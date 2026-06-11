/**
 * Settings — backup & restore, plus the danger zone.
 *
 * Backups are plain JSON: { version: 2, exportedAt, projects, examples,
 * providers (API keys stripped), settings }. Restore merges by id (bulkPut)
 * behind a confirm dialog; the example merge is undoable via withUndo.
 */
import { useRef, useState, type ChangeEvent } from 'react';
import { Download, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import type { Example, Project, ProviderConfig } from '@/engine/types';
import { db, type SettingEntry } from '@/lib/db';
import { withUndo } from '@/lib/undo';
import { fmtNum } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogClose, DialogContent, DialogFooter } from '@/components/ui/Dialog';
import { Input, Label } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Controls';

/** Provider rows travel without their API keys. */
type BackupProvider = Omit<ProviderConfig, 'apiKey'> & { apiKey?: string };

interface ParsedBackup {
  projects: Project[];
  examples: Example[];
  providers: BackupProvider[];
  settings: SettingEntry[];
}

/** Keep only array entries that are objects carrying a string `key` field. */
function rowsWithKey<T>(value: unknown, key: string): T[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (row): row is T =>
      typeof row === 'object' &&
      row !== null &&
      typeof (row as Record<string, unknown>)[key] === 'string',
  );
}

function dateStamp(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-(--radius-control) border border-hairline bg-surface-2 px-2 py-1.5">
      <div className="tech-label">{label}</div>
      <div className="font-mono text-sm tabular-nums text-ink">{fmtNum(value)}</div>
    </div>
  );
}

