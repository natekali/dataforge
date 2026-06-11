/**
 * DataForge V2 — MS-SWIFT 4.3 exporter.
 *
 * Emits messages JSONL in the swift dialect: preference rows put the chosen
 * continuation inline in `messages` with the alternative as a flat
 * `rejected_response` string; KTO rows append the completion to `messages`
 * with a boolean `label`; tools travel as a JSON *string* field; reasoning is
 * always inlined as `<think>…</think>` (swift convention, regardless of the
 * target model's native delimiters). The matching `swift` CLI command is
 * rendered into the bundle README.
 *
 * Runtime-environment agnostic: no DOM, no React.
 */

import type { Example } from '@/engine/types';
import {
  flattenMessagesText,
  renderMessages,
  type ReasoningStyle,
  type RenderContext,
} from './jsonl';

/** Swift always uses `<think>` tags for inline reasoning. */
const SWIFT_THINK: ReasoningStyle = { kind: 'inline', open: '<think>', close: '</think>' };

/** Tools field value: JSON string of `[{name, description, parameters}]`. */
function swiftTools(ex: Example): string | undefined {
  if (ex.tools === undefined || ex.tools.length === 0) return undefined;
  return JSON.stringify(
    ex.tools.map((t) => ({ name: t.name, description: t.description ?? '', parameters: t.parameters })),
  );
}

/**
 * Dataset rows in the MS-SWIFT dialect:
 * - sft        → { messages, tools? }
 * - preference → { messages: prompt + chosen, rejected_response, tools? }
 * - kto        → { messages: prompt + completion, label, tools? }
 * - rl         → { messages: prompt, solution } (read by swift's accuracy ORM)
 */
export function buildMsSwiftRows(
  examples: Example[],
  ctx: RenderContext,
): Record<string, unknown>[] {
  const type = ctx.options.datasetType;
  return examples.map((ex) => {
    const row: Record<string, unknown> = {};
    if (type === 'sft') {
      row['messages'] = renderMessages(ex.messages, ctx, { style: SWIFT_THINK });
    } else if (type === 'preference') {
      row['messages'] = [
        ...renderMessages(ex.messages, ctx, { context: 'prompt', style: SWIFT_THINK }),
        ...renderMessages(ex.chosen ?? [], ctx, { style: SWIFT_THINK }),
      ];
      row['rejected_response'] = flattenMessagesText(ex.rejected ?? [], ctx, { style: SWIFT_THINK });
    } else if (type === 'kto') {
      row['messages'] = [
        ...renderMessages(ex.messages, ctx, { context: 'prompt', style: SWIFT_THINK }),
        ...renderMessages(ex.completion ?? [], ctx, { style: SWIFT_THINK }),
      ];
      row['label'] = ex.label ?? true;
    } else {
      row['messages'] = renderMessages(ex.messages, ctx, { context: 'prompt', style: SWIFT_THINK });
      row['solution'] = ex.answer ?? '';
    }
    const tools = swiftTools(ex);
    if (tools !== undefined) row['tools'] = tools;
    return row;
  });
}

/**
 * The `swift` CLI command matching the exported dataset type, rendered into
 * the README's MS-SWIFT section.
 */
export function buildMsSwiftCommand(ctx: RenderContext, trainFile: string): string {
  const { options, model } = ctx;
  const modelId = model?.hfId ?? '<base-model>';
  const maxLength = model?.recommendedSeqLen ?? 4096;
  const common = [
    `  --model ${modelId}`,
    `  --dataset ${trainFile}`,
    '  --train_type lora',
    '  --lora_rank 32',
    '  --lora_alpha 64',
    `  --max_length ${maxLength}`,
    '  --num_train_epochs 3',
    '  --per_device_train_batch_size 2',
    '  --gradient_accumulation_steps 4',
    '  --learning_rate 2e-4',
    '  --output_dir outputs',
  ];
  let head: string;
  switch (options.datasetType) {
    case 'sft':
      head = 'swift sft';
      break;
    case 'preference':
      head = 'swift rlhf --rlhf_type dpo';
      break;
    case 'kto':
      head = 'swift rlhf --rlhf_type kto';
      break;
    case 'rl':
      head = 'swift rlhf --rlhf_type grpo --reward_funcs accuracy';
      break;
  }
  return [head, ...common].join(' \\\n');
}
