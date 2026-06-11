/**
 * DataForge V2 — per-framework README generation for export bundles.
 *
 * Every bundle ships a `README.md` with install + train instructions pinned to
 * the framework versions the configs were generated for (Axolotl 0.17,
 * TRL 1.5.1, LLaMA-Factory 0.9.5, MS-SWIFT 4.3, Unsloth 2026.6, OpenAI
 * fine-tuning API), the dataset stats, and DataForge provenance.
 *
 * Runtime-environment agnostic: no DOM, no React.
 */

import type {
  DatasetType,
  ExportOptions,
  FrameworkId,
  ModelInfo,
  SplitName,
} from '@/engine/types';
import { SPLITS } from '@/engine/types';
import type { RenderContext } from './jsonl';
import { buildMsSwiftCommand } from './msSwift';

/** Human-readable framework label (with the pinned version where relevant). */
export const FRAMEWORK_LABELS: Record<FrameworkId, string> = {
  jsonl: 'OpenAI messages JSONL',
  axolotl: 'Axolotl 0.17',
  trl: 'TRL 1.5.1',
  'llama-factory': 'LLaMA-Factory 0.9.5',
  'ms-swift': 'MS-SWIFT 4.3',
  unsloth: 'Unsloth 2026.6',
  'openai-ft': 'OpenAI fine-tuning API',
  alpaca: 'Alpaca (legacy)',
  sharegpt: 'ShareGPT (legacy)',
};

/** One-line description per dataset type, used in the README stats block. */
const TYPE_LABELS: Record<DatasetType, string> = {
  sft: 'supervised fine-tuning (chat / instruction)',
  preference: 'paired preference (DPO / ORPO)',
  kto: 'unpaired preference (KTO)',
  rl: 'prompt + verifiable answer (GRPO / RLVR)',
};

/** Dataset stats rendered into the README (computed by the bundle assembler). */
export interface ReadmeStats {
  /** Number of examples actually written to the data files. */
  exampleCount: number;
  /** Exported example counts per split. */
  bySplit: Partial<Record<SplitName, number>>;
}

/** Fenced code block helper (keeps backtick escaping out of the templates). */
function codeBlock(lang: string, body: string): string {
  return `\`\`\`${lang}\n${body}\n\`\`\``;
}

/** Describe how reasoning traces were rendered, for the dataset stats block. */
function describeReasoning(options: ExportOptions, model?: ModelInfo): string {
  if (!options.includeReasoning) return 'stripped at export';
  const delimiters = model?.thinkDelimiters;
  let style: string;
  if (model?.templateFamily === 'harmony' || delimiters === 'harmony-channel') {
    style = 'separate `thinking` field (harmony channel)';
  } else if (Array.isArray(delimiters)) {
    style = `inline \`${delimiters[0]}…${delimiters[1]}\``;
  } else {
    style = 'inline `<think>…</think>`';
  }
  return options.stripPriorThinking ? `${style} — final assistant turn only` : style;
}

/** The data-file list, mirroring the bundle assembler's split grouping. */
function dataFilesLine(options: ExportOptions, stats?: ReadmeStats): string {
  if (!options.splitFiles || stats === undefined) return '`data/train.jsonl`';
  const splits = SPLITS.filter((s) => s === 'train' || (stats.bySplit[s] ?? 0) > 0);
  return splits.map((s) => `\`data/${s}.jsonl\``).join(', ');
}

