/**
 * Project tile on the home launcher. The whole card links to the project's
 * data grid; the kebab menu carries Rename and the irreversible Delete.
 */
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Cpu, EllipsisVertical, Pencil, Trash2, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import type { Project } from '@/engine/types';
import { getModel } from '@/engine/registry';
import { deleteProjectCascade } from '@/lib/db';
import { updateProject } from '@/lib/mutations';
import { fmtNum, fmtRelativeTime } from '@/lib/utils';
import { TypeBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Controls';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/Dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu';
import { Input, Label } from '@/components/ui/Input';

export function ProjectCard({
  project,
  exampleCount,
}: {
  project: Project;
  exampleCount: number | undefined;
}) {
  const [dialog, setDialog] = useState<'rename' | 'delete' | null>(null);
  const [renameValue, setRenameValue] = useState(project.name);
  const [busy, setBusy] = useState(false);

  const modelName = project.targetModelId
    ? (getModel(project.targetModelId)?.name ?? 'No target model')
    : 'No target model';

  const handleRename = async (e: FormEvent) => {
    e.preventDefault();
    const next = renameValue.trim();
    if (!next || busy) return;
    setBusy(true);
    try {
      await updateProject(project.id, { name: next });
      toast.success('Project renamed');
      setDialog(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Rename failed');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await deleteProjectCascade(project.id);
      toast.success(`Deleted "${project.name}"`);
      setDialog(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <article className="panel group relative flex h-full flex-col gap-2 p-3 transition-colors duration-150 hover:border-hairline-strong">
        <div className="flex items-start justify-between gap-2">
          <Link
            to={`/p/${project.id}/data`}
            className="min-w-0 flex-1 outline-none after:absolute after:inset-0 after:rounded-(--radius-panel) after:content-[''] focus-visible:after:outline focus-visible:after:outline-accent"
          >
            <h3 className="truncate text-sm font-semibold text-ink transition-colors duration-100 group-hover:text-accent">
              {project.name}
            </h3>
          </Link>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="relative z-10 -mr-1 -mt-0.5"
                aria-label={`Actions for project ${project.name}`}
              >
                <EllipsisVertical />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem
                onSelect={() => {
                  setRenameValue(project.name);
                  setDialog('rename');
                }}
              >
                <Pencil /> Rename
              </DropdownMenuItem>
              <DropdownMenuItem destructive onSelect={() => setDialog('delete')}>
                <Trash2 /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <p className="line-clamp-2 min-h-8 text-[13px] leading-4 text-ink-dim">
          {project.description || <span className="italic text-ink-faint">No description</span>}
        </p>

        <div className="flex min-w-0 items-center gap-2">
          <TypeBadge type={project.datasetType} />
          <span className="inline-flex min-w-0 items-center gap-1 rounded-(--radius-control) border border-hairline px-1.5 py-px text-[11px] text-ink-dim">
            <Cpu className="size-3.5 shrink-0 text-ink-faint" aria-hidden="true" />
            <span className="truncate">{modelName}</span>
          </span>
        </div>

        <div className="mt-auto flex items-center justify-between border-t border-hairline pt-2">
          <span className="font-mono text-xs tabular-nums text-ink">
            {fmtNum(exampleCount)} <span className="text-ink-faint">examples</span>
          </span>
          <span className="font-mono text-[11px] tabular-nums text-ink-faint">
            {fmtRelativeTime(project.updatedAt)}
          </span>
        </div>
      </article>

      <Dialog open={dialog === 'rename'} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent title="Rename project">
          <form onSubmit={handleRename}>
            <Label htmlFor={`rename-${project.id}`}>Project name</Label>
            <Input
              id={`rename-${project.id}`}
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              maxLength={120}
              required
            />
            <DialogFooter>
              <Button variant="ghost" onClick={() => setDialog(null)} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" variant="solid" disabled={!renameValue.trim() || busy}>
                Rename
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === 'delete'} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent title="Delete project" description="This action is irreversible.">
          <div className="flex items-start gap-2.5 rounded-(--radius-control) border border-danger/40 bg-danger/10 px-3 py-2.5">
            <TriangleAlert className="mt-px size-4 shrink-0 text-danger" aria-hidden="true" />
            <p className="text-[13px] leading-relaxed text-ink">
              Permanently delete <span className="font-semibold">{project.name}</span>
              {exampleCount ? (
                <>
                  {' '}
                  and its <span className="font-mono tabular-nums">{fmtNum(exampleCount)}</span>{' '}
                  examples
                </>
              ) : null}
              . This cannot be undone.
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialog(null)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleDelete} disabled={busy}>
              {busy ? <Spinner /> : <Trash2 />} Delete project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
