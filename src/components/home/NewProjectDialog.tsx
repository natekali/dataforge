/**
 * Create-project dialog: name, description, dataset type, optional target
 * model (vendor-grouped, filterable). Creating navigates to the project's
 * Import surface so empty projects land where data comes in.
 */
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import type { DatasetType, ModelInfo } from '@/engine/types';
import { getModel, modelsByVendor, searchModels } from '@/engine/registry';
import { createProject } from '@/lib/mutations';
import { fmtCtx } from '@/lib/utils';
import { Badge, type BadgeProps } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Controls';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/Dialog';
import { Input, Label, Textarea } from '@/components/ui/Input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
} from '@/components/ui/Select';

const TYPE_OPTIONS: { value: DatasetType; label: string; hint: string }[] = [
  { value: 'sft', label: 'SFT', hint: 'instruction/chat tuning' },
  { value: 'preference', label: 'DPO', hint: 'preference pairs' },
  { value: 'kto', label: 'KTO', hint: 'thumbs up/down feedback' },
  { value: 'rl', label: 'RL', hint: 'verifiable answers for GRPO' },
];

const SIZE_TONES: Record<ModelInfo['sizeClass'], BadgeProps['tone']> = {
  small: 'ok',
  medium: 'info',
  large: 'warn',
};

/** Sentinel for "no target model" — Radix Select forbids empty item values. */
const NONE = 'none';

export function NewProjectDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [datasetType, setDatasetType] = useState<DatasetType>('sft');
  const [targetModelId, setTargetModelId] = useState(NONE);
  const [modelQuery, setModelQuery] = useState('');
  const [creating, setCreating] = useState(false);

  // Fresh form every time the dialog opens.
  useEffect(() => {
    if (open) {
      setName('');
      setDescription('');
      setDatasetType('sft');
      setTargetModelId(NONE);
      setModelQuery('');
      setCreating(false);
    }
  }, [open]);

  const modelGroups = useMemo(() => {
    const matched = new Set(searchModels(modelQuery).map((m) => m.id));
    return Object.entries(modelsByVendor())
      .map(([vendor, models]) => ({
        vendor,
        models: models.filter((m) => matched.has(m.id)),
      }))
      .filter((g) => g.models.length > 0)
      .sort((a, b) => a.vendor.localeCompare(b.vendor));
  }, [modelQuery]);

  const selectedModel = targetModelId === NONE ? undefined : getModel(targetModelId);
  const selectedType = TYPE_OPTIONS.find((t) => t.value === datasetType) ?? TYPE_OPTIONS[0];

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    try {
      const project = await createProject({
        name: trimmed,
        description,
        datasetType,
        targetModelId: targetModelId === NONE ? null : targetModelId,
      });
      toast.success(`Project "${project.name}" created`);
      onOpenChange(false);
      navigate(`/p/${project.id}/import`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create project');
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !creating && onOpenChange(o)}>
      <DialogContent
        title="New project"
        description="Stored in this browser only. Nothing leaves your machine."
      >
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <Label htmlFor="np-name">Name</Label>
            <Input
              id="np-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Support-bot SFT v1"
              maxLength={120}
              required
            />
          </div>

          <div>
            <Label htmlFor="np-description">Description</Label>
            <Textarea
              id="np-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this dataset teaches the model (optional)"
              className="min-h-16"
            />
          </div>

          <div>
            <Label id="np-type-label">Dataset type</Label>
            <Select value={datasetType} onValueChange={(v) => setDatasetType(v as DatasetType)}>
              <SelectTrigger aria-labelledby="np-type-label">
                <span>
                  <span className="font-medium">{selectedType.label}</span>
                  <span className="text-ink-dim"> · {selectedType.hint}</span>
                </span>
              </SelectTrigger>
              <SelectContent>
                {TYPE_OPTIONS.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    <span className="font-medium">{t.label}</span>
                    <span className="text-ink-faint"> · {t.hint}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label id="np-model-label">
              Target model <span className="font-normal text-ink-faint">(optional)</span>
            </Label>
            <Select
              value={targetModelId}
              onValueChange={setTargetModelId}
              onOpenChange={(o) => !o && setModelQuery('')}
            >
              <SelectTrigger aria-labelledby="np-model-label">
                <span className={selectedModel ? undefined : 'text-ink-faint'}>
                  {selectedModel ? selectedModel.name : 'No target model'}
                </span>
              </SelectTrigger>
              <SelectContent>
                <div className="sticky top-0 z-10 -mt-1 border-b border-hairline bg-surface-2 p-1.5">
                  <Input
                    value={modelQuery}
                    onChange={(e) => setModelQuery(e.target.value)}
                    onKeyDown={(e) => e.stopPropagation()}
                    placeholder="Filter models…"
                    className="h-8 text-[13px]"
                    aria-label="Filter models"
                  />
                </div>
                <SelectItem value={NONE}>
                  <span className="text-ink-dim">No target model</span>
                </SelectItem>
                {modelGroups.map((g) => (
                  <SelectGroup key={g.vendor}>
                    <SelectLabel>{g.vendor}</SelectLabel>
                    {g.models.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        <span className="inline-flex items-center gap-2">
                          <span>{m.name}</span>
                          <span className="font-mono text-[11px] tabular-nums text-ink-faint">
                            {fmtCtx(m.nativeCtx)}
                          </span>
                          <Badge tone={SIZE_TONES[m.sizeClass]}>{m.sizeClass}</Badge>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
                {modelGroups.length === 0 && (
                  <p className="px-3 py-2 text-[13px] text-ink-faint">
                    No models match &ldquo;{modelQuery}&rdquo;
                  </p>
                )}
              </SelectContent>
            </Select>
            <p className="mt-1 text-xs text-ink-faint">
              Drives chat-template rendering, token counts and context-limit checks.
            </p>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={creating}>
              Cancel
            </Button>
            <Button type="submit" variant="solid" disabled={!name.trim() || creating}>
              {creating && <Spinner className="border-accent-ink/30 border-t-accent-ink" />}
              Create project
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
