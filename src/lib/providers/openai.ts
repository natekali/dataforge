/**
 * OpenAI provider adapter + shared plumbing for the whole adapter suite.
 *
 * Besides the OpenAI adapter itself, this module exports the helpers reused
 * by every sibling adapter: {@link requestJson} / {@link ProviderHttpError}
 * (fetch with provider-error surfacing), {@link splitReasoning} (leading
 * `<think>` extraction) and the OpenAI-compatible chat-completions mappers
 * used verbatim by the OpenRouter and Groq adapters.
 *
 * The shared helpers live here rather than in index.ts so that index.ts —
 * which imports every adapter to build the PROVIDERS registry — never
 * participates in a runtime import cycle (its own imports from this file are
 * acyclic, and adapters only `import type` from index.ts).
 */
import type {
  ChatRequest,
  ChatResult,
  ProviderConfig,
  ProviderModel,
} from '@/engine/types';
import type { ConnectionTestResult, ProviderAdapter } from './index';

// ---------------------------------------------------------------------------
// Shared HTTP helpers
// ---------------------------------------------------------------------------

/** Maximum number of provider-error characters surfaced to the user. */
const ERROR_DETAIL_LIMIT = 300;

/** Error thrown when a provider responds with a non-2xx HTTP status. */
export class ProviderHttpError extends Error {
  /** HTTP status code returned by the provider. */
  readonly status: number;

  constructor(label: string, status: number, detail: string) {
    super(
      detail
        ? `${label} request failed (HTTP ${status}): ${detail}`
        : `${label} request failed (HTTP ${status})`,
    );
    this.name = 'ProviderHttpError';
    this.status = status;
  }
}

/** Pull the most useful message out of a provider error body. */
function extractErrorDetail(body: string): string {
  let detail = body.trim();
  try {
    const parsed: unknown = JSON.parse(body);
    const root = asRecord(parsed);
    if (root) {
      const err = root['error'];
      const errRecord = asRecord(err);
      const candidate =
        (typeof errRecord?.['message'] === 'string' ? errRecord['message'] : undefined) ??
        (typeof err === 'string' ? err : undefined) ??
        (typeof root['message'] === 'string' ? root['message'] : undefined);
      if (candidate !== undefined && candidate.trim() !== '') detail = candidate.trim();
    }
  } catch {
    // Body is not JSON — keep the raw text.
  }
  return detail.length > ERROR_DETAIL_LIMIT
    ? `${detail.slice(0, ERROR_DETAIL_LIMIT)}…`
    : detail;
}

/**
 * Perform a fetch and parse the JSON response.
 *
 * Non-2xx responses are converted into {@link ProviderHttpError} carrying the
 * HTTP status plus the provider's own error message (truncated to 300 chars).
 * Network failures and aborts reject with the original error so callers can
 * still detect `AbortError`.
 *
 * @param label - Human-readable provider name used in error messages.
 * @param url   - Absolute request URL.
 * @param init  - Standard fetch init (method, headers, body, signal).
 */
export async function requestJson(
  label: string,
  url: string,
  init: RequestInit = {},
): Promise<unknown> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let bodyText = '';
    try {
      bodyText = await res.text();
    } catch {
      // Body unreadable — status alone will have to do.
    }
    throw new ProviderHttpError(label, res.status, extractErrorDetail(bodyText));
  }
  try {
    return (await res.json()) as unknown;
  } catch {
    throw new Error(`${label} returned a non-JSON response from ${url}`);
  }
}

/**
 * Resolve the effective base URL for a request: the user-configured override
 * when present, otherwise the adapter default. Trailing slashes are stripped
 * so paths can be appended safely.
 */
export function resolveBaseUrl(config: ProviderConfig, fallback: string): string {
  const trimmed = config.baseUrl?.trim();
  const base = trimmed !== undefined && trimmed !== '' ? trimmed : fallback;
  return base.replace(/\/+$/, '');
}

