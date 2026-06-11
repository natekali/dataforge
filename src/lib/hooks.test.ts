/**
 * The review-order comparator must be stable across saves and flags:
 * createdAt desc (new imports land on top), id as deterministic tiebreaker,
 * and updatedAt must play no part (it bumps on every edit).
 */
import { describe, expect, it } from 'vitest';
import { compareExamples } from '@/lib/hooks';
import { createExample } from '@/engine/types';
import type { Example } from '@/engine/types';

function ex(partial: Partial<Example>): Example {
  return createExample({
    projectId: 'p1',
    messages: [{ role: 'user', content: 'hi' }],
    ...partial,
  });
}

describe('compareExamples', () => {
  it('orders by createdAt desc', () => {
    const older = ex({ id: 'a', createdAt: 1000, updatedAt: 1000 });
    const newer = ex({ id: 'b', createdAt: 2000, updatedAt: 2000 });
    expect([older, newer].sort(compareExamples).map((e) => e.id)).toEqual(['b', 'a']);
  });

  it('ignores updatedAt, so editing a row does not move it', () => {
    const edited = ex({ id: 'a', createdAt: 1000, updatedAt: 9999 });
    const untouched = ex({ id: 'b', createdAt: 2000, updatedAt: 2000 });
    expect([edited, untouched].sort(compareExamples).map((e) => e.id)).toEqual(['b', 'a']);
  });

  it('breaks createdAt ties by id for a deterministic order', () => {
    const rows = [
      ex({ id: 'c', createdAt: 1000 }),
      ex({ id: 'a', createdAt: 1000 }),
      ex({ id: 'b', createdAt: 1000 }),
    ];
    expect(rows.sort(compareExamples).map((e) => e.id)).toEqual(['a', 'b', 'c']);
    // Stable regardless of input order.
    expect(rows.reverse().sort(compareExamples).map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });
});
