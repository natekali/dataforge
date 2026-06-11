/**
 * Document-grounded generation: turn an uploaded document into fine-tuning
 * examples (Q&A, instructions or summaries), one batch-job item per chunk.
 */
import { createExample, type ProviderConfig } from '@/engine/types';
import { chunkText, parseTextDocument } from '@/engine/importers/textdoc';
import { buildDocQaPrompt, extractStrictJson, type DocGenStyle } from './prompts';
import { parseGeneratedPairs } from './generate';
import {
  cachedChat,
  pairToMessages,
  resolveDb,
  runBatch,
  type BatchHandle,
  type ChatFn,
  type MinimalDb,
} from './runner';

export type { DocGenStyle } from './prompts';

/** Sampling temperature for document-grounded generation. */
const DOCGEN_TEMPERATURE = 0.7;

/** Options accepted by {@link generateFromDocument}. */
export interface GenerateFromDocumentOptions {
  /** Project that receives the generated examples. */
  projectId: string;
  /** Full document text (raw; normalized and chunked internally). */
  text: string;
  /** Document title recorded on every created example's meta. */
  title: string;
  /** Examples to request per chunk (>= 1). */
  questionsPerChunk: number;
  /** Output style: factual Q&A, task instructions or summarization examples. */
  style: DocGenStyle;
  /** Provider configuration for the LLM calls. */
  provider: ProviderConfig;
  /** Model id to use. */
  model: string;
  /** Optional database double (tests). */
  dbOverride?: MinimalDb;
  /** Optional chat transport override (tests). */
  chatFn?: ChatFn;
}

interface ChunkItem {
  chunk: string;
  index: number;
}

/**
 * Generate examples grounded in a document, as a persisted batch job.
 *
 * The document is normalized and split with the canonical importer chunker
 * (`chunkText` from the textdoc importer); each chunk becomes one job item
 * that requests `questionsPerChunk` strict-JSON examples grounded only in
 * that chunk. Created examples are tagged with the generator, document title,
 * style and chunk index, and their ids land on the job's `params.createdIds`.
 *
 * @throws Error synchronously when the document contains no text.
 */
export function generateFromDocument(opts: GenerateFromDocumentOptions): BatchHandle {
  const perChunk = Math.max(1, Math.floor(opts.questionsPerChunk));
  const chunks = chunkText(parseTextDocument(opts.text));
  if (chunks.length === 0) {
    throw new Error('the document contains no text to generate from');
  }

  const database = resolveDb(opts.dbOverride);
  const items: ChunkItem[] = chunks.map((chunk, index) => ({ chunk, index }));
  const createdIds: string[] = [];
  const params: Record<string, unknown> = {
    title: opts.title,
    style: opts.style,
    questionsPerChunk: perChunk,
    chunkCount: chunks.length,
    provider: opts.provider.id,
    model: opts.model,
    createdIds,
  };

  return runBatch<ChunkItem>({
    projectId: opts.projectId,
    kind: 'generate-from-document',
    items,
    params,
    dbOverride: opts.dbOverride,
    worker: async (item, signal) => {
      const pair = buildDocQaPrompt({ chunk: item.chunk, count: perChunk, style: opts.style });
      const result = await cachedChat(
        opts.provider,
        {
          model: opts.model,
          messages: pairToMessages(pair),
          temperature: DOCGEN_TEMPERATURE,
          jsonMode: true,
          signal,
        },
        database,
        opts.chatFn,
      );

      const pairs = parseGeneratedPairs(extractStrictJson(result.content));
      const examples = pairs.map((p) =>
        createExample({
          projectId: opts.projectId,
          messages: [
            { role: 'user', content: p.instruction },
            { role: 'assistant', content: p.response },
          ],
          meta: {
            generator: 'doc-qa',
            docTitle: opts.title,
            docStyle: opts.style,
            chunkIndex: item.index,
          },
        }),
      );
      await database.examples.bulkAdd(examples);
      for (const example of examples) createdIds.push(example.id);
    },
  });
}
