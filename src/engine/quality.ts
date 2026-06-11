/**
 * DataForge V2 — quality analysis + cleaning.
 *
 * Ports the V1 Python pipeline (`dataforge_core/quality.py`) — the 13 V1
 * issue checks, PII regexes, refusal patterns, mojibake fixes and component
 * scoring weights — and extends it with the V2-only issue types:
 * `malformed_tool_call`, `orphan_tool_result`, `incoherent_turn_order`,
 * `context_overflow` (target-model aware) and `special_token_conflict` driven
 * by the template-family control vocabularies. Dataset-level EXACT duplicate
 * detection lives in {@link analyzeDataset} (near-duplicates are handled by
 * the dedup module).
 *
 * No DOM, no React — safe to run in Web Workers and Node (vitest).
 */

import type {
  CleaningOptions,
  DatasetQualitySummary,
  Example,
  IssueType,
  Message,
  ModelInfo,
  QualityIssue,
  QualityReport,
} from '@/engine/types';
import { ALL_SPECIAL_TOKENS, SPECIAL_TOKENS } from '@/engine/templates';
import { countExample } from '@/engine/tokens';
import { ROLE_ALIASES } from '@/engine/convert';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Messages (user/assistant) shorter than this many characters are flagged `too_short`. */
export const TOO_SHORT_CHARS = 10;

/** Messages longer than this many characters are flagged `too_long`. */
export const TOO_LONG_CHARS = 32_000;

/** Canonical V2 roles accepted without an `invalid_role` issue. */
const VALID_ROLES: ReadonlySet<string> = new Set([
  'system',
  'developer',
  'user',
  'assistant',
  'tool',
]);

/**
 * V1 refusal-opener patterns (case-insensitive). Kept as plain sources so the
 * cleaner can extend each one with a "rest of sentence" suffix.
 */
const REFUSAL_PATTERN_SOURCES: readonly string[] = [
  String.raw`as an ai( language model)?`,
  String.raw`i('m| am) (not able|unable|cannot)`,
  String.raw`i (can't|cannot|won't|will not) (help|assist|provide)`,
  String.raw`i('m| am) sorry,? (but )?i (can't|cannot)`,
  String.raw`it('s| is) (not |in)appropriate`,
  String.raw`i (don't|do not) have (the ability|access)`,
  String.raw`i('m| am) (just )?a(n)? (ai|language model|llm)`,
  String.raw`my (programming|guidelines|training)`,
];

const REFUSAL_DETECTORS: readonly RegExp[] = REFUSAL_PATTERN_SOURCES.map(
  (source) => new RegExp(source, 'i'),
);

/** V1 cleaning behaviour: strip the refusal phrase plus the rest of its sentence. */
const REFUSAL_STRIPPERS: readonly RegExp[] = REFUSAL_PATTERN_SOURCES.map(
  (source) => new RegExp(`${source}[^.]*\\.`, 'gi'),
);

interface PiiRule {
  /** Human-readable kind used in issue messages and change logs. */
  label: string;
  /** Mask inserted by {@link cleanExample}. */
  placeholder: string;
  pattern: RegExp;
}

/**
 * V1 PII patterns, ordered for safe masking: the loose phone pattern runs
 * LAST so SSN / credit-card / IP digits are already masked and cannot be
 * partially re-matched as phone numbers.
 */
