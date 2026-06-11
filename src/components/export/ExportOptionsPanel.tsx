import { useId, useMemo } from 'react';
import type { CSSProperties } from 'react';
import { getModel, modelsByVendor } from '@/engine/registry';
import { Badge } from '@/components/ui/Badge';
import { Switch } from '@/components/ui/Controls';
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

export interface ExportOptionsPanelProps {
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
            'block text-[13px] font-medium',
            disabled ? 'text-ink-faint' : 'text-ink',
          )}
        >
          {label}
        </label>
        <p className="text-[11px] text-ink-dim">{hint}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
    </div>
  );
}

/** Target model picker plus the file/system/reasoning switches. */
export function ExportOptionsPanel({
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
  const model = modelId === null ? undefined : getModel(modelId);

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
          <p className="mt-1 text-[11px] text-ink-dim">
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
        </div>
      </div>
    </section>
  );
}
