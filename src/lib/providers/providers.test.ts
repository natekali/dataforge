import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatRequest, ProviderConfig, ProviderId } from '@/engine/types';
import { PROVIDERS, ProviderHttpError, getAdapter } from './index';

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function config(id: ProviderId, overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return { id, apiKey: 'test-key', enabled: true, ...overrides };
}

function request(overrides: Partial<ChatRequest> = {}): ChatRequest {
  return {
    model: 'test-model',
    messages: [{ role: 'user', content: 'Hello' }],
    ...overrides,
  };
}

function lastCall(): { url: string; init: RequestInit } {
  const call = fetchMock.mock.calls.at(-1);
  if (!call) throw new Error('fetch was not called');
  const [input, init] = call;
  return { url: String(input), init: init ?? {} };
}

function lastBody(): Record<string, unknown> {
  return JSON.parse(String(lastCall().init.body)) as Record<string, unknown>;
}

function lastHeaders(): Record<string, string> {
  return (lastCall().init.headers ?? {}) as Record<string, string>;
}

/** Minimal OpenAI-compatible chat completion payload. */
function completionPayload(
  message: Record<string, unknown>,
  usage?: Record<string, unknown>,
): Record<string, unknown> {
  return { choices: [{ index: 0, message, finish_reason: 'stop' }], ...(usage ? { usage } : {}) };
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

describe('PROVIDERS registry', () => {
  const ids: ProviderId[] = ['openai', 'anthropic', 'gemini', 'openrouter', 'groq', 'ollama'];

  it('registers an adapter for every provider id', () => {
    for (const id of ids) {
      expect(PROVIDERS[id].id).toBe(id);
      expect(getAdapter(id)).toBe(PROVIDERS[id]);
      expect(PROVIDERS[id].label.length).toBeGreaterThan(0);
      expect(PROVIDERS[id].defaultBaseUrl).toMatch(/^https?:\/\//);
    }
  });

  it('marks only ollama as keyless', () => {
    for (const id of ids) {
      expect(PROVIDERS[id].needsKey).toBe(id !== 'ollama');
    }
  });

  it('exposes the documented default base URLs', () => {
    expect(PROVIDERS.openai.defaultBaseUrl).toBe('https://api.openai.com');
    expect(PROVIDERS.anthropic.defaultBaseUrl).toBe('https://api.anthropic.com');
    expect(PROVIDERS.gemini.defaultBaseUrl).toBe('https://generativelanguage.googleapis.com');
    expect(PROVIDERS.openrouter.defaultBaseUrl).toBe('https://openrouter.ai/api/v1');
    expect(PROVIDERS.groq.defaultBaseUrl).toBe('https://api.groq.com/openai/v1');
    expect(PROVIDERS.ollama.defaultBaseUrl).toBe('http://localhost:11434');
  });
});

// ---------------------------------------------------------------------------
// OpenAI
// ---------------------------------------------------------------------------

describe('openai adapter', () => {
  const adapter = getAdapter('openai');

  it('posts a chat completion with auth header and mapped body', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(completionPayload({ role: 'assistant', content: 'Hi!' })),
    );
    await adapter.chat(
      config('openai'),
      request({
        messages: [
          { role: 'system', content: 'Be terse.' },
          { role: 'user', content: 'Hello' },
        ],
        temperature: 0.2,
        maxTokens: 256,
      }),
    );

    const { url, init } = lastCall();
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect(lastHeaders()['Authorization']).toBe('Bearer test-key');
    expect(lastHeaders()['Content-Type']).toBe('application/json');

    const body = lastBody();
    expect(body['model']).toBe('test-model');
    expect(body['messages']).toEqual([
      { role: 'system', content: 'Be terse.' },
      { role: 'user', content: 'Hello' },
    ]);
    expect(body['temperature']).toBe(0.2);
    expect(body['max_tokens']).toBe(256);
    expect(body).not.toHaveProperty('response_format');
  });

  it('maps jsonMode to response_format json_object', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(completionPayload({ role: 'assistant', content: '{}' })),
    );
    await adapter.chat(config('openai'), request({ jsonMode: true }));
    expect(lastBody()['response_format']).toEqual({ type: 'json_object' });
  });

  it('omits temperature and sends max_completion_tokens for o-series models', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(completionPayload({ role: 'assistant', content: 'ok' })),
    );
    await adapter.chat(
      config('openai'),
      request({ model: 'o3-mini', temperature: 0.7, maxTokens: 256 }),
    );
    const body = lastBody();
    expect(body).not.toHaveProperty('temperature');
    expect(body).not.toHaveProperty('max_tokens');
    expect(body['max_completion_tokens']).toBe(256);
  });

  it('omits temperature and sends max_completion_tokens for the gpt-5 family', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(completionPayload({ role: 'assistant', content: 'ok' })),
    );
    await adapter.chat(
      config('openai'),
      request({ model: 'GPT-5-mini', temperature: 0.3, maxTokens: 128 }),
    );
    const body = lastBody();
    expect(body).not.toHaveProperty('temperature');
    expect(body).not.toHaveProperty('max_tokens');
    expect(body['max_completion_tokens']).toBe(128);
  });

  it('keeps temperature and max_tokens for non-reasoning gpt models', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(completionPayload({ role: 'assistant', content: 'ok' })),
    );
    await adapter.chat(
      config('openai'),
      request({ model: 'gpt-4o-mini', temperature: 0.7, maxTokens: 256 }),
    );
    const body = lastBody();
    expect(body['temperature']).toBe(0.7);
    expect(body['max_tokens']).toBe(256);
    expect(body).not.toHaveProperty('max_completion_tokens');
  });

  it('omits optional sampling fields when unset', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(completionPayload({ role: 'assistant', content: 'ok' })),
    );
    await adapter.chat(config('openai'), request());
    const body = lastBody();
    expect(body).not.toHaveProperty('temperature');
    expect(body).not.toHaveProperty('max_tokens');
    expect(body).not.toHaveProperty('response_format');
  });

  it('passes through an AbortSignal', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(completionPayload({ role: 'assistant', content: 'ok' })),
    );
    const controller = new AbortController();
    await adapter.chat(config('openai'), request({ signal: controller.signal }));
    expect(lastCall().init.signal).toBe(controller.signal);
  });

  it('parses content and usage', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        completionPayload(
          { role: 'assistant', content: 'Answer' },
          { prompt_tokens: 12, completion_tokens: 34, total_tokens: 46 },
        ),
      ),
    );
    const result = await adapter.chat(config('openai'), request());
    expect(result.content).toBe('Answer');
    expect(result.reasoning).toBeUndefined();
    expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 34 });
  });

  it('omits usage when the provider returns none', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(completionPayload({ role: 'assistant', content: 'ok' })),
    );
    const result = await adapter.chat(config('openai'), request());
    expect(result.usage).toBeUndefined();
  });

  it('extracts message.reasoning into ChatResult.reasoning', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        completionPayload({ role: 'assistant', content: 'Final', reasoning: 'step by step' }),
      ),
    );
    const result = await adapter.chat(config('openai'), request());
    expect(result.content).toBe('Final');
    expect(result.reasoning).toBe('step by step');
  });

  it('strips a leading <think> block into reasoning', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        completionPayload({
          role: 'assistant',
          content: '<think>plan the answer</think>The answer is 4.',
        }),
      ),
    );
    const result = await adapter.chat(config('openai'), request());
    expect(result.content).toBe('The answer is 4.');
    expect(result.reasoning).toBe('plan the answer');
  });

  it('combines an explicit reasoning field with a leading think block', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        completionPayload({
          role: 'assistant',
          content: '  <think>inline</think>Done',
          reasoning_content: 'explicit',
        }),
      ),
    );
    const result = await adapter.chat(config('openai'), request());
    expect(result.content).toBe('Done');
    expect(result.reasoning).toBe('explicit\n\ninline');
  });

  it('surfaces HTTP status and provider error message', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: { message: 'Incorrect API key provided', type: 'invalid_request_error' } }, 401),
    );
    const err: unknown = await adapter.chat(config('openai'), request()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderHttpError);
    expect((err as ProviderHttpError).status).toBe(401);
    expect((err as ProviderHttpError).message).toBe(
      'OpenAI request failed (HTTP 401): Incorrect API key provided',
    );
  });

  it('truncates long provider error bodies to 300 characters', async () => {
    const longMessage = 'x'.repeat(400);
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { message: longMessage } }, 500));
    const err: unknown = await adapter.chat(config('openai'), request()).catch((e: unknown) => e);
    const message = (err as Error).message;
    expect(message).toContain('HTTP 500');
    expect(message).toContain(`${'x'.repeat(300)}…`);
    expect(message).not.toContain('x'.repeat(301));
  });

  it('surfaces non-JSON error bodies as raw text', async () => {
    fetchMock.mockResolvedValueOnce(new Response('Bad gateway', { status: 502 }));
    await expect(adapter.chat(config('openai'), request())).rejects.toThrow(
      'OpenAI request failed (HTTP 502): Bad gateway',
    );
  });

  it('throws a meaningful error on a non-JSON success response', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html></html>', { status: 200 }));
    await expect(adapter.chat(config('openai'), request())).rejects.toThrow(/non-JSON response/);
  });

  it('lists only chat-capable models, sorted', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        object: 'list',
        data: [
          { id: 'o3', object: 'model' },
          { id: 'gpt-4.1', object: 'model' },
          { id: 'text-embedding-3-large', object: 'model' },
          { id: 'whisper-1', object: 'model' },
          { id: 'dall-e-3', object: 'model' },
          { id: 'gpt-4o-realtime-preview', object: 'model' },
          { id: 'tts-1-hd', object: 'model' },
          { id: 'gpt-4o-audio-preview', object: 'model' },
          { id: 'gpt-image-1', object: 'model' },
          { id: 'omni-moderation-latest', object: 'model' },
          { id: 'gpt-4o-mini', object: 'model' },
        ],
      }),
    );
    const models = await adapter.listModels(config('openai'));
    expect(lastCall().url).toBe('https://api.openai.com/v1/models');
    expect(lastHeaders()['Authorization']).toBe('Bearer test-key');
    expect(models).toEqual([
      { id: 'gpt-4.1', name: 'gpt-4.1' },
      { id: 'gpt-4o-mini', name: 'gpt-4o-mini' },
      { id: 'o3', name: 'o3' },
    ]);
  });

  it('honours a custom baseUrl with a trailing slash', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(completionPayload({ role: 'assistant', content: 'ok' })),
    );
    await adapter.chat(
      config('openai', { baseUrl: 'https://proxy.example.com/openai/' }),
      request(),
    );
    expect(lastCall().url).toBe('https://proxy.example.com/openai/v1/chat/completions');
  });

  it('reports a successful connection test with latency', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [{ id: 'gpt-4.1' }, { id: 'o3' }] }));
    const result = await adapter.testConnection(config('openai'));
    expect(result.ok).toBe(true);
    expect(result.message).toContain('2');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('reports a failed connection test without throwing', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { message: 'nope' } }, 401));
    const result = await adapter.testConnection(config('openai'));
    expect(result.ok).toBe(false);
    expect(result.message).toContain('HTTP 401');
    expect(result.message).toContain('nope');
  });
});

