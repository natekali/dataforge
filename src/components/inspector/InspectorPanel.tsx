/**
 * Example inspector — the full editing surface for one example. Header carries
 * identity, navigation and review controls; the meta strip carries split, tags
 * and live draft token count; the body mounts the dataset-type editor over a
 * local draft. Saves are explicit (Ctrl+S), wrapped in withUndo.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { toast } from 'sonner';
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  Flag,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import type { DatasetType, Example, Message, SplitName } from '@/engine/types';
import { useExampleTokenCount } from '@/lib/tokensLazy';
import { useExample } from '@/lib/hooks';
import { useUiStore } from '@/lib/store';
import {
  deleteExamples,
  duplicateExample,
  setFlagged,
  setReviewed,
  setSplitForExamples,
  updateExample,
} from '@/lib/mutations';
import { withUndo } from '@/lib/undo';
import { cn, fmtNum, fmtRelativeTime } from '@/lib/utils';
import { TypeBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Controls';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select';
import { Tip } from '@/components/ui/Tooltip';
import { ConversationEditor } from './ConversationEditor';
import { KtoEditor } from './KtoEditor';
import { PreferenceEditor } from './PreferenceEditor';
import { RlEditor } from './RlEditor';

export interface InspectorPanelProps {
  exampleId: string;
  onClose: () => void;
  /** Ordered ids matching the grid's current filter, for prev/next navigation. */
  filteredIds?: string[];
  /** Navigate the inspector to another example (prev/next). */
  onNavigate?: (id: string) => void;
}

/** Editable subset of an example, held locally until an explicit save. */
interface Draft {
  messages: Message[];
  chosen: Message[];
  rejected: Message[];
  completion: Message[];
  label: boolean;
  answer: string;
}

interface DraftState {
  id: string;
  /** updatedAt of the example this draft was last synced against. */
  updatedAt: number;
  /** JSON snapshot of the draft at sync time — dirty = draft differs from this. */
  baseline: string;
  draft: Draft;
}

function extractDraft(example: Example): Draft {
  return structuredClone({
    messages: example.messages,
    chosen: example.chosen ?? [],
    rejected: example.rejected ?? [],
    completion: example.completion ?? [],
    label: example.label ?? true,
    answer: example.answer ?? '',
  });
}

function initDraftState(example: Example): DraftState {
  const draft = extractDraft(example);
  return {
    id: example.id,
    updatedAt: example.updatedAt,
    baseline: JSON.stringify(draft),
    draft,
  };
}

type DraftPatch = Partial<
  Pick<Example, 'messages' | 'chosen' | 'rejected' | 'completion' | 'label' | 'answer'>
>;

