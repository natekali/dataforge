/**
 * DataForge V2 — deduplication + benchmark decontamination.
 *
 * Three independent screens over a set of canonical {@link Example}s:
 *
 *  1. {@link exactDuplicates}   — hash-bucketed exact matching on the
 *     normalized full text (lowercase, collapsed whitespace).
 *  2. {@link nearDuplicates}    — MinHash (128 permutations, seeded
 *     FNV-1a-style hashing, zero dependencies) + LSH banding (16 bands ×
 *     8 rows) to generate candidate pairs, then verified word-shingle
 *     Jaccard similarity against a configurable threshold.
 *  3. {@link decontaminate}     — sliding word n-gram screen (13-gram by
 *     default, the de-facto standard from the GPT-3 paper onwards) against an
 *     indexed set of benchmark n-grams.
 *
 * The text basis for every screen is the concatenation of all message
 * `content`, `reasoning`, and tool-call `arguments` strings across
 * `messages`, `chosen`, `rejected`, and `completion` — i.e. two preference
 * examples with identical prompts but different chosen continuations are NOT
 * duplicates of one another.
 *
 * No DOM, no React — safe to run in Web Workers and Node (vitest).
 */

import type { Example, Message } from '@/engine/types';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** One cluster of duplicate examples: keep one, drop the rest. */
export interface DuplicateGroup {
  /** Id of the example to keep (the earliest occurrence in the input). */
  keepId: string;
  /** Ids of the redundant examples, in input order. */
  dropIds: string[];
  reason: 'exact' | 'near';
  /**
   * Exact groups: always 1. Near groups: the minimum verified Jaccard
   * similarity among the pair edges that linked the cluster together — a
   * conservative lower bound on the observed within-group similarity.
   */
  similarity: number;
}

/** A single example flagged as overlapping a benchmark test item. */
export interface ContaminationHit {
  exampleId: string;
  benchmarkName: string;
  /** The first matching normalized word n-gram (space-joined). */
  matchedNgram: string;
}

/** A named benchmark screen: verbatim test-set items to scan against. */
export interface BenchmarkSample {
  name: string;
  items: string[];
}

export interface NearDuplicateOptions {
  /** Verified Jaccard similarity required to call a pair near-duplicates. Default {@link NEAR_DUP_THRESHOLD}. */
  threshold?: number;
  /** Words per shingle. Default {@link NEAR_DUP_SHINGLE_SIZE}. */
  shingleSize?: number;
}

