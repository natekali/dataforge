import { describe, expect, it } from 'vitest';
import type { Example } from '@/engine/types';
import { createExample } from '@/engine/types';
import {
  BUILTIN_BENCHMARK_SAMPLES,
  DECONTAMINATION_NGRAM_SIZE,
  LSH_BANDS,
  LSH_BAND_ROWS,
  MINHASH_PERMUTATIONS,
  NEAR_DUP_SHINGLE_SIZE,
  NEAR_DUP_THRESHOLD,
  applyDuplicateResolution,
  decontaminate,
  exactDuplicates,
  nearDuplicates,
} from '@/engine/dedup';

const PROJECT = 'project-1';

/** Single-user-message example with a fixed id. */
function ex(id: string, text: string, extra: Partial<Example> = {}): Example {
  return createExample({
    id,
    projectId: PROJECT,
    messages: [{ role: 'user', content: text }],
    ...extra,
  });
}

/** Deterministic PRNG (mulberry32) so tests never flake. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** n words drawn from a synthetic vocab of `vocab` entries. */
function randomWords(rng: () => number, n: number, vocab: number): string[] {
  const words: string[] = [];
  for (let i = 0; i < n; i++) words.push(`w${Math.floor(rng() * vocab)}`);
  return words;
}

/** 60 distinct words — one shared base for the paraphrase tests. */
const BASE_WORDS = Array.from({ length: 60 }, (_, i) => `alpha${i}`);

// ---------------------------------------------------------------------------
// exactDuplicates
// ---------------------------------------------------------------------------

