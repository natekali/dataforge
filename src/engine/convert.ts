/**
 * DataForge V2 — conversion between raw source rows and canonical Examples.
 *
 * {@link rowsToExamples} turns detected source rows (OpenAI messages,
 * ShareGPT, Alpaca, DPO pairs, KTO, raw text) into canonical `Example`
 * records: roles are normalized, `<think>` traces are extracted into the
 * structural `reasoning` field, tool calls are passed through with generated
 * ids when missing, and invalid rows are skipped with error strings.
 *
 * {@link examplesToRows} is the inverse for legacy export shapes
 * (openai-messages / alpaca / sharegpt).
 *
 * No DOM, no React — safe to run in Web Workers and Node (vitest).
 */

import type {
  DetectedSchema,
  Example,
  ImportResult,
  Message,
  Role,
  SourceFormat,
  ToolCall,
  ToolDefinition,
} from '@/engine/types';
import { createExample } from '@/engine/types';
import {
  ALPACA_ALIASES,
  DPO_PROMPT_FIELDS,
  classifyRow,
  isRecord,
  resolveAlpacaField,
} from '@/engine/detection';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of per-row error strings retained in an ImportResult. */
export const MAX_IMPORT_ERRORS = 20;

/** Row/message-level fields that carry a separate reasoning trace. */
export const REASONING_FIELDS: readonly string[] = ['reasoning', 'reasoning_content', 'thinking'];

/** Source role spellings → canonical roles. Keys are matched lowercase. */
export const ROLE_ALIASES: Readonly<Record<string, Role>> = {
  system: 'system',
  developer: 'developer',
  user: 'user',
  human: 'user',
  assistant: 'assistant',
  gpt: 'assistant',
  ai: 'assistant',
  bot: 'assistant',
  model: 'assistant',
  tool: 'tool',
  observation: 'tool',
  function: 'tool',
};

/** Canonical role → ShareGPT `from` value used by {@link examplesToRows}. */
export const SHAREGPT_FROM: Readonly<Record<Role, string>> = {
  system: 'system',
  developer: 'system',
  user: 'human',
  assistant: 'gpt',
  tool: 'observation',
};

// ---------------------------------------------------------------------------
// Primitive normalizers
// ---------------------------------------------------------------------------

/**
 * Normalize a source role spelling (`human`, `gpt`, `ai`, `bot`, `model`,
 * `observation`, …) to a canonical {@link Role}. Throws on unknown roles so
 * the offending row is skipped and reported.
 */
export function normalizeRole(value: unknown): Role {
  if (typeof value !== 'string') throw new Error('message role must be a string');
  const role = ROLE_ALIASES[value.trim().toLowerCase()];
  if (role === undefined) throw new Error(`unsupported role "${value}"`);
  return role;
}

/**
 * Extract `<think>…</think>` blocks from message content into a separate
 * reasoning string. Returns the cleaned content plus the joined reasoning
 * (omitted when no complete block is present).
 */
export function extractThink(content: string): { content: string; reasoning?: string } {
  const pattern = /<think>([\s\S]*?)<\/think>/gi;
  const parts: string[] = [];
  const stripped = content.replace(pattern, (_match, inner: string) => {
    const trimmed = inner.trim();
    if (trimmed.length > 0) parts.push(trimmed);
    return '';
  });
  if (parts.length === 0) return { content };
  return { content: stripped.trim(), reasoning: parts.join('\n\n') };
}

