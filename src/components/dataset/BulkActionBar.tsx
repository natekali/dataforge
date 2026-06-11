/**
 * Bulk operations over the grid selection. Every mutation is wrapped in
 * withUndo so Ctrl+Z restores the previous state; deletes confirm first.
 */
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { CheckCheck, Flag, FlagOff, Tag, Trash2 } from 'lucide-react';
import type { SplitName } from '@/engine/types';
import {
  addTagToExamples,
  deleteExamples,
  setFlagged,
  setReviewed,
  setSplitForExamples,
} from '@/lib/mutations';
import { useUiStore } from '@/lib/store';
import { withUndo } from '@/lib/undo';
import { fmtNum } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select';

function Divider() {
  return <div aria-hidden="true" className="mx-1 h-4 w-px bg-hairline" />;
}

export function BulkActionBar() {
  const selection = useUiStore((s) => s.selection);
  const clearSelection = useUiStore((s) => s.clearSelection);
  const ids = useMemo(() => [...selection], [selection]);
  const n = ids.length;
  const noun = n === 1 ? 'example' : 'examples';

  const [tag, setTag] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<void>): Promise<void> {
    if (busy || n === 0) return;
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Bulk operation failed');
    } finally {
      setBusy(false);
    }
  }

  const applySplit = (value: string) =>
    run(async () => {
      const split = value as SplitName;
      await withUndo(`Set split to ${split} for ${n} ${noun}`, ids, () =>
        setSplitForExamples(ids, split),
      );
      toast.success(`Split set to ${split} for ${fmtNum(n)} ${noun}`);
    });

  const applyTag = () => {
    const t = tag.trim();
    if (!t) return;
    void run(async () => {
      await withUndo(`Tag ${n} ${noun}`, ids, () => addTagToExamples(ids, t));
      setTag('');
      toast.success(`Added tag "${t}" to ${fmtNum(n)} ${noun}`);
    });
  };

  const applyFlagged = (flagged: boolean) =>
    run(async () => {
      await withUndo(`${flagged ? 'Flag' : 'Unflag'} ${n} ${noun}`, ids, () =>
        setFlagged(ids, flagged),
      );
      toast.success(`${flagged ? 'Flagged' : 'Unflagged'} ${fmtNum(n)} ${noun}`);
    });

  const applyReviewed = () =>
    run(async () => {
      await withUndo(`Mark ${n} ${noun} reviewed`, ids, () => setReviewed(ids, true));
      toast.success(`Marked ${fmtNum(n)} ${noun} as reviewed`);
    });

  const confirmDelete = () =>
    run(async () => {
      await withUndo(`Delete ${n} ${noun}`, ids, () => deleteExamples(ids));
      setConfirmOpen(false);
      clearSelection();
      toast.success(`Deleted ${fmtNum(n)} ${noun}`, {
        description: 'Press Ctrl+Z to undo.',
      });
    });

  return (
    <div
      role="toolbar"
      aria-label="Bulk actions"
      className="animate-rise flex flex-wrap items-center gap-2 border-b border-hairline bg-surface-2 px-3 py-1.5"
    >
      <span className="font-mono text-[13px] tabular-nums text-accent">{fmtNum(n)}</span>
      <span className="tech-label">selected</span>

      <Divider />

      <Select value="" onValueChange={(v) => void applySplit(v)}>
        <SelectTrigger
          className="h-7 w-28 px-2 text-xs"
          aria-label="Set split for selected examples"
          disabled={busy}
        >
          <SelectValue placeholder="Set split…" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="train">Train</SelectItem>
          <SelectItem value="validation">Validation</SelectItem>
          <SelectItem value="test">Test</SelectItem>
        </SelectContent>
      </Select>

      <form
        className="flex items-center gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          applyTag();
        }}
      >
        <Input
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          placeholder="Add tag…"
          aria-label="Tag to add to selected examples"
          className="h-7 w-28 px-2 text-xs"
          disabled={busy}
        />
        <Button size="xs" variant="ghost" type="submit" disabled={busy || tag.trim() === ''}>
          <Tag />
          Tag
        </Button>
      </form>

      <Divider />

      <Button size="xs" variant="ghost" disabled={busy} onClick={() => void applyFlagged(true)}>
        <Flag />
        Flag
      </Button>
      <Button size="xs" variant="ghost" disabled={busy} onClick={() => void applyFlagged(false)}>
        <FlagOff />
        Unflag
      </Button>
      <Button size="xs" variant="ghost" disabled={busy} onClick={() => void applyReviewed()}>
        <CheckCheck />
        Mark reviewed
      </Button>

      <Divider />

      <Button size="xs" variant="danger" disabled={busy} onClick={() => setConfirmOpen(true)}>
        <Trash2 />
        Delete
      </Button>

      <div className="ml-auto">
        <Button size="xs" variant="ghost" onClick={clearSelection}>
          Clear
        </Button>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent
          title={`Delete ${fmtNum(n)} ${noun}?`}
          description="Removed examples can be restored with Ctrl+Z."
        >
          <p className="text-[13px] leading-relaxed text-ink-dim">
            This removes{' '}
            <span className="font-mono tabular-nums text-ink">{fmtNum(n)}</span> {noun} from the
            project, including any selected rows hidden by the current filters.
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void confirmDelete()} disabled={busy}>
              <Trash2 />
              Delete {noun}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
