/**
 * Typed prompt builders for every AI operation in DataForge.
 *
 * Each builder returns a {@link PromptPair} (system + user message) and every
 * generation/judging prompt demands STRICT JSON output with an explicit schema
 * example, so downstream parsing can be deterministic. The strict-JSON
 * counterpart, {@link extractStrictJson}, lives here too: it tolerates code
 * fences and prose-wrapped output while still rejecting non-JSON garbage.
 *
 * Runtime-environment agnostic: no DOM, no React — safe in workers and Node.
 */
import type { Message } from '@/engine/types';

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

/** A system + user prompt pair ready to be sent as two chat messages. */
export interface PromptPair {
  system: string;
  user: string;
}

/** Enhancement operations supported by {@link buildEnhancePrompt}. */
export type EnhanceOp =
  | 'improve-quality'
  | 'add-reasoning'
  | 'expand'
  | 'add-code-examples'
  | 'simplify'
  | 'custom';

/** Output style for document-grounded generation. */
export type DocGenStyle = 'qa' | 'instruction' | 'summary';

/** Evol-Instruct evolution direction. */
export type EvolDirection = 'depth' | 'breadth';

/** A seed instruction (+ optional reference response) for synthetic generation. */
export interface SeedPair {
  instruction: string;
  response?: string;
}

// ---------------------------------------------------------------------------
// Built-in personas
// ---------------------------------------------------------------------------

/**
 * ~30 deliberately diverse personas used by persona-driven generation.
 * They span professions, expertise levels, ages and goals so generated
 * instructions cover a wide stylistic and topical range.
 */
export const PERSONAS: readonly string[] = [
  'a curious high-school student exploring science',
  'a senior backend engineer optimizing distributed systems',
  'a nurse working night shifts in an intensive-care unit',
  'a small-business owner running a neighborhood bakery',
  'a freelance graphic designer learning to code',
  'a retired history teacher researching family genealogy',
  'a PhD candidate in computational biology',
  'a startup founder preparing an investor pitch',
  'a parent homeschooling two elementary-school children',
  'a professional translator working across four languages',
  'a farmer adopting precision-agriculture tools',
  'a paralegal drafting contract summaries under deadline',
  'a game developer building an indie roguelike',
  'a financial analyst modelling discounted cash flows',
  'a travel blogger planning a multi-country itinerary',
  'a mechanical engineer designing consumer hardware',
  'a social worker coordinating community outreach programs',
  'a chef costing out a new seasonal menu',
  'a journalist fact-checking a breaking story',
  'a competitive chess player studying opening theory',
  'a physical therapist designing rehabilitation plans',
  'a city planner evaluating public-transit proposals',
  'a novelist outlining a mystery trilogy',
  'a DevOps engineer hardening CI/CD pipelines',
  'an amateur astronomer photographing deep-sky objects',
  'a pharmacist counselling patients on drug interactions',
  'a marketing manager running A/B experiments',
  'an electrician studying for a master certification exam',
  'a museum curator writing exhibit descriptions',
  'a volunteer firefighter training new recruits',
];

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const STRICT_JSON_RULES =
  'Respond with STRICT JSON only: a single JSON value that matches the requested schema exactly. ' +
  'No markdown code fences, no commentary, no text before or after the JSON.';

const GENERATION_SCHEMA =
  '{"examples":[{"instruction":"<user request>","response":"<assistant answer>"}]}';

const ENHANCE_SCHEMA =
  '{"messages":[{"role":"user","content":"<unchanged>"},' +
  '{"role":"assistant","content":"<improved answer>","reasoning":"<optional step-by-step trace>"}]}';

const JUDGE_SCHEMA =
  '{"helpfulness":7,"correctness":9,"clarity":8,"verdict":"pass","rationale":"<one or two sentences>"}';

const RANKING_SCHEMA = '{"ranking":[2,1,3],"tie":false,"rationale":"<short justification>"}';

/** Truncate long text for prompt embedding, appending an ellipsis. */
function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

/** Anti-duplication marker that also makes per-batch cache keys distinct. */
function batchLine(batchIndex: number): string {
  return (
    `This is batch ${batchIndex + 1} of a larger generation run. ` +
    'Generate examples clearly distinct from what any other batch would produce: vary topics, angles, formats and phrasing.'
  );
}

