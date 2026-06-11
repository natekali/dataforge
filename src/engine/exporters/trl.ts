/**
 * DataForge V2 — TRL 1.5 exporter.
 *
 * Emits column-typed JSONL per the TRL 1.5 dataset taxonomy plus a `train.py`
 * driving the matching trainer (SFTTrainer / DPOTrainer / KTOTrainer /
 * GRPOTrainer) with a peft LoRA config and `load_dataset("json", …)`.
 *
 * Runtime-environment agnostic: no DOM, no React.
 */

import type { DatasetType, Example } from '@/engine/types';
import {
  renderMessages,
  renderToolDefinitions,
  type RenderContext,
  type SplitFileMap,
} from './jsonl';
import { LORA_TARGET_MODULES } from './axolotl';

/** Placeholder used when no target model was selected. */
const MODEL_PLACEHOLDER = 'REPLACE_WITH_BASE_MODEL';

/**
 * Dataset rows per the TRL 1.5 taxonomy:
 * - sft        → { messages, tools? }                        (conversational)
 * - preference → { prompt: msgs, chosen: msgs, rejected: msgs }
 * - kto        → { prompt: msgs, completion: msgs, label }   (unpaired)
 * - rl         → { prompt: msgs, answer }                    (GRPO / RLVR)
 */
export function buildTrlRows(examples: Example[], ctx: RenderContext): Record<string, unknown>[] {
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
        prompt: renderMessages(ex.messages, ctx, { context: 'prompt' }),
        chosen: renderMessages(ex.chosen ?? [], ctx),
        rejected: renderMessages(ex.rejected ?? [], ctx),
      }));
    case 'kto':
      return examples.map((ex) => ({
        prompt: renderMessages(ex.messages, ctx, { context: 'prompt' }),
        completion: renderMessages(ex.completion ?? [], ctx),
        label: ex.label ?? true,
      }));
    case 'rl':
      return examples.map((ex) => ({
        prompt: renderMessages(ex.messages, ctx, { context: 'prompt' }),
        answer: ex.answer ?? '',
      }));
  }
}

/** Python list literal of the LoRA target modules. */
function pyTargetModules(): string {
  return `[${LORA_TARGET_MODULES.map((m) => `"${m}"`).join(', ')}]`;
}

/** Python dict literal for `load_dataset("json", data_files=…)`. */
function pyDataFiles(dataFiles: SplitFileMap): string {
  const entries = [`"train": "${dataFiles.train ?? 'data/train.jsonl'}"`];
  if (dataFiles.validation !== undefined) entries.push(`"validation": "${dataFiles.validation}"`);
  return `{${entries.join(', ')}}`;
}

/** Per-dataset-type trainer wiring. */
function trainerParts(type: DatasetType): {
  trainerImport: string;
  configClass: string;
  trainerClass: string;
  extraConfigArgs: string[];
  extraTrainerArgs: string[];
  preamble: string;
} {
  switch (type) {
    case 'sft':
      return {
        trainerImport: 'from trl import SFTConfig, SFTTrainer',
        configClass: 'SFTConfig',
        trainerClass: 'SFTTrainer',
        extraConfigArgs: ['max_length=MAX_LENGTH', 'packing=True'],
        extraTrainerArgs: [],
        preamble: '',
      };
    case 'preference':
      return {
        trainerImport: 'from trl import DPOConfig, DPOTrainer',
        configClass: 'DPOConfig',
        trainerClass: 'DPOTrainer',
        extraConfigArgs: ['max_length=MAX_LENGTH', 'beta=0.1'],
        extraTrainerArgs: [],
        preamble: '',
      };
    case 'kto':
      return {
        // KTO graduated out of the stable namespace in TRL 1.5.
        trainerImport:
          '# KTOTrainer ships from trl.experimental.kto as of TRL 1.5.\nfrom trl.experimental.kto import KTOConfig, KTOTrainer',
        configClass: 'KTOConfig',
        trainerClass: 'KTOTrainer',
        extraConfigArgs: ['max_length=MAX_LENGTH', 'beta=0.1'],
        extraTrainerArgs: [],
        preamble: '',
      };
    case 'rl':
      return {
        trainerImport: 'from trl import GRPOConfig, GRPOTrainer',
        configClass: 'GRPOConfig',
        trainerClass: 'GRPOTrainer',
        extraConfigArgs: ['max_completion_length=MAX_LENGTH'],
        extraTrainerArgs: ['reward_funcs=[reward_exact_answer]'],
        preamble: `

def reward_exact_answer(completions, answer, **kwargs):
    """Verifiable reward: 1.0 when the completion contains the expected answer.

    Replace with your own reward (math verification, code tests, ...).
    """
    rewards = []
    for completion, expected in zip(completions, answer):
        text = completion[-1]["content"] if isinstance(completion, list) else str(completion)
        rewards.append(1.0 if expected and expected in text else 0.0)
    return rewards

`,
      };
  }
}

/**
 * Build `train.py` for TRL 1.5: loads the exported JSONL with
 * `load_dataset("json")`, attaches a LoRA adapter via peft, and runs the
 * trainer matching the exported dataset type.
 */
export function buildTrlScript(ctx: RenderContext, dataFiles: SplitFileMap): string {
  const { options, model } = ctx;
  const parts = trainerParts(options.datasetType);
  const modelId = model?.hfId ?? MODEL_PLACEHOLDER;
  const maxLength = model?.recommendedSeqLen ?? 4096;
  const hasValidation = dataFiles.validation !== undefined;

  const configArgs = [
    'output_dir="./outputs"',
    'num_train_epochs=3',
    'per_device_train_batch_size=2',
    'gradient_accumulation_steps=4',
    'learning_rate=2e-4',
    'lr_scheduler_type="cosine"',
    'warmup_ratio=0.1',
    'bf16=True',
    'gradient_checkpointing=True',
    'logging_steps=10',
    ...parts.extraConfigArgs,
  ];

  const trainerArgs = [
    'model=MODEL_ID',
    'args=config',
    'train_dataset=dataset["train"]',
    ...(hasValidation ? ['eval_dataset=dataset["validation"]'] : []),
    'peft_config=peft_config',
    ...parts.extraTrainerArgs,
  ];

  return `"""Fine-tune ${modelId} with TRL 1.5 — generated by DataForge Studio.

Install:
    pip install "trl==1.5.*" peft datasets accelerate

Run:
    python train.py
"""

from datasets import load_dataset
from peft import LoraConfig
${parts.trainerImport}

MODEL_ID = "${modelId}"
MAX_LENGTH = ${maxLength}

dataset = load_dataset("json", data_files=${pyDataFiles(dataFiles)})
${parts.preamble}
peft_config = LoraConfig(
    r=32,
    lora_alpha=64,
    lora_dropout=0.05,
    target_modules=${pyTargetModules()},
    task_type="CAUSAL_LM",
)

config = ${parts.configClass}(
${configArgs.map((a) => `    ${a},`).join('\n')}
)

trainer = ${parts.trainerClass}(
${trainerArgs.map((a) => `    ${a},`).join('\n')}
)
trainer.train()
trainer.save_model("./outputs/final")
`;
}
