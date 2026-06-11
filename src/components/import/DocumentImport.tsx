/**
 * Document tab — turn unstructured text into training examples.
 *
 * Receives text/title from the File tab (PDF/DOCX/MD/TXT uploads) or via its
 * own paste box. Existing Q&A structure can be imported directly; otherwise
 * an LLM generates grounded examples per chunk as a cancellable batch job.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { CheckCircle2, FileQuestion, Sparkles } from 'lucide-react';
import type { ImportResult } from '@/engine/types';
import { chunkText, extractQAPairs, parseTextDocument } from '@/engine/importers/textdoc';
import { generateFromDocument, type DocGenStyle } from '@/lib/ai/docgen';
import type { BatchHandle } from '@/lib/ai/runner';
import { getEngineWorker } from '@/lib/workerClient';
import { useActiveJobs } from '@/lib/hooks';
import { fmtNum } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Input, Label, Textarea } from '@/components/ui/Input';
import { Progress, Spinner } from '@/components/ui/Controls';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select';
import {
  ProviderModelPicker,
  type ProviderSelection,
} from '@/components/shared/ProviderModelPicker';
import { ImportPreview } from './ImportPreview';

const STYLE_LABELS: Record<DocGenStyle, string> = {
  qa: 'Q&A',
  instruction: 'Instruction',
  summary: 'Summary',
};

const PER_CHUNK_OPTIONS = ['1', '2', '3', '4', '5'] as const;

interface RunSummary {
  status: 'completed' | 'failed' | 'cancelled';
  created: number;
  error?: string;
}

export function DocumentImport({
  projectId,
  doc,
}: {
  projectId: string;
  doc: { text: string; title: string } | null;
}) {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [perChunk, setPerChunk] = useState('3');
  const [style, setStyle] = useState<DocGenStyle>('qa');
  const [selection, setSelection] = useState<ProviderSelection | null>(null);
  const [pairsBusy, setPairsBusy] = useState(false);
  const [pairsResult, setPairsResult] = useState<ImportResult | null>(null);
  const [handle, setHandle] = useState<BatchHandle | null>(null);
  const [lastRun, setLastRun] = useState<RunSummary | null>(null);

  // Adopt a document handed over from the File tab.
  useEffect(() => {
    if (!doc) return;
    setText(doc.text);
    setTitle(doc.title);
    setPairsResult(null);
    setLastRun(null);
  }, [doc]);

  const normalized = useMemo(() => parseTextDocument(text), [text]);
  const chunks = useMemo(() => (normalized ? chunkText(normalized) : []), [normalized]);
  const qaPairs = useMemo(() => (normalized ? extractQAPairs(normalized) : []), [normalized]);

  const activeJobs = useActiveJobs(projectId);
  const job = handle ? activeJobs?.find((j) => j.id === handle.jobId) : undefined;

  const perChunkNum = Number(perChunk);
  const running = handle !== null;

  async function handleImportPairs() {
    if (pairsBusy || qaPairs.length === 0) return;
    setPairsBusy(true);
    try {
      const api = getEngineWorker();
      const schema = await api.detect(qaPairs);
      setPairsResult(await api.convert(qaPairs, schema, projectId));
    } catch (err) {
      toast.error(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setPairsBusy(false);
    }
  }

  function handleGenerate() {
    if (running || !normalized || !selection?.model) return;
    setLastRun(null);
    try {
      const batch = generateFromDocument({
        projectId,
        text: normalized,
        title: title.trim() || 'Untitled document',
        questionsPerChunk: perChunkNum,
        style,
        provider: selection.config,
        model: selection.model,
      });
      setHandle(batch);
      void batch.promise.then((final) => {
        setHandle(null);
        const created = Array.isArray(final.params.createdIds)
          ? final.params.createdIds.length
          : 0;
        if (final.status === 'completed') {
          setLastRun({ status: 'completed', created });
          toast.success(`Created ${fmtNum(created)} examples`, {
            action: { label: 'View data', onClick: () => navigate('../data') },
          });
        } else if (final.status === 'cancelled') {
          setLastRun({ status: 'cancelled', created });
          toast.info(`Generation cancelled. ${fmtNum(created)} examples were kept.`);
        } else {
          setLastRun({ status: 'failed', created, error: final.error });
          toast.error(final.error ? `Generation failed: ${final.error}` : 'Generation failed');
        }
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label htmlFor="doc-title">Title</Label>
        <Input
          id="doc-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Document title"
          disabled={running}
        />
      </div>
      <div>
        <Label htmlFor="doc-text">Document text</Label>
        <Textarea
          id="doc-text"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setPairsResult(null);
          }}
          placeholder="Paste document text here, or drop a PDF, DOCX, MD or TXT file on the File tab."
          className="h-48 font-mono text-[13px] leading-relaxed"
          spellCheck={false}
          disabled={running}
        />
        <p className="mt-1 font-mono text-xs tabular-nums text-ink-faint">
          {fmtNum(normalized.length)} characters · {fmtNum(chunks.length)} chunks
        </p>
      </div>

      {qaPairs.length > 0 && (
        <div className="panel flex items-center gap-2.5 px-3 py-2">
          <FileQuestion className="size-4 shrink-0 text-info" aria-hidden />
          <span className="text-[13px] text-ink">
            Found <span className="font-mono tabular-nums">{fmtNum(qaPairs.length)}</span> Q&amp;A
            pairs in this document.
          </span>
          <Button
            variant="outline"
            size="xs"
            className="ml-auto shrink-0"
            onClick={handleImportPairs}
            disabled={pairsBusy || running}
          >
            {pairsBusy && <Spinner className="size-3.5" />}
            Import them directly
          </Button>
        </div>
      )}

      {pairsResult && (
        <ImportPreview result={pairsResult} onDiscard={() => setPairsResult(null)} />
      )}

      <section className="panel" aria-label="Generate examples with AI">
        <div className="panel-header">
          <h3 className="tech-label">Generate with AI</h3>
          <span className="font-mono text-xs tabular-nums text-ink-faint">
            up to {fmtNum(chunks.length * perChunkNum)} examples
          </span>
        </div>
        <div className="flex flex-col gap-3 p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Questions per chunk</Label>
              <Select value={perChunk} onValueChange={setPerChunk} disabled={running}>
                <SelectTrigger aria-label="Questions per chunk">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PER_CHUNK_OPTIONS.map((n) => (
                    <SelectItem key={n} value={n}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Style</Label>
              <Select
                value={style}
                onValueChange={(v) => setStyle(v as DocGenStyle)}
                disabled={running}
              >
                <SelectTrigger aria-label="Generation style">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(STYLE_LABELS) as DocGenStyle[]).map((s) => (
                    <SelectItem key={s} value={s}>
                      {STYLE_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <ProviderModelPicker value={selection} onChange={setSelection} />

          {running ? (
            <div className="flex items-center gap-3">
              <Spinner className="size-4 shrink-0" />
              <Progress value={job?.progress ?? 0} className="min-w-0 flex-1" />
              <span className="shrink-0 font-mono text-xs tabular-nums text-ink-dim">
                {job?.detail ?? 'Starting…'}
              </span>
              <Button variant="ghost" size="sm" onClick={() => handle?.cancel()}>
                Cancel
              </Button>
            </div>
          ) : (
            <div>
              <Button
                variant="solid"
                size="sm"
                onClick={handleGenerate}
                disabled={!normalized || !selection?.model}
              >
                <Sparkles />
                Generate
              </Button>
            </div>
          )}

          {lastRun?.status === 'completed' && (
            <p className="flex items-center gap-1.5 text-[13px] text-ok">
              <CheckCircle2 className="size-4 shrink-0" aria-hidden />
              Created <span className="font-mono tabular-nums">{fmtNum(lastRun.created)}</span>{' '}
              examples.
              <Link to="../data" className="text-accent hover:underline">
                View data
              </Link>
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
