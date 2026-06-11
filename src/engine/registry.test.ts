import { describe, expect, it } from 'vitest';
import type { ModelInfo, ReasoningMode, TemplateFamily, ToolCallStyle } from '@/engine/types';
import {
  DEFAULT_MODEL_ID,
  MODEL_REGISTRY,
  getModel,
  listVendors,
  modelsByVendor,
  searchModels,
} from './registry';

/** Runtime mirrors of the type-level unions in types.ts (no runtime arrays exported there). */
const TEMPLATE_FAMILIES: TemplateFamily[] = [
  'chatml', 'kimi-chatml', 'llama3', 'llama4', 'gemma', 'mistral-tekken',
  'deepseek', 'harmony', 'glm', 'granite', 'phi4', 'phi4-mini',
];
const REASONING_MODES: ReasoningMode[] = ['none', 'always-on', 'hybrid', 'separate-checkpoints'];
const TOOL_CALL_STYLES: ToolCallStyle[] = [
  'none', 'hermes', 'openai', 'mistral', 'harmony-ts', 'glm', 'llama-ipython',
];
const SIZE_CLASSES: ModelInfo['sizeClass'][] = ['small', 'medium', 'large'];
const MODALITIES = ['image', 'video', 'audio'];

function mustGet(id: string): ModelInfo {
  const model = getModel(id);
  expect(model, `registry entry "${id}" should exist`).toBeDefined();
  return model as ModelInfo;
}

describe('MODEL_REGISTRY integrity', () => {
  it('has substantial coverage of the 2026 landscape', () => {
    expect(MODEL_REGISTRY.length).toBeGreaterThanOrEqual(50);
  });

  it('has unique registry ids', () => {
    const ids = MODEL_REGISTRY.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has unique HuggingFace ids (case-insensitive)', () => {
    const hfIds = MODEL_REGISTRY.map((m) => m.hfId.toLowerCase());
    expect(new Set(hfIds).size).toBe(hfIds.length);
  });

  it('uses well-formed slugs and org/repo HuggingFace ids', () => {
    for (const m of MODEL_REGISTRY) {
      expect(m.id, m.id).toMatch(/^[a-z0-9][a-z0-9.-]*$/);
      expect(m.hfId, m.hfId).toContain('/');
      expect(m.hfId, m.hfId).toMatch(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
    }
  });

  it('only uses enum values declared in types.ts', () => {
    for (const m of MODEL_REGISTRY) {
      expect(TEMPLATE_FAMILIES, `${m.id} templateFamily`).toContain(m.templateFamily);
      expect(REASONING_MODES, `${m.id} reasoningMode`).toContain(m.reasoningMode);
      expect(TOOL_CALL_STYLES, `${m.id} toolCallStyle`).toContain(m.toolCallStyle);
      expect(SIZE_CLASSES, `${m.id} sizeClass`).toContain(m.sizeClass);
    }
  });

  it('has sane context windows and sequence lengths', () => {
    for (const m of MODEL_REGISTRY) {
      expect(m.nativeCtx, `${m.id} nativeCtx`).toBeGreaterThan(0);
      expect(Number.isInteger(m.nativeCtx), `${m.id} nativeCtx integer`).toBe(true);
      if (m.extendedCtx !== undefined) {
        expect(m.extendedCtx, `${m.id} extendedCtx > nativeCtx`).toBeGreaterThan(m.nativeCtx);
        expect(m.ctxExtension, `${m.id} ctxExtension set when extendedCtx set`).toBeDefined();
      }
      const maxCtx = Math.max(m.nativeCtx, m.extendedCtx ?? 0);
      expect(m.recommendedSeqLen, `${m.id} recommendedSeqLen`).toBeGreaterThan(0);
      expect(m.recommendedSeqLen, `${m.id} recommendedSeqLen <= ctx`).toBeLessThanOrEqual(maxCtx);
    }
  });

  it('has plausible YYYY-MM release dates (2024-01 .. 2026-06)', () => {
    for (const m of MODEL_REGISTRY) {
      expect(m.released, m.id).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/);
      expect(m.released >= '2024-01', `${m.id} released ${m.released}`).toBe(true);
      expect(m.released <= '2026-06', `${m.id} released ${m.released}`).toBe(true);
    }
  });

  it('never sets thinkDelimiters on non-reasoning models, and validates their shape', () => {
    for (const m of MODEL_REGISTRY) {
      if (m.reasoningMode === 'none') {
        expect(m.thinkDelimiters, `${m.id} should not have delimiters`).toBeUndefined();
      }
      if (m.thinkDelimiters !== undefined && m.thinkDelimiters !== 'harmony-channel') {
        expect(m.thinkDelimiters).toHaveLength(2);
        expect(m.thinkDelimiters[0].length).toBeGreaterThan(0);
        expect(m.thinkDelimiters[1].length).toBeGreaterThan(0);
      }
    }
  });

  it('uses valid, duplicate-free multimodal lists', () => {
    for (const m of MODEL_REGISTRY) {
      expect(new Set(m.multimodal).size, m.id).toBe(m.multimodal.length);
      for (const modality of m.multimodal) {
        expect(MODALITIES, m.id).toContain(modality);
      }
    }
  });

  it('has no empty display/identity fields', () => {
    for (const m of MODEL_REGISTRY) {
      expect(m.name.length, m.id).toBeGreaterThan(0);
      expect(m.vendor.length, m.id).toBeGreaterThan(0);
      expect(m.family.length, m.id).toBeGreaterThan(0);
      expect(m.totalParams.length, m.id).toBeGreaterThan(0);
      expect(m.license.length, m.id).toBeGreaterThan(0);
    }
  });

  it('covers all expected vendors', () => {
    const vendors = new Set(MODEL_REGISTRY.map((m) => m.vendor));
    for (const vendor of [
      'Qwen', 'Meta', 'Google', 'DeepSeek', 'Mistral AI', 'Microsoft', 'Z.AI',
      'Moonshot AI', 'OpenAI', 'IBM', 'NVIDIA', 'Hugging Face', 'Ai2',
      'MiniMax', 'ByteDance Seed',
    ]) {
      expect(vendors, vendor).toContain(vendor);
    }
  });
});

