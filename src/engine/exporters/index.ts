/**
 * DataForge V2 — export bundle assembly + zip packaging.
 *
 * {@link buildExportBundle} dispatches to the per-framework row/config
 * builders, groups data files by split (`data/train.jsonl` etc.) and always
 * attaches a framework-specific `README.md` plus a `metadata.json` provenance
 * record. {@link bundleToZip} packs the result with fflate for download.
 *
 * Runtime-environment agnostic: no DOM, no React.
 */

import { strToU8, zipSync } from 'fflate';
import type {
  DatasetType,
  Example,
  ExportBundle,
  ExportFile,
  ExportOptions,
  FrameworkId,
  ModelInfo,
  SplitName,
} from '@/engine/types';
import { SPLITS } from '@/engine/types';
import {
  buildCanonicalRows,
  buildLegacyRows,
  toJsonl,
  type RenderContext,
  type SplitFileMap,
} from './jsonl';
import { buildAxolotlConfig, buildAxolotlRows } from './axolotl';
import { buildTrlRows, buildTrlScript } from './trl';
import {
  buildLlamaFactoryDatasetInfo,
  buildLlamaFactoryRows,
  buildLlamaFactoryTrainYaml,
} from './llamaFactory';
import { buildMsSwiftRows } from './msSwift';
import { buildUnslothRows, buildUnslothScript } from './unsloth';
import { buildOpenAiFtRows } from './openaiFt';
import { buildReadme, FRAMEWORK_LABELS } from './readme';

// ---------------------------------------------------------------------------
// Supported framework × dataset-type matrix
// ---------------------------------------------------------------------------

/**
 * Error thrown when a framework cannot represent a dataset type. The UI
 * catches this (or consults {@link isExportSupported} up front) to grey the
 * combination out instead of producing a broken bundle.
 */
export class UnsupportedExportError extends Error {
  readonly framework: FrameworkId;
  readonly datasetType: DatasetType;

  constructor(framework: FrameworkId, datasetType: DatasetType) {
    super(`${FRAMEWORK_LABELS[framework]} cannot export "${datasetType}" datasets`);
    this.name = 'UnsupportedExportError';
    this.framework = framework;
    this.datasetType = datasetType;
  }
}

/**
 * Dataset types each framework CANNOT export:
 * - LLaMA-Factory has no prompt+answer (RL/GRPO) dataset shape.
 * - The OpenAI fine-tuning API only accepts supervised chat and DPO rows.
 * - Legacy Alpaca cannot carry KTO labels or RL answers; legacy ShareGPT
 *   cannot carry any structural column beyond the conversation itself.
 */
const UNSUPPORTED_COMBOS: Partial<Record<FrameworkId, readonly DatasetType[]>> = {
  'llama-factory': ['rl'],
  'openai-ft': ['kto', 'rl'],
  alpaca: ['kto', 'rl'],
  sharegpt: ['preference', 'kto', 'rl'],
};

/** Whether {@link buildExportBundle} supports the framework × type combo. */
export function isExportSupported(framework: FrameworkId, datasetType: DatasetType): boolean {
  return !(UNSUPPORTED_COMBOS[framework]?.includes(datasetType) ?? false);
}

/** Dataset types the framework cannot export (for greying out UI options). */
export function unsupportedDatasetTypes(framework: FrameworkId): readonly DatasetType[] {
  return UNSUPPORTED_COMBOS[framework] ?? [];
}

// ---------------------------------------------------------------------------
// Bundle assembly
// ---------------------------------------------------------------------------

/** Dispatch one group of examples to the framework's row builder. */
function buildRows(examples: Example[], ctx: RenderContext): Record<string, unknown>[] {
  switch (ctx.options.framework) {
    case 'jsonl':
      return buildCanonicalRows(examples, ctx);
    case 'axolotl':
      return buildAxolotlRows(examples, ctx);
    case 'trl':
      return buildTrlRows(examples, ctx);
    case 'llama-factory':
      return buildLlamaFactoryRows(examples, ctx);
    case 'ms-swift':
      return buildMsSwiftRows(examples, ctx);
    case 'unsloth':
      return buildUnslothRows(examples, ctx);
    case 'openai-ft':
      return buildOpenAiFtRows(examples, ctx);
    case 'alpaca':
      return buildLegacyRows(examples, ctx, 'alpaca');
    case 'sharegpt':
      return buildLegacyRows(examples, ctx, 'sharegpt');
  }
}

/** Framework-specific config/script files referencing the emitted data files. */
function auxiliaryFiles(
  ctx: RenderContext,
  dataFiles: SplitFileMap,
  hasTools: boolean,
): ExportFile[] {
  switch (ctx.options.framework) {
    case 'axolotl':
      return [{ path: 'axolotl.yaml', content: buildAxolotlConfig(ctx, dataFiles) }];
    case 'trl':
      return [{ path: 'train.py', content: buildTrlScript(ctx, dataFiles) }];
    case 'llama-factory':
      return [
        { path: 'dataset_info.json', content: buildLlamaFactoryDatasetInfo(ctx, dataFiles, hasTools) },
        { path: 'llamafactory.yaml', content: buildLlamaFactoryTrainYaml(ctx, dataFiles) },
      ];
    case 'unsloth':
      return [{ path: 'train.py', content: buildUnslothScript(ctx, dataFiles) }];
    case 'jsonl':
    case 'ms-swift':
    case 'openai-ft':
    case 'alpaca':
    case 'sharegpt':
      return [];
  }
}