// ---------------------------------------------------------------------------
// Anthropic
// ---------------------------------------------------------------------------

describe('anthropic adapter', () => {
  const adapter = getAdapter('anthropic');

  const textPayload = (text: string): Record<string, unknown> => ({
    content: [{ type: 'text', text }],
    usage: { input_tokens: 1, output_tokens: 2 },
  });

  it('posts to /v1/messages with the required headers', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(textPayload('ok')));
    await adapter.chat(config('anthropic'), request());

    const { url, init } = lastCall();
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.method).toBe('POST');
    const headers = lastHeaders();
    expect(headers['x-api-key']).toBe('test-key');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('hoists system messages to the top-level system field and defaults max_tokens', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(textPayload('ok')));
    await adapter.chat(
      config('anthropic'),
      request({
        messages: [
          { role: 'system', content: 'You are terse.' },
          { role: 'user', content: 'Hi' },
          { role: 'assistant', content: 'Hello' },
          { role: 'user', content: 'Bye' },
        ],
      }),
    );
    const body = lastBody();
    expect(body['system']).toBe('You are terse.');
    expect(body['max_tokens']).toBe(4096);
    expect(body['messages']).toEqual([
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello' },
      { role: 'user', content: 'Bye' },
    ]);
  });

  it('respects explicit maxTokens and temperature', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(textPayload('ok')));
    await adapter.chat(config('anthropic'), request({ maxTokens: 1024, temperature: 0.7 }));
    const body = lastBody();
    expect(body['max_tokens']).toBe(1024);
    expect(body['temperature']).toBe(0.7);
  });

  it('clamps temperature to the API maximum of 1.0', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(textPayload('ok')));
    await adapter.chat(config('anthropic'), request({ temperature: 1.2 }));
    expect(lastBody()['temperature']).toBe(1);
  });

  it('emulates jsonMode via a system directive', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(textPayload('{}')));
    await adapter.chat(
      config('anthropic'),
      request({
        jsonMode: true,
        messages: [
          { role: 'system', content: 'Base prompt.' },
          { role: 'user', content: 'Give me JSON' },
        ],
      }),
    );
    const system = String(lastBody()['system']);
    expect(system).toContain('Base prompt.');
    expect(system).toContain('JSON object');
  });

  it('concatenates text blocks and maps thinking blocks to reasoning', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        content: [
          { type: 'thinking', thinking: 'let me think', signature: 'sig' },
          { type: 'text', text: 'Hello' },
          { type: 'text', text: ' world' },
        ],
        usage: { input_tokens: 5, output_tokens: 9 },
      }),
    );
    const result = await adapter.chat(config('anthropic'), request());
    expect(result.content).toBe('Hello world');
    expect(result.reasoning).toBe('let me think');
    expect(result.usage).toEqual({ inputTokens: 5, outputTokens: 9 });
  });

  it('lists models with display names', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: [
          { type: 'model', id: 'claude-sonnet-4-5', display_name: 'Claude Sonnet 4.5' },
          { type: 'model', id: 'claude-haiku-4-5', display_name: 'Claude Haiku 4.5' },
        ],
        has_more: false,
      }),
    );
    const models = await adapter.listModels(config('anthropic'));
    expect(lastCall().url).toBe('https://api.anthropic.com/v1/models?limit=1000');
    expect(lastHeaders()['x-api-key']).toBe('test-key');
    expect(models).toEqual([
      { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5' },
      { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Gemini
// ---------------------------------------------------------------------------

describe('gemini adapter', () => {
  const adapter = getAdapter('gemini');

  const textPayload = (text: string): Record<string, unknown> => ({
    candidates: [{ content: { role: 'model', parts: [{ text }] } }],
  });

  it('posts generateContent with key header, role mapping and systemInstruction', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(textPayload('ok')));
    await adapter.chat(
      config('gemini'),
      request({
        messages: [
          { role: 'system', content: 'Be helpful.' },
          { role: 'user', content: 'u1' },
          { role: 'assistant', content: 'a1' },
          { role: 'user', content: 'u2' },
        ],
      }),
    );

    const { url, init } = lastCall();
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/test-model:generateContent',
    );
    expect(init.method).toBe('POST');
    expect(lastHeaders()['x-goog-api-key']).toBe('test-key');

    const body = lastBody();
    expect(body['contents']).toEqual([
      { role: 'user', parts: [{ text: 'u1' }] },
      { role: 'model', parts: [{ text: 'a1' }] },
      { role: 'user', parts: [{ text: 'u2' }] },
    ]);
    expect(body['systemInstruction']).toEqual({ parts: [{ text: 'Be helpful.' }] });
  });

  it('maps jsonMode, temperature and maxTokens into generationConfig', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(textPayload('{}')));
    await adapter.chat(
      config('gemini'),
      request({ jsonMode: true, temperature: 0.4, maxTokens: 128 }),
    );
    expect(lastBody()['generationConfig']).toEqual({
      temperature: 0.4,
      maxOutputTokens: 128,
      responseMimeType: 'application/json',
    });
  });

  it('omits generationConfig and systemInstruction when empty', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(textPayload('ok')));
    await adapter.chat(config('gemini'), request());
    const body = lastBody();
    expect(body).not.toHaveProperty('generationConfig');
    expect(body).not.toHaveProperty('systemInstruction');
  });

  it('parses text parts, thought parts and usage metadata', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        candidates: [
          {
            content: {
              role: 'model',
              parts: [
                { text: 'reasoning trace', thought: true },
                { text: 'Hello ' },
                { text: 'there' },
              ],
            },
          },
        ],
        usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 11, totalTokenCount: 18 },
      }),
    );
    const result = await adapter.chat(config('gemini'), request());
    expect(result.content).toBe('Hello there');
    expect(result.reasoning).toBe('reasoning trace');
    expect(result.usage).toEqual({ inputTokens: 7, outputTokens: 11 });
  });

  it('returns empty content when no candidates are present', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ candidates: [] }));
    const result = await adapter.chat(config('gemini'), request());
    expect(result.content).toBe('');
  });

  it('lists generateContent-capable models without the models/ prefix', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        models: [
          {
            name: 'models/gemini-2.5-pro',
            displayName: 'Gemini 2.5 Pro',
            inputTokenLimit: 1048576,
            supportedGenerationMethods: ['generateContent', 'countTokens'],
          },
          {
            name: 'models/text-embedding-004',
            displayName: 'Text Embedding 004',
            supportedGenerationMethods: ['embedContent'],
          },
          {
            name: 'models/gemini-2.5-flash',
            supportedGenerationMethods: ['generateContent'],
          },
        ],
      }),
    );
    const models = await adapter.listModels(config('gemini'));
    expect(lastCall().url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000',
    );
    expect(models).toEqual([
      { id: 'gemini-2.5-flash', name: 'gemini-2.5-flash' },
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', contextLength: 1048576 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// OpenRouter
// ---------------------------------------------------------------------------

describe('openrouter adapter', () => {
  const adapter = getAdapter('openrouter');

  it('targets the OpenRouter base URL with attribution headers', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(completionPayload({ role: 'assistant', content: 'ok' })),
    );
    await adapter.chat(config('openrouter'), request());

    expect(lastCall().url).toBe('https://openrouter.ai/api/v1/chat/completions');
    const headers = lastHeaders();
    expect(headers['Authorization']).toBe('Bearer test-key');
    expect(headers['HTTP-Referer']).toBe('https://natekali.github.io/dataforge/');
    expect(headers['X-Title']).toBe('DataForge Studio');
  });

  it('extracts message.reasoning from reasoning models', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        completionPayload(
          { role: 'assistant', content: 'Final answer', reasoning: 'chain of thought' },
          { prompt_tokens: 3, completion_tokens: 8 },
        ),
      ),
    );
    const result = await adapter.chat(config('openrouter'), request());
    expect(result.content).toBe('Final answer');
    expect(result.reasoning).toBe('chain of thought');
    expect(result.usage).toEqual({ inputTokens: 3, outputTokens: 8 });
  });

  it('lists models with names and context lengths', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: [
          { id: 'anthropic/claude-sonnet-4.5', name: 'Claude Sonnet 4.5', context_length: 200000 },
          { id: 'meta-llama/llama-4-maverick', name: 'Llama 4 Maverick', context_length: 1048576 },
        ],
      }),
    );
    const models = await adapter.listModels(config('openrouter'));
    expect(lastCall().url).toBe('https://openrouter.ai/api/v1/models');
    expect(models).toEqual([
      { id: 'anthropic/claude-sonnet-4.5', name: 'Claude Sonnet 4.5', contextLength: 200000 },
      { id: 'meta-llama/llama-4-maverick', name: 'Llama 4 Maverick', contextLength: 1048576 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Groq
// ---------------------------------------------------------------------------

describe('groq adapter', () => {
  const adapter = getAdapter('groq');

  it('targets the Groq OpenAI-compatible base URL', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(completionPayload({ role: 'assistant', content: 'ok' })),
    );
    await adapter.chat(config('groq'), request({ jsonMode: true }));

    expect(lastCall().url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(lastHeaders()['Authorization']).toBe('Bearer test-key');
    expect(lastBody()['response_format']).toEqual({ type: 'json_object' });
  });

  it('extracts reasoning_content from parsed reasoning responses', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        completionPayload({
          role: 'assistant',
          content: 'Final',
          reasoning_content: 'thinking out loud',
        }),
      ),
    );
    const result = await adapter.chat(config('groq'), request());
    expect(result.content).toBe('Final');
    expect(result.reasoning).toBe('thinking out loud');
  });

  it('strips inline think tags from raw reasoning responses', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        completionPayload({ role: 'assistant', content: '<think>hmm</think>42' }),
      ),
    );
    const result = await adapter.chat(config('groq'), request());
    expect(result.content).toBe('42');
    expect(result.reasoning).toBe('hmm');
  });

  it('filters speech models out of the listing and keeps context windows', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: [
          { id: 'llama-3.3-70b-versatile', object: 'model', context_window: 131072 },
          { id: 'whisper-large-v3', object: 'model', context_window: 448 },
          { id: 'playai-tts', object: 'model', context_window: 8192 },
        ],
      }),
    );
    const models = await adapter.listModels(config('groq'));
    expect(lastCall().url).toBe('https://api.groq.com/openai/v1/models');
    expect(models).toEqual([
      { id: 'llama-3.3-70b-versatile', name: 'llama-3.3-70b-versatile', contextLength: 131072 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Ollama
// ---------------------------------------------------------------------------

describe('ollama adapter', () => {
  const adapter = getAdapter('ollama');

  const chatPayload = (message: Record<string, unknown>): Record<string, unknown> => ({
    model: 'test-model',
    message,
    done: true,
  });

  it('posts /api/chat with stream false and no auth header by default', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(chatPayload({ role: 'assistant', content: 'Hi' })),
    );
    await adapter.chat(config('ollama', { apiKey: '' }), request());

    const { url, init } = lastCall();
    expect(url).toBe('http://localhost:11434/api/chat');
    expect(init.method).toBe('POST');
    expect(lastHeaders()).not.toHaveProperty('Authorization');
    expect(lastBody()['stream']).toBe(false);
  });

  it('adds bearer auth when an api key is configured (proxied deployments)', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(chatPayload({ role: 'assistant', content: 'Hi' })),
    );
    await adapter.chat(config('ollama'), request());
    expect(lastHeaders()['Authorization']).toBe('Bearer test-key');
  });

  it('maps jsonMode and sampling options', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(chatPayload({ role: 'assistant', content: '{}' })),
    );
    await adapter.chat(
      config('ollama', { apiKey: '' }),
      request({ jsonMode: true, temperature: 0.5, maxTokens: 64 }),
    );
    const body = lastBody();
    expect(body['format']).toBe('json');
    expect(body['options']).toEqual({ temperature: 0.5, num_predict: 64 });
  });

  it('omits options and format when nothing is set', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(chatPayload({ role: 'assistant', content: 'ok' })),
    );
    await adapter.chat(config('ollama', { apiKey: '' }), request());
    const body = lastBody();
    expect(body).not.toHaveProperty('options');
    expect(body).not.toHaveProperty('format');
  });

  it('maps message.thinking to reasoning and eval counts to usage', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        model: 'test-model',
        message: { role: 'assistant', content: 'Hi', thinking: 'pondering' },
        done: true,
        prompt_eval_count: 3,
        eval_count: 5,
      }),
    );
    const result = await adapter.chat(config('ollama', { apiKey: '' }), request());
    expect(result.content).toBe('Hi');
    expect(result.reasoning).toBe('pondering');
    expect(result.usage).toEqual({ inputTokens: 3, outputTokens: 5 });
  });

  it('strips a leading think block from content', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        chatPayload({ role: 'assistant', content: '<think>local thought</think>Sure!' }),
      ),
    );
    const result = await adapter.chat(config('ollama', { apiKey: '' }), request());
    expect(result.content).toBe('Sure!');
    expect(result.reasoning).toBe('local thought');
  });

  it('lists local models from /api/tags', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        models: [
          { name: 'qwen3:8b', model: 'qwen3:8b', size: 1 },
          { name: 'llama3.2:3b', model: 'llama3.2:3b', size: 2 },
        ],
      }),
    );
    const models = await adapter.listModels(config('ollama', { apiKey: '' }));
    expect(lastCall().url).toBe('http://localhost:11434/api/tags');
    expect(models).toEqual([
      { id: 'llama3.2:3b', name: 'llama3.2:3b' },
      { id: 'qwen3:8b', name: 'qwen3:8b' },
    ]);
  });

  it('tests the connection via /api/version', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ version: '0.9.3' }));
    const result = await adapter.testConnection(config('ollama', { apiKey: '' }));
    expect(lastCall().url).toBe('http://localhost:11434/api/version');
    expect(result.ok).toBe(true);
    expect(result.message).toContain('0.9.3');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('reports unreachable hosts as a failed connection test', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    const result = await adapter.testConnection(config('ollama', { apiKey: '' }));
    expect(result.ok).toBe(false);
    expect(result.message).toBe('fetch failed');
  });

  it('honours a custom host baseUrl', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(chatPayload({ role: 'assistant', content: 'ok' })),
    );
    await adapter.chat(
      config('ollama', { apiKey: '', baseUrl: 'http://192.168.1.50:11434/' }),
      request(),
    );
    expect(lastCall().url).toBe('http://192.168.1.50:11434/api/chat');
  });
});
