/**
 * BYOK LLM provider adapters — plain `fetch`, no SDKs.
 *
 * Every adapter implements the same {@link ProviderAdapter} surface so the
 * UI and job workers can treat providers uniformly: one-shot chat, model
 * listing and a connection test. All adapters are runtime-environment
 * agnostic (no DOM, no React) and work identically in Web Workers and Node.
 *
 * Key management is the caller's responsibility: adapters receive a
 * {@link ProviderConfig} per call and never persist anything.
 */
import type {
  ChatRequest,
  ChatResult,
  ProviderConfig,
  ProviderId,
  ProviderModel,
} from '@/engine/types';
import { openaiAdapter } from './openai';
import { anthropicAdapter } from './anthropic';
import { geminiAdapter } from './gemini';
import { openrouterAdapter } from './openrouter';
import { groqAdapter } from './groq';
import { ollamaAdapter } from './ollama';

/** Outcome of {@link ProviderAdapter.testConnection}. */
export interface ConnectionTestResult {
  /** True when the provider answered the probe request successfully. */
  ok: boolean;
  /** Human-readable status ("Connected — 42 models available" / error text). */
  message: string;
  /** Round-trip time of the probe request in milliseconds. */
  latencyMs: number;
}

/** Uniform interface implemented by every BYOK provider adapter. */
export interface ProviderAdapter {
  id: ProviderId;
  /** Display name shown in settings UI (e.g. "OpenAI"). */
  label: string;
  /** False for local providers (Ollama) that work without an API key. */
  needsKey: boolean;
  /** Base URL used when ProviderConfig.baseUrl is not set. */
  defaultBaseUrl: string;
  /** Run a single non-streaming chat completion. */
  chat(config: ProviderConfig, req: ChatRequest): Promise<ChatResult>;
  /** List chat-capable models offered by the provider. */
  listModels(config: ProviderConfig): Promise<ProviderModel[]>;
  /** Cheap reachability + auth probe, never throws. */
  testConnection(config: ProviderConfig): Promise<ConnectionTestResult>;
}

/** Registry of every supported provider, keyed by {@link ProviderId}. */
export const PROVIDERS: Record<ProviderId, ProviderAdapter> = {
  openai: openaiAdapter,
  anthropic: anthropicAdapter,
  gemini: geminiAdapter,
  openrouter: openrouterAdapter,
  groq: groqAdapter,
  ollama: ollamaAdapter,
};

/**
 * Look up the adapter for a provider id.
 *
 * @param id - One of the six supported provider ids.
 * @returns The matching adapter (total over ProviderId, never undefined).
 */
export function getAdapter(id: ProviderId): ProviderAdapter {
  return PROVIDERS[id];
}

export { ProviderHttpError, splitReasoning } from './openai';
