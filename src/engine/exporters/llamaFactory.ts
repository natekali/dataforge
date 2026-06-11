/**
 * DataForge V2 — LLaMA-Factory 0.9.5 exporter.
 *
 * Emits a sharegpt-formatted data file with role/content tags, the matching
 * `dataset_info.json` entry (ranking for preference, kto_tag for KTO) and a
 * `llamafactory.yaml` train config (stage sft|dpo|kto, LoRA).
 *
 * Caveat: assistant turns that carry tool calls are rendered as a single
 * `function_call` message whose content is the call JSON (LLaMA-Factory's
 * format); any plain text/reasoning on that same turn is dropped because the
 * sharegpt parser requires strict user/assistant alternation.
 *
 * Runtime-environment agnostic: no DOM, no React.
 */

import { stringify } from 'yaml';
import type { DatasetType, Example, Message, TemplateFamily } from '@/engine/types';
import {
  flattenMessagesText,
  inlineReasoningStyle,
  inlineThink,
  prepareMessages,
  type PrepareOptions,
  type RenderContext,
  type SplitFileMap,
} from './jsonl';

/** Role/content tag block declared in every dataset_info entry. */
export const LLAMA_FACTORY_TAGS = {
  role_tag: 'role',
  content_tag: 'content',
  user_tag: 'user',
  assistant_tag: 'assistant',
  system_tag: 'system',
  observation_tag: 'tool',
  function_tag: 'function_call',
} as const;

/** TemplateFamily → LLaMA-Factory template name (verify against your install). */
const LF_TEMPLATES: Record<TemplateFamily, string> = {
  chatml: 'qwen',
  'kimi-chatml': 'kimi_vl',
  llama3: 'llama3',
  llama4: 'llama4',
  gemma: 'gemma',
  'mistral-tekken': 'mistral',
  deepseek: 'deepseek3',
  harmony: 'gpt',
  glm: 'glm4',
  granite: 'granite3',
  phi4: 'phi4',
  'phi4-mini': 'phi',
};

/**
 * Sanitize a project name into the dataset_info entry key
 * (lowercase, `[a-z0-9_]`, fallback "dataset").
 */
export function datasetSlug(projectName: string): string {
  const slug = projectName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug.length > 0 ? slug : 'dataset';
}

/** JSON.parse that falls back to the raw string for malformed arguments. */
function tryParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

/** Map a canonical role to its LLaMA-Factory tag. */
function lfRole(role: Message['role']): string {
  if (role === 'developer') return LLAMA_FACTORY_TAGS.system_tag;
  if (role === 'tool') return LLAMA_FACTORY_TAGS.observation_tag;
  return role;
}

/**
 * Render messages to LLaMA-Factory sharegpt entries ({role, content}).
 * Reasoning is always inlined (role/content pairs cannot carry a thinking
 * field); assistant tool calls become `function_call` messages with JSON
 * content (single object for one call, array for parallel calls).
 */
function lfMessages(
  messages: Message[],
  ctx: RenderContext,
  opts?: PrepareOptions,
): { role: string; content: string }[] {
  const style = inlineReasoningStyle(ctx.model);
  const inline = style.kind === 'inline' ? style : { open: '<think>', close: '</think>' };
  const out: { role: string; content: string }[] = [];
  for (const m of prepareMessages(messages, ctx, opts)) {
    if (m.role === 'assistant' && m.toolCalls !== undefined && m.toolCalls.length > 0) {
      const calls = m.toolCalls.map((c) => ({ name: c.name, arguments: tryParseJson(c.arguments) }));
      out.push({
        role: LLAMA_FACTORY_TAGS.function_tag,
        content: JSON.stringify(calls.length === 1 ? calls[0] : calls),
      });
      continue;
    }
    const content =
      m.reasoning !== undefined && m.reasoning !== ''
        ? inlineThink(inline, m.reasoning, m.content)
        : m.content;
    out.push({ role: lfRole(m.role), content });
  }
  return out;
}

/** Tools column value: JSON string of `[{name, description, parameters}]`. */
function lfTools(ex: Example): string | undefined {
  if (ex.tools === undefined || ex.tools.length === 0) return undefined;
  return JSON.stringify(
    ex.tools.map((t) => ({ name: t.name, description: t.description ?? '', parameters: t.parameters })),
  );
}

/**
 * Dataset rows for LLaMA-Factory per dataset type:
 * - sft        → { messages, tools? }
 * - preference → { messages: prompt, chosen: {role, content}, rejected: {role, content}, tools? }
 * - kto        → { messages: prompt + completion, label, tools? }
 * - rl is not representable in LLaMA-Factory and throws upstream.
 */