describe('exactDuplicates', () => {
  it('groups texts that are identical after lowercasing + whitespace collapse', () => {
    const groups = exactDuplicates([
      ex('a', 'Hello   World'),
      ex('b', 'hello world\n'),
      ex('c', '  HELLO\tWORLD  '),
      ex('d', 'something else entirely'),
    ]);
    expect(groups).toEqual([
      { keepId: 'a', dropIds: ['b', 'c'], reason: 'exact', similarity: 1 },
    ]);
  });

  it('returns no groups for distinct texts', () => {
    expect(exactDuplicates([ex('a', 'one'), ex('b', 'two'), ex('c', 'three')])).toEqual([]);
  });

  it('returns multiple groups in first-occurrence order', () => {
    const groups = exactDuplicates([
      ex('a', 'first text'),
      ex('b', 'second text'),
      ex('c', 'second text'),
      ex('d', 'first text'),
    ]);
    expect(groups).toEqual([
      { keepId: 'a', dropIds: ['d'], reason: 'exact', similarity: 1 },
      { keepId: 'b', dropIds: ['c'], reason: 'exact', similarity: 1 },
    ]);
  });

  it('skips examples whose text is empty', () => {
    expect(exactDuplicates([ex('a', ''), ex('b', '   '), ex('c', '\n\t')])).toEqual([]);
  });

  it('includes chosen/rejected/completion and reasoning in the comparison', () => {
    const prompt = 'Pick the better continuation.';
    const samePrompt = (id: string, chosenText: string): Example =>
      ex(id, prompt, {
        type: 'preference',
        chosen: [{ role: 'assistant', content: chosenText }],
        rejected: [{ role: 'assistant', content: 'meh' }],
      });
    // Same prompt, different chosen — NOT duplicates.
    expect(exactDuplicates([samePrompt('a', 'great answer'), samePrompt('b', 'other answer')]))
      .toEqual([]);
    // Same prompt, same chosen — duplicates.
    expect(exactDuplicates([samePrompt('c', 'great answer'), samePrompt('d', 'great answer')]))
      .toHaveLength(1);
    // Same content, different reasoning — NOT duplicates.
    const withReasoning = (id: string, reasoning: string): Example =>
      createExample({
        id,
        projectId: PROJECT,
        messages: [
          { role: 'user', content: 'q' },
          { role: 'assistant', content: 'a', reasoning },
        ],
      });
    expect(exactDuplicates([withReasoning('e', 'because x'), withReasoning('f', 'because y')]))
      .toEqual([]);
  });

  it('distinguishes by tool-call arguments', () => {
    const withCall = (id: string, args: string): Example =>
      createExample({
        id,
        projectId: PROJECT,
        messages: [
          { role: 'user', content: 'look it up' },
          { role: 'assistant', content: '', toolCalls: [{ id: 'call_1', name: 'search', arguments: args }] },
        ],
      });
    expect(exactDuplicates([withCall('a', '{"q":"cats"}'), withCall('b', '{"q":"dogs"}')])).toEqual([]);
    expect(exactDuplicates([withCall('c', '{"q":"cats"}'), withCall('d', '{"q":"cats"}')])).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// nearDuplicates
// ---------------------------------------------------------------------------

describe('nearDuplicates', () => {
  it('exposes consistent tuning constants', () => {
    expect(NEAR_DUP_THRESHOLD).toBe(0.85);
    expect(NEAR_DUP_SHINGLE_SIZE).toBe(3);
    expect(MINHASH_PERMUTATIONS).toBe(LSH_BANDS * LSH_BAND_ROWS);
  });

  it('catches paraphrase-level overlap at the default threshold', () => {
    const original = BASE_WORDS.join(' ');
    // Change two adjacent words mid-text: 58 shingles each, 54 shared,
    // Jaccard = 54 / 62 ≈ 0.871 — above the 0.85 default.
    const edited = [...BASE_WORDS];
    edited[30] = 'changed1';
    edited[31] = 'changed2';
    const groups = nearDuplicates([
      ex('orig', original),
      ex('edit', edited.join(' ')),
      ex('other', 'a completely unrelated short sentence about gardening tools'),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].keepId).toBe('orig');
    expect(groups[0].dropIds).toEqual(['edit']);
    expect(groups[0].reason).toBe('near');
    expect(groups[0].similarity).toBeGreaterThanOrEqual(0.85);
    expect(groups[0].similarity).toBeLessThan(1);
    expect(groups[0].similarity).toBeCloseTo(54 / 62, 5);
  });

  it('respects a stricter threshold', () => {
    const edited = [...BASE_WORDS];
    edited[30] = 'changed1';
    edited[31] = 'changed2';
    const examples = [ex('orig', BASE_WORDS.join(' ')), ex('edit', edited.join(' '))];
    expect(nearDuplicates(examples, { threshold: 0.95 })).toEqual([]);
    expect(nearDuplicates(examples, { threshold: 0.85 })).toHaveLength(1);
  });

  it('respects the shingleSize option', () => {
    const shuffled = [...BASE_WORDS].reverse();
    const examples = [ex('a', BASE_WORDS.join(' ')), ex('b', shuffled.join(' '))];
    // Word order destroyed: 3-shingles barely overlap.
    expect(nearDuplicates(examples)).toEqual([]);
    // Bag-of-words (1-shingles) is identical.
    const unigram = nearDuplicates(examples, { shingleSize: 1 });
    expect(unigram).toHaveLength(1);
    expect(unigram[0].similarity).toBe(1);
  });

  it('reports identical examples with similarity 1', () => {
    const text = BASE_WORDS.slice(0, 30).join(' ');
    const groups = nearDuplicates([ex('a', text), ex('b', text), ex('c', text)]);
    expect(groups).toHaveLength(1);
    expect(groups[0].keepId).toBe('a');
    expect([...groups[0].dropIds].sort()).toEqual(['b', 'c']);
    expect(groups[0].similarity).toBe(1);
  });

  it('returns no groups for unrelated texts and ignores empty examples', () => {
    const rng = mulberry32(7);
    const examples = [
      ex('a', randomWords(rng, 50, 5000).join(' ')),
      ex('b', randomWords(rng, 50, 5000).join(' ')),
      ex('empty', ''),
    ];
    expect(nearDuplicates(examples)).toEqual([]);
  });

  it('LSH finds a planted near-pair among 500 random examples', () => {
    const rng = mulberry32(42);
    const examples: Example[] = [];
    for (let i = 0; i < 500; i++) {
      examples.push(ex(`rand-${i}`, randomWords(rng, 45, 800).join(' ')));
    }
    const planted = randomWords(rng, 60, 800);
    const variant = [...planted];
    variant[20] = 'mutated';
    examples.splice(137, 0, ex('planted-a', planted.join(' ')));
    examples.splice(411, 0, ex('planted-b', variant.join(' ')));

    const groups = nearDuplicates(examples);
    const plantedGroup = groups.find(
      (g) => g.keepId === 'planted-a' && g.dropIds.includes('planted-b'),
    );
    expect(plantedGroup).toBeDefined();
    expect(plantedGroup?.similarity).toBeGreaterThanOrEqual(0.85);
    // No random example should be swept into a group.
    for (const group of groups) {
      expect([group.keepId, ...group.dropIds].every((id) => id.startsWith('planted-'))).toBe(true);
    }
  });

  it('handles fewer than two usable examples', () => {
    expect(nearDuplicates([])).toEqual([]);
    expect(nearDuplicates([ex('a', 'just one example here')])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// decontaminate
// ---------------------------------------------------------------------------

describe('decontaminate', () => {
  const gsm8k = BUILTIN_BENCHMARK_SAMPLES.find((b) => b.name === 'GSM8K');
  if (!gsm8k) throw new Error('GSM8K sample missing');
  const janet = gsm8k.items[0];

  it('flags a planted GSM8K question via a 13-gram', () => {
    const examples = [
      ex('clean', 'A farmer has 12 cows and sells half of them. How many are left?'),
      ex('dirty', `Please solve this problem step by step. ${janet} Show your work.`),
    ];
    const hits = decontaminate(examples, gsm8k);
    expect(hits).toHaveLength(1);
    expect(hits[0].exampleId).toBe('dirty');
    expect(hits[0].benchmarkName).toBe('GSM8K');
    expect(hits[0].matchedNgram.split(' ')).toHaveLength(DECONTAMINATION_NGRAM_SIZE);
    // The matched n-gram is verbatim from the planted question (normalized).
    const normalizedJanet = janet.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    expect(normalizedJanet).toContain(hits[0].matchedNgram);
  });

  it('is case- and punctuation-insensitive', () => {
    const shouted = janet.toUpperCase().replace(/\./g, '!!!');
    const hits = decontaminate([ex('shouted', shouted)], gsm8k);
    expect(hits).toHaveLength(1);
    expect(hits[0].exampleId).toBe('shouted');
  });

  it('scans assistant completions, not just prompts', () => {
    const example = createExample({
      id: 'kto-1',
      projectId: PROJECT,
      type: 'kto',
      messages: [{ role: 'user', content: 'Give me a math problem.' }],
      completion: [{ role: 'assistant', content: `Sure: ${janet}` }],
      label: true,
    });
    expect(decontaminate([example], gsm8k)).toHaveLength(1);
  });

  it('produces no hits for clean examples', () => {
    const examples = [
      ex('a', 'Explain how photosynthesis converts light energy into chemical energy in plants.'),
      ex('b', 'Write a haiku about the changing of the seasons in northern latitudes.'),
    ];
    for (const benchmark of BUILTIN_BENCHMARK_SAMPLES) {
      expect(decontaminate(examples, benchmark)).toEqual([]);
    }
  });

  it('honors a custom ngramSize', () => {
    const benchmark = { name: 'custom', items: ['the quick brown fox jumps over the lazy dog'] };
    const example = ex('e', 'watch the quick brown fox jumps away');
    // 5-gram "the quick brown fox jumps" is present.
    const hits = decontaminate([example], benchmark, { ngramSize: 5 });
    expect(hits).toHaveLength(1);
    expect(hits[0].matchedNgram).toBe('the quick brown fox jumps');
    // At the default 13, the 9-word item is indexed whole and does not match.
    expect(decontaminate([example], benchmark)).toEqual([]);
  });

  it('indexes short benchmark items (5..n-1 words) whole', () => {
    const benchmark = { name: 'short', items: ['what is the judge ad hoc'] };
    const hits = decontaminate(
      [ex('d', 'Question: what is the judge ad hoc? Answer below.'), ex('c', 'what is the judge?')],
      benchmark,
    );
    expect(hits).toHaveLength(1);
    expect(hits[0].exampleId).toBe('d');
  });

  it('skips benchmark items below the 5-word floor', () => {
    const benchmark = { name: 'tiny', items: ['the pleura', 'who am i'] };
    expect(decontaminate([ex('a', 'the pleura is a membrane and who am i to argue')], benchmark))
      .toEqual([]);
  });

  it('reports at most one hit per example', () => {
    const dirty = ex('dirty', `${gsm8k.items[0]} and also ${gsm8k.items[1]}`);
    expect(decontaminate([dirty], gsm8k)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// BUILTIN_BENCHMARK_SAMPLES
// ---------------------------------------------------------------------------

describe('BUILTIN_BENCHMARK_SAMPLES', () => {
  it('covers the four screens with ~40 items total', () => {
    expect(BUILTIN_BENCHMARK_SAMPLES.map((b) => b.name)).toEqual([
      'GSM8K',
      'MMLU',
      'HumanEval',
      'MT-Bench',
    ]);
    const total = BUILTIN_BENCHMARK_SAMPLES.reduce((sum, b) => sum + b.items.length, 0);
    expect(total).toBe(40);
  });

  it('every item is non-empty and indexable (>= 5 words)', () => {
    for (const benchmark of BUILTIN_BENCHMARK_SAMPLES) {
      for (const item of benchmark.items) {
        const words = item.toLowerCase().split(/[^\p{L}\p{N}]+/gu).filter((w) => w.length > 0);
        expect(words.length).toBeGreaterThanOrEqual(5);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// applyDuplicateResolution
// ---------------------------------------------------------------------------

describe('applyDuplicateResolution', () => {
  it('drops every dropId and keeps the rest in input order', () => {
    const examples = [ex('a', 'one'), ex('b', 'two'), ex('c', 'three'), ex('d', 'four')];
    const { kept, dropped } = applyDuplicateResolution(examples, [
      { keepId: 'a', dropIds: ['c'], reason: 'exact', similarity: 1 },
      { keepId: 'b', dropIds: ['d'], reason: 'near', similarity: 0.9 },
    ]);
    expect(kept.map((e) => e.id)).toEqual(['a', 'b']);
    expect(dropped).toEqual(['c', 'd']);
  });

  it('ignores dropIds that are not present', () => {
    const examples = [ex('a', 'one')];
    const { kept, dropped } = applyDuplicateResolution(examples, [
      { keepId: 'x', dropIds: ['ghost'], reason: 'exact', similarity: 1 },
    ]);
    expect(kept.map((e) => e.id)).toEqual(['a']);
    expect(dropped).toEqual([]);
  });

  it('is the identity for empty groups', () => {
    const examples = [ex('a', 'one'), ex('b', 'two')];
    const { kept, dropped } = applyDuplicateResolution(examples, []);
    expect(kept).toHaveLength(2);
    expect(dropped).toEqual([]);
  });

  it('dropping wins when an id is keeper in one group and drop in another', () => {
    const examples = [ex('a', 'one'), ex('b', 'two'), ex('c', 'three')];
    const { kept, dropped } = applyDuplicateResolution(examples, [
      { keepId: 'a', dropIds: ['b'], reason: 'near', similarity: 0.9 },
      { keepId: 'b', dropIds: ['c'], reason: 'near', similarity: 0.9 },
    ]);
    expect(kept.map((e) => e.id)).toEqual(['a']);
    expect(dropped).toEqual(['b', 'c']);
  });
});

// ---------------------------------------------------------------------------
// Performance smoke
// ---------------------------------------------------------------------------

describe('performance', () => {
  it('handles 5k synthetic examples in a few seconds', () => {
    const rng = mulberry32(1234);
    const examples: Example[] = [];
    for (let i = 0; i < 5000; i++) {
      examples.push(ex(`perf-${i}`, randomWords(rng, 40, 1000).join(' ')));
    }
    // Plant one exact and one near duplicate so the pipeline does real work.
    examples.push(ex('perf-exact', examples[100].messages[0].content));
    const nearWords = examples[200].messages[0].content.split(' ');
    nearWords[5] = 'mutatedword';
    examples.push(ex('perf-near', nearWords.join(' ')));

    const start = performance.now();
    const exact = exactDuplicates(examples);
    const near = nearDuplicates(examples);
    const contamination = BUILTIN_BENCHMARK_SAMPLES.flatMap((b) => decontaminate(examples, b));
    const elapsed = performance.now() - start;

    expect(exact.some((g) => g.dropIds.includes('perf-exact'))).toBe(true);
    expect(
      near.some((g) => [g.keepId, ...g.dropIds].includes('perf-near')),
    ).toBe(true);
    expect(contamination).toEqual([]);
    expect(elapsed).toBeLessThan(10_000);
  });
});