/**
 * Group the exported examples into per-split data files. When `splitFiles` is
 * off everything lands in `train`; when on, `train` is always emitted (so the
 * generated configs always reference an existing file) and `validation`/`test`
 * only when non-empty.
 */
function groupBySplit(examples: Example[], splitFiles: boolean): [SplitName, Example[]][] {
  if (!splitFiles) return [['train', examples]];
  const groups: [SplitName, Example[]][] = [];
  for (const split of SPLITS) {
    const group = examples.filter((ex) => ex.split === split);
    if (split === 'train' || group.length > 0) groups.push([split, group]);
  }
  return groups;
}

/** `metadata.json` content: provenance, options echo and example counts. */
function buildMetadata(
  provided: Example[],
  exported: Example[],
  bySplit: Partial<Record<SplitName, number>>,
  options: ExportOptions,
  model: ModelInfo | undefined,
  filePaths: string[],
): string {
  const byType: Partial<Record<DatasetType, number>> = {};
  for (const ex of provided) byType[ex.type] = (byType[ex.type] ?? 0) + 1;
  const metadata = {
    generator: 'DataForge Studio v2',
    exportedAt: new Date().toISOString(),
    options,
    model: model !== undefined ? { id: model.id, hfId: model.hfId, name: model.name } : null,
    examples: {
      /** Examples handed to the exporter (all dataset types). */
      provided: provided.length,
      /** Examples matching `options.datasetType` that were written out. */
      exported: exported.length,
      byType,
      bySplit,
    },
    files: filePaths,
  };
  return `${JSON.stringify(metadata, null, 2)}\n`;
}

/**
 * Build a complete export bundle for the given framework × dataset type.
 *
 * Only examples whose `type` matches `options.datasetType` are written (the
 * builders rely on type-specific structural columns); `metadata.json` records
 * both the provided and exported counts. Data files land under `data/` —
 * one per split when `options.splitFiles`, otherwise a single
 * `data/train.jsonl` — followed by framework configs/scripts, `README.md`
 * and `metadata.json`.
 *
 * @throws UnsupportedExportError when the framework cannot represent the
 *         dataset type (see {@link isExportSupported}).
 */
export function buildExportBundle(
  examples: Example[],
  options: ExportOptions,
  model?: ModelInfo,
): ExportBundle {
  if (!isExportSupported(options.framework, options.datasetType)) {
    throw new UnsupportedExportError(options.framework, options.datasetType);
  }
  const ctx: RenderContext = { options, model };
  const exported = examples.filter((ex) => ex.type === options.datasetType);
  const groups = groupBySplit(exported, options.splitFiles);

  const dataFiles: SplitFileMap = {};
  const files: ExportFile[] = [];
  for (const [split, group] of groups) {
    const path = `data/${split}.jsonl`;
    dataFiles[split] = path;
    files.push({ path, content: toJsonl(buildRows(group, ctx)) });
  }

  const hasTools = exported.some((ex) => ex.tools !== undefined && ex.tools.length > 0);
  files.push(...auxiliaryFiles(ctx, dataFiles, hasTools));

  const bySplit: Partial<Record<SplitName, number>> = {};
  for (const ex of exported) bySplit[ex.split] = (bySplit[ex.split] ?? 0) + 1;

  files.push({
    path: 'README.md',
    content: buildReadme(options.framework, options, model, {
      exampleCount: exported.length,
      bySplit,
    }),
  });
  files.push({
    path: 'metadata.json',
    content: buildMetadata(examples, exported, bySplit, options, model, [
      ...files.map((f) => f.path),
      'metadata.json',
    ]),
  });

  const breakdown = groups.map(([split, group]) => `${group.length} ${split}`).join(' · ');
  const plural = exported.length === 1 ? '' : 's';
  return {
    files,
    summary: `${FRAMEWORK_LABELS[options.framework]} — ${exported.length} ${options.datasetType} example${plural} (${breakdown}) in ${files.length} files`,
  };
}

// ---------------------------------------------------------------------------
// Zip packaging
// ---------------------------------------------------------------------------

/**
 * Pack an export bundle into a single zip archive (fflate `zipSync`).
 * String contents are UTF-8 encoded; binary contents pass through unchanged.
 */
export function bundleToZip(bundle: ExportBundle): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const file of bundle.files) {
    entries[file.path] = typeof file.content === 'string' ? strToU8(file.content) : file.content;
  }
  return zipSync(entries, { level: 6 });
}