/** Only the fields the type's editor actually owns make it into the patch. */
function buildPatch(type: DatasetType, draft: Draft): DraftPatch {
  switch (type) {
    case 'sft':
      return { messages: draft.messages };
    case 'preference':
      return { messages: draft.messages, chosen: draft.chosen, rejected: draft.rejected };
    case 'kto':
      return { messages: draft.messages, completion: draft.completion, label: draft.label };
    case 'rl':
      return { messages: draft.messages, answer: draft.answer };
  }
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

const DISCARD_PROMPT = 'Discard unsaved changes?';

export function InspectorPanel({
  exampleId,
  onClose,
  filteredIds,
  onNavigate,
}: InspectorPanelProps) {
  const example = useExample(exampleId);

  const [draftState, setDraftState] = useState<DraftState | null>(null);
  const [tagInput, setTagInput] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Init on example change; re-sync on external updates only while clean.
  useEffect(() => {
    if (!example) return;
    setDraftState((prev) => {
      if (!prev || prev.id !== example.id) return initDraftState(example);
      if (prev.updatedAt !== example.updatedAt) {
        const isDirty = JSON.stringify(prev.draft) !== prev.baseline;
        if (!isDirty) return initDraftState(example);
        return { ...prev, updatedAt: example.updatedAt };
      }
      return prev;
    });
  }, [example]);

  // Local chrome state never travels between examples.
  useEffect(() => {
    setTagInput('');
    setConfirmOpen(false);
  }, [exampleId]);

  const dirty = useMemo(
    () => draftState !== null && JSON.stringify(draftState.draft) !== draftState.baseline,
    [draftState],
  );

  const draftExample = useMemo(() => {
    if (!example || !draftState || draftState.id !== example.id) return null;
    const { draft } = draftState;
    return {
      ...example,
      messages: draft.messages,
      chosen: draft.chosen,
      rejected: draft.rejected,
      completion: draft.completion,
    };
  }, [example, draftState]);
  const draftTokens = useExampleTokenCount(draftExample);

  const patchDraft = useCallback((patch: Partial<Draft>) => {
    setDraftState((prev) =>
      prev ? { ...prev, draft: { ...prev.draft, ...patch } } : prev,
    );
  }, []);

  // Mirror dirtiness into the UI store so other surfaces (grid row clicks)
  // can warn before discarding; the flag clears when the panel unmounts.
  const setInspectorDirty = useUiStore((s) => s.setInspectorDirty);
  useEffect(() => {
    setInspectorDirty(dirty);
  }, [dirty, setInspectorDirty]);
  useEffect(() => () => useUiStore.getState().setInspectorDirty(false), []);

  // Warn before the tab closes while edits are unsaved.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // Focus the panel root so j/k and Ctrl+S work without a click inside.
  const rootRef = useRef<HTMLDivElement>(null);
  const loaded = example !== undefined;
  useEffect(() => {
    if (loaded) rootRef.current?.focus();
  }, [exampleId, loaded]);

  if (!example) {
    return (
      <div className="flex h-full flex-col">
        <div className="panel-header">
          <span className="tech-label">Example</span>
          <Tip label="Close">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={onClose}
              aria-label="Close inspector"
            >
              <X />
            </Button>
          </Tip>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <Spinner />
        </div>
      </div>
    );
  }

  const draft = draftState && draftState.id === example.id ? draftState.draft : null;

  const ids = filteredIds ?? [];
  const idx = ids.indexOf(exampleId);
  const prevId = idx > 0 ? ids[idx - 1] : null;
  const nextId = idx !== -1 && idx < ids.length - 1 ? ids[idx + 1] : null;

  const go = (id: string | null) => {
    if (!id || !onNavigate) return;
    if (dirty && !window.confirm(DISCARD_PROMPT)) return;
    onNavigate(id);
  };

  const handleClose = () => {
    if (dirty && !window.confirm(DISCARD_PROMPT)) return;
    onClose();
  };

  const handleSave = async () => {
    if (!draft || !dirty || saving) return;
    setSaving(true);
    try {
      const patch = buildPatch(example.type, draft);
      await withUndo('Edit example', [example.id], () => updateExample(example.id, patch));
      setDraftState((prev) =>
        prev && prev.id === example.id
          ? { ...prev, baseline: JSON.stringify(prev.draft) }
          : prev,
      );
      toast.success('Saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const revert = () => setDraftState(initDraftState(example));

  const handleDuplicate = async () => {
    if (dirty && !window.confirm(DISCARD_PROMPT)) return;
    let newId: string | null = null;
    await withUndo('Duplicate example', [], async () => {
      newId = await duplicateExample(example.id);
      return newId ? [newId] : [];
    });
    if (newId) {
      toast.success('Example duplicated');
      onNavigate?.(newId);
    }
  };

  const handleDelete = async () => {
    await withUndo('Delete example', [example.id], () => deleteExamples([example.id]));
    setConfirmOpen(false);
    toast.success('Example deleted', { description: 'Press Ctrl+Z to undo.' });
    onClose();
  };

  const addTag = () => {
    const t = tagInput.trim();
    if (!t) return;
    setTagInput('');
    if (example.tags.includes(t)) return;
    void updateExample(example.id, { tags: [...example.tags, t] });
  };

  const removeTag = (tag: string) => {
    void updateExample(example.id, { tags: example.tags.filter((x) => x !== tag) });
  };

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 's') {
      e.preventDefault();
      void handleSave();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (isEditableTarget(e.target)) return;
    if (e.key === 'j') {
      e.preventDefault();
      go(nextId);
    } else if (e.key === 'k') {
      e.preventDefault();
      go(prevId);
    }
  };

  return (
    <div
      ref={rootRef}
      className="flex h-full min-h-0 flex-col focus:outline-none"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
    >
      <div className="panel-header">
        <div className="flex min-w-0 items-center gap-2">
          <span className="tech-label">Example</span>
          <Tip label={<span className="font-mono text-[11px]">{example.id}</span>}>
            <span className="font-mono text-xs text-ink-dim">
              {example.id.slice(0, 8)}
            </span>
          </Tip>
          <TypeBadge type={example.type} />
        </div>
        <div className="flex items-center gap-0.5">
          <Tip label="Previous (k)">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              disabled={!prevId || !onNavigate}
              onClick={() => go(prevId)}
              aria-label="Previous example"
            >
              <ChevronUp />
            </Button>
          </Tip>
          <Tip label="Next (j)">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              disabled={!nextId || !onNavigate}
              onClick={() => go(nextId)}
              aria-label="Next example"
            >
              <ChevronDown />
            </Button>
          </Tip>
          <Tip label={example.flagged ? 'Remove flag' : 'Flag for review'}>
            <Button
              variant="ghost"
              size="icon"
              className={cn('h-7 w-7', example.flagged && 'text-danger hover:text-danger')}
              onClick={() => void setFlagged([example.id], !example.flagged)}
              aria-label={example.flagged ? 'Remove flag' : 'Flag example'}
            >
              <Flag className={cn(example.flagged && 'fill-current')} />
            </Button>
          </Tip>
          <Tip label={example.reviewed ? 'Mark as not reviewed' : 'Mark as reviewed'}>
            <Button
              variant="ghost"
              size="icon"
              className={cn('h-7 w-7', example.reviewed && 'text-ok hover:text-ok')}
              onClick={() => void setReviewed([example.id], !example.reviewed)}
              aria-label={example.reviewed ? 'Mark as not reviewed' : 'Mark as reviewed'}
            >
              <CheckCircle2 />
            </Button>
          </Tip>
          <Tip label="Duplicate example">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => void handleDuplicate()}
              aria-label="Duplicate example"
            >
              <Copy />
            </Button>
          </Tip>
          <Tip label="Delete example">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 hover:text-danger"
              onClick={() => setConfirmOpen(true)}
              aria-label="Delete example"
            >
              <Trash2 />
            </Button>
          </Tip>
          <Tip label="Close">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={handleClose}
              aria-label="Close inspector"
            >
              <X />
            </Button>
          </Tip>
        </div>
      </div>

      <div className="flex flex-col gap-1.5 border-b border-hairline px-3 py-2">
        <div className="flex items-center gap-2">
          <Select
            value={example.split}
            onValueChange={(v) => void setSplitForExamples([example.id], v as SplitName)}
          >
            <SelectTrigger className="h-7 w-28 px-2 text-xs" aria-label="Split">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="train">Train</SelectItem>
              <SelectItem value="validation">Validation</SelectItem>
              <SelectItem value="test">Test</SelectItem>
            </SelectContent>
          </Select>
          <Tip label="Approximate count, o200k vocabulary">
            <span className="font-mono text-xs tabular-nums text-ink-dim">
              {fmtNum(draftTokens)} tok
            </span>
          </Tip>
          <span className="ml-auto text-xs text-ink-faint">
            {fmtRelativeTime(example.updatedAt)}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {example.tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 rounded-(--radius-control) border border-hairline bg-surface-2 px-1.5 py-px font-mono text-[11px] text-ink-dim"
            >
              {tag}
              <button
                type="button"
                onClick={() => removeTag(tag)}
                aria-label={`Remove tag ${tag}`}
                className="text-ink-faint transition-colors duration-100 hover:text-danger"
              >
                <X className="size-2.5" />
              </button>
            </span>
          ))}
          <form
            className="flex items-center"
            onSubmit={(e) => {
              e.preventDefault();
              addTag();
            }}
          >
            <Input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              placeholder="Add tag"
              aria-label="Add tag"
              className="h-6 w-24 px-1.5 font-mono text-[11px]"
            />
          </form>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {draft ? (
          example.type === 'sft' ? (
            <ConversationEditor
              messages={draft.messages}
              onChange={(messages) => patchDraft({ messages })}
            />
          ) : example.type === 'preference' ? (
            <PreferenceEditor
              messages={draft.messages}
              chosen={draft.chosen}
              rejected={draft.rejected}
              onChange={patchDraft}
            />
          ) : example.type === 'kto' ? (
            <KtoEditor
              messages={draft.messages}
              completion={draft.completion}
              label={draft.label}
              onChange={patchDraft}
            />
          ) : (
            <RlEditor
              messages={draft.messages}
              answer={draft.answer}
              onChange={patchDraft}
            />
          )
        ) : (
          <div className="flex h-full items-center justify-center">
            <Spinner />
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-hairline px-3 py-2">
        {dirty && <span className="text-xs text-ink-dim">Unsaved changes</span>}
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="sm" disabled={!dirty || saving} onClick={revert}>
            Revert
          </Button>
          {dirty && (
            <span aria-hidden="true" className="size-1.5 rounded-full bg-accent" />
          )}
          <Tip label="Ctrl+S">
            <Button
              variant="solid"
              size="sm"
              disabled={!dirty || saving}
              onClick={() => void handleSave()}
            >
              <Save /> Save
            </Button>
          </Tip>
        </div>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent
          title="Delete this example?"
          description="You can undo with Ctrl+Z."
        >
          <p className="text-[13px] leading-relaxed text-ink-dim">
            This removes the example from the project.
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void handleDelete()}>
              <Trash2 /> Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
