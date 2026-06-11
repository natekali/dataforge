/**
 * OpenRouter adapter — OpenAI-compatible chat completions at
 * https://openrouter.ai/api/v1 with app-attribution headers.
 *
 * Reasoning models surface their traces as `message.reasoning`, which the
 * shared parser maps to {@link ChatResult.reasoning} (with leading `<think>`
 * fallback for models that inline traces).
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
  chatCompletions,
  numberOrUndefined,
  requestJson,
  resolveBaseUrl,
  runConnectionTest,
} from './openai';

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

/** App attribution shown on the OpenRouter activity dashboard. */
const ATTRIBUTION_HEADERS: Record<string, string> = {
  'HTTP-Referer': 'https://natekali.github.io/dataforge/',
  'X-Title': 'DataForge Studio',
};

function apiHeaders(config: ProviderConfig): Record<string, string> {
  return { Authorization: `Bearer ${config.apiKey}`, ...ATTRIBUTION_HEADERS };
}

async function chat(config: ProviderConfig, req: ChatRequest): Promise<ChatResult> {
  const base = resolveBaseUrl(config, OPENROUTER_BASE);
  return chatCompletions(
    'OpenRouter',
    `${base}/chat/completions`,
    apiHeaders(config),
    req,
  );
}

async function listModels(config: ProviderConfig): Promise<ProviderModel[]> {
  const base = resolveBaseUrl(config, OPENROUTER_BASE);
  const data = await requestJson('OpenRouter', `${base}/models`, {
    headers: apiHeaders(config),
  });
  const rows = asArray(asRecord(data)?.['data']) ?? [];
  const models: ProviderModel[] = [];
  for (const raw of rows) {
    const rec = asRecord(raw);
    if (!rec) continue;
    const id = rec['id'];
    if (typeof id !== 'string') continue;
    const name = rec['name'];
    const contextLength = numberOrUndefined(rec['context_length']);
    const model: ProviderModel = {
      id,
      name: typeof name === 'string' ? name : id,
    };
    if (contextLength !== undefined) model.contextLength = contextLength;
    models.push(model);
  }
  return models.sort((a, b) => a.id.localeCompare(b.id));
}

function testConnection(config: ProviderConfig): Promise<ConnectionTestResult> {
  return runConnectionTest(async () => {
    const models = await listModels(config);
    return `Connected — ${models.length} models available`;
  });
}

/** OpenRouter adapter (openrouter.ai/api/v1, Bearer auth + attribution). */
export const openrouterAdapter: ProviderAdapter = {
  id: 'openrouter',
  label: 'OpenRouter',
  needsKey: true,
  defaultBaseUrl: OPENROUTER_BASE,
  chat,
  listModels,
  testConnection,
};
