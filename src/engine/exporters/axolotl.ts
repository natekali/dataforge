/**
 * DataForge V2 — Axolotl 0.17 exporter.
 *
 * Emits a chat_template JSONL dataset plus an `axolotl.yaml` with 2026 QLoRA
 * defaults. Preference data uses `rl: dpo` with a `user_defined.default`
 * dataset over flattened-text {prompt, chosen, rejected} columns; KTO uses
 * `rl: kto` over {prompt, completion, label}; RL/GRPO emits {prompt, answer}
 * with a config stub the user completes with reward functions.
 *
 * Runtime-environment agnostic: no DOM, no React.
 */

import { stringify } from 'yaml';
import type { DatasetType, Example } from '@/engine/types';
import {
  flattenMessagesText,
  renderMessages,
  renderToolDefinitions,
  type RenderContext,
  type SplitFileMap,
} from './jsonl';

/** 2026 default LoRA projection targets (attention + MLP). */
export const LORA_TARGET_MODULES: string[] = [
  'q_proj',
  'k_proj',
  'v_proj',
  'o_proj',
  'gate_proj',
  'up_proj',
  'down_proj',
];

/** Placeholder used when no target model was selected. */
const BASE_MODEL_PLACEHOLDER = 'REPLACE_WITH_BASE_MODEL';

/**
 * Dataset rows for Axolotl per dataset type:
 * - sft        → { messages: canonical[], tools? } (chat_template consumption)
 * - preference → { prompt, chosen, rejected } flattened text
 * - kto        → { prompt, completion, label } flattened text
 * - rl         → { prompt, answer } flattened text
 */
export function buildAxolotlRows(
  examples: Example[],
  ctx: RenderContext,
): Record<string, unknown>[] {
  switch (ctx.options.datasetType) {
    case 'sft':
      return examples.map((ex) => {
        const row: Record<string, unknown> = { messages: renderMessages(ex.messages, ctx) };
        const tools = renderToolDefinitions(ex.tools);
        if (tools !== undefined) row['tools'] = tools;
        return row;
      });
    case 'preference':
      return examples.map((ex) => ({
        prompt: flattenMessagesText(ex.messages, ctx, { context: 'prompt' }),
        chosen: flattenMessagesText(ex.chosen ?? [], ctx),
        rejected: flattenMessagesText(ex.rejected ?? [], ctx),
      }));
    case 'kto':
      return examples.map((ex) => ({
        prompt: flattenMessagesText(ex.messages, ctx, { context: 'prompt' }),
        completion: flattenMessagesText(ex.completion ?? [], ctx),
        label: ex.label ?? true,
      }));
    case 'rl':
      return examples.map((ex) => ({
        prompt: flattenMessagesText(ex.messages, ctx, { context: 'prompt' }),
        answer: ex.answer ?? '',
      }));
  }
}

/** Per-dataset-type dataset entries for the YAML `datasets:` list. */
function datasetEntry(type: DatasetType, trainPath: string): Record<string, unknown> {
  switch (type) {
    case 'sft':
      return { path: trainPath, type: 'chat_template', field_messages: 'messages' };
    case 'preference':
      return {
        path: trainPath,
        split: 'train',
        type: 'user_defined.default',
        field_prompt: 'prompt',
        field_chosen: 'chosen',
        field_rejected: 'rejected',
      };
    case 'kto':
      return {
        path: trainPath,
        split: 'train',
        type: 'user_defined.default',
        field_prompt: 'prompt',
        field_completion: 'completion',
        field_label: 'label',
      };
    case 'rl':
      return { path: trainPath, split: 'train', type: 'user_defined.default', field_prompt: 'prompt' };
  }
}

/**
 * Build `axolotl.yaml`: base model from the registry entry, QLoRA defaults
 * (4-bit, r=32/alpha=64/dropout=0.05 over attention+MLP projections),
 * sequence_len from the model's recommended SFT length, sample packing for
 * SFT, bf16 auto, cosine 2e-4 for 3 epochs. A validation data file (when
 * split files were emitted) is wired as `test_datasets`.
 */
export function buildAxolotlConfig(ctx: RenderContext, dataFiles: SplitFileMap): string {
  const { options, model } = ctx;
  const type = options.datasetType;
  const trainPath = `./${dataFiles.train ?? 'data/train.jsonl'}`;
  const validationPath = dataFiles.validation !== undefined ? `./${dataFiles.validation}` : undefined;

  const config: Record<string, unknown> = {
    base_model: model?.hfId ?? BASE_MODEL_PLACEHOLDER,
    model_type: 'AutoModelForCausalLM',
    tokenizer_type: 'AutoTokenizer',

    load_in_4bit: true,
    adapter: 'qlora',
    lora_r: 32,
    lora_alpha: 64,
    lora_dropout: 0.05,
    lora_target_modules: LORA_TARGET_MODULES,

    datasets: [datasetEntry(type, trainPath)],
    sequence_len: model?.recommendedSeqLen ?? 4096,

    micro_batch_size: 2,
    gradient_accumulation_steps: 4,
    num_epochs: 3,
    learning_rate: 2e-4,
    lr_scheduler: 'cosine',
    warmup_ratio: 0.1,
    bf16: 'auto',
    gradient_checkpointing: true,
    flash_attention: true,
    logging_steps: 10,
    output_dir: './outputs',
  };

  if (type === 'sft') {
    config['chat_template'] = 'tokenizer_default';
    config['sample_packing'] = true;
  } else if (type === 'preference') {
    config['rl'] = 'dpo';
  } else if (type === 'kto') {
    config['rl'] = 'kto';
    config['remove_unused_columns'] = false;
  } else {
    config['rl'] = 'grpo';
  }

  if (validationPath !== undefined && type === 'sft') {
    config['test_datasets'] = [
      { path: validationPath, split: 'train', type: 'chat_template', field_messages: 'messages' },
    ];
    config['val_set_size'] = 0;
  } else if (type === 'sft') {
    config['val_set_size'] = 0.05;
  }

  const header = [
    '# Axolotl 0.17 training config — generated by DataForge Studio',
    '# Run: axolotl train axolotl.yaml',
    ...(type === 'rl'
      ? ['# NOTE: GRPO requires reward functions — see the Axolotl RL docs and add', '# a `trl.reward_funcs` section before training.']
      : []),
    '',
  ].join('\n');
  return header + stringify(config);
}