const PII_RULES: readonly PiiRule[] = [
  {
    label: 'email address',
    placeholder: '[EMAIL]',
    pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  },
  { label: 'SSN', placeholder: '[SSN]', pattern: /\b\d{3}-\d{2}-\d{4}\b/g },
  {
    label: 'credit card number',
    placeholder: '[CARD]',
    pattern: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g,
  },
  { label: 'IP address', placeholder: '[IP]', pattern: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g },
  {
    label: 'phone number',
    placeholder: '[PHONE]',
    pattern: /(\+\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g,
  },
];

/**
 * Mojibake repair table (V1 pairs in both their latin-1 form, ``-range
 * C1 controls, and the cp1252 form users actually see, e.g. `â€™`).
 * Longer sequences must run before the 2-char `Ã.` pairs.
 */
const MOJIBAKE_FIXES: ReadonlyArray<readonly [string, string]> = [
  ['â', "'"],
  ['â€™', "'"],
  ['â', '"'],
  ['â€œ', '"'],
  ['â', '"'],
  ['â€', '"'],
  ['â', '—'],
  ['â€”', '—'],
  ['â', '–'],
  ['â€“', '–'],
  ['Ã¢', 'â'],
  ['Ã©', 'é'],
  ['�', ''],
];

/**
 * Signals of broken text: latin-1/cp1252 mojibake prefixes (`â€`, `Ã¢`, `Ã©`),
 * the replacement character, null bytes and literal escaped hex bytes.
 */
const ENCODING_ERROR_PATTERN =
  /â[€]|Ã[¢©]|�|\u0000|\\x[0-9a-fA-F]{2}/;

// DEFAULT_CLEANING lives in types.ts (dependency-free) so UI code can import
// it without dragging this module's tokenizer dependency into the entry
// bundle. Re-exported here for engine-side consumers.
export { DEFAULT_CLEANING } from './types';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

type ListField = NonNullable<QualityIssue['field']>;

interface MessageList {
  field: ListField;
  messages: Message[];
}

/** Every message list of an example, prompt first, in a stable order. */
function messageLists(example: Example): MessageList[] {
  const lists: MessageList[] = [{ field: 'messages', messages: example.messages }];
  if (example.chosen !== undefined) lists.push({ field: 'chosen', messages: example.chosen });
  if (example.rejected !== undefined) lists.push({ field: 'rejected', messages: example.rejected });
  if (example.completion !== undefined) {
    lists.push({ field: 'completion', messages: example.completion });
  }
  return lists;
}

/** Lower-cased, trimmed role string (defensive against malformed imports). */
function rawRole(message: Message): string {
  return typeof message.role === 'string' ? message.role.trim().toLowerCase() : '';
}

/** Content string, defensive against malformed imports. */
function contentOf(message: Message): string {
  return typeof message.content === 'string' ? message.content : '';
}

/** True when the message carries trainable signal (content, tool calls or reasoning). */
function isMessageNonEmpty(message: Message): boolean {
  if (contentOf(message).trim().length > 0) return true;
  if (message.toolCalls !== undefined && message.toolCalls.length > 0) return true;
  return message.reasoning !== undefined && message.reasoning.trim().length > 0;
}

/** True when a continuation list exists and contains at least one non-empty message. */
function hasContent(messages: Message[] | undefined): boolean {
  return messages !== undefined && messages.some(isMessageNonEmpty);
}

function isValidJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/** Remove every known template control token from a string. */
function stripControlTokens(text: string): string {
  let out = text;
  for (const token of ALL_SPECIAL_TOKENS) {
    if (out.includes(token)) out = out.split(token).join('');
  }
  return out;
}

/** Shallow example clone with control tokens removed from every counted text field. */
function withControlTokensStripped(example: Example): Example {
  const stripList = (messages: Message[] | undefined): Message[] | undefined =>
    messages?.map((message) => ({
      ...message,
      content: stripControlTokens(contentOf(message)),
      reasoning:
        typeof message.reasoning === 'string' ? stripControlTokens(message.reasoning) : undefined,
      toolCalls: message.toolCalls?.map((call) => ({
        ...call,
        arguments: stripControlTokens(call.arguments),
      })),
    }));
  return {
    ...example,
    messages: stripList(example.messages) ?? [],
    chosen: stripList(example.chosen),
    rejected: stripList(example.rejected),
    completion: stripList(example.completion),
  };
}

/** Last-resort token estimate (~4 chars/token + per-message overhead). */
function estimateTokens(example: Example): number {
  let chars = 0;
  let messageCount = 0;
  for (const { messages } of messageLists(example)) {
    for (const message of messages) {
      messageCount += 1;
      chars += contentOf(message).length;
      if (typeof message.reasoning === 'string') chars += message.reasoning.length;
      if (message.toolCalls !== undefined) {
        for (const call of message.toolCalls) chars += call.arguments.length;
      }
    }
  }
  return messageCount * 4 + Math.ceil(chars / 4);
}

/**
 * Token count that never throws. gpt-tokenizer refuses to encode text that
 * contains disallowed control tokens (e.g. `<|im_start|>`) — exactly the kind
 * of content `special_token_conflict` exists to flag — so retry with known
 * control tokens stripped, then fall back to a chars/4 estimate.
 */
function safeCountExample(example: Example): number {
  try {
    return countExample(example);
  } catch {
    // Fall through to the stripped retry below.
  }
  try {
    return countExample(withControlTokensStripped(example));
  } catch {
    return estimateTokens(example);
  }
}

// ---------------------------------------------------------------------------
// Issue collection
// ---------------------------------------------------------------------------

interface SeverityCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
}