/** `## Dataset` section: type, counts, target model and rendering policy. */
function datasetSection(options: ExportOptions, model?: ModelInfo, stats?: ReadmeStats): string {
  const lines = ['## Dataset', ''];
  lines.push(`- **Type:** \`${options.datasetType}\` — ${TYPE_LABELS[options.datasetType]}`);
  if (stats !== undefined) {
    const parts = SPLITS.filter((s) => (stats.bySplit[s] ?? 0) > 0).map(
      (s) => `${stats.bySplit[s]} ${s}`,
    );
    const breakdown = parts.length > 0 ? ` (${parts.join(' · ')})` : '';
    lines.push(`- **Examples:** ${stats.exampleCount}${breakdown}`);
  }
  lines.push(
    `- **Target model:** ${
      model !== undefined
        ? `${model.name} (\`${model.hfId}\`)`
        : 'not selected — replace the model placeholder in the config/script before training'
    }`,
  );
  lines.push(`- **Reasoning traces:** ${describeReasoning(options, model)}`);
  lines.push(`- **System turns:** ${options.includeSystem ? 'included' : 'removed'}`);
  lines.push(`- **Data files:** ${dataFilesLine(options, stats)}`);
  return lines.join('\n');
}

/** TRL trainer class matching the exported dataset type. */
function trlTrainerName(type: DatasetType): string {
  switch (type) {
    case 'sft':
      return 'SFTTrainer';
    case 'preference':
      return 'DPOTrainer';
    case 'kto':
      return 'KTOTrainer (from `trl.experimental.kto` as of TRL 1.5)';
    case 'rl':
      return 'GRPOTrainer';
  }
}

/** Python upload + job-creation snippet for the OpenAI fine-tuning API. */
function openAiFtSnippet(options: ExportOptions, hasValidation: boolean): string {
  const upload = [
    'from openai import OpenAI',
    '',
    'client = OpenAI()',
    '',
    'training_file = client.files.create(',
    '    file=open("data/train.jsonl", "rb"),',
    '    purpose="fine-tune",',
    ')',
  ];
  if (hasValidation) {
    upload.push(
      'validation_file = client.files.create(',
      '    file=open("data/validation.jsonl", "rb"),',
      '    purpose="fine-tune",',
      ')',
    );
  }
  const jobArgs = [
    '    model="gpt-4.1-mini-2025-04-14",  # any fine-tunable model',
    '    training_file=training_file.id,',
  ];
  if (hasValidation) jobArgs.push('    validation_file=validation_file.id,');
  if (options.datasetType === 'preference') {
    jobArgs.push('    method={"type": "dpo", "dpo": {"hyperparameters": {"beta": 0.1}}},');
  }
  return [...upload, '', 'job = client.fine_tuning.jobs.create(', ...jobArgs, ')', 'print(job.id)'].join(
    '\n',
  );
}

/** Framework-specific install + train section. */
function frameworkSection(
  framework: FrameworkId,
  options: ExportOptions,
  model?: ModelInfo,
  stats?: ReadmeStats,
): string {
  switch (framework) {
    case 'jsonl':
      return [
        '## Use the canonical JSONL',
        '',
        'Each line is an OpenAI-style `messages` object; preference / KTO / RL exports keep',
        'their structural columns (`chosen` / `rejected` / `completion` / `label` / `answer`)',
        'and per-example `tools` schemas. This shape loads directly into most 2026 trainers',
        '(TRL, Axolotl `type: chat_template`, MS-SWIFT, …).',
        '',
        codeBlock(
          'python',
          [
            'from datasets import load_dataset',
            '',
            'dataset = load_dataset("json", data_files="data/train.jsonl", split="train")',
          ].join('\n'),
        ),
      ].join('\n');
    case 'axolotl':
      return [
        '## Train with Axolotl 0.17',
        '',
        codeBlock(
          'bash',
          [
            'pip install "axolotl[flash-attn]==0.17.*"',
            'axolotl preprocess axolotl.yaml   # optional: tokenize + cache ahead of time',
            'axolotl train axolotl.yaml',
          ].join('\n'),
        ),
        '',
        'The generated `axolotl.yaml` uses QLoRA defaults (4-bit, r=32, α=64). Adjust',
        '`micro_batch_size` / `gradient_accumulation_steps` for your GPU before training.' +
          (options.datasetType === 'rl'
            ? '\nGRPO additionally requires reward functions — see the note at the top of the YAML.'
            : ''),
      ].join('\n');
    case 'trl':
      return [
        '## Train with TRL 1.5.1',
        '',
        codeBlock(
          'bash',
          ['pip install "trl==1.5.1" peft datasets accelerate', 'python train.py'].join('\n'),
        ),
        '',
        `The generated \`train.py\` runs ${trlTrainerName(options.datasetType)} with a peft LoRA`,
        'adapter over the exported JSONL.',
      ].join('\n');
    case 'llama-factory':
      return [
        '## Train with LLaMA-Factory 0.9.5',
        '',
        codeBlock(
          'bash',
          ['pip install "llamafactory==0.9.5"', 'llamafactory-cli train llamafactory.yaml'].join('\n'),
        ),
        '',
        'Keep `dataset_info.json` next to `llamafactory.yaml` (the config sets `dataset_dir: .`).',
        'Verify the `template:` entry matches your base model before training.',
      ].join('\n');
    case 'ms-swift':
      return [
        '## Train with MS-SWIFT 4.3',
        '',
        codeBlock('bash', 'pip install "ms-swift==4.3.*"'),
        '',
        codeBlock('bash', buildMsSwiftCommand({ options, model } satisfies RenderContext, 'data/train.jsonl')),
      ].join('\n');
    case 'unsloth':
      return [
        '## Train with Unsloth 2026.6',
        '',
        codeBlock('bash', ['pip install "unsloth==2026.6.*"', 'python train.py'].join('\n')),
        '',
        'The generated `train.py` loads the base model 4-bit via `FastLanguageModel`,',
        'attaches LoRA adapters, and runs the TRL trainer matching this dataset type.',
      ].join('\n');
    case 'openai-ft':
      return [
        '## Fine-tune via the OpenAI API',
        '',
        codeBlock('bash', 'pip install openai'),
        '',
        codeBlock(
          'python',
          // Without split files every example merges into data/train.jsonl,
          // so the snippet must not reference data/validation.jsonl.
          openAiFtSnippet(options, options.splitFiles && (stats?.bySplit.validation ?? 0) > 0),
        ),
        '',
        options.datasetType === 'preference'
          ? 'Rows use the DPO format (`input` / `preferred_output` / `non_preferred_output`).'
          : 'Rows use the supervised chat format; assistant turns may carry `weight: 0` to mask them from the loss.',
        'Every training example must fit the target model context window.',
      ].join('\n');
    case 'alpaca':
      return [
        '## Legacy Alpaca JSONL',
        '',
        'Rows are `{system?, instruction, output}`. Multi-turn structure, tool calls and',
        'loss weights are **not** representable in this format — prefer the canonical',
        'messages JSONL export for modern trainers.',
      ].join('\n');
    case 'sharegpt':
      return [
        '## Legacy ShareGPT JSONL',
        '',
        'Rows are `{conversations: [{from, value}]}` with `human` / `gpt` / `system` /',
        '`observation` speakers. Structured tool calls and loss weights are **not**',
        'representable — prefer the canonical messages JSONL export for modern trainers.',
      ].join('\n');
  }
}

/**
 * Build the bundle `README.md`: title, dataset stats, framework-pinned
 * install + train instructions and DataForge provenance.
 *
 * @param framework Target framework (also echoed in `options.framework`).
 * @param options   The export options the bundle was built with.
 * @param model     Resolved target model, when the project selected one.
 * @param stats     Exported example counts (rendered when provided).
 */
export function buildReadme(
  framework: FrameworkId,
  options: ExportOptions,
  model?: ModelInfo,
  stats?: ReadmeStats,
): string {
  const sections = [
    `# ${options.projectName} — ${FRAMEWORK_LABELS[framework]} export`,
    datasetSection(options, model, stats),
    frameworkSection(framework, options, model, stats),
    [
      '## Provenance',
      '',
      'Generated by **DataForge Studio v2** — a 100% client-side fine-tuning dataset',
      'workbench. The bundle was assembled locally in your browser; no data left your',
      'machine. See `metadata.json` for the full export-options echo and per-split counts.',
    ].join('\n'),
  ];
  return `${sections.join('\n\n')}\n`;
}
