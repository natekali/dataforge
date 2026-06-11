/**
 * Google Gemini (Generative Language API) adapter.
 *
 * Uses the v1beta `generateContent` endpoint with `x-goog-api-key` header
 * auth. System messages map to `systemInstruction`, assistant turns to the
 * `model` role, `jsonMode` to `generationConfig.responseMimeType` and
 * thinking parts (`part.thought === true`) to {@link ChatResult.reasoning}.
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

const GEMINI_BASE = 'https://generativelanguage.googleapis.com';

function apiHeaders(config: ProviderConfig): Record<string, string> {
  return { 'x-goog-api-key': config.apiKey };
}

/** Map a canonical request onto a generateContent body. */
function buildBody(req: ChatRequest): Record<string, unknown> {
  const systemTexts = req.messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content);
  const contents = req.messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

  const generationConfig: Record<string, unknown> = {};
  if (typeof req.temperature === 'number') generationConfig['temperature'] = req.temperature;
  if (typeof req.maxTokens === 'number') generationConfig['maxOutputTokens'] = req.maxTokens;
  if (req.jsonMode) generationConfig['responseMimeType'] = 'application/json';

  const body: Record<string, unknown> = { contents };
  if (systemTexts.length > 0) {
    body['systemInstruction'] = { parts: [{ text: systemTexts.join('\n\n') }] };
  }
  if (Object.keys(generationConfig).length > 0) {
    body['generationConfig'] = generationConfig;
  }
  return body;
}

/** Concatenate text parts; `thought: true` parts become reasoning. */
function parseResult(data: unknown): ChatResult {
  const root = asRecord(data);
  const candidate = asRecord(asArray(root?.['candidates'])?.[0]);
  const parts = asArray(asRecord(candidate?.['content'])?.['parts']) ?? [];
  const textParts: string[] = [];
  const thoughtParts: string[] = [];
  for (const raw of parts) {
    const part = asRecord(raw);
    if (!part || typeof part['text'] !== 'string') continue;
    if (part['thought'] === true) thoughtParts.push(part['text']);
    else textParts.push(part['text']);
  }

  const result: ChatResult = { content: textParts.join('') };
  if (thoughtParts.length > 0) result.reasoning = thoughtParts.join('\n\n');

  const usage = asRecord(root?.['usageMetadata']);
  const input = numberOrUndefined(usage?.['promptTokenCount']);
  const output = numberOrUndefined(usage?.['candidatesTokenCount']);
  if (input !== undefined || output !== undefined) {
    result.usage = { inputTokens: input ?? 0, outputTokens: output ?? 0 };
  }
  return result;
}

async function chat(config: ProviderConfig, req: ChatRequest): Promise<ChatResult> {
  const base = resolveBaseUrl(config, GEMINI_BASE);
  const url = `${base}/v1beta/models/${encodeURIComponent(req.model)}:generateContent`;
  const data = await requestJson('Gemini', url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...apiHeaders(config) },
    body: JSON.stringify(buildBody(req)),
    signal: req.signal,
  });
  return parseResult(data);
}

async function listModels(config: ProviderConfig): Promise<ProviderModel[]> {
  const base = resolveBaseUrl(config, GEMINI_BASE);
  const data = await requestJson('Gemini', `${base}/v1beta/models?pageSize=1000`, {
    headers: apiHeaders(config),
  });
  const rows = asArray(asRecord(data)?.['models']) ?? [];
  const models: ProviderModel[] = [];
  for (const raw of rows) {
    const rec = asRecord(raw);
    if (!rec) continue;
    const name = rec['name'];
    if (typeof name !== 'string') continue;
    const methods = asArray(rec['supportedGenerationMethods']);
    if (methods && !methods.includes('generateContent')) continue;
    const id = name.replace(/^models\//, '');
    const displayName = rec['displayName'];
    const contextLength = numberOrUndefined(rec['inputTokenLimit']);
    const model: ProviderModel = {
      id,
      name: typeof displayName === 'string' ? displayName : id,
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

/** Google Gemini adapter (generativelanguage.googleapis.com, API-key auth). */
export const geminiAdapter: ProviderAdapter = {
  id: 'gemini',
  label: 'Google Gemini',
  needsKey: true,
  defaultBaseUrl: GEMINI_BASE,
  chat,
  listModels,
  testConnection,
};