/** Numbered seed list for self-/evol-instruct prompts. */
function formatSeeds(seeds: SeedPair[]): string {
  return seeds
    .map((seed, i) => {
      const lines = [`${i + 1}. Instruction: ${truncate(seed.instruction, 600)}`];
      if (seed.response !== undefined && seed.response.trim() !== '') {
        lines.push(`   Response: ${truncate(seed.response, 600)}`);
      }
      return lines.join('\n');
    })
    .join('\n');
}

/** Serialize a conversation as pretty JSON for round-trip enhancement prompts. */
function serializeConversation(messages: Message[]): string {
  return JSON.stringify(
    {
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.reasoning !== undefined && m.reasoning !== '' ? { reasoning: m.reasoning } : {}),
      })),
    },
    null,
    2,
  );
}

// ---------------------------------------------------------------------------
// Transcript rendering (shared by judge + preference ranking)
// ---------------------------------------------------------------------------

/**
 * Render a conversation as a plain-text transcript with role headers,
 * including reasoning traces and tool calls, for judge-style prompts.
 *
 * @param messages - Canonical messages to render.
 * @returns A human-readable transcript (empty string for no messages).
 */
export function conversationTranscript(messages: Message[]): string {
  return messages
    .map((m) => {
      const parts: string[] = [`### ${m.role.toUpperCase()}`];
      if (m.reasoning !== undefined && m.reasoning.trim() !== '') {
        parts.push(`[reasoning]\n${m.reasoning.trim()}\n[/reasoning]`);
      }
      if (m.content.trim() !== '') parts.push(m.content);
      for (const call of m.toolCalls ?? []) {
        parts.push(`[tool_call] ${call.name}(${call.arguments})`);
      }
      return parts.join('\n');
    })
    .join('\n\n');
}

// ---------------------------------------------------------------------------
// Enhancement prompts
// ---------------------------------------------------------------------------

const ENHANCE_DIRECTIVES: Record<Exclude<EnhanceOp, 'custom'>, string> = {
  'improve-quality':
    'Rewrite each assistant response to be more helpful, accurate and well-structured. ' +
    'Preserve the original intent and factual content, fix errors, remove filler and repetition, ' +
    'and improve formatting (headings, lists, code blocks) where it genuinely helps.',
  'add-reasoning':
    'Add a high-quality step-by-step reasoning trace for the FINAL assistant response. ' +
    'Place the trace in that message\'s "reasoning" field (preferred) or in a leading <think>…</think> block of its content. ' +
    'The visible "content" must remain a polished final answer with no reasoning artifacts.',
  expand:
    'Expand each assistant response to be more detailed and comprehensive: add relevant explanations, ' +
    'concrete examples and edge cases. Do not pad with generic filler or restate the question.',
  'add-code-examples':
    'Where a code example would genuinely improve the assistant response, add well-commented, runnable, ' +
    'idiomatic code in fenced code blocks (inside the JSON string). Leave responses that need no code unchanged.',
  simplify:
    'Simplify each assistant response: shorter sentences, plain language, no jargon without explanation. ' +
    'Keep it correct and complete while making it accessible to a non-expert.',
};

/**
 * Build the enhancement prompt for one example conversation.
 *
 * The model must return the COMPLETE conversation as strict JSON, modifying
 * only assistant messages, so the caller can merge results back safely.
 *
 * @param op                - Enhancement operation to perform.
 * @param messages          - The conversation to enhance.
 * @param customInstruction - Required when `op === 'custom'`.
 * @throws Error when `op` is `'custom'` and no instruction is provided.
 */
export function buildEnhancePrompt(
  op: EnhanceOp,
  messages: Message[],
  customInstruction?: string,
): PromptPair {
  let directive: string;
  if (op === 'custom') {
    const instruction = customInstruction?.trim();
    if (instruction === undefined || instruction === '') {
      throw new Error('custom enhancement requires a customInstruction');
    }
    directive = `Apply this instruction to the assistant messages: ${instruction}`;
  } else {
    directive = ENHANCE_DIRECTIVES[op];
  }

  const system =
    'You are an expert dataset engineer improving fine-tuning training data. ' +
    'You rewrite assistant responses while preserving every other message exactly. ' +
    STRICT_JSON_RULES;

  const user = [
    directive,
    '',
    'Return STRICT JSON matching exactly this schema:',
    ENHANCE_SCHEMA,
    '',
    'Rules:',
    '- Return EVERY message of the conversation, in the original order, with the original roles.',
    '- Modify ONLY assistant messages; copy system, user and tool messages verbatim.',
    '- Write in the same language as the original conversation.',
    ...(op === 'add-reasoning'
      ? [
          '- Add the reasoning trace only to the FINAL assistant message.',
          '- The trace must show genuine step-by-step thinking that leads to the answer.',
        ]
      : []),
    '',
    'Conversation JSON:',
    serializeConversation(messages),
  ].join('\n');

  return { system, user };
}