/** Generate an OpenAI-style tool-call id (`call_` + 24 hex chars). */
export function generateToolCallId(): string {
  return `call_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
}

/** First non-empty string among `keys` on the record, or undefined. */
function firstString(row: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string' && value.trim().length > 0) return value;
  }
  return undefined;
}

function requireRecord(row: unknown): Record<string, unknown> {
  if (!isRecord(row)) throw new Error('row is not an object');
  return row;
}

/** Coerce message content to a string (null → "", text-part arrays joined). */
function contentToString(value: unknown, context: string): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) {
    return value
      .map((part, index) => {
        if (typeof part === 'string') return part;
        if (isRecord(part) && typeof part['text'] === 'string') return part['text'];
        throw new Error(`${context}: unsupported content part at index ${index}`);
      })
      .join('');
  }
  throw new Error(`${context}: content must be a string`);
}

/** Normalize raw `tool_calls` entries to canonical {@link ToolCall}s. */
function normalizeToolCalls(value: unknown, context: string): ToolCall[] {
  if (!Array.isArray(value)) throw new Error(`${context}: tool_calls must be an array`);
  return value.map((item, index) => {
    if (!isRecord(item)) throw new Error(`${context}: tool_calls[${index}] is not an object`);
    const fn = isRecord(item['function']) ? item['function'] : item;
    const name = fn['name'];
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error(`${context}: tool_calls[${index}] is missing a function name`);
    }
    const rawArguments = fn['arguments'];
    let argumentsJson: string;
    if (typeof rawArguments === 'string') argumentsJson = rawArguments;
    else if (rawArguments === undefined || rawArguments === null) argumentsJson = '{}';
    else argumentsJson = JSON.stringify(rawArguments);
    const rawId = item['id'];
    const id = typeof rawId === 'string' && rawId.length > 0 ? rawId : generateToolCallId();
    return { id, name, arguments: argumentsJson };
  });
}

/** Normalize a top-level `tools` array to canonical {@link ToolDefinition}s. */
function normalizeToolDefinitions(value: unknown): ToolDefinition[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const definitions: ToolDefinition[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const fn = isRecord(item['function']) ? item['function'] : item;
    const name = fn['name'];
    if (typeof name !== 'string' || name.length === 0) continue;
    const definition: ToolDefinition = {
      name,
      parameters: isRecord(fn['parameters']) ? fn['parameters'] : {},
    };
    if (typeof fn['description'] === 'string') definition.description = fn['description'];
    definitions.push(definition);
  }
  return definitions.length > 0 ? definitions : undefined;
}

// ---------------------------------------------------------------------------
// Message normalization
// ---------------------------------------------------------------------------

/**
 * Normalize one raw message object (OpenAI keys, or ShareGPT keys remapped by
 * the caller) into a canonical {@link Message}: role aliases, content
 * coercion, message-level reasoning fields, `<think>` extraction for
 * assistant turns, tool_calls / tool_call_id / name / weight passthrough.
 */
function normalizeMessage(raw: unknown, index: number): Message {
  if (!isRecord(raw)) throw new Error(`message ${index} is not an object`);
  if (!('role' in raw)) throw new Error(`message ${index} is missing "role"`);

  const role = normalizeRole(raw['role']);
  const message: Message = { role, content: contentToString(raw['content'], `message ${index}`) };

  const fieldReasoning = firstString(raw, REASONING_FIELDS);
  if (fieldReasoning !== undefined) message.reasoning = fieldReasoning;

  if (role === 'assistant') {
    const { content, reasoning } = extractThink(message.content);
    message.content = content;
    if (reasoning !== undefined) {
      message.reasoning =
        message.reasoning !== undefined ? `${message.reasoning}\n\n${reasoning}` : reasoning;
    }
  }

  const rawToolCalls = raw['tool_calls'] ?? raw['toolCalls'];
  if (rawToolCalls !== undefined && rawToolCalls !== null) {
    message.toolCalls = normalizeToolCalls(rawToolCalls, `message ${index}`);
  }

  const toolCallId = raw['tool_call_id'] ?? raw['toolCallId'];
  if (typeof toolCallId === 'string' && toolCallId.length > 0) message.toolCallId = toolCallId;

  const name = raw['name'];
  if (typeof name === 'string' && name.length > 0) message.name = name;

  const weight = raw['weight'];
  if (weight === 0 || weight === 1) message.weight = weight;

  return message;
}

/** Attach a row-level reasoning field to the last assistant message. */
function applyRowReasoning(row: Record<string, unknown>, messages: Message[]): void {
  const reasoning = firstString(row, REASONING_FIELDS);
  if (reasoning === undefined) return;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role === 'assistant') {
      if (message.reasoning === undefined) message.reasoning = reasoning;
      return;
    }
  }
}

/** Build an assistant message from a plain string, extracting think tags. */
function assistantFromString(text: string): Message {
  return { role: 'assistant', ...extractThink(text) };
}

/**
 * Normalize a DPO/KTO continuation (`chosen` / `rejected` / `completion`):
 * a plain string becomes a single assistant message; message objects and
 * arrays are normalized message-by-message.
 */
function normalizeContinuation(value: unknown, label: string): Message[] {
  if (typeof value === 'string') {
    if (value.trim().length === 0) throw new Error(`"${label}" is empty`);
    return [assistantFromString(value)];
  }
  if (Array.isArray(value) && value.length > 0) {
    return value.map((item, index) => normalizeMessage(item, index));
  }
  if (isRecord(value)) return [normalizeMessage(value, 0)];
  throw new Error(`"${label}" must be a string, a message, or a message array`);
}

/**
 * Extract the prompt portion of a DPO/KTO row as messages. String prompts
 * become a single user turn (with a system turn prepended when the row has a
 * system field); message-list prompts are normalized and kept as-is.
 */
function promptMessages(row: Record<string, unknown>): Message[] {
  for (const field of DPO_PROMPT_FIELDS) {
    const value = row[field];
    if (Array.isArray(value) && value.length > 0) {
      return value.map((item, index) => normalizeMessage(item, index));
    }
    if (typeof value === 'string' && value.trim().length > 0) {
      const messages: Message[] = [];
      const system = firstString(row, ALPACA_ALIASES.system);
      if (system !== undefined) messages.push({ role: 'system', content: system });
      messages.push({ role: 'user', content: value });
      return messages;
    }
  }
  throw new Error('missing prompt field (expected "prompt", "question", "messages", or "input")');
}

/**
 * Resolve a canonical Alpaca field on a row: the detected schema's
 * fieldMapping takes precedence, then the built-in alias list.
 */
function resolveMappedString(
  row: Record<string, unknown>,
  canonical: keyof typeof ALPACA_ALIASES,
  schema: DetectedSchema,
): string | undefined {
  for (const [source, target] of Object.entries(schema.fieldMapping)) {
    if (target !== canonical) continue;
    const value = row[source];
    if (typeof value === 'string') return value;
  }
  const alias = resolveAlpacaField(row, canonical);
  if (alias === undefined) return undefined;
  const value = row[alias];
  return typeof value === 'string' ? value : undefined;
}

// ---------------------------------------------------------------------------
// Per-format row converters
// ---------------------------------------------------------------------------

function convertOpenAiRow(row: unknown, projectId: string): Example {
  const record = requireRecord(row);
  const raw = record['messages'];
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('"messages" must be a non-empty array');
  }
  const messages = raw.map((item, index) => normalizeMessage(item, index));
  applyRowReasoning(record, messages);
  const tools = normalizeToolDefinitions(record['tools']);
  // RL rows (prompt-only conversation + verifiable answer) share the canonical
  // messages shape — keep their type and answer instead of degrading to SFT.
  const answer = record['answer'];
  if (typeof answer === 'string' && !messages.some((m) => m.role === 'assistant')) {
    return createExample({
      projectId,
      type: 'rl',
      messages,
      answer,
      tools,
      meta: { sourceFormat: 'openai-messages' },
    });
  }
  return createExample({
    projectId,
    messages,
    tools,
    meta: { sourceFormat: 'openai-messages' },
  });
}

function convertShareGptRow(row: unknown, projectId: string): Example {
  const record = requireRecord(row);
  const turns = record['conversations'];
  if (!Array.isArray(turns) || turns.length === 0) {
    throw new Error('"conversations" must be a non-empty array');
  }
  const messages = turns.map((turn, index) => {
    if (!isRecord(turn)) throw new Error(`conversation turn ${index} is not an object`);
    return normalizeMessage(
      { ...turn, role: turn['from'] ?? turn['role'], content: turn['value'] ?? turn['content'] },
      index,
    );
  });
  const system = firstString(record, ALPACA_ALIASES.system);
  if (system !== undefined && !messages.some((m) => m.role === 'system')) {
    messages.unshift({ role: 'system', content: system });
  }
  applyRowReasoning(record, messages);
  return createExample({ projectId, messages, meta: { sourceFormat: 'sharegpt' } });
}

function convertAlpacaRow(row: unknown, schema: DetectedSchema, projectId: string): Example {
  const record = requireRecord(row);

  const instruction = resolveMappedString(record, 'instruction', schema);
  if (instruction === undefined || instruction.trim().length === 0) {
    throw new Error('missing or empty instruction field');
  }
  const output = resolveMappedString(record, 'output', schema);
  if (output === undefined || output.trim().length === 0) {
    throw new Error('missing or empty output field');
  }
  const input = resolveMappedString(record, 'input', schema);
  const system = resolveMappedString(record, 'system', schema);

  const messages: Message[] = [];
  if (system !== undefined && system.trim().length > 0) {
    messages.push({ role: 'system', content: system });
  }
  messages.push({
    role: 'user',
    content: input !== undefined && input.trim().length > 0 ? `${instruction}\n${input}` : instruction,
  });
  messages.push(assistantFromString(output));
  applyRowReasoning(record, messages);

  return createExample({ projectId, messages, meta: { sourceFormat: 'alpaca' } });
}

function convertDpoRow(row: unknown, projectId: string): Example {
  const record = requireRecord(row);
  const messages = promptMessages(record);
  const chosen = normalizeContinuation(record['chosen'], 'chosen');
  const rejected = normalizeContinuation(record['rejected'], 'rejected');
  return createExample({
    projectId,
    type: 'preference',
    messages,
    chosen,
    rejected,
    tools: normalizeToolDefinitions(record['tools']),
    meta: { sourceFormat: 'dpo-pairs' },
  });
}

/** Coerce a KTO label (boolean, 0/1, or "true"/"false") to a boolean. */
function normalizeLabel(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (value === 0 || value === 1) return value === 1;
  if (value === 'true' || value === 'false') return value === 'true';
  throw new Error('"label" must be a boolean, 0/1, or "true"/"false"');
}

function convertKtoRow(row: unknown, projectId: string): Example {
  const record = requireRecord(row);
  const messages = promptMessages(record);
  const completion = normalizeContinuation(record['completion'], 'completion');
  const label = normalizeLabel(record['label']);
  return createExample({
    projectId,
    type: 'kto',
    messages,
    completion,
    label,
    tools: normalizeToolDefinitions(record['tools']),
    meta: { sourceFormat: 'kto-unpaired' },
  });
}

function convertTextRow(row: unknown, schema: DetectedSchema, projectId: string): Example {
  let content: string | undefined;
  if (typeof row === 'string') {
    content = row;
  } else if (isRecord(row)) {
    for (const [source, target] of Object.entries(schema.fieldMapping)) {
      const value = row[source];
      if ((target === 'messages' || target === 'text') && typeof value === 'string') {
        content = value;
        break;
      }
    }
    if (content === undefined) {
      const keys = Object.keys(row);
      if (keys.length === 1) {
        const only = row[keys[0]];
        if (typeof only === 'string') content = only;
      }
    }
    if (content === undefined && typeof row['text'] === 'string') content = row['text'];
  }
  if (content === undefined || content.trim().length === 0) {
    throw new Error('row has no usable text content');
  }
  return createExample({
    projectId,
    messages: [{ role: 'user', content }],
    meta: { sourceFormat: 'text' },
  });
}

function convertRow(
  row: unknown,
  format: SourceFormat,
  schema: DetectedSchema,
  projectId: string,
): Example {
  switch (format) {
    case 'openai-messages':
      return convertOpenAiRow(row, projectId);
    case 'sharegpt':
      return convertShareGptRow(row, projectId);
    case 'alpaca':
      return convertAlpacaRow(row, schema, projectId);
    case 'dpo-pairs':
      return convertDpoRow(row, projectId);
    case 'kto-unpaired':
      return convertKtoRow(row, projectId);
    case 'text':
      return convertTextRow(row, schema, projectId);
    case 'unknown': {
      const detected = classifyRow(row);
      if (detected === null) throw new Error('row does not match any known format');
      return convertRow(row, detected, schema, projectId);
    }
  }
}

// ---------------------------------------------------------------------------
// Public API: import
// ---------------------------------------------------------------------------

/**
 * Convert raw source rows into canonical Examples according to the detected
 * schema. Invalid rows are skipped and counted; at most
 * {@link MAX_IMPORT_ERRORS} per-row error strings are retained. When the
 * schema format is `unknown`, each row is classified individually and
 * converted on a best-effort basis.
 */
export function rowsToExamples(
  rows: unknown[],
  schema: DetectedSchema,
  projectId: string,
): ImportResult {
  const examples: Example[] = [];
  const errors: string[] = [];
  let skipped = 0;

  for (let i = 0; i < rows.length; i += 1) {
    try {
      examples.push(convertRow(rows[i], schema.format, schema, projectId));
    } catch (error) {
      skipped += 1;
      if (errors.length < MAX_IMPORT_ERRORS) {
        errors.push(`Row ${i + 1}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  return { examples, schema, skipped, errors };
}

