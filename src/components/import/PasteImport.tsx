/**
 * Paste tab — parse pasted JSONL / JSON / CSV text into rows, then run the
 * worker's detect + convert pipeline and preview the result.
 */
import { useState } from 'react';
import { toast } from 'sonner';
import { ClipboardPaste } from 'lucide-react';
import type { ImportResult } from '@/engine/types';
import { getEngineWorker } from '@/lib/workerClient';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Controls';
import { ImportPreview } from './ImportPreview';

/** Copy a string into a standalone ArrayBuffer for worker transfer. */
function textToBuffer(text: string): ArrayBuffer {
  const bytes = new TextEncoder().encode(text);
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

interface ParsedRows {
  rows: unknown[];
  /** Per-line parse failures (JSONL mode), surfaced in the preview. */
  errors: string[];
}

/**
 * Client-side row extraction: JSONL lines first, then a JSON array/object,
 * then CSV via the worker parser when the text looks delimited.
 */
async function parseRows(text: string): Promise<ParsedRows> {
  const trimmed = text.trim();
  const lines = trimmed
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  // JSONL: most non-empty lines are standalone JSON objects. A few bad lines
  // must not demote the whole paste to CSV; they are skipped and reported.
  if (lines.length > 1 && lines.some((l) => l.startsWith('{'))) {
    const rows: unknown[] = [];
    const errors: string[] = [];
    lines.forEach((line, i) => {
      try {
        rows.push(JSON.parse(line) as unknown);
      } catch {
        errors.push(`Line ${i + 1} is not valid JSON and was skipped.`);
      }
    });
    if (rows.length * 2 >= lines.length) return { rows, errors };
  }

  // Whole-text JSON: array of rows or a single object.
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return { rows: parsed, errors: [] };
    if (parsed !== null && typeof parsed === 'object') return { rows: [parsed], errors: [] };
  } catch {
    // Not JSON — fall through.
  }

  // CSV/TSV: needs a delimiter on the header line and at least one data row.
  if (lines.length > 1 && /[,\t;]/.test(lines[0])) {
    const parsed = await getEngineWorker().parseFile({
      name: 'pasted.csv',
      data: textToBuffer(trimmed),
    });
    if (parsed.kind === 'rows' && parsed.rows.length > 0) {
      return { rows: parsed.rows, errors: [] };
    }
  }

  throw new Error('Could not parse this. Paste JSONL, a JSON array, or CSV.');
}

export function PasteImport({ projectId }: { projectId: string }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  async function handleImport() {
    if (busy || !text.trim()) return;
    setBusy(true);
    try {
      const { rows, errors } = await parseRows(text);
      const api = getEngineWorker();
      const schema = await api.detect(rows);
      const converted = await api.convert(rows, schema, projectId);
      setResult(
        errors.length > 0
          ? { ...converted, errors: [...errors, ...converted.errors] }
          : converted,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (result) setResult(null);
        }}
        placeholder={'Paste JSONL, a JSON array, or CSV.\n{"messages":[{"role":"user","content":"…"}]}'}
        aria-label="Pasted data"
        className="h-64 font-mono text-[13px] leading-relaxed"
        spellCheck={false}
        disabled={busy}
      />
      <div className="flex items-center gap-2">
        <Button variant="solid" size="sm" onClick={handleImport} disabled={busy || !text.trim()}>
          {busy ? (
            <Spinner className="border-accent-ink/30 border-t-accent-ink" />
          ) : (
            <ClipboardPaste />
          )}
          Parse and preview
        </Button>
        {text.trim() && !busy && (
          <Button variant="ghost" size="sm" onClick={() => setText('')}>
            Clear
          </Button>
        )}
      </div>
      {result && <ImportPreview result={result} onDiscard={() => setResult(null)} />}
    </div>
  );
}
