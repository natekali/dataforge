import { useMemo } from 'react';
import type { CSSProperties } from 'react';
import { Ban } from 'lucide-react';
import type { DatasetType, Example, ExportBundle, ExportOptions, ModelInfo } from '@/engine/types';
import { buildExportBundle, UnsupportedExportError } from '@/engine/exporters';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs';
import { cn, fmtNum } from '@/lib/utils';

const TYPE_WORD: Record<DatasetType, string> = {
  sft: 'SFT',
  preference: 'preference',
  kto: 'KTO',
  rl: 'RL',
};

/** Keep the preview DOM bounded even if a sample example is enormous. */
const MAX_PREVIEW_CHARS = 100_000;

interface PreviewState {
  bundle: ExportBundle | null;
  unsupported: UnsupportedExportError | null;
}

export interface ExportPreviewProps {
  /** Sample examples the preview bundle is built from (the page passes 3). */
  examples: Example[];
  options: ExportOptions;
  model?: ModelInfo;
  className?: string;
  style?: CSSProperties;
}

/** Live preview of the export bundle, one tab per emitted file. */
export function ExportPreview({ examples, options, model, className, style }: ExportPreviewProps) {
  const preview = useMemo<PreviewState>(() => {
    try {
      return { bundle: buildExportBundle(examples, options, model), unsupported: null };
    } catch (err) {
      if (err instanceof UnsupportedExportError) return { bundle: null, unsupported: err };
      throw err;
    }
  }, [examples, options, model]);

  const files = preview.bundle?.files ?? [];
  const pathKey = files.map((f) => f.path).join('|');

  return (
    <section className={cn('panel', className)} style={style}>
      <div className="panel-header">
        <h2 className="tech-label">Preview</h2>
        <span className="font-mono text-xs tabular-nums text-ink-faint">
          {examples.length === 1 ? 'first example' : `first ${fmtNum(examples.length)} examples`}
        </span>
      </div>
      <div className="p-3">
        {preview.unsupported !== null ? (
          <div className="flex items-center justify-center gap-2 py-8 text-[13px] text-ink-dim">
            <Ban className="size-4 shrink-0 text-warn" aria-hidden />
            <p>
              This framework cannot export {TYPE_WORD[preview.unsupported.datasetType]} datasets.
              Pick another one above.
            </p>
          </div>
        ) : (
          <Tabs key={pathKey} defaultValue={files[0]?.path}>
            <TabsList className="h-auto flex-wrap justify-start">
              {files.map((file) => (
                <TabsTrigger key={file.path} value={file.path} className="font-mono text-xs">
                  {file.path}
                </TabsTrigger>
              ))}
            </TabsList>
            {files.map((file) => (
              <TabsContent key={file.path} value={file.path} className="mt-2">
                {typeof file.content === 'string' ? (
                  <pre className="max-h-96 overflow-auto whitespace-pre rounded-(--radius-control) border border-hairline bg-surface-2 p-3 font-mono text-xs leading-relaxed text-ink-dim">
                    {file.content.length > MAX_PREVIEW_CHARS
                      ? `${file.content.slice(0, MAX_PREVIEW_CHARS)}\n… preview truncated`
                      : file.content}
                  </pre>
                ) : (
                  <p className="px-1 py-2 font-mono text-xs tabular-nums text-ink-faint">
                    binary file, {fmtNum(file.content.byteLength)} bytes
                  </p>
                )}
              </TabsContent>
            ))}
          </Tabs>
        )}
      </div>
    </section>
  );
}
