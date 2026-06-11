/**
 * File tab — dropzone plus per-file import pipeline.
 *
 * Each dropped file runs through the engine worker (parse → detect → convert)
 * with its phase shown inline. Row files end in an ImportPreview; documents
 * (PDF/DOCX/MD/TXT) are handed up so the page can switch to the Document tab.
 */
import { useCallback, useRef, useState } from 'react';
import type { DragEvent, KeyboardEvent } from 'react';
import { CheckCircle2, CircleAlert, CloudUpload, FileText, X } from 'lucide-react';
import type { ImportResult } from '@/engine/types';
import { importFileToProject, type ImportPhase } from '@/lib/workerClient';
import { cn, fmtBytes } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Controls';
import { ImportPreview } from './ImportPreview';

const ACCEPT_EXTENSIONS = [
  '.jsonl',
  '.ndjson',
  '.json',
  '.csv',
  '.tsv',
  '.parquet',
  '.xlsx',
  '.xls',
  '.pdf',
  '.docx',
  '.md',
  '.txt',
] as const;

const PHASE_LABELS: Record<ImportPhase, string> = {
  parsing: 'Parsing',
  detecting: 'Detecting format',
  converting: 'Converting',
};

interface FileEntry {
  id: string;
  name: string;
  size: number;
  status: 'queued' | ImportPhase | 'done' | 'failed';
  result?: ImportResult;
  error?: string;
}

export function FileDrop({
  projectId,
  onDocument,
}: {
  projectId: string;
  onDocument: (doc: { text: string; title: string }) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [dragOver, setDragOver] = useState(false);
  const [entries, setEntries] = useState<FileEntry[]>([]);

  const patchEntry = useCallback((id: string, patch: Partial<FileEntry>) => {
    setEntries((prev) => prev.map((en) => (en.id === id ? { ...en, ...patch } : en)));
  }, []);

  const removeEntry = useCallback((id: string) => {
    setEntries((prev) => prev.filter((en) => en.id !== id));
  }, []);

  const processFile = useCallback(
    async (file: File, entryId: string) => {
      try {
        const outcome = await importFileToProject(file, projectId, (phase) =>
          patchEntry(entryId, { status: phase }),
        );
        if (outcome.kind === 'document') {
          removeEntry(entryId);
          onDocument({ text: outcome.text, title: outcome.title });
        } else {
          patchEntry(entryId, { status: 'done', result: outcome.result });
        }
      } catch (err) {
        patchEntry(entryId, {
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [projectId, patchEntry, removeEntry, onDocument],
  );

  const handleFiles = useCallback(
    async (list: FileList | File[]) => {
      const files = Array.from(list);
      if (files.length === 0) return;
      const fresh: FileEntry[] = files.map((f) => ({
        id: crypto.randomUUID(),
        name: f.name,
        size: f.size,
        status: 'queued',
      }));
      setEntries((prev) => [...prev, ...fresh]);
      for (let i = 0; i < files.length; i++) {
        await processFile(files[i], fresh[i].id);
      }
    },
    [processFile],
  );

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    dragDepth.current = 0;
    setDragOver(false);
    void handleFiles(e.dataTransfer.files);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      inputRef.current?.click();
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT_EXTENSIONS.join(',')}
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          if (e.target.files) void handleFiles(e.target.files);
          e.target.value = '';
        }}
      />

      <div
        role="button"
        tabIndex={0}
        aria-label="Drop files here or click to browse"
        onClick={() => inputRef.current?.click()}
        onKeyDown={handleKeyDown}
        onDragEnter={(e) => {
          e.preventDefault();
          dragDepth.current += 1;
          setDragOver(true);
        }}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDragOver(false);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        className={cn(
          'panel flex cursor-pointer flex-col items-center gap-2 border-dashed px-6 py-12 text-center transition-colors duration-100',
          dragOver ? 'border-accent bg-ember-500/5' : 'hover:border-hairline-strong',
        )}
      >
        <CloudUpload
          className={cn('size-6', dragOver ? 'text-accent' : 'text-ink-faint')}
          aria-hidden
        />
        <p className="text-sm font-medium text-ink">Drop files here or click to browse</p>
        <p className="text-[13px] text-ink-dim">
          Multiple files allowed. Your data stays in this browser.
        </p>
      </div>

      <p className="font-mono text-[11px] tracking-wide text-ink-faint">
        {ACCEPT_EXTENSIONS.join('  ')}
      </p>

      {entries.map((entry) => (
        <div key={entry.id} className="flex flex-col gap-3">
          <div className="panel flex items-center gap-2.5 px-3 py-2">
            <FileText className="size-4 shrink-0 text-ink-faint" aria-hidden />
            <span className="min-w-0 truncate font-mono text-[13px] text-ink">{entry.name}</span>
            <span className="shrink-0 font-mono text-xs tabular-nums text-ink-faint">
              {fmtBytes(entry.size)}
            </span>
            <span className="ml-auto flex min-w-0 shrink-0 items-center gap-1.5">
              {entry.status === 'queued' && (
                <span className="text-xs text-ink-faint">Queued</span>
              )}
              {(entry.status === 'parsing' ||
                entry.status === 'detecting' ||
                entry.status === 'converting') && (
                <>
                  <Spinner className="size-3.5" />
                  <span className="text-xs text-ink-dim">{PHASE_LABELS[entry.status]}</span>
                </>
              )}
              {entry.status === 'done' && (
                <>
                  <CheckCircle2 className="size-4 text-ok" aria-hidden />
                  <span className="text-xs text-ok">Ready</span>
                </>
              )}
              {entry.status === 'failed' && (
                <>
                  <CircleAlert className="size-4 shrink-0 text-danger" aria-hidden />
                  <span className="max-w-72 truncate text-xs text-danger" title={entry.error}>
                    {entry.error ?? 'Import failed'}
                  </span>
                </>
              )}
            </span>
            {(entry.status === 'failed' || entry.status === 'done') && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                aria-label={`Remove ${entry.name}`}
                onClick={() => removeEntry(entry.id)}
              >
                <X />
              </Button>
            )}
          </div>
          {entry.result && (
            <ImportPreview result={entry.result} onDiscard={() => removeEntry(entry.id)} />
          )}
        </div>
      ))}
    </div>
  );
}