// ---------------------------------------------------------------------------
// Public API: legacy export
// ---------------------------------------------------------------------------

/** Render a message's reasoning back inline as a `<think>` block. */
function renderContentWithReasoning(message: Message): string {
  if (message.reasoning === undefined || message.reasoning.length === 0) return message.content;
  const think = `<think>${message.reasoning}</think>`;
  return message.content.length > 0 ? `${think}\n${message.content}` : think;
}

function messageToOpenAi(message: Message): Record<string, unknown> {
  const out: Record<string, unknown> = {
    role: message.role,
    content: renderContentWithReasoning(message),
  };
  if (message.toolCalls !== undefined && message.toolCalls.length > 0) {
    out['tool_calls'] = message.toolCalls.map((call) => ({
      id: call.id,
      type: 'function',
      function: { name: call.name, arguments: call.arguments },
    }));
  }
  if (message.toolCallId !== undefined) out['tool_call_id'] = message.toolCallId;
  if (message.name !== undefined) out['name'] = message.name;
  if (message.weight !== undefined) out['weight'] = message.weight;
  return out;
}

function exampleToOpenAiRow(example: Example): object {
  const row: Record<string, unknown> = { messages: example.messages.map(messageToOpenAi) };
  if (example.chosen !== undefined && example.chosen.length > 0) {
    row['chosen'] = example.chosen.map(messageToOpenAi);
  }
  if (example.rejected !== undefined && example.rejected.length > 0) {
    row['rejected'] = example.rejected.map(messageToOpenAi);
  }
  if (example.completion !== undefined && example.completion.length > 0) {
    row['completion'] = example.completion.map(messageToOpenAi);
  }
  if (example.label !== undefined) row['label'] = example.label;
  if (example.tools !== undefined && example.tools.length > 0) {
    row['tools'] = example.tools.map((tool) => ({ type: 'function', function: tool }));
  }
  return row;
}