export interface DecontaminateOptions {
  /** Words per n-gram. Default {@link DECONTAMINATION_NGRAM_SIZE}. */
  ngramSize?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default verified-Jaccard threshold for {@link nearDuplicates}. */
export const NEAR_DUP_THRESHOLD = 0.85;

/** Default words-per-shingle for {@link nearDuplicates}. */
export const NEAR_DUP_SHINGLE_SIZE = 3;

/** Only the first ~2000 normalized chars of each example feed near-dup shingling. */
export const NEAR_DUP_MAX_CHARS = 2000;

/** Number of MinHash permutations (= LSH_BANDS × LSH_BAND_ROWS). */
export const MINHASH_PERMUTATIONS = 128;

/** LSH band count. */
export const LSH_BANDS = 16;

/** MinHash rows per LSH band. */
export const LSH_BAND_ROWS = 8;

/** Default n-gram length for {@link decontaminate} (the GPT-3-era standard). */
export const DECONTAMINATION_NGRAM_SIZE = 13;

/**
 * Benchmark items shorter than the n-gram size are indexed whole, but only
 * when they have at least this many words; anything shorter is skipped as
 * too false-positive-prone.
 */
const MIN_FALLBACK_NGRAM_SIZE = 5;

/**
 * Degenerate-bucket safeguard: LSH buckets up to this size are expanded into
 * all pairs; larger buckets pair every member with the bucket's first member
 * only (union-find still merges transitive chains).
 */
const FULL_PAIRWISE_BUCKET_LIMIT = 64;

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** Anything that is not a Unicode letter or digit separates words. */
const NON_WORD = /[^\p{L}\p{N}]+/gu;

// ---------------------------------------------------------------------------
// Hashing (inline FNV-1a; no dependencies)
// ---------------------------------------------------------------------------

/** 32-bit FNV-1a over UTF-16 code units, with an optional seed basis. */
function fnv1a(text: string, seed: number = FNV_OFFSET_BASIS): number {
  let hash = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

/**
 * FNV-1a-style mixing of a base hash with a permutation seed: fold the seed
 * in with xor + FNV-prime multiplies and an avalanche shift. Cheap enough to
 * run 128× per shingle.
 */
function mixHash(base: number, seed: number): number {
  let value = (base ^ seed) >>> 0;
  value = Math.imul(value, FNV_PRIME);
  value ^= value >>> 15;
  value = Math.imul(value, FNV_PRIME);
  return value >>> 0;
}

/** Deterministic per-permutation seeds, derived once at module load. */
const PERMUTATION_SEEDS: Uint32Array = (() => {
  const seeds = new Uint32Array(MINHASH_PERMUTATIONS);
  for (let p = 0; p < MINHASH_PERMUTATIONS; p++) {
    seeds[p] = fnv1a(`dataforge-minhash-permutation-${p}`);
  }
  return seeds;
})();

// ---------------------------------------------------------------------------
// Text extraction + normalization
// ---------------------------------------------------------------------------

function collectMessageText(messages: readonly Message[] | undefined, parts: string[]): void {
  if (!messages) return;
  for (const message of messages) {
    if (message.content) parts.push(message.content);
    if (message.reasoning) parts.push(message.reasoning);
    if (message.toolCalls) {
      for (const call of message.toolCalls) {
        if (call.arguments) parts.push(call.arguments);
      }
    }
  }
}

/** Full comparable text of an example (content + reasoning + tool args). */
function exampleText(example: Example): string {
  const parts: string[] = [];
  collectMessageText(example.messages, parts);
  collectMessageText(example.chosen, parts);
  collectMessageText(example.rejected, parts);
  collectMessageText(example.completion, parts);
  return parts.join('\n');
}

/** Lowercase + collapse all whitespace runs to single spaces + trim. */
function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Lowercased words with all punctuation stripped (Unicode-aware). */
function normalizeWords(text: string): string[] {
  return text.toLowerCase().split(NON_WORD).filter((word) => word.length > 0);
}

// ---------------------------------------------------------------------------
// Exact duplicates
// ---------------------------------------------------------------------------

/**
 * Finds groups of examples whose normalized full text (lowercase, collapsed
 * whitespace) is byte-identical. Hash-bucketed (FNV-1a) with in-bucket string
 * verification, so results are exact even under hash collisions.
 *
 * Examples whose text normalizes to the empty string are skipped — emptiness
 * is a quality issue (`empty_field`), not duplication.
 *
 * Complexity: O(total text length). The first occurrence of each text is the
 * keeper; groups are returned in first-occurrence order.
 */
export function exactDuplicates(examples: Example[]): DuplicateGroup[] {
  interface Bucket {
    text: string;
    ids: string[];
  }
  const byHash = new Map<number, Bucket[]>();
  const inOrder: Bucket[] = [];

  for (const example of examples) {
    const text = normalizeText(exampleText(example));
    if (text.length === 0) continue;
    const hash = fnv1a(text);
    let collisions = byHash.get(hash);
    if (!collisions) {
      collisions = [];
      byHash.set(hash, collisions);
    }
    let bucket = collisions.find((b) => b.text === text);
    if (!bucket) {
      bucket = { text, ids: [] };
      collisions.push(bucket);
      inOrder.push(bucket);
    }
    bucket.ids.push(example.id);
  }

  const groups: DuplicateGroup[] = [];
  for (const bucket of inOrder) {
    if (bucket.ids.length < 2) continue;
    groups.push({
      keepId: bucket.ids[0],
      dropIds: bucket.ids.slice(1),
      reason: 'exact',
      similarity: 1,
    });
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Near duplicates (MinHash + LSH + verified Jaccard)
// ---------------------------------------------------------------------------

/** Word-shingle set hashed to 32-bit ints. Sub-shingle texts get one whole-text shingle. */
function buildShingleSet(words: string[], shingleSize: number): Set<number> {
  const shingles = new Set<number>();
  if (words.length === 0) return shingles;
  if (words.length < shingleSize) {
    shingles.add(fnv1a(words.join(' ')));
    return shingles;
  }
  for (let i = 0; i + shingleSize <= words.length; i++) {
    shingles.add(fnv1a(words.slice(i, i + shingleSize).join(' ')));
  }
  return shingles;
}

/** 128-permutation MinHash signature of a shingle set. */
function minhashSignature(shingles: Set<number>): Uint32Array {
  const signature = new Uint32Array(MINHASH_PERMUTATIONS).fill(0xffffffff);
  for (const shingle of shingles) {
    for (let p = 0; p < MINHASH_PERMUTATIONS; p++) {
      const value = mixHash(shingle, PERMUTATION_SEEDS[p]);
      if (value < signature[p]) signature[p] = value;
    }
  }
  return signature;
}

/** Exact Jaccard similarity of two shingle sets. */
function jaccard(a: Set<number>, b: Set<number>): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let intersection = 0;
  for (const value of small) {
    if (large.has(value)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

/**
 * Finds groups of near-duplicate examples.
 *
 * Pipeline:
 *  1. Shingle the first {@link NEAR_DUP_MAX_CHARS} (~2000) normalized chars
 *     of each example into `shingleSize`-word shingles (default 3).
 *  2. Compute a 128-permutation MinHash signature per example (seeded
 *     FNV-1a-style hashing, no dependencies).
 *  3. LSH-band the signatures (16 bands × 8 rows); examples sharing any band
 *     bucket become candidate pairs.
 *  4. Verify every candidate pair with exact Jaccard on the shingle sets;
 *     pairs at or above `threshold` (default 0.85) are unioned into groups.
 *
 * Complexity: O(n·s·P) signature construction dominates, where n = example
 * count, s = shingles per example (≤ ~330 at the 2000-char cap) and P = 128
 * permutations; LSH bucketing is O(n·16) and verification is proportional to
 * the candidate-pair count, which LSH keeps near-linear for non-degenerate
 * data. 50k typical examples complete in tens of seconds in a worker;
 * degenerate buckets (> {@link FULL_PAIRWISE_BUCKET_LIMIT} members) are
 * paired against a single representative to avoid quadratic blowup.
 *
 * The earliest example (input order) in each group is the keeper. Exact
 * duplicates naturally also appear here with similarity 1; run
 * {@link exactDuplicates} first if you want them separated.
 */
export function nearDuplicates(
  examples: Example[],
  opts: NearDuplicateOptions = {},
): DuplicateGroup[] {
  const threshold = opts.threshold ?? NEAR_DUP_THRESHOLD;
  const shingleSize = opts.shingleSize ?? NEAR_DUP_SHINGLE_SIZE;

  // -- 1+2: shingle sets + signatures (skip examples with no text) ----------
  const ids: string[] = [];
  const shingleSets: Set<number>[] = [];
  const signatures: Uint32Array[] = [];
  for (const example of examples) {
    const normalized = normalizeText(exampleText(example)).slice(0, NEAR_DUP_MAX_CHARS);
    const shingles = buildShingleSet(normalizeWords(normalized), shingleSize);
    if (shingles.size === 0) continue;
    ids.push(example.id);
    shingleSets.push(shingles);
    signatures.push(minhashSignature(shingles));
  }
  const n = ids.length;
  if (n < 2) return [];

  // -- 3: LSH banding --------------------------------------------------------
  const buckets = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const signature = signatures[i];
    for (let band = 0; band < LSH_BANDS; band++) {
      const start = band * LSH_BAND_ROWS;
      let key = String(band);
      for (let row = 0; row < LSH_BAND_ROWS; row++) {
        key += ':' + signature[start + row];
      }
      const members = buckets.get(key);
      if (members) members.push(i);
      else buckets.set(key, [i]);
    }
  }

  // Candidate pairs, deduped across bands. Members are ascending (pushed in
  // index order), so pairs encode as lowIndex * n + highIndex.
  const candidates = new Set<number>();
  for (const members of buckets.values()) {
    if (members.length < 2) continue;
    if (members.length <= FULL_PAIRWISE_BUCKET_LIMIT) {
      for (let a = 0; a < members.length; a++) {
        for (let b = a + 1; b < members.length; b++) {
          candidates.add(members[a] * n + members[b]);
        }
      }
    } else {
      const representative = members[0];
      for (let b = 1; b < members.length; b++) {
        candidates.add(representative * n + members[b]);
      }
    }
  }

  // -- 4: verify + union-find -------------------------------------------------
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };

  const passingEdges: { a: number; b: number; similarity: number }[] = [];
  for (const code of candidates) {
    const a = Math.floor(code / n);
    const b = code % n;
    const similarity = jaccard(shingleSets[a], shingleSets[b]);
    if (similarity >= threshold) {
      passingEdges.push({ a, b, similarity });
      parent[find(a)] = find(b);
    }
  }
  if (passingEdges.length === 0) return [];

  // -- cluster assembly -------------------------------------------------------
  const memberSets = new Map<number, Set<number>>();
  const minSimilarity = new Map<number, number>();
  for (const edge of passingEdges) {
    const root = find(edge.a);
    let members = memberSets.get(root);
    if (!members) {
      members = new Set<number>();
      memberSets.set(root, members);
    }
    members.add(edge.a);
    members.add(edge.b);
    const previous = minSimilarity.get(root);
    minSimilarity.set(
      root,
      previous === undefined ? edge.similarity : Math.min(previous, edge.similarity),
    );
  }

  const ordered: { keepIndex: number; group: DuplicateGroup }[] = [];
  for (const [root, members] of memberSets) {
    const sorted = [...members].sort((a, b) => a - b);
    ordered.push({
      keepIndex: sorted[0],
      group: {
        keepId: ids[sorted[0]],
        dropIds: sorted.slice(1).map((index) => ids[index]),
        reason: 'near',
        similarity: minSimilarity.get(root) ?? threshold,
      },
    });
  }
  ordered.sort((a, b) => a.keepIndex - b.keepIndex);
  return ordered.map((entry) => entry.group);
}

// ---------------------------------------------------------------------------
// Decontamination
// ---------------------------------------------------------------------------

/**
 * Flags examples that share a verbatim word n-gram (default 13 words, the
 * de-facto industry standard) with any item of the given benchmark.
 *
 * Both sides are normalized identically: lowercased, punctuation stripped,
 * split on whitespace. Benchmark items with at least `ngramSize` words are
 * indexed as all sliding `ngramSize`-grams; shorter items with at least 5
 * words are indexed whole (matched with a window of their own length); items
 * below 5 words are skipped as too false-positive-prone.
 *
 * At most one hit is reported per example (the first matching n-gram,
 * longest window first); a flagged example is contaminated either way.
 *
 * Complexity: O(benchmark words) to index, then O(example words × distinct
 * window lengths) to scan.
 */
export function decontaminate(
  examples: Example[],
  benchmark: BenchmarkSample,
  opts: DecontaminateOptions = {},
): ContaminationHit[] {
  const ngramSize = opts.ngramSize ?? DECONTAMINATION_NGRAM_SIZE;

  // -- index benchmark n-grams by window length -------------------------------
  const index = new Map<number, Set<string>>();
  const setFor = (length: number): Set<string> => {
    let set = index.get(length);
    if (!set) {
      set = new Set<string>();
      index.set(length, set);
    }
    return set;
  };
  for (const item of benchmark.items) {
    const words = normalizeWords(item);
    if (words.length >= ngramSize) {
      const set = setFor(ngramSize);
      for (let i = 0; i + ngramSize <= words.length; i++) {
        set.add(words.slice(i, i + ngramSize).join(' '));
      }
    } else if (words.length >= MIN_FALLBACK_NGRAM_SIZE) {
      setFor(words.length).add(words.join(' '));
    }
  }
  if (index.size === 0) return [];

  // Longest window first so the most specific overlap is the one reported.
  const lengths = [...index.keys()].sort((a, b) => b - a);

  // -- scan examples ----------------------------------------------------------
  const hits: ContaminationHit[] = [];
  for (const example of examples) {
    const words = normalizeWords(exampleText(example));
    const matched = findFirstMatch(words, lengths, index);
    if (matched !== undefined) {
      hits.push({ exampleId: example.id, benchmarkName: benchmark.name, matchedNgram: matched });
    }
  }
  return hits;
}

function findFirstMatch(
  words: string[],
  lengths: number[],
  index: Map<number, Set<string>>,
): string | undefined {
  for (const length of lengths) {
    if (words.length < length) continue;
    const set = index.get(length);
    if (!set) continue;
    for (let i = 0; i + length <= words.length; i++) {
      const gram = words.slice(i, i + length).join(' ');
      if (set.has(gram)) return gram;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Built-in benchmark samples
// ---------------------------------------------------------------------------

/**
 * Built-in decontamination screens — a PARTIAL sample, NOT full benchmarks.
 *
 * Each entry holds ~10 distinctive verbatim test-set items (reproduced from
 * the public test splits of GSM8K, MMLU, HumanEval, and MT-Bench) so the
 * default scan can catch the most common copy-paste contamination. Passing
 * this screen does NOT certify a dataset as decontaminated: full benchmarks
 * have hundreds to thousands of items. For a rigorous screen, load the
 * complete benchmark test split and call {@link decontaminate} with it.
 */
export const BUILTIN_BENCHMARK_SAMPLES: BenchmarkSample[] = [
  {
    name: 'GSM8K',
    items: [
      "Janet's ducks lay 16 eggs per day. She eats three for breakfast every morning and bakes muffins for her friends every day with four. She sells the remainder at the farmers' market daily for $2 per fresh duck egg. How much in dollars does she make every day at the farmers' market?",
      'A robe takes 2 bolts of blue fiber and half that much white fiber. How many bolts in total does it take?',
      'Josh decides to try flipping a house. He buys a house for $80,000 and then puts in $50,000 in repairs. This increased the value of the house by 150%. How much profit did he make?',
      'James decides to run 3 sprints 3 times a week. He runs 60 meters each sprint. How many total meters does he run a week?',
      "Every day, Wendi feeds each of her chickens three cups of mixed chicken feed, containing seeds, mealworms and vegetables to help keep them healthy. She gives the chickens their feed in three separate meals. In the morning, she gives her flock of chickens 15 cups of feed. In the afternoon, she gives her chickens another 25 cups of feed. How many cups of feed does she need to give her chickens in the final meal of the day if the size of Wendi's flock is 20 chickens?",
      'Kylar went to the store to buy glasses for his new apartment. One glass costs $5, but every second glass costs only 60% of the price. Kylar wants to buy 16 glasses. How much does he need to pay for them?',
      'Toulouse has twice as many sheep as Charleston. Charleston has 4 times as many sheep as Seattle. How many sheep do Toulouse, Charleston, and Seattle have together if Seattle has 20 sheep?',
      'Carla is downloading a 200 GB file. Normally she can download 2 GB/minute, but 40% of the way through the download, Windows forces a restart to install updates, which takes 20 minutes. Then Carla has to restart the download from the beginning. How load does it take to download the file?',
      "Eliza's rate per hour for the first 40 hours she works each week is $10. She also receives an overtime pay of 1.2 times her regular hourly rate. If Eliza worked for 45 hours this week, how much are her earnings for this week?",
      'A new program had 60 downloads in the first month. The number of downloads in the second month was three times as many as the downloads in the first month, but then the number of downloads in the third month was reduced by 30%. How many downloads did the program have total over the three months?',
    ],
  },
  {
    name: 'MMLU',
    items: [
      'Find the degree for the given field extension Q(sqrt(2), sqrt(3), sqrt(18)) over Q.',
      'Find all c in Z_3 such that Z_3[x]/(x^2 + c) is a field.',
      'Statement 1 | If aH is an element of a factor group, then |aH| divides |a|. Statement 2 | If H and K are subgroups of G then HK is a subgroup of G.',
      'What is the embryological origin of the hyoid bone?',
      'Which of the following is the body cavity that contains the pituitary gland?',
      'Which of the following represents an accurate statement concerning arthropods?',
      'In a given population, 1 out of every 400 people has a cancer caused by a completely recessive allele, b. Assuming the population is in Hardy-Weinberg equilibrium, which of the following is the expected proportion of individuals who carry the b allele but are not expected to develop the cancer?',
      'How many attempts should you make to cannulate a patient before passing the job on to a senior colleague, according to the medical knowledge of 2020?',
      "As of 2017, how many of the world's 1-year-old children today have been vaccinated against some disease?",
      'What place is named in the title of the 1979 live album by rock legends Cheap Trick?',
    ],
  },
  {
    name: 'HumanEval',
    items: [
      'Check if in given list of numbers, are any two numbers closer to each other than given threshold.',
      'Input to this function is a string containing multiple groups of nested parentheses. Your goal is to separate those group into separate strings and return the list of those. Separate groups are balanced (each open brace is properly closed) and not nested within each other. Ignore any spaces in the input string.',
      'Given a positive floating point number, it can be decomposed into an integer part (largest integer smaller than given number) and decimals (leftover part always smaller than 1). Return the decimal part of the number.',
      "You're given a list of deposit and withdrawal operations on a bank account that starts with zero balance. Your task is to detect if at any point the balance of account falls below zero, and at that point function should return True. Otherwise it should return False.",
      'For a given list of input numbers, calculate Mean Absolute Deviation around the mean of this dataset. Mean Absolute Deviation is the average absolute difference between each element and a centerpoint (mean in this case)',
      "Insert a number 'delimeter' between every two consecutive elements of input list `numbers'",
      'Filter an input list of strings only for ones that contain given substring',
      'Return list of prime factors of given integer in the order from smallest to largest. Each of the factors should be listed number of times corresponding to how many times it appeares in factorization. Input number should be equal to the product of all factors.',
      'From a given list of integers, generate a list of rolling maximum element found until given moment in the sequence.',
      'From a supplied list of numbers (of length at least two) select and return two that are the closest to each other and return them in order (smaller number, larger number).',
    ],
  },
  {
    name: 'MT-Bench',
    items: [
      'Compose an engaging travel blog post about a recent trip to Hawaii, highlighting cultural experiences and must-see attractions.',
      "Draft a professional email seeking your supervisor's feedback on the 'Quarterly Financial Report' you prepared. Ask specifically about the data analysis, presentation style, and the clarity of conclusions drawn. Keep the email short and to the point.",
      'Write a persuasive email to convince your introverted friend, who dislikes public speaking, to volunteer as a guest speaker at a local event. Use compelling arguments and address potential objections. Please be concise.',
      'Could you write a captivating short story beginning with the sentence: The old abandoned house at the end of the street held a secret that no one had ever discovered.',
      'Craft an intriguing opening paragraph for a fictional short story. The story should involve a character who wakes up one morning to find that they can time travel.',
      'Pretend yourself to be Elon Musk in all the following conversations. Speak like Elon Musk as much as possible. Why do we need to go to Mars?',
      'Suppose you are a mathematician and poet. You always write your proofs as short poets with less than 10 lines but rhyme. Prove the square root of 2 is irrational number.',
      "Imagine you are participating in a race with a group of people. If you have just overtaken the second person, what's your current position? Where is the person you just overtook?",
      'David has three sisters. Each of them has one brother. How many brothers does David have?',
      'Thomas is very healthy, but he has to go to the hospital every day. What could be the reasons?',
    ],
  },
];

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * Applies duplicate groups to an example list: every id listed in any
 * group's `dropIds` is removed; everything else is kept (input order
 * preserved). `dropped` contains only ids that were actually present, in
 * input order. If an id is a keeper in one group but a drop in another,
 * dropping wins.
 */
export function applyDuplicateResolution(
  examples: Example[],
  groups: DuplicateGroup[],
): { kept: Example[]; dropped: string[] } {
  const dropSet = new Set<string>();
  for (const group of groups) {
    for (const id of group.dropIds) dropSet.add(id);
  }
  const kept: Example[] = [];
  const dropped: string[] = [];
  for (const example of examples) {
    if (dropSet.has(example.id)) dropped.push(example.id);
    else kept.push(example);
  }
  return { kept, dropped };
}
