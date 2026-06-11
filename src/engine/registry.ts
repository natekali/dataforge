/**
 * DataForge V2 — 2026 open-weight model registry.
 *
 * Curated, verified (June 2026) catalogue of fine-tunable open models with the
 * chat-template / reasoning / tool-calling metadata the import, quality and
 * export pipelines need. Pure data + lookup helpers: no DOM, no React, safe in
 * workers and Node.
 *
 * Conventions:
 *  - `id` is the stable registry slug referenced by Project.targetModelId.
 *  - `hfId` is the exact HuggingFace repo id.
 *  - `recommendedSeqLen` is a practical SFT packing length (4096 for the
 *    "small" class, 8192 for medium/large), never the marketing context.
 */

import type { ModelInfo } from '@/engine/types';

/** Inline reasoning-trace delimiters used by most think-tag models. */
const THINK: [string, string] = ['<think>', '</think>'];
/** Mistral reasoning token pair (Magistral / Mistral Medium 3.5). */
const MISTRAL_THINK: [string, string] = ['[THINK]', '[/THINK]'];
/** ByteDance Seed-OSS uses namespaced think tags. */
const SEED_THINK: [string, string] = ['<seed:think>', '</seed:think>'];

type ModelSeed = Omit<ModelInfo, 'preservesThinking' | 'supportsSystemRole' | 'multimodal'> &
  Partial<Pick<ModelInfo, 'preservesThinking' | 'supportsSystemRole' | 'multimodal'>>;

/** Applies registry-wide defaults for the rarely-varying flags. */
function def(seed: ModelSeed): ModelInfo {
  return { preservesThinking: false, supportsSystemRole: true, multimodal: [], ...seed };
}

/**
 * The full model registry, grouped by vendor in rough release order.
 * Treat as read-only; copy before sorting/mutating.
 */
