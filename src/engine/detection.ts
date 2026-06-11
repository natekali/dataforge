/**
 * DataForge V2 — dataset source-format detection.
 *
 * Pure, runtime-agnostic analysis of raw imported rows (parsed JSONL / CSV /
 * Parquet records). Given a sample of rows it determines which source format
 * they follow ({@link detectFormat}) and how source fields map onto the
 * canonical example shape. Ported and extended from the V1 Python engine
 * (`dataforge_core/detection.py`).
 *
 * No DOM, no React — safe to run in Web Workers and Node (vitest).
 */

import type { DetectedSchema, SourceFormat } from '@/engine/types';

// ---------------------------------------------------------------------------
// Constants (exported for reuse by convert.ts and the import UI)
// ---------------------------------------------------------------------------

/** Maximum number of rows analyzed by {@link detectFormat}. */
export const DETECTION_SAMPLE_LIMIT = 200;

/** Minimum fraction of sampled rows that must match a format to qualify. */
export const FIELD_PRESENCE_THRESHOLD = 0.5;

/**
 * Canonical Alpaca field → accepted source-field aliases, in priority order.
 * The first alias found on a row wins.
 */
export const ALPACA_ALIASES: Readonly<
  Record<'instruction' | 'output' | 'input' | 'system', readonly string[]>
> = {
  instruction: ['instruction', 'prompt', 'question', 'query'],
  output: ['output', 'response', 'completion', 'answer'],
  input: ['input', 'context'],
  system: ['system', 'system_prompt', 'system_message'],
};

/** Canonical Alpaca fields, in mapping-resolution order. */
export const ALPACA_CANONICAL_FIELDS = ['instruction', 'output', 'input', 'system'] as const;

/** Accepted prompt-carrying fields for DPO / KTO rows, in priority order. */
export const DPO_PROMPT_FIELDS: readonly string[] = ['prompt', 'question', 'messages', 'input'];

/** A concretely detectable format (everything except the 'unknown' sentinel). */
export type DetectableFormat = Exclude<SourceFormat, 'unknown'>;

/**
 * How unambiguous each format's field signature is (0–1). Detection
 * confidence = presence ratio × specificity, so a fully-matching but
 * weakly-shaped format (e.g. `text`) scores lower than a fully-matching
 * strongly-shaped one (e.g. `dpo-pairs`).
 */
export const FORMAT_SPECIFICITY: Readonly<Record<DetectableFormat, number>> = {
  'dpo-pairs': 0.98,
  'kto-unpaired': 0.97,
  'openai-messages': 0.95,
  sharegpt: 0.95,
  alpaca: 0.9,
  text: 0.7,
};

/** Specificity floor used for Alpaca rows matched only via field aliases. */
const ALPACA_ALIASED_SPECIFICITY = 0.8;

/** Classification priority: most specific shapes are tested first. */
const CLASSIFY_ORDER: readonly DetectableFormat[] = [
  'dpo-pairs',
  'kto-unpaired',
  'openai-messages',
  'sharegpt',
  'alpaca',
  'text',
];

const MAX_WARNINGS = 8;

// ---------------------------------------------------------------------------
// Shape predicates
// ---------------------------------------------------------------------------

/** True when the value is a plain (non-array) object. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Loose OpenAI-message shape: object with a string role and some content. */
function isMessageLike(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value['role'] === 'string' &&
    ('content' in value || 'tool_calls' in value || 'toolCalls' in value)
  );
}

/** Non-empty array where every element looks like an OpenAI message. */
function isMessagesArray(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0 && value.every(isMessageLike);
}

/** ShareGPT turn shape: object with a string `from` and a `value`. */
function isShareGptTurn(value: unknown): boolean {
  return isRecord(value) && typeof value['from'] === 'string' && 'value' in value;
}

/** Usable KTO label: boolean, 0/1 number, or "true"/"false" string. */
export function isKtoLabel(value: unknown): boolean {
  return (
    typeof value === 'boolean' ||
    value === 0 ||
    value === 1 ||
    value === 'true' ||
    value === 'false'
  );
}

/** True when the row carries a usable DPO/KTO prompt field. */
function hasPromptField(row: Record<string, unknown>): boolean {
  return DPO_PROMPT_FIELDS.some((field) => {
    const value = row[field];
    return typeof value === 'string' || Array.isArray(value);
  });
}

