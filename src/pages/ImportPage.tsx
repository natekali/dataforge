/**
 * Import surface — /p/:projectId/import.
 *
 * Four ways in: file upload, pasted text, Hugging Face Hub, raw documents.
 * Tab contents stay mounted (forceMount + hidden) so switching tabs never
 * loses an in-progress import. Documents parsed on the File tab hand their
 * text to the Document tab.
 */
import { useCallback, useState } from 'react';
import { useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs';
import { FileDrop } from '@/components/import/FileDrop';
import { PasteImport } from '@/components/import/PasteImport';
import { HfImport } from '@/components/import/HfImport';
import { DocumentImport } from '@/components/import/DocumentImport';

type ImportTab = 'file' | 'paste' | 'hf' | 'document';

export function ImportPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [tab, setTab] = useState<ImportTab>('file');
  const [doc, setDoc] = useState<{ text: string; title: string } | null>(null);

  const handleDocument = useCallback((d: { text: string; title: string }) => {
    setDoc(d);
    setTab('document');
    toast.info(`"${d.title}" is a document. Switched to the Document tab.`);
  }, []);

  if (!projectId) return null;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl p-6">
        <header className="animate-rise">
          <h1 className="text-base font-semibold text-ink">Import</h1>
          <p className="mt-0.5 text-xs text-ink-dim">
            Bring in examples from files, pasted text, Hugging Face or documents. Everything
            stays in this browser.
          </p>
        </header>

        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as ImportTab)}
          className="animate-rise mt-4"
          style={{ animationDelay: '40ms' }}
        >
          <TabsList>
            <TabsTrigger value="file">File</TabsTrigger>
            <TabsTrigger value="paste">Paste</TabsTrigger>
            <TabsTrigger value="hf">Hugging Face</TabsTrigger>
            <TabsTrigger value="document">Document</TabsTrigger>
          </TabsList>

          <TabsContent value="file" forceMount className="mt-4 data-[state=inactive]:hidden">
            <FileDrop projectId={projectId} onDocument={handleDocument} />
          </TabsContent>
          <TabsContent value="paste" forceMount className="mt-4 data-[state=inactive]:hidden">
            <PasteImport projectId={projectId} />
          </TabsContent>
          <TabsContent value="hf" forceMount className="mt-4 data-[state=inactive]:hidden">
            <HfImport projectId={projectId} />
          </TabsContent>
          <TabsContent value="document" forceMount className="mt-4 data-[state=inactive]:hidden">
            <DocumentImport projectId={projectId} doc={doc} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