describe('DEFAULT_MODEL_ID', () => {
  it('resolves to a small, permissively licensed registry entry', () => {
    const model = mustGet(DEFAULT_MODEL_ID);
    expect(model.id).toBe(DEFAULT_MODEL_ID);
    expect(model.sizeClass).toBe('small');
    expect(model.license).toBe('Apache-2.0');
  });
});

describe('getModel', () => {
  it('finds models by registry slug', () => {
    expect(mustGet('qwen3.5-9b').hfId).toBe('Qwen/Qwen3.5-9B');
    expect(mustGet('llama-3.1-8b').hfId).toBe('meta-llama/Llama-3.1-8B-Instruct');
  });

  it('falls back to case-insensitive HuggingFace ids', () => {
    expect(getModel('Qwen/Qwen3.5-9B')?.id).toBe('qwen3.5-9b');
    expect(getModel('qwen/qwen3.5-9b')?.id).toBe('qwen3.5-9b');
    expect(getModel('MOONSHOTAI/KIMI-K2-THINKING')?.id).toBe('kimi-k2-thinking');
  });

  it('returns undefined for unknown ids', () => {
    expect(getModel('not-a-model')).toBeUndefined();
    expect(getModel('')).toBeUndefined();
  });
});

describe('searchModels', () => {
  it('matches case-insensitively across id, hfId, name, vendor and family', () => {
    const hits = searchModels('QWEN3.6');
    expect(hits.map((m) => m.id).sort()).toEqual(['qwen3.6-27b', 'qwen3.6-35b-a3b']);
  });

  it('requires every whitespace-separated term to match', () => {
    const hits = searchModels('deepseek distill llama');
    expect(hits.map((m) => m.id).sort()).toEqual(['r1-distill-llama-70b', 'r1-distill-llama-8b']);
  });

  it('finds models by vendor name', () => {
    const hits = searchModels('moonshot');
    expect(hits.length).toBe(4);
    expect(hits.every((m) => m.vendor === 'Moonshot AI')).toBe(true);
  });

  it('returns the full registry for an empty or blank query', () => {
    expect(searchModels('')).toHaveLength(MODEL_REGISTRY.length);
    expect(searchModels('   ')).toHaveLength(MODEL_REGISTRY.length);
  });

  it('returns a fresh array, not the registry itself', () => {
    expect(searchModels('')).not.toBe(MODEL_REGISTRY);
  });

  it('returns nothing for nonsense queries', () => {
    expect(searchModels('zz-definitely-not-a-model-zz')).toEqual([]);
  });
});