// ---------------------------------------------------------------------------
// Synthetic generation prompts
// ---------------------------------------------------------------------------

const GENERATOR_SYSTEM =
  'You are a synthetic training-data generator producing diverse, high-quality ' +
  'instruction/response pairs for supervised fine-tuning. Responses must be genuinely ' +
  'excellent: accurate, complete and well-formatted. ' +
  STRICT_JSON_RULES;

function generationContract(count: number): string[] {
  return [
    '',
    `Return STRICT JSON matching exactly this schema, with exactly ${count} entries in "examples":`,
    GENERATION_SCHEMA,
    '',
    'Rules:',
    '- "instruction" is what a real user would write; "response" is the ideal assistant answer.',
    '- Every entry must be self-contained and independent of the others.',
    '- No two entries may share a topic or phrasing.',
  ];
}

/** Options for {@link buildSelfInstructPrompt}. */
export interface SelfInstructPromptOptions {
  /** Seed pairs the new examples should be inspired by (not copied from). */
  seeds: SeedPair[];
  /** Number of new examples to request. */
  count: number;
  /** 0-based batch number (varies the prompt across batches). */
  batchIndex: number;
}

/**
 * Self-Instruct style generation: new tasks inspired by seed examples.
 *
 * @throws Error when no seeds are provided.
 */
export function buildSelfInstructPrompt(opts: SelfInstructPromptOptions): PromptPair {
  if (opts.seeds.length === 0) throw new Error('self-instruct requires at least one seed example');
  const user = [
    'Here are seed examples from an existing dataset:',
    '',
    formatSeeds(opts.seeds),
    '',
    `Generate ${opts.count} brand-new instruction/response pairs INSPIRED BY the seeds but not copying them. ` +
      'Match the general domain and tone while varying topic, difficulty, length and format.',
    batchLine(opts.batchIndex),
    ...generationContract(opts.count),
  ].join('\n');
  return { system: GENERATOR_SYSTEM, user };
}

/** Options for {@link buildEvolInstructPrompt}. */
export interface EvolInstructPromptOptions {
  /** Seed pairs whose instructions will be evolved. */
  seeds: SeedPair[];
  /** Number of evolved examples to request. */
  count: number;
  /** depth = harder/more constrained; breadth = adjacent topics, same difficulty. */
  direction: EvolDirection;
  /** 0-based batch number. */
  batchIndex: number;
}

/**
 * Evol-Instruct style generation: evolve seed instructions in depth (more
 * complex) or breadth (adjacent domains), each with a full new response.
 *
 * @throws Error when no seeds are provided.
 */
export function buildEvolInstructPrompt(opts: EvolInstructPromptOptions): PromptPair {
  if (opts.seeds.length === 0) throw new Error('evol-instruct requires at least one seed example');
  const evolution =
    opts.direction === 'depth'
      ? 'Evolve each seed instruction IN DEPTH: add constraints, multi-step requirements, edge cases or ' +
        'rarely-considered details so the task demands deeper reasoning than the seed.'
      : 'Evolve each seed instruction IN BREADTH: create new instructions in adjacent domains or from new ' +
        'angles, at a similar difficulty, that broaden topic coverage beyond the seeds.';
  const user = [
    'Here are seed instructions from an existing dataset:',
    '',
    formatSeeds(opts.seeds),
    '',
    evolution,
    `Generate ${opts.count} evolved instructions, each paired with an excellent complete response.`,
    batchLine(opts.batchIndex),
    ...generationContract(opts.count),
  ].join('\n');
  return { system: GENERATOR_SYSTEM, user };
}

/** Options for {@link buildPersonaPrompt}. */
export interface PersonaPromptOptions {
  /** Personas to adopt (rotate a slice of {@link PERSONAS} per batch). */
  personas: readonly string[];
  /** Optional topic constraint. */
  topic?: string;
  /** Number of examples to request. */
  count: number;
  /** 0-based batch number. */
  batchIndex: number;
}

/**
 * Persona-driven generation: realistic questions asked by diverse personas,
 * each answered by an expert assistant.
 *
 * @throws Error when no personas are provided.
 */