export function buildLlamaFactoryRows(
  examples: Example[],
  ctx: RenderContext,
): Record<string, unknown>[] {
  const type = ctx.options.datasetType;
  if (type === 'rl') {
    throw new Error('LLaMA-Factory export does not support the "rl" dataset type');
  }
  return examples.map((ex) => {
    const row: Record<string, unknown> = {};
    if (type === 'sft') {
      row['messages'] = lfMessages(ex.messages, ctx);
    } else if (type === 'preference') {
      row['messages'] = lfMessages(ex.messages, ctx, { context: 'prompt' });
      row['chosen'] = { role: 'assistant', content: flattenMessagesText(ex.chosen ?? [], ctx) };
      row['rejected'] = { role: 'assistant', content: flattenMessagesText(ex.rejected ?? [], ctx) };
    } else {
      row['messages'] = [
        ...lfMessages(ex.messages, ctx, { context: 'prompt' }),
        ...lfMessages(ex.completion ?? [], ctx),
      ];
      row['label'] = ex.label ?? true;
    }
    const tools = lfTools(ex);
    if (tools !== undefined) row['tools'] = tools;
    return row;
  });
}

/** dataset_info entry for one data file. */
function datasetInfoEntry(
  type: DatasetType,
  fileName: string,
  hasTools: boolean,
): Record<string, unknown> {
  const columns: Record<string, string> = { messages: 'messages' };
  if (type === 'preference') {
    columns['chosen'] = 'chosen';
    columns['rejected'] = 'rejected';
  }
  if (type === 'kto') columns['kto_tag'] = 'label';
  if (hasTools) columns['tools'] = 'tools';
  const entry: Record<string, unknown> = {
    file_name: fileName,
    formatting: 'sharegpt',
    columns,
    tags: LLAMA_FACTORY_TAGS,
  };
  if (type === 'preference') entry['ranking'] = true;
  return entry;
}

/**
 * Build `dataset_info.json` with one entry per emitted data file: the project
 * slug for train plus `<slug>_validation` / `<slug>_test` when split files
 * were requested.
 */
export function buildLlamaFactoryDatasetInfo(
  ctx: RenderContext,
  dataFiles: SplitFileMap,
  hasTools: boolean,
): string {
  const slug = datasetSlug(ctx.options.projectName);
  const type = ctx.options.datasetType;
  const info: Record<string, unknown> = {};
  for (const split of ['train', 'validation', 'test'] as const) {
    const file = dataFiles[split];
    if (file === undefined) continue;
    const key = split === 'train' ? slug : `${slug}_${split}`;
    info[key] = datasetInfoEntry(type, file, hasTools);
  }
  return `${JSON.stringify(info, null, 2)}\n`;
}

/**
 * Build `llamafactory.yaml`: stage sft|dpo|kto, LoRA finetuning over the
 * registry model, cutoff_len from the model's recommended SFT length, and the
 * validation dataset wired as `eval_dataset` when present.
 */
export function buildLlamaFactoryTrainYaml(ctx: RenderContext, dataFiles: SplitFileMap): string {
  const { options, model } = ctx;
  const slug = datasetSlug(options.projectName);
  const stage = options.datasetType === 'preference' ? 'dpo' : options.datasetType === 'kto' ? 'kto' : 'sft';

  const config: Record<string, unknown> = {
    model_name_or_path: model?.hfId ?? 'REPLACE_WITH_BASE_MODEL',
    trust_remote_code: true,

    stage,
    do_train: true,
    finetuning_type: 'lora',
    lora_rank: 32,
    lora_alpha: 64,
    lora_dropout: 0.05,
    lora_target: 'all',

    dataset: slug,
    dataset_dir: '.',
    template: model !== undefined ? LF_TEMPLATES[model.templateFamily] : 'default',
    cutoff_len: model?.recommendedSeqLen ?? 4096,

    per_device_train_batch_size: 2,
    gradient_accumulation_steps: 4,
    num_train_epochs: 3,
    learning_rate: 2e-4,
    lr_scheduler_type: 'cosine',
    warmup_ratio: 0.1,
    bf16: true,
    gradient_checkpointing: true,
    logging_steps: 10,
    output_dir: './outputs',
  };

  if (stage === 'dpo') {
    config['pref_beta'] = 0.1;
    config['pref_loss'] = 'sigmoid';
  }
  if (dataFiles.validation !== undefined) {
    config['eval_dataset'] = `${slug}_validation`;
  }

  const header = [
    '# LLaMA-Factory 0.9.5 training config — generated by DataForge Studio',
    '# Run: llamafactory-cli train llamafactory.yaml',
    '# Note: verify `template` matches your base model before training.',
    '',
  ].join('\n');
  return header + stringify(config);
}