describe('listVendors', () => {
  it('returns unique vendors sorted alphabetically', () => {
    const vendors = listVendors();
    expect(new Set(vendors).size).toBe(vendors.length);
    expect(vendors).toEqual([...vendors].sort((a, b) => a.localeCompare(b)));
    expect(vendors).toContain('Qwen');
    expect(vendors).toContain('OpenAI');
  });
});

describe('modelsByVendor', () => {
  it('partitions the registry exactly', () => {
    const groups = modelsByVendor();
    const total = Object.values(groups).reduce((sum, models) => sum + models.length, 0);
    expect(total).toBe(MODEL_REGISTRY.length);
    for (const [vendor, models] of Object.entries(groups)) {
      expect(models.length).toBeGreaterThan(0);
      for (const m of models) expect(m.vendor).toBe(vendor);
    }
    expect(Object.keys(groups).sort((a, b) => a.localeCompare(b))).toEqual(listVendors());
  });
});

describe('spot checks (verified June-2026 facts)', () => {
  it('qwen3.6-35b-a3b: always-on thinking, preserved across turns, 262K/1M YaRN', () => {
    const m = mustGet('qwen3.6-35b-a3b');
    expect(m.hfId).toBe('Qwen/Qwen3.6-35B-A3B');
    expect(m.reasoningMode).toBe('always-on');
    expect(m.preservesThinking).toBe(true);
    expect(m.nativeCtx).toBe(262144);
    expect(m.extendedCtx).toBe(1010000);
    expect(m.ctxExtension).toBe('YaRN');
    expect(m.thinkDelimiters).toEqual(['<think>', '</think>']);
  });

  it('every Gemma 3 / 3n entry lacks a system role; Gemma 4 has one', () => {
    const gemma3 = MODEL_REGISTRY.filter((m) => m.id.startsWith('gemma-3'));
    expect(gemma3).toHaveLength(7);
    for (const m of gemma3) {
      expect(m.supportsSystemRole, m.id).toBe(false);
      expect(m.reasoningMode, m.id).toBe('none');
      expect(m.toolCallStyle, m.id).toBe('none');
    }
    const gemma4 = MODEL_REGISTRY.filter((m) => m.id.startsWith('gemma-4'));
    expect(gemma4).toHaveLength(5);
    for (const m of gemma4) {
      expect(m.supportsSystemRole, m.id).toBe(true);
      expect(m.reasoningMode, m.id).toBe('hybrid');
    }
  });

  it('gpt-oss models use the Harmony stack end-to-end', () => {
    for (const id of ['gpt-oss-20b', 'gpt-oss-120b']) {
      const m = mustGet(id);
      expect(m.templateFamily).toBe('harmony');
      expect(m.thinkDelimiters).toBe('harmony-channel');
      expect(m.toolCallStyle).toBe('harmony-ts');
      expect(m.reasoningMode).toBe('always-on');
      expect(m.nativeCtx).toBe(131072);
    }
  });

  it('llama-4-scout: 10M marketing context but conservative seq len, with a note', () => {
    const m = mustGet('llama-4-scout');
    expect(m.nativeCtx).toBe(10000000);
    expect(m.recommendedSeqLen).toBe(8192);
    expect(m.templateFamily).toBe('llama4');
    expect(m.notes).toContain('Llama 5');
  });

  it('phi-4: 16K context, capped sequence length', () => {
    const m = mustGet('phi-4');
    expect(m.nativeCtx).toBe(16384);
    expect(m.recommendedSeqLen).toBe(4096);
    expect(m.templateFamily).toBe('phi4');
  });

  it('mistral reasoning models use [THINK] delimiters', () => {
    expect(mustGet('magistral-small-2509').thinkDelimiters).toEqual(['[THINK]', '[/THINK]']);
    expect(mustGet('mistral-medium-3.5-128b').thinkDelimiters).toEqual(['[THINK]', '[/THINK]']);
  });

  it('deepseek-v4-pro: 1M native ctx, hybrid effort-mode reasoning, preserved thinking', () => {
    const m = mustGet('deepseek-v4-pro');
    expect(m.nativeCtx).toBe(1000000);
    expect(m.reasoningMode).toBe('hybrid');
    expect(m.preservesThinking).toBe(true);
    expect(m.license).toBe('MIT');
    expect(m.totalParams).toBe('1.6T');
  });

  it('GLM-4.7 and Kimi K2 Thinking preserve thinking across turns', () => {
    const glm = mustGet('glm-4.7');
    expect(glm.preservesThinking).toBe(true);
    expect(glm.templateFamily).toBe('glm');
    expect(glm.toolCallStyle).toBe('glm');
    const kimi = mustGet('kimi-k2-thinking');
    expect(kimi.preservesThinking).toBe(true);
    expect(kimi.reasoningMode).toBe('always-on');
    expect(kimi.nativeCtx).toBe(262144);
    expect(kimi.templateFamily).toBe('kimi-chatml');
  });

  it('qwen3-coder models are non-thinking', () => {
    for (const id of ['qwen3-coder-30b-a3b', 'qwen3-coder-480b-a35b', 'qwen3-coder-next']) {
      const m = mustGet(id);
      expect(m.reasoningMode, id).toBe('none');
      expect(m.thinkDelimiters, id).toBeUndefined();
    }
    expect(mustGet('qwen3-coder-30b-a3b').nativeCtx).toBe(262144);
  });

  it('qwen3 2507 refresh uses separate Instruct/Thinking checkpoints', () => {
    const instruct = mustGet('qwen3-30b-a3b-instruct-2507');
    const thinking = mustGet('qwen3-30b-a3b-thinking-2507');
    expect(instruct.reasoningMode).toBe('separate-checkpoints');
    expect(instruct.thinkDelimiters).toBeUndefined();
    expect(thinking.reasoningMode).toBe('separate-checkpoints');
    expect(thinking.thinkDelimiters).toEqual(['<think>', '</think>']);
    expect(instruct.nativeCtx).toBe(262144);
    expect(thinking.nativeCtx).toBe(262144);
  });

  it('keeps a healthy pool of small consumer-GPU targets', () => {
    const small = MODEL_REGISTRY.filter((m) => m.sizeClass === 'small');
    expect(small.length).toBeGreaterThanOrEqual(15);
    const smallIds = new Set(small.map((m) => m.id));
    expect(smallIds.has('qwen3.5-9b')).toBe(true);
    expect(smallIds.has('llama-3.1-8b')).toBe(true);
    expect(smallIds.has('qwen3.5-35b-a3b')).toBe(true); // MoE, 3B active
    expect(smallIds.has('glm-4.7-flash')).toBe(true); // MoE, 3B active
  });
});
