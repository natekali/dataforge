import { useId, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { toast } from 'sonner';
import { getModel, modelsByVendor } from '@/engine/registry';
import { autoSplit } from '@/lib/mutations';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Spinner, Switch } from '@/components/ui/Controls';
import { Label } from '@/components/ui/Input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select';
import { cn, fmtCtx, fmtNum } from '@/lib/utils';

/** Radix Select cannot carry an empty value; sentinel for "no target model". */
const NO_MODEL = 'none';

/** Train/validation/test ratio presets for auto split assignment. */
const SPLIT_PRESETS = {
  '80/10/10': { train: 0.8, validation: 0.1, test: 0.1 },
  '90/10/0': { train: 0.9, validation: 0.1, test: 0 },
  '70/15/15': { train: 0.7, validation: 0.15, test: 0.15 },
} as const;
type SplitPreset = keyof typeof SPLIT_PRESETS;
const SPLIT_PRESET_NAMES = Object.keys(SPLIT_PRESETS) as SplitPreset[];

export interface ExportOptionsPanelProps {
  /** Project whose examples the Splits row reassigns. */
  projectId: string;
  /** Registry id of the target model, or null for none. */
  modelId: string | null;
  onModelChange: (id: string | null) => void;
  splitFiles: boolean;
  onSplitFilesChange: (value: boolean) => void;
  includeSystem: boolean;
  onIncludeSystemChange: (value: boolean) => void;
  /** Effective reasoning toggle; the page passes false when no traces exist. */
  includeReasoning: boolean;
  onIncludeReasoningChange: (value: boolean) => void;
  stripPriorThinking: boolean;
  onStripPriorThinkingChange: (value: boolean) => void;
  /** Exported examples that carry at least one reasoning trace. */
  reasoningCount: number;
  className?: string;
  style?: CSSProperties;
}

function OptionRow({
  label,
  hint,
  checked,
  onCheckedChange,
  disabled = false,
  indent = false,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
  disabled?: boolean;
  indent?: boolean;
}) {
  const id = useId();
  return (
    <div className={cn('flex items-center justify-between gap-4 py-2.5', indent && 'pl-5')}>
      <div className="min-w-0">
        <label
          htmlFor={id}
          className={cn(
            'block text-sm font-medium',
            disabled ? 'text-ink-faint' : 'text-ink',
          )}
        >
          {label}
        </label>
        <p className="text-xs text-ink-dim">{hint}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
    </div>
  );
}

/** Target model picker plus the file/system/reasoning switches. */
export function ExportOptionsPanel({
  projectId,
  modelId,
  onModelChange,
  splitFiles,
  onSplitFilesChange,
  includeSystem,
  onIncludeSystemChange,
  includeReasoning,
  onIncludeReasoningChange,
  stripPriorThinking,
  onStripPriorThinkingChange,
  reasoningCount,
  className,
  style,
}: ExportOptionsPanelProps) {
  const modelSelectId = useId();
  const splitSelectId = useId();
  const model = modelId === null ? undefined : getModel(modelId);

  const [splitPreset, setSplitPreset] = useState<SplitPreset>('80/10/10');
  const [assigning, setAssigning] = useState(false);

  async function handleAssignSplits(): Promise<void> {
    if (assigning) return;
    setAssigning(true);
    try {
      const r = await autoSplit(projectId, SPLIT_PRESETS[splitPreset]);
      toast.success(
        `Splits assigned: ${fmtNum(r.train)} train, ${fmtNum(r.validation)} validation, ${fmtNum(r.test)} test`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Split assignment failed');
    } finally {
      setAssigning(false);
    }
  }

  const vendors = useMemo(() => {
    const groups = modelsByVendor();
    return Object.keys(groups)
      .sort((a, b) => a.localeCompare(b))
      .map((vendor) => [vendor, groups[vendor]] as const);
  }, []);

  const hasReasoning = reasoningCount > 0;

  return (
    <section className={cn('panel', className)} style={style}>
      <div className="panel-header">
        <h2 className="tech-label">Options</h2>
      </div>
      <div className="p-4">
        <div>
          <Label htmlFor={modelSelectId}>Target model</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={modelId ?? NO_MODEL}
              onValueChange={(value) => onModelChange(value === NO_MODEL ? null : value)}
            >
              <SelectTrigger id={modelSelectId} className="w-72">
                <SelectValue placeholder="No target model" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_MODEL}>No target model</SelectItem>
                {vendors.map(([vendor, models]) => (
                  <SelectGroup key={vendor}>
                    <SelectLabel>{vendor}</SelectLabel>
                    {models.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
            {model !== undefined && (
              <Badge tone="neutral">
                {model.templateFamily} · {fmtCtx(model.nativeCtx)} ctx
              </Badge>
            )}
          </div>
          <p className="mt-1 text-xs text-ink-dim">
            Sets think delimiters and template hints in the generated configs. Optional.
          </p>
        </div>

        <div className="mt-3 flex flex-col divide-y divide-hairline border-t border-hairline">
          <OptionRow
            label="Split files"
            hint="One data file per split. Off writes everything to train.jsonl."
            checked={splitFiles}
            onCheckedChange={onSplitFilesChange}
          />
          <OptionRow
            label="Include system messages"
            hint="Off drops system and developer turns from every example."
            checked={includeSystem}
            onCheckedChange={onIncludeSystemChange}
          />
          <OptionRow
            label="Include reasoning traces"
            hint={
              hasReasoning
                ? `Renders think blocks for ${fmtNum(reasoningCount)} example${reasoningCount === 1 ? '' : 's'}. Off strips them.`
                : 'No examples carry reasoning traces.'
            }
            checked={includeReasoning}
            onCheckedChange={onIncludeReasoningChange}
            disabled={!hasReasoning}
          />
          <OptionRow
            indent
            label="Strip reasoning from earlier turns"
            hint={
              model?.preservesThinking
                ? `${model.name} keeps think blocks across turns, so this is off by default.`
                : 'Keeps only the final assistant trace in each conversation.'
            }
            checked={stripPriorThinking}
            onCheckedChange={onStripPriorThinkingChange}
            disabled={!hasReasoning || !includeReasoning}
          />
          <div className="flex items-center justify-between gap-4 py-2.5">
            <div className="min-w-0">
              <label
                htmlFor={splitSelectId}
                className="block text-sm font-medium text-ink"
              >
                Splits
              </label>
              <p className="text-xs text-ink-dim">
                Random train/validation/test assignment. Overwrites current splits.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Select
                value={splitPreset}
                onValueChange={(v) => setSplitPreset(v as SplitPreset)}
              >
                <SelectTrigger
                  id={splitSelectId}
                  className="h-8 w-28 px-2 font-mono text-[13px] tabular-nums"
                  aria-label="Split ratios"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SPLIT_PRESET_NAMES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                onClick={() => void handleAssignSplits()}
                disabled={assigning}
              >
                {assigning && <Spinner />} Assign
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