export function buildPersonaPrompt(opts: PersonaPromptOptions): PromptPair {
  if (opts.personas.length === 0) throw new Error('persona generation requires at least one persona');
  const topic = opts.topic?.trim();
  const user = [
    'Adopt each of these personas in turn:',
    '',
    opts.personas.map((p, i) => `${i + 1}. ${p}`).join('\n'),
    '',
    `Write ${opts.count} instructions: for each, pick a persona (cycle through the list) and write the kind of ` +
      `question or request that persona would realistically ask${topic !== undefined && topic !== '' ? ` about ${topic}` : ''}, ` +
      "reflecting the persona's knowledge level, vocabulary and goals. Then write an excellent expert response.",
    batchLine(opts.batchIndex),
    ...generationContract(opts.count),
  ].join('\n');
  return { system: GENERATOR_SYSTEM, user };
}

/** Options for {@link buildMagpiePrompt}. */
export interface MagpiePromptOptions {
  /** Topic to generate queries about (required). */
  topic: string;
  /** Number of examples to request. */
  count: number;
  /** 0-based batch number. */
  batchIndex: number;
}

/**
 * Magpie-style cold generation: realistic user queries sampled "from the wild"
 * for a topic, with no seed data, each paired with an excellent response.
 *
 * @throws Error when the topic is empty.
 */
export function buildMagpiePrompt(opts: MagpiePromptOptions): PromptPair {
  const topic = opts.topic.trim();
  if (topic === '') throw new Error('magpie-style generation requires a topic');
  const user = [
    `Imagine sampling real user queries sent to an AI assistant about: ${topic}.`,
    `Generate ${opts.count} such queries as if written by different real users — vary expertise (novice to expert), ` +
      'length (one line to a detailed paragraph), tone and intent (how-to, debugging, comparison, planning, explanation). ' +
      'Pair each with an excellent assistant response.',
    batchLine(opts.batchIndex),
    ...generationContract(opts.count),
  ].join('\n');
  return { system: GENERATOR_SYSTEM, user };
}

// ---------------------------------------------------------------------------
// Document Q&A generation
// ---------------------------------------------------------------------------

/** Options for {@link buildDocQaPrompt}. */
export interface DocQaPromptOptions {
  /** The document chunk to ground generation in. */
  chunk: string;
  /** Number of examples to request from this chunk. */
  count: number;
  /** Output style: factual Q&A, task instructions or summarization examples. */
  style: DocGenStyle;
}

const DOC_STYLE_DIRECTIVES: Record<DocGenStyle, (count: number) => string> = {
  qa: (count) =>
    `Generate ${count} factual question/answer pairs grounded ONLY in the passage below. ` +
    'Each answer must be fully supported by the passage. Questions must be self-contained — ' +
    'never write "according to the passage" or assume the reader can see it.',
  instruction: (count) =>
    `Generate ${count} task-style instructions grounded in the passage below (e.g. extract, explain, ` +
    'compare, rewrite, list). Embed any necessary context from the passage inside the instruction so it is ' +
    'fully self-contained, and write the ideal response for each.',
  summary: (count) =>
    `Generate ${count} summarization examples for the passage below. Each "instruction" must ask to ` +
    'summarize the text and INCLUDE the passage text inside the instruction; each "response" is a faithful ' +
    'summary. Vary the requested summary form (one-liner, bullet points, abstract, executive summary).',
};

/**
 * Build a document-grounded generation prompt for one chunk.
 */
export function buildDocQaPrompt(opts: DocQaPromptOptions): PromptPair {
  const system =
    'You are a training-data generator that creates fine-tuning examples grounded in source documents. ' +
    'Never invent facts that are not supported by the provided passage. ' +
    STRICT_JSON_RULES;
  const user = [
    DOC_STYLE_DIRECTIVES[opts.style](opts.count),
    ...generationContract(opts.count),
    '',
    'Passage:',
    '<<<',
    opts.chunk,
    '>>>',
  ].join('\n');
  return { system, user };
}

// ---------------------------------------------------------------------------
// Judge + ranking prompts
// ---------------------------------------------------------------------------

const JUDGE_SYSTEM =
  'You are a strict, calibrated evaluator of fine-tuning training examples (LLM-as-judge). ' +
  'You never reward verbosity, sycophancy or confident-sounding errors. ' +
  STRICT_JSON_RULES;

/**
 * Build the rubric-scoring prompt for one example transcript.
 *
 * The model must score helpfulness / correctness / clarity on a 1–10 scale
 * and give a pass/fail verdict, as strict JSON.
 *
 * @param transcript - Output of {@link conversationTranscript}.
 */
