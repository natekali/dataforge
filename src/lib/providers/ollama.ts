/**
 * Ollama adapter — local (or self-hosted) models, no API key required.
 *
 * Uses the native Ollama API: POST /api/chat with `stream: false`,
 * GET /api/tags for the model list and GET /api/version as the connection
 * probe. Thinking models return `message.thinking`, which maps to
 * {@link ChatResult.reasoning} (with leading `<think>` fallback).
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
  splitReasoning,
} from './openai';

const OLLAMA_BASE = 'http://localhost:11434';

/**
 * Ollama itself needs no auth, but reverse-proxied deployments often sit
 * behind a bearer token — forward the key only when one is configured.
 */
function apiHeaders(config: ProviderConfig): Record<string, string> {
  const headers: Record<string, string> = {};
  const key = config.apiKey.trim();
  if (key !== '') headers['Authorization'] = `Bearer ${key}`;
  return headers;
}

/** Map a canonical request onto an /api/chat body (non-streaming). */
function buildBody(req: ChatRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: req.model,
    messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
    stream: false,
  };
  const options: Record<string, unknown> = {};
  if (typeof req.temperature === 'number') options['temperature'] = req.temperature;
  if (typeof req.maxTokens === 'number') options['num_predict'] = req.maxTokens;
  if (Object.keys(options).length > 0) body['options'] = options;
  if (req.jsonMode) body['format'] = 'json';
  return body;
}

/** Parse a non-streaming /api/chat response. */
function parseResult(data: unknown): ChatResult {
  const root = asRecord(data);
  const message = asRecord(root?.['message']);
  if (!message) {
    throw new Error('Ollama response did not contain a chat message');
  }
  const rawContent = typeof message['content'] === 'string' ? message['content'] : '';
  const { content, reasoning } = splitReasoning(rawContent, message['thinking']);

  const result: ChatResult = { content };
  if (reasoning !== undefined) result.reasoning = reasoning;

  const input = numberOrUndefined(root?.['prompt_eval_count']);
  const output = numberOrUndefined(root?.['eval_count']);
  if (input !== undefined || output !== undefined) {
    result.usage = { inputTokens: input ?? 0, outputTokens: output ?? 0 };
  }
  return result;
}

async function chat(config: ProviderConfig, req: ChatRequest): Promise<ChatResult> {
  const base = resolveBaseUrl(config, OLLAMA_BASE);
  const data = await requestJson('Ollama', `${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...apiHeaders(config) },
    body: JSON.stringify(buildBody(req)),
    signal: req.signal,
  });
  return parseResult(data);
}

async function listModels(config: ProviderConfig): Promise<ProviderModel[]> {
  const base = resolveBaseUrl(config, OLLAMA_BASE);
  const data = await requestJson('Ollama', `${base}/api/tags`, {
    headers: apiHeaders(config),
  });
  const rows = asArray(asRecord(data)?.['models']) ?? [];
  const models: ProviderModel[] = [];
  for (const raw of rows) {
    const rec = asRecord(raw);
    if (!rec) continue;
    const name = rec['name'];
    const modelField = rec['model'];
    const id =
      typeof name === 'string'
        ? name
        : typeof modelField === 'string'
          ? modelField
          : undefined;
    if (id === undefined) continue;
    models.push({ id, name: id });
  }
  return models.sort((a, b) => a.id.localeCompare(b.id));
}

function testConnection(config: ProviderConfig): Promise<ConnectionTestResult> {
  return runConnectionTest(async () => {
    const base = resolveBaseUrl(config, OLLAMA_BASE);
    const data = await requestJson('Ollama', `${base}/api/version`, {
      headers: apiHeaders(config),
    });
    const version = asRecord(data)?.['version'];
    return typeof version === 'string'
      ? `Connected — Ollama ${version}`
      : 'Connected — Ollama';
  });
}

/** Ollama adapter (localhost:11434 by default, keyless). */
export const ollamaAdapter: ProviderAdapter = {
  id: 'ollama',
  label: 'Ollama',
  needsKey: false,
  defaultBaseUrl: OLLAMA_BASE,
  chat,
  listModels,
  testConnection,
};