export const MODEL_REGISTRY: ModelInfo[] = [
  // -------------------------------------------------------------------------
  // Qwen — Qwen3.5 (2026-02): hybrid thinking, 262K native / ~1M YaRN.
  // -------------------------------------------------------------------------
  def({
    id: 'qwen3.5-0.8b', hfId: 'Qwen/Qwen3.5-0.8B', name: 'Qwen3.5 0.8B',
    vendor: 'Qwen', family: 'Qwen3.5', totalParams: '0.8B',
    nativeCtx: 262144, extendedCtx: 1010000, ctxExtension: 'YaRN',
    templateFamily: 'chatml', reasoningMode: 'hybrid', thinkDelimiters: THINK,
    toolCallStyle: 'hermes', license: 'Apache-2.0',
    recommendedSeqLen: 4096, sizeClass: 'small', released: '2026-02',
  }),
  def({
    id: 'qwen3.5-2b', hfId: 'Qwen/Qwen3.5-2B', name: 'Qwen3.5 2B',
    vendor: 'Qwen', family: 'Qwen3.5', totalParams: '2B',
    nativeCtx: 262144, extendedCtx: 1010000, ctxExtension: 'YaRN',
    templateFamily: 'chatml', reasoningMode: 'hybrid', thinkDelimiters: THINK,
    toolCallStyle: 'hermes', license: 'Apache-2.0',
    recommendedSeqLen: 4096, sizeClass: 'small', released: '2026-02',
  }),
  def({
    id: 'qwen3.5-4b', hfId: 'Qwen/Qwen3.5-4B', name: 'Qwen3.5 4B',
    vendor: 'Qwen', family: 'Qwen3.5', totalParams: '4B',
    nativeCtx: 262144, extendedCtx: 1010000, ctxExtension: 'YaRN',
    templateFamily: 'chatml', reasoningMode: 'hybrid', thinkDelimiters: THINK,
    toolCallStyle: 'hermes', license: 'Apache-2.0',
    recommendedSeqLen: 4096, sizeClass: 'small', released: '2026-02',
  }),
  def({
    id: 'qwen3.5-9b', hfId: 'Qwen/Qwen3.5-9B', name: 'Qwen3.5 9B',
    vendor: 'Qwen', family: 'Qwen3.5', totalParams: '9B',
    nativeCtx: 262144, extendedCtx: 1010000, ctxExtension: 'YaRN',
    templateFamily: 'chatml', reasoningMode: 'hybrid', thinkDelimiters: THINK,
    toolCallStyle: 'hermes', license: 'Apache-2.0',
    recommendedSeqLen: 4096, sizeClass: 'small', released: '2026-02',
    notes: 'Sweet-spot dense target for consumer-GPU QLoRA in 2026.',
  }),
  def({
    id: 'qwen3.5-27b', hfId: 'Qwen/Qwen3.5-27B', name: 'Qwen3.5 27B',
    vendor: 'Qwen', family: 'Qwen3.5', totalParams: '27B',
    nativeCtx: 262144, extendedCtx: 1010000, ctxExtension: 'YaRN',
    templateFamily: 'chatml', reasoningMode: 'hybrid', thinkDelimiters: THINK,
    toolCallStyle: 'hermes', license: 'Apache-2.0',
    recommendedSeqLen: 8192, sizeClass: 'medium', released: '2026-02',
  }),
  def({
    id: 'qwen3.5-35b-a3b', hfId: 'Qwen/Qwen3.5-35B-A3B', name: 'Qwen3.5 35B-A3B',
    vendor: 'Qwen', family: 'Qwen3.5', totalParams: '35B', activeParams: '3B',
    nativeCtx: 262144, extendedCtx: 1010000, ctxExtension: 'YaRN',
    templateFamily: 'chatml', reasoningMode: 'hybrid', thinkDelimiters: THINK,
    toolCallStyle: 'hermes', license: 'Apache-2.0',
    recommendedSeqLen: 4096, sizeClass: 'small', released: '2026-02',
    notes: 'MoE with 3B active parameters; trains like a small model.',
  }),
  def({
    id: 'qwen3.5-122b-a10b', hfId: 'Qwen/Qwen3.5-122B-A10B', name: 'Qwen3.5 122B-A10B',
    vendor: 'Qwen', family: 'Qwen3.5', totalParams: '122B', activeParams: '10B',
    nativeCtx: 262144, extendedCtx: 1010000, ctxExtension: 'YaRN',
    templateFamily: 'chatml', reasoningMode: 'hybrid', thinkDelimiters: THINK,
    toolCallStyle: 'hermes', license: 'Apache-2.0',
    recommendedSeqLen: 8192, sizeClass: 'large', released: '2026-02',
  }),
  def({
    id: 'qwen3.5-397b-a17b', hfId: 'Qwen/Qwen3.5-397B-A17B', name: 'Qwen3.5 397B-A17B',
    vendor: 'Qwen', family: 'Qwen3.5', totalParams: '397B', activeParams: '17B',
    nativeCtx: 262144, extendedCtx: 1010000, ctxExtension: 'YaRN',
    templateFamily: 'chatml', reasoningMode: 'hybrid', thinkDelimiters: THINK,
    toolCallStyle: 'hermes', multimodal: ['image', 'video'], license: 'Apache-2.0',
    recommendedSeqLen: 8192, sizeClass: 'large', released: '2026-02',
    notes: 'First Qwen open-weight flagship with native vision + video; covers 201 languages.',
  }),

  // -------------------------------------------------------------------------
  // Qwen — Qwen3.6 (2026-04): thinking by default, preserved across turns.
  // -------------------------------------------------------------------------
  def({
    id: 'qwen3.6-27b', hfId: 'Qwen/Qwen3.6-27B', name: 'Qwen3.6 27B',
    vendor: 'Qwen', family: 'Qwen3.6', totalParams: '27B',
    nativeCtx: 262144, extendedCtx: 1010000, ctxExtension: 'YaRN',
    templateFamily: 'chatml', reasoningMode: 'always-on', thinkDelimiters: THINK,
    preservesThinking: true, toolCallStyle: 'hermes', license: 'Apache-2.0',
    recommendedSeqLen: 8192, sizeClass: 'medium', released: '2026-04',
    notes: 'Thinking on by default; think blocks are retained across turns.',
  }),
  def({
    id: 'qwen3.6-35b-a3b', hfId: 'Qwen/Qwen3.6-35B-A3B', name: 'Qwen3.6 35B-A3B',
    vendor: 'Qwen', family: 'Qwen3.6', totalParams: '35B', activeParams: '3B',
    nativeCtx: 262144, extendedCtx: 1010000, ctxExtension: 'YaRN',
    templateFamily: 'chatml', reasoningMode: 'always-on', thinkDelimiters: THINK,
    preservesThinking: true, toolCallStyle: 'hermes', license: 'Apache-2.0',
    recommendedSeqLen: 4096, sizeClass: 'small', released: '2026-04',
    notes: 'Thinking on by default; think blocks are retained across turns.',
  }),

  // -------------------------------------------------------------------------
  // Qwen — Qwen3 (2025-04): hybrid thinking via enable_thinking.
  // -------------------------------------------------------------------------
  def({
    id: 'qwen3-0.6b', hfId: 'Qwen/Qwen3-0.6B', name: 'Qwen3 0.6B',
    vendor: 'Qwen', family: 'Qwen3', totalParams: '0.6B',
    nativeCtx: 32768,
    templateFamily: 'chatml', reasoningMode: 'hybrid', thinkDelimiters: THINK,
    toolCallStyle: 'hermes', license: 'Apache-2.0',
    recommendedSeqLen: 4096, sizeClass: 'small', released: '2025-04',
  }),
  def({
    id: 'qwen3-1.7b', hfId: 'Qwen/Qwen3-1.7B', name: 'Qwen3 1.7B',
    vendor: 'Qwen', family: 'Qwen3', totalParams: '1.7B',
    nativeCtx: 32768,
    templateFamily: 'chatml', reasoningMode: 'hybrid', thinkDelimiters: THINK,
    toolCallStyle: 'hermes', license: 'Apache-2.0',
    recommendedSeqLen: 4096, sizeClass: 'small', released: '2025-04',
  }),
  def({
    id: 'qwen3-4b', hfId: 'Qwen/Qwen3-4B', name: 'Qwen3 4B',
    vendor: 'Qwen', family: 'Qwen3', totalParams: '4B',
    nativeCtx: 32768, extendedCtx: 131072, ctxExtension: 'YaRN',
    templateFamily: 'chatml', reasoningMode: 'hybrid', thinkDelimiters: THINK,
    toolCallStyle: 'hermes', license: 'Apache-2.0',
    recommendedSeqLen: 4096, sizeClass: 'small', released: '2025-04',
  }),
  def({
    id: 'qwen3-8b', hfId: 'Qwen/Qwen3-8B', name: 'Qwen3 8B',
    vendor: 'Qwen', family: 'Qwen3', totalParams: '8B',
    nativeCtx: 32768, extendedCtx: 131072, ctxExtension: 'YaRN',
    templateFamily: 'chatml', reasoningMode: 'hybrid', thinkDelimiters: THINK,
    toolCallStyle: 'hermes', license: 'Apache-2.0',
    recommendedSeqLen: 4096, sizeClass: 'small', released: '2025-04',
  }),
  def({
    id: 'qwen3-14b', hfId: 'Qwen/Qwen3-14B', name: 'Qwen3 14B',
    vendor: 'Qwen', family: 'Qwen3', totalParams: '14B',
    nativeCtx: 32768, extendedCtx: 131072, ctxExtension: 'YaRN',
    templateFamily: 'chatml', reasoningMode: 'hybrid', thinkDelimiters: THINK,
    toolCallStyle: 'hermes', license: 'Apache-2.0',
    recommendedSeqLen: 4096, sizeClass: 'small', released: '2025-04',
  }),
  def({
    id: 'qwen3-32b', hfId: 'Qwen/Qwen3-32B', name: 'Qwen3 32B',
    vendor: 'Qwen', family: 'Qwen3', totalParams: '32B',
    nativeCtx: 32768, extendedCtx: 131072, ctxExtension: 'YaRN',
    templateFamily: 'chatml', reasoningMode: 'hybrid', thinkDelimiters: THINK,
    toolCallStyle: 'hermes', license: 'Apache-2.0',
    recommendedSeqLen: 8192, sizeClass: 'medium', released: '2025-04',
  }),
  def({
    id: 'qwen3-30b-a3b', hfId: 'Qwen/Qwen3-30B-A3B', name: 'Qwen3 30B-A3B',
    vendor: 'Qwen', family: 'Qwen3', totalParams: '30B', activeParams: '3B',
    nativeCtx: 32768, extendedCtx: 131072, ctxExtension: 'YaRN',
    templateFamily: 'chatml', reasoningMode: 'hybrid', thinkDelimiters: THINK,
    toolCallStyle: 'hermes', license: 'Apache-2.0',
    recommendedSeqLen: 4096, sizeClass: 'small', released: '2025-04',
  }),
  def({
    id: 'qwen3-235b-a22b', hfId: 'Qwen/Qwen3-235B-A22B', name: 'Qwen3 235B-A22B',
    vendor: 'Qwen', family: 'Qwen3', totalParams: '235B', activeParams: '22B',
    nativeCtx: 32768, extendedCtx: 131072, ctxExtension: 'YaRN',
    templateFamily: 'chatml', reasoningMode: 'hybrid', thinkDelimiters: THINK,
    toolCallStyle: 'hermes', license: 'Apache-2.0',
    recommendedSeqLen: 8192, sizeClass: 'large', released: '2025-04',
  }),
  def({
    id: 'qwen3-30b-a3b-instruct-2507', hfId: 'Qwen/Qwen3-30B-A3B-Instruct-2507',
    name: 'Qwen3 30B-A3B Instruct 2507',
    vendor: 'Qwen', family: 'Qwen3', totalParams: '30B', activeParams: '3B',
    nativeCtx: 262144,
    templateFamily: 'chatml', reasoningMode: 'separate-checkpoints',
    toolCallStyle: 'hermes', license: 'Apache-2.0',
    recommendedSeqLen: 4096, sizeClass: 'small', released: '2025-07',
    notes: 'Non-thinking checkpoint; the 2507 refresh replaced hybrid mode with separate Instruct/Thinking models.',
  }),
  def({
    id: 'qwen3-30b-a3b-thinking-2507', hfId: 'Qwen/Qwen3-30B-A3B-Thinking-2507',
    name: 'Qwen3 30B-A3B Thinking 2507',
    vendor: 'Qwen', family: 'Qwen3', totalParams: '30B', activeParams: '3B',
    nativeCtx: 262144,
    templateFamily: 'chatml', reasoningMode: 'separate-checkpoints', thinkDelimiters: THINK,
    toolCallStyle: 'hermes', license: 'Apache-2.0',
    recommendedSeqLen: 4096, sizeClass: 'small', released: '2025-07',
    notes: 'Thinking checkpoint of the 2507 refresh; always emits a reasoning trace.',
  }),

  // -------------------------------------------------------------------------
  // Qwen — Qwen3-Coder: non-thinking coding specialists.
  // -------------------------------------------------------------------------
  def({
    id: 'qwen3-coder-30b-a3b', hfId: 'Qwen/Qwen3-Coder-30B-A3B-Instruct',
    name: 'Qwen3-Coder 30B-A3B',
    vendor: 'Qwen', family: 'Qwen3-Coder', totalParams: '30B', activeParams: '3B',
    nativeCtx: 262144,
    templateFamily: 'chatml', reasoningMode: 'none',
    toolCallStyle: 'hermes', license: 'Apache-2.0',
    recommendedSeqLen: 4096, sizeClass: 'small', released: '2025-07',
  }),
  def({
    id: 'qwen3-coder-480b-a35b', hfId: 'Qwen/Qwen3-Coder-480B-A35B-Instruct',
    name: 'Qwen3-Coder 480B-A35B',
    vendor: 'Qwen', family: 'Qwen3-Coder', totalParams: '480B', activeParams: '35B',
    nativeCtx: 262144,
    templateFamily: 'chatml', reasoningMode: 'none',
    toolCallStyle: 'hermes', license: 'Apache-2.0',
    recommendedSeqLen: 8192, sizeClass: 'large', released: '2025-07',
  }),
  def({
    id: 'qwen3-coder-next', hfId: 'Qwen/Qwen3-Coder-Next', name: 'Qwen3-Coder-Next',
    vendor: 'Qwen', family: 'Qwen3-Coder', totalParams: '80B', activeParams: '3B',
    nativeCtx: 262144,
    templateFamily: 'chatml', reasoningMode: 'none',
    toolCallStyle: 'hermes', license: 'Apache-2.0',
    recommendedSeqLen: 8192, sizeClass: 'medium', released: '2026-01',
    notes: 'Non-thinking agentic-coding MoE (80B total / 3B active).',
  }),

  // -------------------------------------------------------------------------
  // Meta — Llama 3.x / Llama 4. Llama 5 NOT released as of 2026-06.
  // -------------------------------------------------------------------------
  def({
    id: 'llama-3.1-8b', hfId: 'meta-llama/Llama-3.1-8B-Instruct', name: 'Llama 3.1 8B Instruct',
    vendor: 'Meta', family: 'Llama 3', totalParams: '8B',
    nativeCtx: 131072,
    templateFamily: 'llama3', reasoningMode: 'none',
    toolCallStyle: 'llama-ipython', license: 'Llama 3.1 Community License',
    recommendedSeqLen: 4096, sizeClass: 'small', released: '2024-07',
    notes: 'Still the most fine-tuned base in the ecosystem; huge adapter/tooling coverage.',
  }),
  def({
    id: 'llama-3.2-1b', hfId: 'meta-llama/Llama-3.2-1B-Instruct', name: 'Llama 3.2 1B Instruct',
    vendor: 'Meta', family: 'Llama 3', totalParams: '1B',
    nativeCtx: 131072,
    templateFamily: 'llama3', reasoningMode: 'none',
    toolCallStyle: 'llama-ipython', license: 'Llama 3.2 Community License',
    recommendedSeqLen: 4096, sizeClass: 'small', released: '2024-09',
  }),
  def({
    id: 'llama-3.2-3b', hfId: 'meta-llama/Llama-3.2-3B-Instruct', name: 'Llama 3.2 3B Instruct',
    vendor: 'Meta', family: 'Llama 3', totalParams: '3B',
    nativeCtx: 131072,
    templateFamily: 'llama3', reasoningMode: 'none',
    toolCallStyle: 'llama-ipython', license: 'Llama 3.2 Community License',
    recommendedSeqLen: 4096, sizeClass: 'small', released: '2024-09',
  }),
  def({
    id: 'llama-3.3-70b', hfId: 'meta-llama/Llama-3.3-70B-Instruct', name: 'Llama 3.3 70B Instruct',
    vendor: 'Meta', family: 'Llama 3', totalParams: '70B',
    nativeCtx: 131072,
    templateFamily: 'llama3', reasoningMode: 'none',
    toolCallStyle: 'llama-ipython', license: 'Llama 3.3 Community License',
    recommendedSeqLen: 8192, sizeClass: 'medium', released: '2024-12',
  }),
  def({
    id: 'llama-3.1-405b', hfId: 'meta-llama/Llama-3.1-405B-Instruct', name: 'Llama 3.1 405B Instruct',
    vendor: 'Meta', family: 'Llama 3', totalParams: '405B',
    nativeCtx: 131072,
    templateFamily: 'llama3', reasoningMode: 'none',
    toolCallStyle: 'llama-ipython', license: 'Llama 3.1 Community License',
    recommendedSeqLen: 8192, sizeClass: 'large', released: '2024-07',
  }),
  def({
    id: 'llama-4-scout', hfId: 'meta-llama/Llama-4-Scout-17B-16E-Instruct', name: 'Llama 4 Scout',
    vendor: 'Meta', family: 'Llama 4', totalParams: '109B', activeParams: '17B',
    nativeCtx: 10000000,
    templateFamily: 'llama4', reasoningMode: 'none',
    toolCallStyle: 'llama-ipython', multimodal: ['image'], license: 'Llama 4 Community License',
    recommendedSeqLen: 8192, sizeClass: 'large', released: '2025-04',
    notes: 'Marketing context is 10M tokens; practical SFT sequence length is far lower — use recommendedSeqLen. Llama 5 has NOT been released as of 2026-06 (claims to the contrary are SEO spam).',
  }),
  def({
    id: 'llama-4-maverick', hfId: 'meta-llama/Llama-4-Maverick-17B-128E-Instruct',
    name: 'Llama 4 Maverick',
    vendor: 'Meta', family: 'Llama 4', totalParams: '400B', activeParams: '17B',
    nativeCtx: 1000000,
    templateFamily: 'llama4', reasoningMode: 'none',
    toolCallStyle: 'llama-ipython', multimodal: ['image'], license: 'Llama 4 Community License',
    recommendedSeqLen: 8192, sizeClass: 'large', released: '2025-04',
    notes: 'Llama 5 has NOT been released as of 2026-06 (claims to the contrary are SEO spam).',
  }),

  // -------------------------------------------------------------------------
  // Google — Gemma 3 / 3n (no system role) and Gemma 4 (adds system role).
  // -------------------------------------------------------------------------
  def({
    id: 'gemma-3-270m', hfId: 'google/gemma-3-270m', name: 'Gemma 3 270M',
    vendor: 'Google', family: 'Gemma 3', totalParams: '270M',
    nativeCtx: 32768,
    templateFamily: 'gemma', reasoningMode: 'none', supportsSystemRole: false,
    toolCallStyle: 'none', license: 'Gemma Terms of Use',
    recommendedSeqLen: 4096, sizeClass: 'small', released: '2025-03',
    notes: 'No system role — system content is merged into the first user turn.',
  }),
  def({
    id: 'gemma-3-1b', hfId: 'google/gemma-3-1b-it', name: 'Gemma 3 1B',
    vendor: 'Google', family: 'Gemma 3', totalParams: '1B',
    nativeCtx: 32768,
    templateFamily: 'gemma', reasoningMode: 'none', supportsSystemRole: false,
    toolCallStyle: 'none', license: 'Gemma Terms of Use',
    recommendedSeqLen: 4096, sizeClass: 'small', released: '2025-03',
    notes: 'No system role — system content is merged into the first user turn.',
  }),
  def({
    id: 'gemma-3-4b', hfId: 'google/gemma-3-4b-it', name: 'Gemma 3 4B',
    vendor: 'Google', family: 'Gemma 3', totalParams: '4B',
    nativeCtx: 131072,
    templateFamily: 'gemma', reasoningMode: 'none', supportsSystemRole: false,
    toolCallStyle: 'none', multimodal: ['image'], license: 'Gemma Terms of Use',
    recommendedSeqLen: 4096, sizeClass: 'small', released: '2025-03',
    notes: 'No system role — system content is merged into the first user turn.',
  }),
  def({
    id: 'gemma-3-12b', hfId: 'google/gemma-3-12b-it', name: 'Gemma 3 12B',
    vendor: 'Google', family: 'Gemma 3', totalParams: '12B',
    nativeCtx: 131072,
    templateFamily: 'gemma', reasoningMode: 'none', supportsSystemRole: false,
    toolCallStyle: 'none', multimodal: ['image'], license: 'Gemma Terms of Use',
    recommendedSeqLen: 4096, sizeClass: 'small', released: '2025-03',
    notes: 'No system role — system content is merged into the first user turn.',
  }),
  def({
    id: 'gemma-3-27b', hfId: 'google/gemma-3-27b-it', name: 'Gemma 3 27B',
    vendor: 'Google', family: 'Gemma 3', totalParams: '27B',
    nativeCtx: 131072,
    templateFamily: 'gemma', reasoningMode: 'none', supportsSystemRole: false,
    toolCallStyle: 'none', multimodal: ['image'], license: 'Gemma Terms of Use',
    recommendedSeqLen: 8192, sizeClass: 'medium', released: '2025-03',
    notes: 'No system role — system content is merged into the first user turn.',
  }),
  def({
    id: 'gemma-3n-e2b', hfId: 'google/gemma-3n-E2B-it', name: 'Gemma 3n E2B',
    vendor: 'Google', family: 'Gemma 3n', totalParams: '5B', activeParams: '2B',
    nativeCtx: 32768,
    templateFamily: 'gemma', reasoningMode: 'none', supportsSystemRole: false,
    toolCallStyle: 'none', multimodal: ['image', 'audio'], license: 'Gemma Terms of Use',
    recommendedSeqLen: 4096, sizeClass: 'small', released: '2025-03',
    notes: 'On-device MatFormer (~2B effective). No system role — merged into first user turn.',
  }),
  def({
    id: 'gemma-3n-e4b', hfId: 'google/gemma-3n-E4B-it', name: 'Gemma 3n E4B',
    vendor: 'Google', family: 'Gemma 3n', totalParams: '8B', activeParams: '4B',
    nativeCtx: 32768,
    templateFamily: 'gemma', reasoningMode: 'none', supportsSystemRole: false,
    toolCallStyle: 'none', multimodal: ['image', 'audio'], license: 'Gemma Terms of Use',
    recommendedSeqLen: 4096, sizeClass: 'small', released: '2025-03',
    notes: 'On-device MatFormer (~4B effective). No system role — merged into first user turn.',
  }),
  def({
    id: 'gemma-4-e2b', hfId: 'google/gemma-4-E2B', name: 'Gemma 4 E2B',
    vendor: 'Google', family: 'Gemma 4', totalParams: '5B', activeParams: '2B',
    nativeCtx: 131072,
    templateFamily: 'gemma', reasoningMode: 'hybrid', thinkDelimiters: THINK,
    toolCallStyle: 'openai', multimodal: ['image', 'audio'], license: 'Gemma Terms of Use',
    recommendedSeqLen: 4096, sizeClass: 'small', released: '2026-04',
    notes: 'Gemma 4 adds a real system role and function calling.',
  }),
  def({
    id: 'gemma-4-e4b', hfId: 'google/gemma-4-E4B', name: 'Gemma 4 E4B',
    vendor: 'Google', family: 'Gemma 4', totalParams: '8B', activeParams: '4B',
    nativeCtx: 131072,
    templateFamily: 'gemma', reasoningMode: 'hybrid', thinkDelimiters: THINK,
    toolCallStyle: 'openai', multimodal: ['image', 'audio'], license: 'Gemma Terms of Use',
    recommendedSeqLen: 4096, sizeClass: 'small', released: '2026-04',
    notes: 'Gemma 4 adds a real system role and function calling.',
  }),
  def({
    id: 'gemma-4-12b', hfId: 'google/gemma-4-12B-it', name: 'Gemma 4 12B',
    vendor: 'Google', family: 'Gemma 4', totalParams: '12B',
    nativeCtx: 262144,
    templateFamily: 'gemma', reasoningMode: 'hybrid', thinkDelimiters: THINK,
    toolCallStyle: 'openai', multimodal: ['image', 'audio', 'video'], license: 'Gemma Terms of Use',
    recommendedSeqLen: 4096, sizeClass: 'small', released: '2026-04',
    notes: 'Unified multimodal checkpoint; system role and function calling supported.',
  }),
  def({
    id: 'gemma-4-26b-a4b', hfId: 'google/gemma-4-26B-A4B', name: 'Gemma 4 26B-A4B',
    vendor: 'Google', family: 'Gemma 4', totalParams: '26B', activeParams: '4B',
    nativeCtx: 262144,
    templateFamily: 'gemma', reasoningMode: 'hybrid', thinkDelimiters: THINK,
    toolCallStyle: 'openai', multimodal: ['image'], license: 'Gemma Terms of Use',
    recommendedSeqLen: 4096, sizeClass: 'small', released: '2026-04',
    notes: 'First MoE Gemma; 4B active parameters.',
  }),
  def({
    id: 'gemma-4-31b', hfId: 'google/gemma-4-31B-it', name: 'Gemma 4 31B',
    vendor: 'Google', family: 'Gemma 4', totalParams: '31B',
    nativeCtx: 262144,
    templateFamily: 'gemma', reasoningMode: 'hybrid', thinkDelimiters: THINK,
    toolCallStyle: 'openai', multimodal: ['image'], license: 'Gemma Terms of Use',
    recommendedSeqLen: 8192, sizeClass: 'medium', released: '2026-04',
  }),

  // -------------------------------------------------------------------------
  // DeepSeek — V3 / R1 / distills / V4. All MIT.
  // -------------------------------------------------------------------------
  def({
    id: 'deepseek-v3-0324', hfId: 'deepseek-ai/DeepSeek-V3-0324', name: 'DeepSeek-V3-0324',
    vendor: 'DeepSeek', family: 'DeepSeek-V3', totalParams: '671B', activeParams: '37B',
    nativeCtx: 131072,
    templateFamily: 'deepseek', reasoningMode: 'none',
    toolCallStyle: 'openai', license: 'MIT',
    recommendedSeqLen: 8192, sizeClass: 'large', released: '2025-03',
  }),
  def({
    id: 'deepseek-v3.2', hfId: 'deepseek-ai/DeepSeek-V3.2', name: 'DeepSeek-V3.2',
    vendor: 'DeepSeek', family: 'DeepSeek-V3', totalParams: '671B', activeParams: '37B',
    nativeCtx: 131072,
    templateFamily: 'deepseek', reasoningMode: 'hybrid', thinkDelimiters: THINK,
    toolCallStyle: 'openai', license: 'MIT',
    recommendedSeqLen: 8192, sizeClass: 'large', released: '2025-12',
    notes: 'DeepSeek Sparse Attention (DSA) for cheap long-context.',
  }),
  def({
    id: 'deepseek-r1-0528', hfId: 'deepseek-ai/DeepSeek-R1-0528', name: 'DeepSeek-R1-0528',
    vendor: 'DeepSeek', family: 'DeepSeek-R1', totalParams: '671B', activeParams: '37B',
    nativeCtx: 131072,
    templateFamily: 'deepseek', reasoningMode: 'always-on', thinkDelimiters: THINK,
    toolCallStyle: 'openai', license: 'MIT',
    recommendedSeqLen: 8192, sizeClass: 'large', released: '2025-05',
  }),
  def({
    id: 'r1-distill-qwen-1.5b', hfId: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B',
    name: 'DeepSeek-R1 Distill Qwen 1.5B',
    vendor: 'DeepSeek', family: 'DeepSeek-R1', totalParams: '1.5B',
    nativeCtx: 131072,
    templateFamily: 'deepseek', reasoningMode: 'always-on', thinkDelimiters: THINK,
    toolCallStyle: 'none', license: 'MIT',
    recommendedSeqLen: 4096, sizeClass: 'small', released: '2025-01',
    notes: 'Upstream guidance: avoid system prompts; put all instructions in the user turn.',
  }),
  def({
    id: 'r1-distill-qwen-7b', hfId: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-7B',
    name: 'DeepSeek-R1 Distill Qwen 7B',
    vendor: 'DeepSeek', family: 'DeepSeek-R1', totalParams: '7B',
    nativeCtx: 131072,
    templateFamily: 'deepseek', reasoningMode: 'always-on', thinkDelimiters: THINK,
    toolCallStyle: 'none', license: 'MIT',
    recommendedSeqLen: 4096, sizeClass: 'small', released: '2025-01',
    notes: 'Upstream guidance: avoid system prompts; put all instructions in the user turn.',
  }),
  def({
    id: 'r1-distill-qwen-14b', hfId: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-14B',
    name: 'DeepSeek-R1 Distill Qwen 14B',
    vendor: 'DeepSeek', family: 'DeepSeek-R1', totalParams: '14B',
    nativeCtx: 131072,
    templateFamily: 'deepseek', reasoningMode: 'always-on', thinkDelimiters: THINK,
    toolCallStyle: 'none', license: 'MIT',
    recommendedSeqLen: 4096, sizeClass: 'small', released: '2025-01',
  }),
  def({
    id: 'r1-distill-qwen-32b', hfId: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-32B',
    name: 'DeepSeek-R1 Distill Qwen 32B',
    vendor: 'DeepSeek', family: 'DeepSeek-R1', totalParams: '32B',
    nativeCtx: 131072,
    templateFamily: 'deepseek', reasoningMode: 'always-on', thinkDelimiters: THINK,
    toolCallStyle: 'none', license: 'MIT',
    recommendedSeqLen: 8192, sizeClass: 'medium', released: '2025-01',
  }),
  def({
    id: 'r1-distill-llama-8b', hfId: 'deepseek-ai/DeepSeek-R1-Distill-Llama-8B',
    name: 'DeepSeek-R1 Distill Llama 8B',
    vendor: 'DeepSeek', family: 'DeepSeek-R1', totalParams: '8B',
    nativeCtx: 131072,
    templateFamily: 'deepseek', reasoningMode: 'always-on', thinkDelimiters: THINK,
    toolCallStyle: 'none', license: 'MIT',
    recommendedSeqLen: 4096, sizeClass: 'small', released: '2025-01',
  }),
  def({
    id: 'r1-distill-llama-70b', hfId: 'deepseek-ai/DeepSeek-R1-Distill-Llama-70B',
    name: 'DeepSeek-R1 Distill Llama 70B',
    vendor: 'DeepSeek', family: 'DeepSeek-R1', totalParams: '70B',
    nativeCtx: 131072,
    templateFamily: 'deepseek', reasoningMode: 'always-on', thinkDelimiters: THINK,
    toolCallStyle: 'none', license: 'MIT',
    recommendedSeqLen: 8192, sizeClass: 'medium', released: '2025-01',
  }),
  def({
    id: 'deepseek-v4-pro', hfId: 'deepseek-ai/DeepSeek-V4-Pro', name: 'DeepSeek-V4 Pro',
    vendor: 'DeepSeek', family: 'DeepSeek-V4', totalParams: '1.6T', activeParams: '49B',
    nativeCtx: 1000000,
    templateFamily: 'deepseek', reasoningMode: 'hybrid', thinkDelimiters: THINK,
    preservesThinking: true, toolCallStyle: 'openai', license: 'MIT',
    recommendedSeqLen: 8192, sizeClass: 'large', released: '2026-04',
    notes: 'Hybrid reasoning with effort modes; think blocks retained across turns.',
  }),
  def({
    id: 'deepseek-v4-flash', hfId: 'deepseek-ai/DeepSeek-V4-Flash', name: 'DeepSeek-V4 Flash',
    vendor: 'DeepSeek', family: 'DeepSeek-V4', totalParams: '284B', activeParams: '13B',
    nativeCtx: 1000000,
    templateFamily: 'deepseek', reasoningMode: 'hybrid', thinkDelimiters: THINK,
    preservesThinking: true, toolCallStyle: 'openai', license: 'MIT',
    recommendedSeqLen: 8192, sizeClass: 'large', released: '2026-04',
    notes: 'Hybrid reasoning with effort modes; think blocks retained across turns.',
  }),

  // -------------------------------------------------------------------------
  // Mistral AI — Ministral 3, Small 3.2, Magistral, Large 3, Medium 3.5.
  // -------------------------------------------------------------------------
  def({
    id: 'ministral-3-3b', hfId: 'mistralai/Ministral-3-3B-Instruct-2512', name: 'Ministral 3 3B',
    vendor: 'Mistral AI', family: 'Ministral', totalParams: '3B',
    nativeCtx: 131072,
    templateFamily: 'mistral-tekken', reasoningMode: 'none',
    toolCallStyle: 'mistral', multimodal: ['image'], license: 'Apache-2.0',
    recommendedSeqLen: 4096, sizeClass: 'small', released: '2025-12',
  }),
  def({
    id: 'ministral-3-8b', hfId: 'mistralai/Ministral-3-8B-Instruct-2512', name: 'Ministral 3 8B',
    vendor: 'Mistral AI', family: 'Ministral', totalParams: '8B',
    nativeCtx: 131072,
    templateFamily: 'mistral-tekken', reasoningMode: 'none',
    toolCallStyle: 'mistral', multimodal: ['image'], license: 'Apache-2.0',
    recommendedSeqLen: 4096, sizeClass: 'small', released: '2025-12',
  }),
  def({
    id: 'ministral-3-14b', hfId: 'mistralai/Ministral-3-14B-Instruct-2512', name: 'Ministral 3 14B',
    vendor: 'Mistral AI', family: 'Ministral', totalParams: '14B',
    nativeCtx: 131072,
    templateFamily: 'mistral-tekken', reasoningMode: 'none',
    toolCallStyle: 'mistral', multimodal: ['image'], license: 'Apache-2.0',
    recommendedSeqLen: 4096, sizeClass: 'small', released: '2025-12',
  }),
  def({
    id: 'mistral-small-3.2-24b', hfId: 'mistralai/Mistral-Small-3.2-24B-Instruct-2506',
    name: 'Mistral Small 3.2 24B',
    vendor: 'Mistral AI', family: 'Mistral Small', totalParams: '24B',
    nativeCtx: 131072,
    templateFamily: 'mistral-tekken', reasoningMode: 'none',
    toolCallStyle: 'mistral', multimodal: ['image'], license: 'Apache-2.0',
    recommendedSeqLen: 8192, sizeClass: 'medium', released: '2025-06',
  }),
  def({
    id: 'magistral-small-2509', hfId: 'mistralai/Magistral-Small-2509', name: 'Magistral Small 2509',
    vendor: 'Mistral AI', family: 'Magistral', totalParams: '24B',
    nativeCtx: 131072,
    templateFamily: 'mistral-tekken', reasoningMode: 'always-on', thinkDelimiters: MISTRAL_THINK,
    toolCallStyle: 'mistral', multimodal: ['image'], license: 'Apache-2.0',
    recommendedSeqLen: 8192, sizeClass: 'medium', released: '2025-09',
    notes: 'Reasoning traces use [THINK]…[/THINK] special tokens.',
  }),
  def({
    id: 'mistral-large-3-675b', hfId: 'mistralai/Mistral-Large-3-675B-Instruct-2512',
    name: 'Mistral Large 3',
    vendor: 'Mistral AI', family: 'Mistral Large', totalParams: '675B', activeParams: '41B',
    nativeCtx: 262144,
    templateFamily: 'mistral-tekken', reasoningMode: 'none',
    toolCallStyle: 'mistral', license: 'Apache-2.0',
    recommendedSeqLen: 8192, sizeClass: 'large', released: '2025-12',
  }),
  def({
    id: 'mistral-medium-3.5-128b', hfId: 'mistralai/Mistral-Medium-3.5-128B',
    name: 'Mistral Medium 3.5',
    vendor: 'Mistral AI', family: 'Mistral Medium', totalParams: '128B',
    nativeCtx: 262144,
    templateFamily: 'mistral-tekken', reasoningMode: 'hybrid', thinkDelimiters: MISTRAL_THINK,
    toolCallStyle: 'mistral', license: 'Modified MIT',
    recommendedSeqLen: 8192, sizeClass: 'large', released: '2026-04',
    notes: 'Hybrid instant/reasoning modes.',
  }),

  // -------------------------------------------------------------------------
  // Microsoft — Phi-4 family. Phi-5 NOT released as of 2026-06. All MIT.
  // -------------------------------------------------------------------------
  def({
    id: 'phi-4', hfId: 'microsoft/phi-4', name: 'Phi-4',
    vendor: 'Microsoft', family: 'Phi-4', totalParams: '14B',
    nativeCtx: 16384,
    templateFamily: 'phi4', reasoningMode: 'none',
    toolCallStyle: 'none', license: 'MIT',
    recommendedSeqLen: 4096, sizeClass: 'small', released: '2024-12',
    notes: 'Only 16K context — small for a 2025+ target.',
  }),
  def({
    id: 'phi-4-mini', hfId: 'microsoft/Phi-4-mini-instruct', name: 'Phi-4-mini',
    vendor: 'Microsoft', family: 'Phi-4', totalParams: '3.8B',
    nativeCtx: 131072,
    templateFamily: 'phi4-mini', reasoningMode: 'none',
    toolCallStyle: 'hermes', license: 'MIT',
    recommendedSeqLen: 4096, sizeClass: 'small', released: '2025-02',
  }),
  def({
    id: 'phi-4-reasoning', hfId: 'microsoft/Phi-4-reasoning', name: 'Phi-4-reasoning',
    vendor: 'Microsoft', family: 'Phi-4', totalParams: '14B',
    nativeCtx: 32768,
    templateFamily: 'phi4', reasoningMode: 'always-on', thinkDelimiters: THINK,
    toolCallStyle: 'none', license: 'MIT',
    recommendedSeqLen: 4096, sizeClass: 'small', released: '2025-04',
  }),
  def({
    id: 'phi-4-reasoning-plus', hfId: 'microsoft/Phi-4-reasoning-plus', name: 'Phi-4-reasoning-plus',
    vendor: 'Microsoft', family: 'Phi-4', totalParams: '14B',
    nativeCtx: 32768,
    templateFamily: 'phi4', reasoningMode: 'always-on', thinkDelimiters: THINK,
    toolCallStyle: 'none', license: 'MIT',
    recommendedSeqLen: 4096, sizeClass: 'small', released: '2025-04',
    notes: 'RL-boosted variant of Phi-4-reasoning; longer traces.',
  }),
  def({
    id: 'phi-4-mini-reasoning', hfId: 'microsoft/Phi-4-mini-reasoning', name: 'Phi-4-mini-reasoning',
    vendor: 'Microsoft', family: 'Phi-4', totalParams: '3.8B',
    nativeCtx: 131072,
    templateFamily: 'phi4-mini', reasoningMode: 'always-on', thinkDelimiters: THINK,
    toolCallStyle: 'none', license: 'MIT',
    recommendedSeqLen: 4096, sizeClass: 'small', released: '2025-04',
  }),
  def({
    id: 'phi-4-reasoning-vision', hfId: 'microsoft/Phi-4-reasoning-vision-15B',
    name: 'Phi-4-reasoning-vision',
    vendor: 'Microsoft', family: 'Phi-4', totalParams: '15B',
    nativeCtx: 32768,
    templateFamily: 'phi4', reasoningMode: 'hybrid', thinkDelimiters: THINK,
    toolCallStyle: 'none', multimodal: ['image'], license: 'MIT',
    recommendedSeqLen: 4096, sizeClass: 'small', released: '2026-03',
    notes: 'Phi-5 has NOT been released as of 2026-06.',
  }),

  // -------------------------------------------------------------------------
  // Z.AI — GLM. All MIT; glm template + tool style.
  // -------------------------------------------------------------------------
  def({
    id: 'glm-4.7-flash', hfId: 'zai-org/GLM-4.7-Flash', name: 'GLM-4.7-Flash',
    vendor: 'Z.AI', family: 'GLM-4', totalParams: '30B', activeParams: '3B',
    nativeCtx: 202752,
    templateFamily: 'glm', reasoningMode: 'hybrid', thinkDelimiters: THINK,
    preservesThinking: true, toolCallStyle: 'glm', license: 'MIT',
    recommendedSeqLen: 4096, sizeClass: 'small', released: '2025-12',
    notes: 'Popular consumer-GPU agentic target (30B total / 3B active).',
  }),
  def({
    id: 'glm-4.6', hfId: 'zai-org/GLM-4.6', name: 'GLM-4.6',
    vendor: 'Z.AI', family: 'GLM-4', totalParams: '357B', activeParams: '32B',
    nativeCtx: 202752,
    templateFamily: 'glm', reasoningMode: 'hybrid', thinkDelimiters: THINK,
    toolCallStyle: 'glm', license: 'MIT',
    recommendedSeqLen: 8192, sizeClass: 'large', released: '2025-10',
  }),
  def({
    id: 'glm-4.7', hfId: 'zai-org/GLM-4.7', name: 'GLM-4.7',
    vendor: 'Z.AI', family: 'GLM-4', totalParams: '357B', activeParams: '32B',
    nativeCtx: 202752,
    templateFamily: 'glm', reasoningMode: 'hybrid', thinkDelimiters: THINK,
    preservesThinking: true, toolCallStyle: 'glm', license: 'MIT',
    recommendedSeqLen: 8192, sizeClass: 'large', released: '2025-12',
    notes: 'Turn-level thinking: think blocks are retained across turns.',
  }),
  def({
    id: 'glm-5', hfId: 'zai-org/GLM-5', name: 'GLM-5',
    vendor: 'Z.AI', family: 'GLM-5', totalParams: '744B', activeParams: '40B',
    nativeCtx: 202752,
    templateFamily: 'glm', reasoningMode: 'hybrid', thinkDelimiters: THINK,
    preservesThinking: true, toolCallStyle: 'glm', license: 'MIT',
    recommendedSeqLen: 8192, sizeClass: 'large', released: '2026-02',
  }),
  def({
    id: 'glm-5.1', hfId: 'zai-org/GLM-5.1', name: 'GLM-5.1',
    vendor: 'Z.AI', family: 'GLM-5', totalParams: '744B', activeParams: '40B',
    nativeCtx: 202752,
    templateFamily: 'glm', reasoningMode: 'hybrid', thinkDelimiters: THINK,
    preservesThinking: true, toolCallStyle: 'glm', license: 'MIT',
    recommendedSeqLen: 8192, sizeClass: 'large', released: '2026-04',
  }),

  // -------------------------------------------------------------------------
  // Moonshot AI — Kimi K2. Modified MIT; kimi-chatml template.
  // -------------------------------------------------------------------------
  def({
    id: 'kimi-k2-instruct', hfId: 'moonshotai/Kimi-K2-Instruct', name: 'Kimi K2 Instruct',
    vendor: 'Moonshot AI', family: 'Kimi K2', totalParams: '1.04T', activeParams: '32B',
    nativeCtx: 131072,
    templateFamily: 'kimi-chatml', reasoningMode: 'none',
    toolCallStyle: 'openai', license: 'Modified MIT',
    recommendedSeqLen: 8192, sizeClass: 'large', released: '2025-07',
  }),
  def({
    id: 'kimi-k2-thinking', hfId: 'moonshotai/Kimi-K2-Thinking', name: 'Kimi K2 Thinking',
    vendor: 'Moonshot AI', family: 'Kimi K2', totalParams: '1.04T', activeParams: '32B',
    nativeCtx: 262144,
    templateFamily: 'kimi-chatml', reasoningMode: 'always-on', thinkDelimiters: THINK,
    preservesThinking: true, toolCallStyle: 'openai', license: 'Modified MIT',
    recommendedSeqLen: 8192, sizeClass: 'large', released: '2025-11',
    notes: 'Shipped as native INT4 (quantization-aware trained).',
  }),
  def({
    id: 'kimi-k2.5', hfId: 'moonshotai/Kimi-K2.5', name: 'Kimi K2.5',
    vendor: 'Moonshot AI', family: 'Kimi K2', totalParams: '1.04T', activeParams: '32B',
    nativeCtx: 262144,
    templateFamily: 'kimi-chatml', reasoningMode: 'hybrid', thinkDelimiters: THINK,
    preservesThinking: true, toolCallStyle: 'openai', multimodal: ['image'],
    license: 'Modified MIT',
    recommendedSeqLen: 8192, sizeClass: 'large', released: '2026-01',
  }),
  def({
    id: 'kimi-k2.6', hfId: 'moonshotai/Kimi-K2.6', name: 'Kimi K2.6',
    vendor: 'Moonshot AI', family: 'Kimi K2', totalParams: '1.04T', activeParams: '32B',
    nativeCtx: 262144,
    templateFamily: 'kimi-chatml', reasoningMode: 'hybrid', thinkDelimiters: THINK,
    preservesThinking: true, toolCallStyle: 'openai', multimodal: ['image', 'video'],
    license: 'Modified MIT',
    recommendedSeqLen: 8192, sizeClass: 'large', released: '2026-04',
  }),

  // -------------------------------------------------------------------------
  // OpenAI — gpt-oss. Harmony format: channels, TS-namespace tools.
  // -------------------------------------------------------------------------
  def({
    id: 'gpt-oss-20b', hfId: 'openai/gpt-oss-20b', name: 'gpt-oss-20b',
    vendor: 'OpenAI', family: 'gpt-oss', totalParams: '21B', activeParams: '3.6B',
    nativeCtx: 131072,
    templateFamily: 'harmony', reasoningMode: 'always-on', thinkDelimiters: 'harmony-channel',
    toolCallStyle: 'harmony-ts', license: 'Apache-2.0',
    recommendedSeqLen: 8192, sizeClass: 'medium', released: '2025-08',
    notes: 'Fits 16 GB GPUs in MXFP4. Reasoning effort levels low/medium/high via system prompt.',
  }),
  def({
    id: 'gpt-oss-120b', hfId: 'openai/gpt-oss-120b', name: 'gpt-oss-120b',
    vendor: 'OpenAI', family: 'gpt-oss', totalParams: '117B', activeParams: '5.1B',
    nativeCtx: 131072,
    templateFamily: 'harmony', reasoningMode: 'always-on', thinkDelimiters: 'harmony-channel',
    toolCallStyle: 'harmony-ts', license: 'Apache-2.0',
    recommendedSeqLen: 8192, sizeClass: 'large', released: '2025-08',
    notes: 'Reasoning effort levels low/medium/high via system prompt.',
  }),

  // -------------------------------------------------------------------------
  // IBM — Granite 4.x. Apache-2.0; granite template.
  // -------------------------------------------------------------------------
  def({
    id: 'granite-4.0-h-micro', hfId: 'ibm-granite/granite-4.0-h-micro', name: 'Granite 4.0 H Micro',
    vendor: 'IBM', family: 'Granite 4', totalParams: '3B',
    nativeCtx: 131072,
    templateFamily: 'granite', reasoningMode: 'none',
    toolCallStyle: 'hermes', license: 'Apache-2.0',
    recommendedSeqLen: 4096, sizeClass: 'small', released: '2025-10',
    notes: 'Hybrid Mamba-2/Transformer architecture.',
  }),
  def({
    id: 'granite-4.0-h-tiny', hfId: 'ibm-granite/granite-4.0-h-tiny', name: 'Granite 4.0 H Tiny',
    vendor: 'IBM', family: 'Granite 4', totalParams: '7B', activeParams: '1B',
    nativeCtx: 131072,
    templateFamily: 'granite', reasoningMode: 'none',
    toolCallStyle: 'hermes', license: 'Apache-2.0',
    recommendedSeqLen: 4096, sizeClass: 'small', released: '2025-10',
    notes: 'Hybrid Mamba-2/Transformer MoE (7B total / 1B active).',
  }),
  def({
    id: 'granite-4.0-h-small', hfId: 'ibm-granite/granite-4.0-h-small', name: 'Granite 4.0 H Small',
    vendor: 'IBM', family: 'Granite 4', totalParams: '32B', activeParams: '9B',
    nativeCtx: 131072,
    templateFamily: 'granite', reasoningMode: 'none',
    toolCallStyle: 'hermes', license: 'Apache-2.0',
    recommendedSeqLen: 8192, sizeClass: 'medium', released: '2025-10',
    notes: 'Hybrid Mamba-2/Transformer MoE (32B total / 9B active).',
  }),
  def({
    id: 'granite-4.1-3b', hfId: 'ibm-granite/granite-4.1-3b', name: 'Granite 4.1 3B',
    vendor: 'IBM', family: 'Granite 4', totalParams: '3B',
    nativeCtx: 524288,
    templateFamily: 'granite', reasoningMode: 'none',
    toolCallStyle: 'hermes', license: 'Apache-2.0',
    recommendedSeqLen: 4096, sizeClass: 'small', released: '2026-04',
    notes: 'Explicitly non-reasoning; built for predictable enterprise workloads.',
  }),
  def({
    id: 'granite-4.1-8b', hfId: 'ibm-granite/granite-4.1-8b', name: 'Granite 4.1 8B',
    vendor: 'IBM', family: 'Granite 4', totalParams: '8B',
    nativeCtx: 524288,
    templateFamily: 'granite', reasoningMode: 'none',
    toolCallStyle: 'hermes', license: 'Apache-2.0',
    recommendedSeqLen: 4096, sizeClass: 'small', released: '2026-04',
    notes: 'Explicitly non-reasoning; built for predictable enterprise workloads.',
  }),
  def({
    id: 'granite-4.1-30b', hfId: 'ibm-granite/granite-4.1-30b', name: 'Granite 4.1 30B',
    vendor: 'IBM', family: 'Granite 4', totalParams: '30B',
    nativeCtx: 524288,
    templateFamily: 'granite', reasoningMode: 'none',
    toolCallStyle: 'hermes', license: 'Apache-2.0',
    recommendedSeqLen: 8192, sizeClass: 'medium', released: '2026-04',
    notes: 'Explicitly non-reasoning; built for predictable enterprise workloads.',
  }),

  // -------------------------------------------------------------------------
  // NVIDIA — Nemotron 3. ChatML template, hybrid reasoning with budget.
  // -------------------------------------------------------------------------
  def({
    id: 'nemotron-3-nano-4b', hfId: 'nvidia/NVIDIA-Nemotron-3-Nano-4B-BF16',
    name: 'Nemotron 3 Nano 4B',
    vendor: 'NVIDIA', family: 'Nemotron 3', totalParams: '4B',
    nativeCtx: 262144,
    templateFamily: 'chatml', reasoningMode: 'hybrid', thinkDelimiters: THINK,
    toolCallStyle: 'hermes', license: 'NVIDIA Open Model License',
    recommendedSeqLen: 4096, sizeClass: 'small', released: '2025-12',
    notes: 'Hybrid reasoning with a controllable thinking budget.',
  }),
  def({
    id: 'nemotron-3-nano-30b-a3b', hfId: 'nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-BF16',
    name: 'Nemotron 3 Nano 30B-A3B',
    vendor: 'NVIDIA', family: 'Nemotron 3', totalParams: '30B', activeParams: '3.5B',
    nativeCtx: 262144,
    templateFamily: 'chatml', reasoningMode: 'hybrid', thinkDelimiters: THINK,
    toolCallStyle: 'hermes', license: 'NVIDIA Open Model License',
    recommendedSeqLen: 4096, sizeClass: 'small', released: '2025-12',
    notes: 'Hybrid reasoning with a controllable thinking budget.',
  }),
  def({
    id: 'nemotron-3-super-120b-a12b', hfId: 'nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-BF16',
    name: 'Nemotron 3 Super 120B-A12B',
    vendor: 'NVIDIA', family: 'Nemotron 3', totalParams: '120B', activeParams: '12B',
    nativeCtx: 262144,
    templateFamily: 'chatml', reasoningMode: 'hybrid', thinkDelimiters: THINK,
    toolCallStyle: 'hermes', license: 'NVIDIA Open Model License',
    recommendedSeqLen: 8192, sizeClass: 'large', released: '2026-03',
    notes: 'Hybrid reasoning with a controllable thinking budget.',
  }),

  // -------------------------------------------------------------------------
  // Hugging Face — SmolLM3.
  // -------------------------------------------------------------------------
  def({
    id: 'smollm3-3b', hfId: 'HuggingFaceTB/SmolLM3-3B', name: 'SmolLM3 3B',
    vendor: 'Hugging Face', family: 'SmolLM3', totalParams: '3B',
    nativeCtx: 65536, extendedCtx: 131072, ctxExtension: 'YaRN',
    templateFamily: 'chatml', reasoningMode: 'hybrid', thinkDelimiters: THINK,
    toolCallStyle: 'hermes', license: 'Apache-2.0',
    recommendedSeqLen: 4096, sizeClass: 'small', released: '2025-07',
    notes: 'Reasoning toggled with /think and /no_think soft switches in the system prompt.',
  }),

  // -------------------------------------------------------------------------
  // Ai2 — OLMo. Apache-2.0, fully open (data + code + weights).
  // -------------------------------------------------------------------------
  def({
    id: 'olmo-2-1b', hfId: 'allenai/OLMo-2-0425-1B-Instruct', name: 'OLMo 2 1B Instruct',
    vendor: 'Ai2', family: 'OLMo 2', totalParams: '1B',
    nativeCtx: 4096,
    templateFamily: 'chatml', reasoningMode: 'none',
    toolCallStyle: 'none', license: 'Apache-2.0',
    recommendedSeqLen: 4096, sizeClass: 'small', released: '2025-04',
    notes: 'Fully open: training data, code and weights.',
  }),
  def({
    id: 'olmo-2-7b', hfId: 'allenai/OLMo-2-1124-7B-Instruct', name: 'OLMo 2 7B Instruct',
    vendor: 'Ai2', family: 'OLMo 2', totalParams: '7B',
    nativeCtx: 4096,
    templateFamily: 'chatml', reasoningMode: 'none',
    toolCallStyle: 'none', license: 'Apache-2.0',
    recommendedSeqLen: 4096, sizeClass: 'small', released: '2024-11',
    notes: 'Fully open: training data, code and weights.',
  }),
  def({
    id: 'olmo-2-32b', hfId: 'allenai/OLMo-2-0325-32B-Instruct', name: 'OLMo 2 32B Instruct',
    vendor: 'Ai2', family: 'OLMo 2', totalParams: '32B',
    nativeCtx: 4096,
    templateFamily: 'chatml', reasoningMode: 'none',
    toolCallStyle: 'none', license: 'Apache-2.0',
    recommendedSeqLen: 4096, sizeClass: 'medium', released: '2025-03',
    notes: 'Fully open: training data, code and weights.',
  }),
  def({
    id: 'olmo-3-7b-instruct', hfId: 'allenai/Olmo-3-7B-Instruct', name: 'Olmo 3 7B Instruct',
    vendor: 'Ai2', family: 'Olmo 3', totalParams: '7B',
    nativeCtx: 65536,
    templateFamily: 'chatml', reasoningMode: 'none',
    toolCallStyle: 'hermes', license: 'Apache-2.0',
    recommendedSeqLen: 4096, sizeClass: 'small', released: '2025-11',
    notes: 'Fully open model flow: every training stage is reproducible.',
  }),
  def({
    id: 'olmo-3-7b-think', hfId: 'allenai/Olmo-3-7B-Think', name: 'Olmo 3 7B Think',
    vendor: 'Ai2', family: 'Olmo 3', totalParams: '7B',
    nativeCtx: 65536,
    templateFamily: 'chatml', reasoningMode: 'always-on', thinkDelimiters: THINK,
    toolCallStyle: 'none', license: 'Apache-2.0',
    recommendedSeqLen: 4096, sizeClass: 'small', released: '2025-11',
  }),
  def({
    id: 'olmo-3-32b-think', hfId: 'allenai/Olmo-3-32B-Think', name: 'Olmo 3 32B Think',
    vendor: 'Ai2', family: 'Olmo 3', totalParams: '32B',
    nativeCtx: 65536,
    templateFamily: 'chatml', reasoningMode: 'always-on', thinkDelimiters: THINK,
    toolCallStyle: 'none', license: 'Apache-2.0',
    recommendedSeqLen: 8192, sizeClass: 'medium', released: '2025-11',
  }),
  def({
    id: 'olmo-3.1-32b-instruct', hfId: 'allenai/Olmo-3.1-32B-Instruct', name: 'Olmo 3.1 32B Instruct',
    vendor: 'Ai2', family: 'Olmo 3', totalParams: '32B',
    nativeCtx: 65536,
    templateFamily: 'chatml', reasoningMode: 'none',
    toolCallStyle: 'hermes', license: 'Apache-2.0',
    recommendedSeqLen: 8192, sizeClass: 'medium', released: '2026-01',
  }),
  def({
    id: 'olmo-3.1-32b-think', hfId: 'allenai/Olmo-3.1-32B-Think', name: 'Olmo 3.1 32B Think',
    vendor: 'Ai2', family: 'Olmo 3', totalParams: '32B',
    nativeCtx: 65536,
    templateFamily: 'chatml', reasoningMode: 'always-on', thinkDelimiters: THINK,
    toolCallStyle: 'none', license: 'Apache-2.0',
    recommendedSeqLen: 8192, sizeClass: 'medium', released: '2026-01',
  }),

  // -------------------------------------------------------------------------
  // Others — MiniMax, ByteDance Seed.
  // -------------------------------------------------------------------------
  def({
    id: 'minimax-m2', hfId: 'MiniMaxAI/MiniMax-M2', name: 'MiniMax M2',
    vendor: 'MiniMax', family: 'MiniMax', totalParams: '230B', activeParams: '10B',
    nativeCtx: 204800,
    templateFamily: 'chatml', reasoningMode: 'always-on', thinkDelimiters: THINK,
    preservesThinking: true, toolCallStyle: 'hermes', license: 'Apache-2.0',
    recommendedSeqLen: 8192, sizeClass: 'large', released: '2025-10',
    notes: 'Interleaved thinking: keep think blocks in multi-turn context per upstream guidance.',
  }),
  def({
    id: 'seed-oss-36b', hfId: 'ByteDance-Seed/Seed-OSS-36B-Instruct', name: 'Seed-OSS 36B',
    vendor: 'ByteDance Seed', family: 'Seed-OSS', totalParams: '36B',
    nativeCtx: 524288,
    templateFamily: 'chatml', reasoningMode: 'hybrid', thinkDelimiters: SEED_THINK,
    toolCallStyle: 'hermes', license: 'Apache-2.0',
    recommendedSeqLen: 8192, sizeClass: 'medium', released: '2025-08',
    notes: 'Controllable thinking budget (0 disables reasoning). Uses <seed:think> tags.',
  }),
];