export function buildJudgePrompt(transcript: string): PromptPair {
  const user = [
    'Evaluate the following training example. Score each dimension as an integer from 1 to 10:',
    '- helpfulness: does the assistant fully address the user need with actionable substance?',
    '- correctness: are all factual claims, code and logic accurate?',
    '- clarity: is the response well-organized, concise and easy to follow?',
    'Anchors: 1–2 unusable, 3–4 poor, 5–6 mediocre, 7–8 good, 9–10 excellent.',
    'Verdict: "pass" only if the example is suitable for training as-is (no dimension below 6 and no critical flaw), otherwise "fail".',
    '',
    'Return STRICT JSON matching exactly this schema:',
    JUDGE_SCHEMA,
    '',
    'Example transcript:',
    transcript,
  ].join('\n');
  return { system: JUDGE_SYSTEM, user };
}

/**
 * Build the candidate-ranking prompt used for preference-pair construction.
 *
 * The model ranks ALL candidates from best to worst using 1-based candidate
 * numbers, flagging `tie: true` when the best and worst are interchangeable.
 *
 * @param promptTranscript - Transcript of the prompt portion of the conversation.
 * @param candidates       - Candidate completions, in their generated order.
 */
export function buildRankingPrompt(promptTranscript: string, candidates: string[]): PromptPair {
  const numbered = candidates
    .map((c, i) => `--- Candidate ${i + 1} ---\n${c === '' ? '(empty response)' : c}`)
    .join('\n\n');
  const user = [
    'Below is a conversation prompt followed by several candidate assistant responses.',
    'Rank ALL candidates from best to worst on helpfulness, correctness and clarity.',
    'Use 1-based candidate numbers and include every candidate exactly once in "ranking".',
    'Set "tie": true ONLY if the best and worst candidates are of essentially equivalent quality.',
    '',
    'Return STRICT JSON matching exactly this schema:',
    RANKING_SCHEMA,
    '',
    'Conversation prompt:',
    promptTranscript,
    '',
    `Candidates (${candidates.length} total):`,
    numbered,
  ].join('\n');
  return { system: JUDGE_SYSTEM, user };
}

// ---------------------------------------------------------------------------
// Strict-JSON output parsing
// ---------------------------------------------------------------------------

const UNPARSED = Symbol('unparsed');
const FENCE_PATTERN = /```[a-zA-Z]*[ \t]*\r?\n?([\s\S]*?)```/g;
/** Max balanced-block candidates scanned before giving up. */
const MAX_SCAN_ATTEMPTS = 20;

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return UNPARSED;
  }
}

/** Find the index of the closing bracket matching `text[start]`, or -1. */
function findBalancedEnd(text: string, start: number): number {
  const open = text[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === open) {
      depth++;
    } else if (ch === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Scan for the first balanced `{…}` / `[…]` block that parses as JSON. */
function scanBalanced(text: string): unknown {
  let attempts = 0;
  for (let i = 0; i < text.length && attempts < MAX_SCAN_ATTEMPTS; i++) {
    const ch = text[i];
    if (ch !== '{' && ch !== '[') continue;
    attempts++;
    const end = findBalancedEnd(text, i);
    if (end === -1) continue;
    const parsed = tryParse(text.slice(i, end + 1));
    if (parsed !== UNPARSED) return parsed;
  }
  return UNPARSED;
}

/**
 * Robustly extract a JSON value from raw model output.
 *
 * Strategy, in order: contents of any fenced code block, then the whole text,
 * each tried as-is and then via a string-aware balanced `{…}`/`[…]` scan
 * (so prose-wrapped JSON like "Here you go: {…} Enjoy!" still parses).
 *
 * @param text - Raw model output.
 * @returns The first JSON value found.
 * @throws Error when no parseable JSON value is present.
 */
export function extractStrictJson(text: string): unknown {
  const candidates: string[] = [];
  const trimmed = text.trim();
  const fence = new RegExp(FENCE_PATTERN.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = fence.exec(trimmed)) !== null) {
    const inner = (match[1] ?? '').trim();
    if (inner !== '') candidates.push(inner);
  }
  candidates.push(trimmed);

  for (const candidate of candidates) {
    const direct = tryParse(candidate);
    if (direct !== UNPARSED) return direct;
    const scanned = scanBalanced(candidate);
    if (scanned !== UNPARSED) return scanned;
  }
  throw new Error('model output did not contain valid JSON');
}
