/**
 * Anthropic Messages API adapter.
 *
 * Browser-direct calls are enabled via the
 * `anthropic-dangerous-direct-browser-access` header (officially supported
 * for BYOK apps). System messages are hoisted into the top-level `system`
 * field, `max_tokens` is always sent (the API requires it) and extended
 * thinking blocks are surfaced as {@link ChatResult.reasoning}.
 */
import type {
  ChatRequest,
  ChatResult,
  ProviderConfig,
  ProviderModel,
} from '@/engine/types';
import type { ConnectionTestResult, ProviderAdapter } from './index';
import {
  asArray,
  asRecord,
  numberOrUndefined,
  requestJson,
  resolveBaseUrl,
  runConnectionTest,
} from './openai';

const ANTHROPIC_BASE = 'https://api.anthropic.com';
const ANTHROPIC_VERSION = '2023-06-01';
/** The Messages API requires max_tokens; used when the request omits it. */
const DEFAULT_MAX_TOKENS = 4096;
/** Anthropic has no native JSON mode — emulate it with a system directive. */
const JSON_MODE_DIRECTIVE =
  'Respond with a single valid JSON object and nothing else — no prose, no code fences.';

function apiHeaders(config: ProviderConfig): Record<string, string> {
  return {
    'x-api-key': config.apiKey,
    'anthropic-version': ANTHROPIC_VERSION,
    'anthropic-dangerous-direct-browser-access': 'true',
  };
}

/** Map a canonical request onto a Messages API body. */
function buildBody(req: ChatRequest): Record<string, unknown> {
  const systemParts = req.messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content);
  if (req.jsonMode) systemParts.push(JSON_MODE_DIRECTIVE);

  const body: Record<string, unknown> = {
    model: req.model,
    max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
    messages: req.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role, content: m.content })),
  };
  if (systemParts.length > 0) body['system'] = systemParts.join('\n\n');
  // Anthropic rejects temperature > 1.0 (the UI slider goes up to 1.2).
  if (typeof req.temperature === 'number') {
    body['temperature'] = Math.min(req.temperature, 1);
  }
  return body;
}

/** Concatenate text blocks; thinking blocks become ChatResult.reasoning. */
function parseResult(data: unknown): ChatResult {
  const root = asRecord(data);
  const blocks = asArray(root?.['content']) ?? [];
  const textParts: string[] = [];
  const thinkingParts: string[] = [];
  for (const raw of blocks) {
    const block = asRecord(raw);
    if (!block) continue;
    if (block['type'] === 'text' && typeof block['text'] === 'string') {
      textParts.push(block['text']);
    } else if (block['type'] === 'thinking' && typeof block['thinking'] === 'string') {
      thinkingParts.push(block['thinking']);
    }
  }

  const result: ChatResult = { content: textParts.join('') };
  if (thinkingParts.length > 0) result.reasoning = thinkingParts.join('\n\n');

  const usage = asRecord(root?.['usage']);
  const input = numberOrUndefined(usage?.['input_tokens']);
  const output = numberOrUndefined(usage?.['output_tokens']);
  if (input !== undefined || output !== undefined) {
    result.usage = { inputTokens: input ?? 0, outputTokens: output ?? 0 };
  }
  return result;
}

async function chat(config: ProviderConfig, req: ChatRequest): Promise<ChatResult> {
  const base = resolveBaseUrl(config, ANTHROPIC_BASE);
  const data = await requestJson('Anthropic', `${base}/v1/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...apiHeaders(config) },
    body: JSON.stringify(buildBody(req)),
    signal: req.signal,
  });
  return parseResult(data);
}

async function listModels(config: ProviderConfig): Promise<ProviderModel[]> {
  const base = resolveBaseUrl(config, ANTHROPIC_BASE);
  const data = await requestJson('Anthropic', `${base}/v1/models?limit=1000`, {
    headers: apiHeaders(config),
  });
  const rows = asArray(asRecord(data)?.['data']) ?? [];
  const models: ProviderModel[] = [];
  for (const raw of rows) {
    const rec = asRecord(raw);
    if (!rec) continue;
    const id = rec['id'];
    if (typeof id !== 'string') continue;
    const displayName = rec['display_name'];
    models.push({ id, name: typeof displayName === 'string' ? displayName : id });
  }
  return models.sort((a, b) => a.id.localeCompare(b.id));
}

function testConnection(config: ProviderConfig): Promise<ConnectionTestResult> {
  return runConnectionTest(async () => {
    const models = await listModels(config);
    return `Connected — ${models.length} models available`;
  });
}

/** Anthropic Messages API adapter (api.anthropic.com, x-api-key auth). */
export const anthropicAdapter: ProviderAdapter = {
  id: 'anthropic',
  label: 'Anthropic',
  needsKey: true,
  defaultBaseUrl: ANTHROPIC_BASE,
  chat,
  listModels,
  testConnection,
};