/**
 * Registry id of the suggested default fine-tune target: a small, permissively
 * licensed, well-supported dense model.
 */
export const DEFAULT_MODEL_ID = 'qwen3.5-9b';

const byId = new Map<string, ModelInfo>();
const byHfId = new Map<string, ModelInfo>();
for (const m of MODEL_REGISTRY) {
  byId.set(m.id, m);
  byHfId.set(m.hfId.toLowerCase(), m);
}

/**
 * Looks up a model by registry slug (e.g. "qwen3.5-9b"); falls back to a
 * case-insensitive HuggingFace id match (e.g. "Qwen/Qwen3.5-9B").
 *
 * @returns The matching entry, or undefined if unknown.
 */
export function getModel(id: string): ModelInfo | undefined {
  return byId.get(id) ?? byHfId.get(id.toLowerCase());
}

/**
 * Case-insensitive multi-term search over id, HF id, name, vendor and family.
 * Every whitespace-separated term must match; an empty/blank query returns the
 * whole registry (as a fresh array).
 */
export function searchModels(query: string): ModelInfo[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [...MODEL_REGISTRY];
  return MODEL_REGISTRY.filter((m) => {
    const haystack = `${m.id} ${m.hfId} ${m.name} ${m.vendor} ${m.family}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

/** Unique vendor names, sorted alphabetically. */
export function listVendors(): string[] {
  return [...new Set(MODEL_REGISTRY.map((m) => m.vendor))].sort((a, b) => a.localeCompare(b));
}

/**
 * Groups the registry by vendor, preserving registry order within each group.
 * Returns fresh arrays — callers may sort/mutate the groups freely.
 */
export function modelsByVendor(): Record<string, ModelInfo[]> {
  const groups: Record<string, ModelInfo[]> = {};
  for (const m of MODEL_REGISTRY) {
    (groups[m.vendor] ??= []).push(m);
  }
  return groups;
}
