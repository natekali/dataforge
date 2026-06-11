/**
 * Lazy access to the tokenizer for main-thread UI.
 *
 * The o200k rank table inside gpt-tokenizer is ~2 MB; a static import would
 * drag it into the entry bundle. UI code uses these wrappers instead, so the
 * tokenizer loads in the background on first use (and the worker keeps its
 * own copy off-thread for batch jobs).
 */
import { useEffect, useState } from 'react';
import type { Example } from '@/engine/types';

type TokensModule = typeof import('@/engine/tokens');

let modPromise: Promise<TokensModule> | null = null;

function loadTokens(): Promise<TokensModule> {
  modPromise ??= import('@/engine/tokens');
  return modPromise;
}

export async function countExampleAsync(example: Example): Promise<number> {
  return (await loadTokens()).countExample(example);
}

export async function countExamplesAsync(
  examples: Example[],
): Promise<{ total: number; perExample: number[] }> {
  return (await loadTokens()).countExamples(examples);
}

export async function countTextAsync(text: string): Promise<number> {
  return (await loadTokens()).countText(text);
}

/** Debounced live token count for an example draft. Null while computing. */
export function useExampleTokenCount(example: Example | null | undefined): number | null {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    if (!example) {
      setCount(null);
      return;
    }
    let alive = true;
    const timer = setTimeout(() => {
      void loadTokens().then((m) => {
        if (alive) setCount(m.countExample(example));
      });
    }, 150);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [example]);
  return count;
}

/** Debounced live token count for a text snippet. Null while computing. */
export function useTextTokenCount(text: string | null | undefined): number | null {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    if (text == null || text === '') {
      setCount(text === '' ? 0 : null);
      return;
    }
    let alive = true;
    const timer = setTimeout(() => {
      void loadTokens().then((m) => {
        if (alive) setCount(m.countText(text));
      });
    }, 200);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [text]);
  return count;
}