function tallySeverities(issues: readonly QualityIssue[]): SeverityCounts {
  const counts: SeverityCounts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const issue of issues) counts[issue.severity] += 1;
  return counts;
}

/** Per-message checks shared across all four message lists. */
function checkMessage(
  message: Message,
  index: number,
  field: ListField,
  knownCallIds: ReadonlySet<string>,
  specialTokens: readonly string[],
  tokenSeverity: 'high' | 'medium',
  issues: QualityIssue[],
): void {
  const role = rawRole(message);
  const content = contentOf(message);
  const reasoning = typeof message.reasoning === 'string' ? message.reasoning : '';
  const hasToolCalls = message.toolCalls !== undefined && message.toolCalls.length > 0;

  // Roles ------------------------------------------------------------------
  if (role === '') {
    issues.push({
      type: 'missing_role',
      severity: 'critical',
      message: `Missing role in ${field}[${index}]`,
      messageIndex: index,
      field,
      autoFixable: false,
    });
  } else if (!VALID_ROLES.has(role)) {
    const normalizable = ROLE_ALIASES[role] !== undefined;
    issues.push({
      type: 'invalid_role',
      severity: 'high',
      message: `Invalid role "${role}" in ${field}[${index}]`,
      messageIndex: index,
      field,
      autoFixable: normalizable,
    });
  }

  // Empty content ------------------------------------------------------------
  if (content.trim() === '' && !isMessageNonEmpty(message)) {
    issues.push({
      type: 'empty_field',
      severity: 'critical',
      message: `Empty content in ${field}[${index}] (role: ${role || 'unknown'})`,
      messageIndex: index,
      field,
      autoFixable: true,
    });
  }

  // Length -------------------------------------------------------------------
  if (role === 'user' || role === 'assistant') {
    if (content.length < TOO_SHORT_CHARS && !hasToolCalls) {
      issues.push({
        type: 'too_short',
        severity: 'medium',
        message: `${field}[${index}] is very short (${content.length} chars)`,
        messageIndex: index,
        field,
        autoFixable: false,
      });
    }
    if (content.length > TOO_LONG_CHARS) {
      issues.push({
        type: 'too_long',
        severity: 'high',
        message: `${field}[${index}] exceeds max length (${content.length} > ${TOO_LONG_CHARS})`,
        messageIndex: index,
        field,
        autoFixable: false,
      });
    }
  }

  // Refusals (assistant turns; never in `rejected` — refusals there are
  // legitimate DPO negative signal) -----------------------------------------
  if (role === 'assistant' && field !== 'rejected') {
    if (REFUSAL_DETECTORS.some((re) => re.test(content))) {
      issues.push({
        type: 'refusal_pattern',
        severity: 'high',
        message: `Detected refusal pattern in ${field}[${index}]`,
        messageIndex: index,
        field,
        autoFixable: true,
      });
    }
  }

  // PII ----------------------------------------------------------------------
  for (const rule of PII_RULES) {
    if (content.match(rule.pattern) !== null || reasoning.match(rule.pattern) !== null) {
      issues.push({
        type: 'pii_detected',
        severity: 'high',
        message: `Potential ${rule.label} detected in ${field}[${index}]`,
        messageIndex: index,
        field,
        autoFixable: true,
      });
    }
  }

  // Encoding ------------------------------------------------------------------
  if (ENCODING_ERROR_PATTERN.test(content) || ENCODING_ERROR_PATTERN.test(reasoning)) {
    issues.push({
      type: 'encoding_error',
      severity: 'medium',
      message: `Possible encoding issue in ${field}[${index}]`,
      messageIndex: index,
      field,
      autoFixable: true,
    });
  }

  // Special tokens --------------------------------------------------------------
  const found = specialTokens.filter(
    (token) => content.includes(token) || reasoning.includes(token),
  );
  if (found.length > 0) {
    issues.push({
      type: 'special_token_conflict',
      severity: tokenSeverity,
      message: `Special token(s) ${found.map((t) => `"${t}"`).join(', ')} found in ${field}[${index}]`,
      messageIndex: index,
      field,
      autoFixable: true,
    });
  }

  // Tool calls -------------------------------------------------------------------
  if (message.toolCalls !== undefined) {
    for (const call of message.toolCalls) {
      if (!isValidJson(call.arguments)) {
        issues.push({
          type: 'malformed_tool_call',
          severity: 'high',
          message: `Tool call "${call.name}" in ${field}[${index}] has non-JSON arguments`,
          messageIndex: index,
          field,
          autoFixable: false,
        });
      }
    }
  }
  if (role === 'tool') {
    const callId = typeof message.toolCallId === 'string' ? message.toolCallId.trim() : '';
    if (callId === '') {
      issues.push({
        type: 'malformed_tool_call',
        severity: 'high',
        message: `Tool result in ${field}[${index}] is missing its toolCallId`,
        messageIndex: index,
        field,
        autoFixable: false,
      });
    } else if (!knownCallIds.has(callId)) {
      issues.push({
        type: 'orphan_tool_result',
        severity: 'high',
        message: `Tool result in ${field}[${index}] references unknown call id "${callId}"`,
        messageIndex: index,
        field,
        autoFixable: false,
      });
    }
  }
}