/**
 * Resolve the source field carrying a canonical Alpaca field on a row,
 * scanning {@link ALPACA_ALIASES} in priority order. Returns the source key
 * (e.g. `"prompt"` for canonical `"instruction"`) or undefined.
 */
export function resolveAlpacaField(
  row: Record<string, unknown>,
  canonical: keyof typeof ALPACA_ALIASES,
): string | undefined {
  for (const alias of ALPACA_ALIASES[canonical]) {
    if (typeof row[alias] === 'string') return alias;
  }
  return undefined;
}

/**
 * Classify a single row to the most specific format it matches, or null when
 * it matches none. Order of precedence: dpo-pairs → kto-unpaired →
 * openai-messages → sharegpt → alpaca → text.
 */
export function classifyRow(row: unknown): DetectableFormat | null {
  if (typeof row === 'string') return row.trim().length > 0 ? 'text' : null;
  if (!isRecord(row)) return null;

  if ('chosen' in row && 'rejected' in row && hasPromptField(row)) return 'dpo-pairs';

  if (
    'completion' in row &&
    isKtoLabel(row['label']) &&
    (typeof row['prompt'] === 'string' || isMessagesArray(row['messages']))
  ) {
    return 'kto-unpaired';
  }

  if (isMessagesArray(row['messages'])) return 'openai-messages';

  const conversations = row['conversations'];
  if (
    Array.isArray(conversations) &&
    conversations.length > 0 &&
    conversations.every(isShareGptTurn)
  ) {
    return 'sharegpt';
  }

  if (
    resolveAlpacaField(row, 'instruction') !== undefined &&
    resolveAlpacaField(row, 'output') !== undefined
  ) {
    return 'alpaca';
  }

  const keys = Object.keys(row);
  if (keys.length === 1 && typeof row[keys[0]] === 'string') return 'text';

  return null;
}

// ---------------------------------------------------------------------------
// Field-mapping construction
// ---------------------------------------------------------------------------

