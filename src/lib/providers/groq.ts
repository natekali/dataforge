/**
 * Groq adapter — OpenAI-compatible chat completions at
 * https://api.groq.com/openai/v1.
 *
 * Groq's reasoning models return traces either as
 * `message.reasoning_content` (parsed mode) or inline `<think>` blocks;
 * both are mapped to {@link ChatResult.reasoning} by the shared parser.
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

const GROQ_BASE = 'https://api.groq.com/openai/v1';

/** Speech/audio model ids that appear in /models but cannot chat. */
const NON_CHAT_MODEL = /whisper|tts|transcribe/;

function apiHeaders(config: ProviderConfig): Record<string, string> {
  return { Authorization: `Bearer ${config.apiKey}` };
}

async function chat(config: ProviderConfig, req: ChatRequest): Promise<ChatResult> {
  const base = resolveBaseUrl(config, GROQ_BASE);
  return chatCompletions('Groq', `${base}/chat/completions`, apiHeaders(config), req);
}

async function listModels(config: ProviderConfig): Promise<ProviderModel[]> {
  const base = resolveBaseUrl(config, GROQ_BASE);
  const data = await requestJson('Groq', `${base}/models`, {
    headers: apiHeaders(config),
  });
  const rows = asArray(asRecord(data)?.['data']) ?? [];
  const models: ProviderModel[] = [];
  for (const raw of rows) {
    const rec = asRecord(raw);
    if (!rec) continue;
    const id = rec['id'];
    if (typeof id !== 'string' || NON_CHAT_MODEL.test(id)) continue;
    const contextLength = numberOrUndefined(rec['context_window']);
    const model: ProviderModel = { id, name: id };
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

/** Groq adapter (api.groq.com/openai/v1, Bearer auth). */
export const groqAdapter: ProviderAdapter = {
  id: 'groq',
  label: 'Groq',
  needsKey: true,
  defaultBaseUrl: GROQ_BASE,
  chat,
  listModels,
  testConnection,
};