/** Run every example-level check and return the collected issues. */
function collectIssues(example: Example, targetModel?: ModelInfo): QualityIssue[] {
  const issues: QualityIssue[] = [];

  const specialTokens =
    targetModel !== undefined ? SPECIAL_TOKENS[targetModel.templateFamily] : ALL_SPECIAL_TOKENS;
  const tokenSeverity: 'high' | 'medium' = targetModel !== undefined ? 'high' : 'medium';

  // Presence of a prompt --------------------------------------------------------
  if (example.messages.length === 0) {
    issues.push({
      type: 'empty_field',
      severity: 'critical',
      message: 'Example has no messages',
      field: 'messages',
      autoFixable: false,
    });
  }

  // Per-message checks across all lists. Tool-call ids declared in the prompt
  // are visible to continuation lists; each continuation also sees its own.
  const promptCallIds = new Set<string>();
  for (const { field, messages } of messageLists(example)) {
    const knownCallIds = field === 'messages' ? promptCallIds : new Set(promptCallIds);
    messages.forEach((message, index) => {
      checkMessage(message, index, field, knownCallIds, specialTokens, tokenSeverity, issues);
      if (rawRole(message) === 'assistant' && message.toolCalls !== undefined) {
        for (const call of message.toolCalls) knownCallIds.add(call.id);
      }
    });
  }

  // Turn order (prompt conversation only) ---------------------------------------
  const roles = example.messages.map(rawRole);
  const firstUser = roles.indexOf('user');
  const firstAssistant = roles.indexOf('assistant');
  if (firstAssistant !== -1 && (firstUser === -1 || firstAssistant < firstUser)) {
    issues.push({
      type: 'incoherent_turn_order',
      severity: 'medium',
      message: 'Assistant turn appears before any user turn',
      messageIndex: firstAssistant,
      field: 'messages',
      autoFixable: false,
    });
  }
  for (let i = 1; i < roles.length; i++) {
    if (roles[i] === 'user' && roles[i - 1] === 'user') {
      issues.push({
        type: 'incoherent_turn_order',
        severity: 'medium',
        message: `Consecutive user turns at messages[${i - 1}] and messages[${i}]`,
        messageIndex: i,
        field: 'messages',
        autoFixable: false,
      });
    }
  }

  // Required roles ----------------------------------------------------------------
  if (!roles.includes('user')) {
    issues.push({
      type: 'missing_role',
      severity: 'high',
      message: 'No user message found',
      field: 'messages',
      autoFixable: false,
    });
  }
  if (example.type === 'sft' && !roles.includes('assistant')) {
    issues.push({
      type: 'missing_role',
      severity: 'high',
      message: 'No assistant message found',
      field: 'messages',
      autoFixable: false,
    });
  }

  // Length balance (rl is prompt-only by design — no ratio to check) ---------------
  if (example.type !== 'rl') {
    const { userLen, assistantLen } = contentLengths(example);
    if (userLen > 0) {
      const ratio = assistantLen / userLen;
      if (ratio < 0.1) {
        issues.push({
          type: 'imbalanced_ratio',
          severity: 'medium',
          message: `Very short assistant response (ratio: ${ratio.toFixed(2)})`,
          autoFixable: false,
        });
      } else if (ratio > 50) {
        issues.push({
          type: 'imbalanced_ratio',
          severity: 'low',
          message: `Very long response relative to instruction (ratio: ${ratio.toFixed(2)})`,
          autoFixable: false,
        });
      }
    }
  }

  // Dataset-type specific requirements ----------------------------------------------
  if (example.type === 'preference') {
    if (!hasContent(example.chosen)) {
      issues.push({
        type: 'empty_field',
        severity: 'critical',
        message: 'Preference example is missing a non-empty chosen continuation',
        field: 'chosen',
        autoFixable: false,
      });
    }
    if (!hasContent(example.rejected)) {
      issues.push({
        type: 'empty_field',
        severity: 'critical',
        message: 'Preference example is missing a non-empty rejected continuation',
        field: 'rejected',
        autoFixable: false,
      });
    }
    if (example.messages.length > 0 && roles[roles.length - 1] !== 'user') {
      issues.push({
        type: 'incoherent_turn_order',
        severity: 'high',
        message: 'Preference prompt must end with a user turn',
        messageIndex: example.messages.length - 1,
        field: 'messages',
        autoFixable: false,
      });
    }
  } else if (example.type === 'kto') {
    if (!hasContent(example.completion)) {
      issues.push({
        type: 'empty_field',
        severity: 'critical',
        message: 'KTO example is missing a non-empty completion',
        field: 'completion',
        autoFixable: false,
      });
    }
    if (typeof example.label !== 'boolean') {
      issues.push({
        type: 'empty_field',
        severity: 'critical',
        message: 'KTO example is missing its desirability label',
        autoFixable: false,
      });
    }
  } else if (example.type === 'rl') {
    if (typeof example.answer !== 'string' || example.answer.trim() === '') {
      issues.push({
        type: 'empty_field',
        severity: 'critical',
        message: 'RL example is missing a non-empty verifiable answer',
        autoFixable: false,
      });
    }
  }

  // Context overflow against the fine-tune target -------------------------------------
  if (targetModel !== undefined) {
    const tokens = safeCountExample(example);
    if (tokens > targetModel.recommendedSeqLen) {
      issues.push({
        type: 'context_overflow',
        severity: 'critical',
        message:
          `Example is ~${tokens} tokens but ${targetModel.name} trains at ` +
          `${targetModel.recommendedSeqLen} tokens — it will be truncated`,
        autoFixable: false,
      });
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/** User chars come from the prompt; assistant chars include chosen/completion. */
function contentLengths(example: Example): { userLen: number; assistantLen: number } {
  let userLen = 0;
  let assistantLen = 0;
  for (const message of example.messages) {
    const role = rawRole(message);
    if (role === 'user') userLen += contentOf(message).length;
    else if (role === 'assistant') assistantLen += contentOf(message).length;
  }
  for (const list of [example.chosen, example.completion]) {
    if (list === undefined) continue;
    for (const message of list) {
      if (rawRole(message) === 'assistant') assistantLen += contentOf(message).length;
    }
  }
  return { userLen, assistantLen };
}

function completenessScore(example: Example): number {
  const roles = example.messages.map(rawRole);
  const user = roles.includes('user') ? 0.5 : 0;
  switch (example.type) {
    case 'preference':
      return user + (hasContent(example.chosen) ? 0.25 : 0) + (hasContent(example.rejected) ? 0.25 : 0);
    case 'kto':
      return (
        user +
        (hasContent(example.completion) ? 0.25 : 0) +
        (typeof example.label === 'boolean' ? 0.25 : 0)
      );
    case 'rl':
      return (
        user + (typeof example.answer === 'string' && example.answer.trim() !== '' ? 0.5 : 0)
      );
    default:
      return user + (roles.includes('assistant') ? 0.5 : 0);
  }
}

function lengthBalanceScore(example: Example): number {
  const { userLen, assistantLen } = contentLengths(example);

  // rl is prompt-only by design: judge the prompt substance alone.
  if (example.type === 'rl') {
    if (userLen < 50) return 0.5;
    if (userLen < 100) return 0.8;
    return 1;
  }

  if (userLen === 0) return assistantLen > 0 ? 0.5 : 0;

  const ratio = assistantLen / userLen;
  let balance: number;
  if (ratio >= 1 && ratio <= 5) balance = 1;
  else if (ratio < 1) balance = Math.max(0.1, ratio);
  else balance = Math.max(0.3, 1 - (ratio - 5) / 10);

  const total = userLen + assistantLen;
  if (total < 50) balance *= 0.5;
  else if (total < 100) balance *= 0.8;
  return balance;
}

/** Components are reported on a 0–100 scale, one decimal of precision. */
const asPercent = (value: number): number => Math.round(clamp01(value) * 1000) / 10;

/** Assemble a QualityReport from a collected issue list (V1 scoring weights). */
function buildReport(example: Example, issues: QualityIssue[]): QualityReport {
  const counts = tallySeverities(issues);

  const completeness = clamp01(completenessScore(example));
  const formatting = clamp01(1 - counts.critical * 0.3 - counts.high * 0.1);
  const lengthBalance = clamp01(lengthBalanceScore(example));
  const contentQuality = clamp01(1 - counts.medium * 0.15 - counts.low * 0.05);

  // V1 weighting: penalty weights when anything is off, equal weights when clean.
  const overall =
    lengthBalance < 0.5 || issues.length > 0
      ? completeness * 0.2 + formatting * 0.2 + lengthBalance * 0.35 + contentQuality * 0.25
      : (completeness + formatting + lengthBalance + contentQuality) / 4;

  return {
    exampleId: example.id,
    score: Math.round(clamp01(overall) * 100),
    components: {
      completeness: asPercent(completeness),
      formatting: asPercent(formatting),
      lengthBalance: asPercent(lengthBalance),
      contentQuality: asPercent(contentQuality),
    },
    issues,
  };
}

// ---------------------------------------------------------------------------
// Public analysis API
// ---------------------------------------------------------------------------

/**
 * Analyze a single example: run every structural, content and dataset-type
 * check and score it 0–100 with the V1 component weights (completeness 0.2,
 * formatting 0.2, lengthBalance 0.35, contentQuality 0.25 — equal 0.25 weights
 * when the example is issue-free and well balanced).
 *
 * When `opts.targetModel` is provided, two checks become model-aware:
 * `context_overflow` (token count vs `recommendedSeqLen`) and
 * `special_token_conflict` (only the target family's control tokens are
 * scanned, at high severity, instead of every known family at medium).
 *
 * Exact-duplicate detection is dataset-wide and therefore lives in
 * {@link analyzeDataset}.
 *
 * @param example - The example to analyze.
 * @param opts - Optional target-model context.
 * @returns The quality report (score, 0–100 components, issues).
 */
export function analyzeExample(
  example: Example,
  opts?: { targetModel?: ModelInfo },
): QualityReport {
  return buildReport(example, collectIssues(example, opts?.targetModel));
}

/** Lower-cased, whitespace-collapsed text for duplicate hashing. */
function normalizeForHash(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** 32-bit FNV-1a over UTF-16 code units (seeded, for a wider combined key). */
function fnv1a32(input: string, seed: number): number {
  let hash = seed >>> 0;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Hash key over the normalized concatenated text of an example (all message
 * lists, roles, reasoning, tool-call payloads, answer and label). Two seeded
 * 32-bit FNV-1a hashes plus the signature length make accidental collisions
 * negligible without retaining the full text.
 */
function duplicateKey(example: Example): string {
  const parts: string[] = [example.type];
  for (const { field, messages } of messageLists(example)) {
    for (const message of messages) {
      parts.push(`${field}${rawRole(message)}${normalizeForHash(contentOf(message))}`);
      if (message.reasoning !== undefined && message.reasoning !== '') {
        parts.push(normalizeForHash(message.reasoning));
      }
      if (message.toolCalls !== undefined) {
        for (const call of message.toolCalls) {
          parts.push(`${call.name}${normalizeForHash(call.arguments)}`);
        }
      }
    }
  }
  if (typeof example.answer === 'string') parts.push(`answer${normalizeForHash(example.answer)}`);
  if (typeof example.label === 'boolean') parts.push(`label${String(example.label)}`);
  const signature = parts.join('');
  const a = fnv1a32(signature, 0x811c9dc5).toString(16);
  const b = fnv1a32(signature, 0x6c62272e).toString(16);
  return `${a}-${b}-${signature.length}`;
}

/**
 * Analyze a whole dataset: per-example reports plus EXACT duplicate detection
 * (normalized concatenated-text hash — case and whitespace insensitive) and a
 * dataset-level summary. Later occurrences of a duplicate receive a
 * high-severity `duplicate` issue and are re-scored; the first occurrence is
 * left untouched. Near-duplicate detection lives in the dedup module.
 *
 * @param examples - Examples to analyze (reports are index-aligned).
 * @returns Reports plus a {@link DatasetQualitySummary}.
 */
export function analyzeDataset(examples: Example[]): {
  reports: QualityReport[];
  summary: DatasetQualitySummary;
} {
  const reports = examples.map((example) => analyzeExample(example));

  const seen = new Map<string, number>();
  examples.forEach((example, index) => {
    const key = duplicateKey(example);
    const firstIndex = seen.get(key);
    if (firstIndex === undefined) {
      seen.set(key, index);
      return;
    }
    const duplicateIssue: QualityIssue = {
      type: 'duplicate',
      severity: 'high',
      message: `Exact duplicate of example ${examples[firstIndex].id}`,
      autoFixable: false,
    };
    reports[index] = buildReport(example, [...reports[index].issues, duplicateIssue]);
  });

  const scoreDistribution = { excellent: 0, good: 0, fair: 0, poor: 0 };
  const issueCounts: Partial<Record<IssueType, number>> = {};
  let totalScore = 0;
  for (const report of reports) {
    totalScore += report.score;
    if (report.score >= 90) scoreDistribution.excellent += 1;
    else if (report.score >= 70) scoreDistribution.good += 1;
    else if (report.score >= 50) scoreDistribution.fair += 1;
    else scoreDistribution.poor += 1;
    for (const issue of report.issues) {
      issueCounts[issue.type] = (issueCounts[issue.type] ?? 0) + 1;
    }
  }

  return {
    reports,
    summary: {
      scored: reports.length,
      averageScore: reports.length === 0 ? 0 : Math.round((totalScore / reports.length) * 10) / 10,
      scoreDistribution,
      issueCounts,
    },
  };
}

// ---------------------------------------------------------------------------
// Cleaning
// ---------------------------------------------------------------------------

/** Strip null bytes and repair mojibake (looped so double-encoded text settles). */
function fixEncodingText(text: string): { text: string; removedNulls: boolean; fixed: boolean } {
  const withoutNulls = text.replace(/\u0000/g, '');
  let out = withoutNulls;
  for (let pass = 0; pass < 4; pass++) {
    let next = out;
    for (const [bad, good] of MOJIBAKE_FIXES) {
      if (next.includes(bad)) next = next.split(bad).join(good);
    }
    if (next === out) break;
    out = next;
  }
  return { text: out, removedNulls: withoutNulls !== text, fixed: out !== withoutNulls };
}

/** Collapse 3+ newlines to 2, drop trailing spaces per line, trim the edges. */
function normalizeWhitespaceText(text: string): string {
  return text
    .replace(/[ \t]+(?=\r?\n)/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function cloneMessage(message: Message): Message {
  const copy: Message = { ...message };
  if (message.toolCalls !== undefined) {
    copy.toolCalls = message.toolCalls.map((call) => ({ ...call }));
  }
  return copy;
}

/**
 * Clean a single example. Pure: the input is never mutated and a new Example
 * (with fresh message/tag/meta containers) is always returned.
 *
 * Operations (applied in this order per message, then list-wide removal):
 *  1. `normalizeRoles` — alias roles (`human`→`user`, `gpt`→`assistant`, …).
 *  2. `fixEncoding` — strip null bytes, repair V1 mojibake pairs (both
 *     latin-1 and cp1252 flavors) and drop U+FFFD replacement characters.
 *  3. `removeRefusals` — remove refusal-pattern openers (plus the rest of
 *     the sentence) from assistant turns. Skipped inside `rejected`, where
 *     refusals are legitimate negative DPO signal, and in reasoning traces.
 *  4. `maskPii` — mask with `[EMAIL]`/`[SSN]`/`[CARD]`/`[IP]`/`[PHONE]`.
 *  5. `removeSpecialTokens` — strip every known template control token.
 *  6. `normalizeWhitespace` — collapse 3+ newlines, drop trailing spaces,
 *     trim the edges.
 *  7. `removeEmptyMessages` — drop messages with no content, tool calls or
 *     reasoning (runs last so newly-emptied messages are caught).
 *
 * Text operations apply to both `content` and `reasoning` of every message in
 * `messages`, `chosen`, `rejected` and `completion`.
 *
 * @param example - The example to clean.
 * @param opts - Which operations to run (see {@link DEFAULT_CLEANING}).
 * @returns The cleaned example and a deduplicated list of change descriptions
 *          (empty when nothing was modified).
 */
export function cleanExample(
  example: Example,
  opts: CleaningOptions,
): { example: Example; changed: string[] } {
  const changed: string[] = [];
  const note = (message: string): void => {
    if (!changed.includes(message)) changed.push(message);
  };

  const transformText = (text: string, role: string, allowRefusalRemoval: boolean): string => {
    let out = text;
    if (opts.fixEncoding) {
      const result = fixEncodingText(out);
      if (result.removedNulls) note('Removed null characters');
      if (result.fixed) note('Fixed encoding artifacts');
      out = result.text;
    }
    if (opts.removeRefusals && allowRefusalRemoval && role === 'assistant') {
      let next = out;
      for (const re of REFUSAL_STRIPPERS) next = next.replace(re, '');
      if (next !== out) {
        note('Removed refusal text from assistant message');
        out = next.trim();
      }
    }
    if (opts.maskPii) {
      for (const rule of PII_RULES) {
        const next = out.replace(rule.pattern, rule.placeholder);
        if (next !== out) {
          note(`Masked ${rule.label} with ${rule.placeholder}`);
          out = next;
        }
      }
    }
    if (opts.removeSpecialTokens) {
      for (const token of ALL_SPECIAL_TOKENS) {
        if (out.includes(token)) {
          out = out.split(token).join('');
          note(`Removed special token "${token}"`);
        }
      }
    }
    if (opts.normalizeWhitespace) {
      const next = normalizeWhitespaceText(out);
      if (next !== out) {
        note('Normalized whitespace');
        out = next;
      }
    }
    return out;
  };

  const cleanList = (
    messages: Message[] | undefined,
    allowRefusalRemoval: boolean,
  ): Message[] | undefined => {
    if (messages === undefined) return undefined;
    let out = messages.map(cloneMessage);

    for (const message of out) {
      if (opts.normalizeRoles) {
        const raw = typeof message.role === 'string' ? message.role : '';
        const mapped = ROLE_ALIASES[raw.trim().toLowerCase()];
        if (mapped !== undefined && mapped !== raw) {
          message.role = mapped;
          note(`Normalized role "${raw}" to "${mapped}"`);
        }
      }
      const role = rawRole(message);
      message.content = transformText(contentOf(message), role, allowRefusalRemoval);
      if (typeof message.reasoning === 'string') {
        message.reasoning = transformText(message.reasoning, role, false);
      }
    }

    if (opts.removeEmptyMessages) {
      const kept: Message[] = [];
      for (const message of out) {
        if (isMessageNonEmpty(message)) kept.push(message);
        else note(`Removed empty ${rawRole(message) || 'unknown'} message`);
      }
      out = kept;
    }
    return out;
  };

  const cleaned: Example = {
    ...example,
    messages: cleanList(example.messages, true) ?? [],
    tags: [...example.tags],
    qualityIssues: example.qualityIssues.map((issue) => ({ ...issue })),
    meta: { ...example.meta },
  };
  if (example.chosen !== undefined) cleaned.chosen = cleanList(example.chosen, true);
  if (example.rejected !== undefined) cleaned.rejected = cleanList(example.rejected, false);
  if (example.completion !== undefined) cleaned.completion = cleanList(example.completion, true);
  if (example.tools !== undefined) {
    cleaned.tools = example.tools.map((tool) => ({ ...tool, parameters: { ...tool.parameters } }));
  }

  return { example: cleaned, changed };
}