/** Key with the highest count in the map, or undefined when empty. */
function maxKey(counts: ReadonlyMap<string, number>): string | undefined {
  let best: string | undefined;
  let bestCount = 0;
  for (const [key, count] of counts) {
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Most common field among `candidates` (first match per row wins) whose value
 * passes `accepts`, across all record samples.
 */
function mostCommonField(
  samples: readonly unknown[],
  candidates: readonly string[],
  accepts: (value: unknown) => boolean,
): string | undefined {
  const counts = new Map<string, number>();
  for (const row of samples) {
    if (!isRecord(row)) continue;
    for (const candidate of candidates) {
      if (candidate in row && accepts(row[candidate])) {
        counts.set(candidate, (counts.get(candidate) ?? 0) + 1);
        break;
      }
    }
  }
  return maxKey(counts);
}

/** Build the source-field → canonical-field mapping for the winning format. */
function buildFieldMapping(
  format: SourceFormat,
  samples: readonly unknown[],
): Record<string, string> {
  switch (format) {
    case 'openai-messages':
      return { messages: 'messages' };

    case 'sharegpt':
      return { conversations: 'messages', from: 'role', value: 'content' };

    case 'alpaca': {
      const mapping: Record<string, string> = {};
      for (const canonical of ALPACA_CANONICAL_FIELDS) {
        const counts = new Map<string, number>();
        for (const row of samples) {
          if (!isRecord(row)) continue;
          const source = resolveAlpacaField(row, canonical);
          if (source !== undefined) counts.set(source, (counts.get(source) ?? 0) + 1);
        }
        const best = maxKey(counts);
        if (best !== undefined) mapping[best] = canonical;
      }
      return mapping;
    }

    case 'dpo-pairs': {
      const mapping: Record<string, string> = {};
      const promptField = mostCommonField(
        samples,
        DPO_PROMPT_FIELDS,
        (v) => typeof v === 'string' || Array.isArray(v),
      );
      if (promptField !== undefined) mapping[promptField] = 'messages';
      mapping['chosen'] = 'chosen';
      mapping['rejected'] = 'rejected';
      return mapping;
    }

    case 'kto-unpaired': {
      const promptField =
        mostCommonField(
          samples,
          ['prompt', 'messages'],
          (v) => typeof v === 'string' || Array.isArray(v),
        ) ?? 'prompt';
      return { [promptField]: 'messages', completion: 'completion', label: 'label' };
    }

    case 'text': {
      const counts = new Map<string, number>();
      for (const row of samples) {
        if (!isRecord(row)) continue;
        const keys = Object.keys(row);
        if (keys.length === 1 && typeof row[keys[0]] === 'string') {
          counts.set(keys[0], (counts.get(keys[0]) ?? 0) + 1);
        }
      }
      const best = maxKey(counts);
      return best !== undefined ? { [best]: 'messages' } : {};
    }

    case 'unknown':
      return {};
  }
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/**
 * Analyze up to {@link DETECTION_SAMPLE_LIMIT} sample rows and detect their
 * source format.
 *
 * Each row is classified exclusively to the most specific format it matches;
 * a format qualifies when its presence ratio is ≥
 * {@link FIELD_PRESENCE_THRESHOLD}. Confidence is the presence ratio weighted
 * by the format's field specificity ({@link FORMAT_SPECIFICITY}); Alpaca rows
 * matched only through aliases score lower than canonical
 * `instruction`/`output` rows. Warnings flag mixed formats, unmatched rows,
 * and empty field values.
 */
export function detectFormat(rows: unknown[]): DetectedSchema {
  const samples = rows.slice(0, DETECTION_SAMPLE_LIMIT);
  const sampleCount = samples.length;

  if (sampleCount === 0) {
    return {
      format: 'unknown',
      confidence: 0,
      fieldMapping: {},
      sampleCount: 0,
      warnings: ['Dataset is empty — nothing to analyze.'],
    };
  }

  const matchCounts = new Map<DetectableFormat, number>();
  let unmatched = 0;
  let alpacaCanonical = 0;

  for (const row of samples) {
    const format = classifyRow(row);
    if (format === null) {
      unmatched += 1;
      continue;
    }
    matchCounts.set(format, (matchCounts.get(format) ?? 0) + 1);
    if (
      format === 'alpaca' &&
      isRecord(row) &&
      typeof row['instruction'] === 'string' &&
      typeof row['output'] === 'string'
    ) {
      alpacaCanonical += 1;
    }
  }

  let bestFormat: SourceFormat = 'unknown';
  let bestConfidence = 0;
  let maxScore = 0;

  for (const format of CLASSIFY_ORDER) {
    const matched = matchCounts.get(format) ?? 0;
    if (matched === 0) continue;
    const ratio = matched / sampleCount;
    const specificity =
      format === 'alpaca'
        ? ALPACA_ALIASED_SPECIFICITY +
          (FORMAT_SPECIFICITY.alpaca - ALPACA_ALIASED_SPECIFICITY) * (alpacaCanonical / matched)
        : FORMAT_SPECIFICITY[format];
    const score = ratio * specificity;
    if (score > maxScore) maxScore = score;
    if (ratio >= FIELD_PRESENCE_THRESHOLD && score > bestConfidence) {
      bestFormat = format;
      bestConfidence = score;
    }
  }

  const warnings: string[] = [];
  if (unmatched > 0) {
    warnings.push(`${unmatched} of ${sampleCount} sampled rows did not match any known format.`);
  }
  for (const format of CLASSIFY_ORDER) {
    const matched = matchCounts.get(format) ?? 0;
    if (matched > 0 && format !== bestFormat) {
      warnings.push(
        `Mixed formats: ${matched} of ${sampleCount} sampled rows look like "${format}".`,
      );
    }
  }

  const emptyFields: string[] = [];
  for (const row of samples.slice(0, 10)) {
    if (!isRecord(row)) continue;
    for (const [key, value] of Object.entries(row)) {
      if (
        (value === null || (typeof value === 'string' && value.trim() === '')) &&
        !emptyFields.includes(key)
      ) {
        emptyFields.push(key);
      }
    }
  }
  for (const field of emptyFields.slice(0, 2)) {
    warnings.push(`Some rows have an empty "${field}" value.`);
  }

  return {
    format: bestFormat,
    confidence: round4(bestFormat === 'unknown' ? maxScore : bestConfidence),
    fieldMapping: buildFieldMapping(bestFormat, samples),
    sampleCount,
    warnings: warnings.slice(0, MAX_WARNINGS),
  };
}