/**
 * Run a connection probe and convert its outcome (success message or thrown
 * error) into a {@link ConnectionTestResult} with round-trip latency.
 */
export async function runConnectionTest(
  probe: () => Promise<string>,
): Promise<ConnectionTestResult> {
  const start = performance.now();
  try {
    const message = await probe();
    return { ok: true, message, latencyMs: Math.round(performance.now() - start) };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
      latencyMs: Math.round(performance.now() - start),
    };
  }
}

// ---------------------------------------------------------------------------
// Loose-JSON narrowing utilities (shared by all adapters)
// ---------------------------------------------------------------------------

/** Narrow an unknown value to a plain object record, else undefined. */
export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Narrow an unknown value to an array, else undefined. */
export function asArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

/** Narrow an unknown value to a finite number, else undefined. */
export function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

// ---------------------------------------------------------------------------
// Reasoning extraction
// ---------------------------------------------------------------------------

const LEADING_THINK = /^\s*<think>([\s\S]*?)<\/think>\s*/;

/**
 * Separate reasoning from final content.
 *
 * Combines an explicit provider-supplied reasoning field (e.g. OpenRouter's
 * `message.reasoning`, Groq's `message.reasoning_content`, Ollama's
 * `message.thinking`) with a leading `<think>…</think>` block embedded in the
 * content itself. When both are present they are joined with a blank line.
 *
 * @param rawContent        - The assistant message content as returned.
 * @param explicitReasoning - Provider-supplied reasoning field (unknown shape).
 */
export function splitReasoning(
  rawContent: string,
  explicitReasoning?: unknown,
): { content: string; reasoning?: string } {
  const explicit =
    typeof explicitReasoning === 'string' && explicitReasoning.trim() !== ''
      ? explicitReasoning
      : undefined;
  const match = LEADING_THINK.exec(rawContent);
  const content = match ? rawContent.slice(match[0].length) : rawContent;
  const inlineRaw = match ? match[1].trim() : '';
  const inline = inlineRaw !== '' ? inlineRaw : undefined;
  const reasoning =
    explicit !== undefined && inline !== undefined
      ? `${explicit}\n\n${inline}`
      : (explicit ?? inline);
  return reasoning === undefined ? { content } : { content, reasoning };
}

// ---------------------------------------------------------------------------
// OpenAI-compatible chat-completions wire format
// (reused by the OpenRouter and Groq adapters)
// ---------------------------------------------------------------------------

/**
 * OpenAI reasoning-model families (o1/o3/…, gpt-5*): these reject the
 * `temperature` parameter and take `max_completion_tokens` instead of
 * `max_tokens`.
 */
const REASONING_MODEL_ID = /^(o\d|gpt-5)/i;

/**
 * Map a canonical {@link ChatRequest} onto an OpenAI chat-completions body.
 * Optional sampling fields are omitted entirely when unset; `jsonMode` maps
 * to `response_format: {type: "json_object"}`. For o-series and gpt-5 family
 * models `temperature` is omitted entirely and the output cap is sent as
 * `max_completion_tokens` (those models reject the legacy parameters).
 */
export function buildChatCompletionsBody(req: ChatRequest): Record<string, unknown> {
  const reasoningModel = REASONING_MODEL_ID.test(req.model);
  const body: Record<string, unknown> = {
    model: req.model,
    messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
  };
  if (typeof req.temperature === 'number' && !reasoningModel) {
    body['temperature'] = req.temperature;
  }
  if (typeof req.maxTokens === 'number') {
    body[reasoningModel ? 'max_completion_tokens' : 'max_tokens'] = req.maxTokens;
  }
  if (req.jsonMode) body['response_format'] = { type: 'json_object' };
  return body;
}

/**
 * Parse an OpenAI-compatible chat-completions response into a
 * {@link ChatResult}: first-choice content, reasoning from
 * `message.reasoning` / `message.reasoning_content` plus any leading
 * `<think>` block, and `usage.prompt_tokens` / `usage.completion_tokens`.
 */