export function BackupSection() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [building, setBuilding] = useState(false);
  const [pending, setPending] = useState<ParsedBackup | null>(null);
  const [restoring, setRestoring] = useState(false);

  async function downloadBackup(): Promise<void> {
    setBuilding(true);
    try {
      const [projects, examples, providers, settings] = await Promise.all([
        db.projects.toArray(),
        db.examples.toArray(),
        db.providers.toArray(),
        db.settings.toArray(),
      ]);
      const payload = {
        version: 2,
        exportedAt: Date.now(),
        projects,
        examples,
        // API keys never leave the browser, not even inside backups.
        providers: providers.map(({ apiKey: _apiKey, ...rest }) => rest),
        // Access tokens (e.g. hf-token) stay local for the same reason.
        settings: settings.filter((s) => !s.key.toLowerCase().includes('token')),
      };
      const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `dataforge-backup-${dateStamp()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(
        `Backup saved: ${fmtNum(projects.length)} projects, ${fmtNum(examples.length)} examples`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Backup failed');
    } finally {
      setBuilding(false);
    }
  }

  async function onFileSelected(e: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow picking the same file again
    if (!file) return;

    let raw: unknown;
    try {
      raw = JSON.parse(await file.text());
    } catch {
      toast.error('Could not read backup. The file is not valid JSON.');
      return;
    }
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      toast.error('Not a DataForge backup file');
      return;
    }
    const rec = raw as Record<string, unknown>;
    if (rec['version'] !== 2) {
      toast.error('Unsupported backup version. Expected a DataForge V2 backup.');
      return;
    }
    if (!Array.isArray(rec['projects']) || !Array.isArray(rec['examples'])) {
      toast.error('Backup is missing its projects/examples arrays');
      return;
    }
    setPending({
      projects: rowsWithKey<Project>(rec['projects'], 'id'),
      examples: rowsWithKey<Example>(rec['examples'], 'id'),
      providers: rowsWithKey<BackupProvider>(rec['providers'], 'id'),
      settings: rowsWithKey<SettingEntry>(rec['settings'], 'key'),
    });
  }

  async function restore(): Promise<void> {
    if (!pending) return;
    setRestoring(true);
    try {
      await db.projects.bulkPut(pending.projects);
      await withUndo(
        `Restore backup (${fmtNum(pending.examples.length)} examples)`,
        pending.examples.map((ex) => ex.id),
        async () => {
          await db.examples.bulkPut(pending.examples);
        },
      );
      // Backups never carry API keys — keep whatever key is already stored.
      for (const p of pending.providers) {
        const existing = await db.providers.get(p.id);
        await db.providers.put({ ...p, apiKey: p.apiKey ?? existing?.apiKey ?? '' });
      }
      if (pending.settings.length > 0) await db.settings.bulkPut(pending.settings);
      toast.success(
        `Restored ${fmtNum(pending.projects.length)} projects, ${fmtNum(pending.examples.length)} examples`,
      );
      setPending(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Restore failed');
    } finally {
      setRestoring(false);
    }
  }

  return (
    <>
      <div className="panel divide-y divide-hairline">
        <div className="flex items-center justify-between gap-3 px-3 py-2.5">
          <div className="min-w-0">
            <div className="text-sm text-ink">Full backup</div>
            <p className="text-[13px] text-ink-dim">
              Projects, examples, provider settings and app settings in one JSON file.
              API keys and access tokens are never included.
            </p>
          </div>
          <Button
            variant="solid"
            className="shrink-0"
            onClick={() => void downloadBackup()}
            disabled={building}
          >
            {building ? <Spinner /> : <Download />} Download full backup
          </Button>
        </div>

        <div className="flex items-center justify-between gap-3 px-3 py-2.5">
          <div className="min-w-0">
            <div className="text-sm text-ink">Restore</div>
            <p className="text-[13px] text-ink-dim">
              Merge a backup file into this browser's data. Rows with matching ids are
              overwritten.
            </p>
          </div>
          <Button className="shrink-0" onClick={() => fileRef.current?.click()}>
            <Upload /> Restore backup
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            aria-label="Backup file"
            onChange={(e) => void onFileSelected(e)}
          />
        </div>
      </div>

      <Dialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open && !restoring) setPending(null);
        }}
      >
        {pending && (
          <DialogContent
            title="Restore backup"
            description="Merges into your current data by id."
          >
            <p className="text-[13px] leading-relaxed text-ink-dim">
              Nothing is deleted, but existing projects, examples, provider settings and
              app settings with matching ids will be overwritten by the backup contents.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Stat label="Projects" value={pending.projects.length} />
              <Stat label="Examples" value={pending.examples.length} />
              <Stat label="Providers" value={pending.providers.length} />
              <Stat label="Settings" value={pending.settings.length} />
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="ghost" disabled={restoring}>
                  Cancel
                </Button>
              </DialogClose>
              <Button variant="solid" onClick={() => void restore()} disabled={restoring}>
                {restoring && <Spinner />} Restore
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}

export function DangerZone() {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  async function wipeEverything(): Promise<void> {
    setDeleting(true);
    try {
      window.localStorage.removeItem('dataforge-ui');
      await db.delete();
      window.location.reload();
    } catch (err) {
      setDeleting(false);
      toast.error(err instanceof Error ? err.message : 'Could not delete the database');
    }
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3 rounded-(--radius-panel) border border-danger/40 bg-danger/5 px-3 py-2.5">
        <div className="min-w-0">
          <div className="text-sm font-medium text-ink">Delete all data</div>
          <p className="text-[13px] text-ink-dim">
            Wipes every project, example, job, provider config and cached response from
            this browser. This cannot be undone.
          </p>
        </div>
        <Button
          variant="danger"
          className="shrink-0"
          onClick={() => {
            setConfirmText('');
            setOpen(true);
          }}
        >
          <Trash2 /> Delete all data
        </Button>
      </div>

      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!deleting) setOpen(o);
        }}
      >
        <DialogContent
          title="Delete all data"
          description="Permanently erases the local database."
        >
          <p className="text-[13px] leading-relaxed text-ink-dim">
            Everything DataForge has stored in this browser will be erased and the app
            will reload empty. There is no undo and no recovery. Download a backup
            first if you might need this data again.
          </p>
          <div className="mt-3">
            <Label htmlFor="confirm-delete-all">
              Type <span className="font-mono text-danger">DELETE</span> to confirm
            </Label>
            <Input
              id="confirm-delete-all"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
            />
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" disabled={deleting}>
                Cancel
              </Button>
            </DialogClose>
            <Button
              variant="danger"
              disabled={confirmText !== 'DELETE' || deleting}
              onClick={() => void wipeEverything()}
            >
              {deleting ? <Spinner /> : <Trash2 />} Delete everything
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
