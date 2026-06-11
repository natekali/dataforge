/**
 * Export workbench — /p/:projectId/export.
 *
 * Flow top to bottom: framework grid, options, live preview (first 3 exported
 * examples), download row. The exported dataset type defaults to the dominant
 * type among the project's examples and can be switched via a compact
 * selector (the engine writes only matching examples and records skipped ones
 * in metadata.json); frameworks that cannot represent the chosen type are
 * greyed out. The zip is assembled on the main thread after the next paint so
 * the spinner shows before a long synchronous build.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Download, PackageOpen, Upload } from 'lucide-react';

import type { DatasetType, Example, ExportOptions, FrameworkId, Message } from '@/engine/types';
import { DATASET_TYPES } from '@/engine/types';
import { buildExportBundle, bundleToZip, isExportSupported } from '@/engine/exporters';
import { getModel } from '@/engine/registry';
import { countExamplesAsync } from '@/lib/tokensLazy';
import { useFilteredExamples, useProject, type ExampleFilters } from '@/lib/hooks';
import { cn, fmtBytes, fmtNum } from '@/lib/utils';

import { Button, buttonVariants } from '@/components/ui/Button';
import { TypeBadge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Controls';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select';
import { FrameworkCard } from '@/components/export/FrameworkCard';
import { ExportOptionsPanel } from '@/components/export/ExportOptionsPanel';
import { ExportPreview } from '@/components/export/ExportPreview';

const NO_FILTERS: ExampleFilters = {};
const PAGE = { offset: 0, limit: 250000 };

/** Above this many uncounted examples, skip the on-the-fly token estimate. */
const UNCOUNTED_ESTIMATE_LIMIT = 2000;

const FRAMEWORKS: { id: FrameworkId; name: string; description: string }[] = [
  { id: 'jsonl', name: 'JSONL', description: 'OpenAI messages JSONL. Works with every 2026 trainer.' },
  { id: 'axolotl', name: 'Axolotl', description: 'YAML config plus dataset. v0.17' },
  { id: 'trl', name: 'TRL', description: 'Column-typed JSONL plus train.py. v1.5' },
  { id: 'llama-factory', name: 'LLaMA-Factory', description: 'dataset_info.json entry plus data. v0.9.5' },
  { id: 'ms-swift', name: 'MS-SWIFT', description: 'Swift dialect JSONL. v4.3' },
  { id: 'unsloth', name: 'Unsloth', description: 'Ready-to-run Python script. 2026.6' },
  { id: 'openai-ft', name: 'OpenAI fine-tuning', description: 'Upload-ready for the OpenAI fine-tuning API' },
  { id: 'alpaca', name: 'Alpaca', description: 'Legacy single-turn format' },
  { id: 'sharegpt', name: 'ShareGPT', description: 'Legacy from/value format' },
];

const TYPE_WORD: Record<DatasetType, string> = {
  sft: 'SFT',
  preference: 'DPO',
  kto: 'KTO',
  rl: 'RL',
};

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-+|-+$)/g, '');
  return slug.length > 0 ? slug : 'dataset';
}

function hasReasoningTrace(example: Example): boolean {
  const scan = (msgs: Message[] | undefined) =>
    msgs?.some((m) => m.reasoning !== undefined && m.reasoning !== '') ?? false;
  return (
    scan(example.messages) ||
    scan(example.chosen) ||
    scan(example.rejected) ||
    scan(example.completion)
  );
}

/** Resolve after the next paint so a spinner renders before a long sync build. */
function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => window.setTimeout(resolve, 0));
  });
}