export function parseChatCompletionsResult(label: string, data: unknown): ChatResult {
  const root = asRecord(data);
  const choice = asRecord(asArray(root?.['choices'])?.[0]);
  const message = asRecord(choice?.['message']);
  if (!message) {
    throw new Error(`${label} response did not contain a chat completion message`);
  }
  const rawContent = typeof message['content'] === 'string' ? message['content'] : '';
  const explicit = message['reasoning'] ?? message['reasoning_content'];
  const { content, reasoning } = splitReasoning(rawContent, explicit);

  const result: ChatResult = { content };
  if (reasoning !== undefined) result.reasoning = reasoning;

  const usage = asRecord(root?.['usage']);
  const input = numberOrUndefined(usage?.['prompt_tokens']);
  const output = numberOrUndefined(usage?.['completion_tokens']);
  if (input !== undefined || output !== undefined) {
    result.usage = { inputTokens: input ?? 0, outputTokens: output ?? 0 };
  }
  return result;
}

/**
 * Execute a full OpenAI-compatible chat-completions request: build the body,
 * POST it with the given auth/extra headers and parse the result.
 *
 * @param label   - Provider name for error messages.
 * @param url     - Absolute chat-completions endpoint URL.
 * @param headers - Provider-specific headers (auth, attribution, …).
 * @param req     - Canonical chat request (AbortSignal passed through).
 */
export async function chatCompletions(
  label: string,
  url: string,
  headers: Record<string, string>,
  req: ChatRequest,
): Promise<ChatResult> {
  const data = await requestJson(label, url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(buildChatCompletionsBody(req)),
    signal: req.signal,
  });
  return parseChatCompletionsResult(label, data);
}

// ---------------------------------------------------------------------------
// OpenAI adapter
// ---------------------------------------------------------------------------

const OPENAI_BASE = 'https://api.openai.com';

/** Chat-capable id prefixes: gpt-* and o-series reasoning models (o1, o3, …). */
const CHAT_MODEL_ID = /^(gpt-|o\d)/;
/** Modality-specific ids that share the gpt-/o prefixes but cannot chat. */
const NON_CHAT_MODEL =
  /embedding|audio|dall-e|whisper|tts|realtime|image|transcribe|moderation/;

function authHeaders(config: ProviderConfig): Record<string, string> {
  return { Authorization: `Bearer ${config.apiKey}` };
}

async function chat(config: ProviderConfig, req: ChatRequest): Promise<ChatResult> {
  const base = resolveBaseUrl(config, OPENAI_BASE);
  return chatCompletions(
    'OpenAI',
    `${base}/v1/chat/completions`,
    authHeaders(config),
    req,
  );
}

async function listModels(config: ProviderConfig): Promise<ProviderModel[]> {
  const base = resolveBaseUrl(config, OPENAI_BASE);
  const data = await requestJson('OpenAI', `${base}/v1/models`, {
    headers: authHeaders(config),
  });
  const rows = asArray(asRecord(data)?.['data']) ?? [];
  const models: ProviderModel[] = [];
  for (const raw of rows) {
    const rec = asRecord(raw);
    if (!rec) continue;
    const id = rec['id'];
    if (typeof id !== 'string') continue;
    if (!CHAT_MODEL_ID.test(id) || NON_CHAT_MODEL.test(id)) continue;
    models.push({ id, name: id });
  }
  return models.sort((a, b) => a.id.localeCompare(b.id));
}

function testConnection(config: ProviderConfig): Promise<ConnectionTestResult> {
  return runConnectionTest(async () => {
    const models = await listModels(config);
    return `Connected — ${models.length} chat models available`;
  });
}

/** OpenAI chat-completions adapter (api.openai.com, Bearer auth). */
export const openaiAdapter: ProviderAdapter = {
  id: 'openai',
  label: 'OpenAI',
  needsKey: true,
  defaultBaseUrl: OPENAI_BASE,
  chat,
  listModels,
  testConnection,
};