/** First assistant turn of the example (messages, then chosen/completion). */
function firstAssistant(example: Example): Message | undefined {
  return (
    example.messages.find((m) => m.role === 'assistant') ??
    example.chosen?.find((m) => m.role === 'assistant') ??
    example.completion?.find((m) => m.role === 'assistant')
  );
}

function exampleToAlpacaRow(example: Example): object {
  const row: Record<string, unknown> = {};
  const system = example.messages.find((m) => m.role === 'system');
  if (system !== undefined) row['system'] = system.content;
  const user = example.messages.find((m) => m.role === 'user');
  row['instruction'] = user !== undefined ? user.content : '';
  const assistant = firstAssistant(example);
  row['output'] = assistant !== undefined ? renderContentWithReasoning(assistant) : '';
  return row;
}

function exampleToShareGptRow(example: Example): object {
  return {
    conversations: example.messages.map((message) => ({
      from: SHAREGPT_FROM[message.role],
      value: renderContentWithReasoning(message),
    })),
  };
}

/**
 * Inverse conversion for legacy export targets.
 *
 * - `openai-messages`: full structural passthrough (tool_calls re-wrapped,
 *   reasoning re-inlined as `<think>` blocks, preference/kto columns kept).
 * - `alpaca`: first system → `system`, first user → `instruction`, first
 *   assistant (falling back to chosen/completion) → `output`.
 * - `sharegpt`: roles mapped to `from` human/gpt/system (tool → observation).
 */
export function examplesToRows(
  examples: Example[],
  format: 'openai-messages' | 'alpaca' | 'sharegpt',
): object[] {
  switch (format) {
    case 'openai-messages':
      return examples.map(exampleToOpenAiRow);
    case 'alpaca':
      return examples.map(exampleToAlpacaRow);
    case 'sharegpt':
      return examples.map(exampleToShareGptRow);
  }
}