export function ExportPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const project = useProject(projectId);
  const data = useFilteredExamples(projectId, NO_FILTERS, PAGE);

  const [framework, setFramework] = useState<FrameworkId>('jsonl');
  // undefined = not yet initialized from the project; null = explicit none.
  const [modelId, setModelId] = useState<string | null | undefined>(undefined);
  const [splitFiles, setSplitFiles] = useState(true);
  const [includeSystem, setIncludeSystem] = useState(true);
  const [includeReasoning, setIncludeReasoning] = useState(true);
  const [stripPriorThinking, setStripPriorThinking] = useState(true);
  const [building, setBuilding] = useState(false);

  const rows = data?.rows;

  // Per-type counts; the dominant type (project primary wins ties) is the
  // default export choice, overridable via the compact type selector.
  const { typeCounts, dominantType } = useMemo(() => {
    const counts: Record<DatasetType, number> = { sft: 0, preference: 0, kto: 0, rl: 0 };
    for (const e of rows ?? []) counts[e.type] += 1;
    let best: DatasetType = project?.datasetType ?? 'sft';
    for (const t of DATASET_TYPES) if (counts[t] > counts[best]) best = t;
    return { typeCounts: counts, dominantType: best };
  }, [rows, project?.datasetType]);

  const presentTypes = useMemo(
    () => DATASET_TYPES.filter((t) => typeCounts[t] > 0),
    [typeCounts],
  );

  // null = follow the dominant type; an explicit choice falls back to the
  // dominant type if its examples disappear.
  const [typeChoice, setTypeChoice] = useState<DatasetType | null>(null);
  const exportedType: DatasetType =
    typeChoice !== null && typeCounts[typeChoice] > 0 ? typeChoice : dominantType;

  const exported = useMemo(
    () => (rows ?? []).filter((e) => e.type === exportedType),
    [rows, exportedType],
  );
  const skipped = (rows?.length ?? 0) - exported.length;

  const reasoningCount = useMemo(
    () => exported.reduce((n, e) => n + (hasReasoningTrace(e) ? 1 : 0), 0),
    [exported],
  );

  // Stored counts where present; lazy o200k estimate for the rest so the
  // tokenizer never lands in the entry bundle.
  const [estimatedTokens, setEstimatedTokens] = useState<number | null>(null);
  const storedTokens = useMemo(() => {
    let total = 0;
    const missing: Example[] = [];
    for (const e of exported) {
      if (e.tokenCount != null) total += e.tokenCount;
      else missing.push(e);
    }
    return { total, missing };
  }, [exported]);
  useEffect(() => {
    let alive = true;
    if (storedTokens.missing.length === 0) {
      setEstimatedTokens(0);
      return;
    }
    setEstimatedTokens(null);
    // Counting thousands of examples on the fly would freeze the page; the
    // Analytics page computes and stores counts in the worker instead.
    if (storedTokens.missing.length > UNCOUNTED_ESTIMATE_LIMIT) return;
    void countExamplesAsync(storedTokens.missing).then((r) => {
      if (alive) setEstimatedTokens(r.total);
    });
    return () => {
      alive = false;
    };
  }, [storedTokens]);
  const tooManyUncounted = storedTokens.missing.length > UNCOUNTED_ESTIMATE_LIMIT;
  const totalTokens =
    estimatedTokens == null ? null : storedTokens.total + estimatedTokens;

  const model = modelId != null ? getModel(modelId) : undefined;

  // Initialize the model picker from the project default once it loads.
  useEffect(() => {
    if (project !== undefined && modelId === undefined) setModelId(project.targetModelId);
  }, [project, modelId]);

  // Stripping earlier traces defaults off for models that preserve thinking.
  useEffect(() => {
    setStripPriorThinking(!(model?.preservesThinking ?? false));
  }, [model]);

  // The dominant type follows the data; never leave an unsupported framework selected.
  useEffect(() => {
    if (!isExportSupported(framework, exportedType)) setFramework('jsonl');
  }, [framework, exportedType]);

  const effectiveReasoning = reasoningCount > 0 && includeReasoning;

  const options = useMemo<ExportOptions>(
    () => ({
      framework,
      datasetType: exportedType,
      includeReasoning: effectiveReasoning,
      stripPriorThinking,
      includeSystem,
      splitFiles,
      targetModelId: model?.id,
      projectName: project?.name ?? 'dataset',
    }),
    [
      framework,
      exportedType,
      effectiveReasoning,
      stripPriorThinking,
      includeSystem,
      splitFiles,
      model?.id,
      project?.name,
    ],
  );

  const previewExamples = useMemo(() => exported.slice(0, 3), [exported]);

  async function handleDownload() {
    if (building || project === undefined || rows === undefined) return;
    setBuilding(true);
    await nextPaint();
    try {
      const bundle = buildExportBundle(rows, options, model);
      const zip = bundleToZip(bundle);
      const blob = new Blob([zip as Uint8Array<ArrayBuffer>], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${slugify(project.name)}-${framework}.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast.success(
        `Saved ${fmtNum(bundle.files.length)} files, ${fmtBytes(zip.byteLength)}`,
      );
    } catch (err) {
      toast.error(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBuilding(false);
    }
  }

  if (project === undefined || data === undefined) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-5" />
      </div>
    );
  }

  if (data.projectTotal === 0) {
    return (
      <div className="flex h-full items-center justify-center overflow-y-auto p-6">
        <EmptyState
          icon={PackageOpen}
          title="Nothing to export yet"
          description="Add examples first. Import a file or generate data, then come back to package it."
          action={
            <Link to="../import" className={cn(buttonVariants({ variant: 'solid', size: 'sm' }))}>
              <Upload />
              Import data
            </Link>
          }
          className="w-full max-w-xl"
        />
      </div>
    );
  }

  const supported = isExportSupported(framework, exportedType);

  let riseIdx = 0;
  const rise = () => ({ animationDelay: `${riseIdx++ * 40}ms` });

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-5xl flex-col gap-4 p-6">
        <header className="animate-rise" style={rise()}>
          <h1 className="text-lg font-semibold text-ink">Export</h1>
          <p className="mt-0.5 text-[13px] text-ink-dim">
            Pick a framework, tune the options, download a training-ready bundle.
          </p>
        </header>

        <section className="animate-rise" style={rise()}>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="tech-label">Framework</h2>
            {presentTypes.length > 1 ? (
              <span className="flex items-center gap-1.5 text-xs text-ink-faint">
                exporting
                <Select
                  value={exportedType}
                  onValueChange={(v) => setTypeChoice(v as DatasetType)}
                >
                  <SelectTrigger
                    className="h-7 w-auto min-w-28 px-2 text-xs"
                    aria-label="Dataset type to export"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {presentTypes.map((t) => (
                      <SelectItem key={t} value={t}>
                        {TYPE_WORD[t]} · {fmtNum(typeCounts[t])}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-xs text-ink-faint">
                exporting
                <TypeBadge type={exportedType} />
                <span className="font-mono tabular-nums">{fmtNum(exported.length)}</span>
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            {FRAMEWORKS.map((f) => (
              <FrameworkCard
                key={f.id}
                id={f.id}
                name={f.name}
                description={f.description}
                selected={framework === f.id}
                disabled={!isExportSupported(f.id, exportedType)}
                disabledReason={`Not available for ${TYPE_WORD[exportedType]} datasets`}
                onSelect={setFramework}
              />
            ))}
          </div>
        </section>

        <ExportOptionsPanel
          className="animate-rise"
          style={rise()}
          projectId={project.id}
          modelId={modelId ?? null}
          onModelChange={setModelId}
          splitFiles={splitFiles}
          onSplitFilesChange={setSplitFiles}
          includeSystem={includeSystem}
          onIncludeSystemChange={setIncludeSystem}
          includeReasoning={effectiveReasoning}
          onIncludeReasoningChange={setIncludeReasoning}
          stripPriorThinking={stripPriorThinking}
          onStripPriorThinkingChange={setStripPriorThinking}
          reasoningCount={reasoningCount}
        />

        <ExportPreview
          className="animate-rise"
          style={rise()}
          examples={previewExamples}
          options={options}
          model={model}
        />

        <section
          className="panel animate-rise flex flex-wrap items-center justify-between gap-3 px-4 py-3"
          style={rise()}
        >
          <div>
            <p className="text-sm text-ink">
              Exports <span className="font-mono tabular-nums">{fmtNum(exported.length)}</span>{' '}
              {TYPE_WORD[exportedType]} example{exported.length === 1 ? '' : 's'}.
              {skipped > 0 && (
                <>
                  {' '}
                  <span className="font-mono tabular-nums">{fmtNum(skipped)}</span> example
                  {skipped === 1 ? '' : 's'} of other types {skipped === 1 ? 'is' : 'are'} skipped.
                </>
              )}
            </p>
            <p className="mt-0.5 font-mono text-xs tabular-nums text-ink-faint">
              {tooManyUncounted
                ? `tokens uncounted for ${fmtNum(storedTokens.missing.length)} examples · compute them in Analytics`
                : totalTokens == null
                  ? 'counting tokens'
                  : `about ${fmtNum(totalTokens)} tokens`}
              {data.total > (rows?.length ?? 0) && (
                <> · packaging first {fmtNum(rows?.length ?? 0)} of {fmtNum(data.total)}</>
              )}
            </p>
          </div>
          <Button
            variant="solid"
            size="md"
            onClick={handleDownload}
            disabled={building || !supported || exported.length === 0}
          >
            {building ? (
              <Spinner className="border-accent-ink/30 border-t-accent-ink" />
            ) : (
              <Download />
            )}
            {building ? 'Building zip' : 'Download ZIP'}
          </Button>
        </section>
      </div>
    </div>
  );
}
