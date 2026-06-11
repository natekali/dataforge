/**
 * Settings — local storage panel: IndexedDB usage gauge, persistent-storage
 * status (with a request action when the grant is missing) and a control to
 * clear the resumable AI response cache.
 */
import { useCallback, useEffect, useState } from 'react';
import { Eraser, ShieldCheck, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import {
  db,
  estimateStorage,
  requestPersistentStorage,
  type StorageEstimate,
} from '@/lib/db';
import { fmtBytes, fmtNum } from '@/lib/utils';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Progress } from '@/components/ui/Controls';

async function readPersisted(): Promise<boolean> {
  try {
    if (navigator.storage?.persisted) return await navigator.storage.persisted();
  } catch {
    /* unsupported — treat as not persisted */
  }
  return false;
}

export function StorageSection() {
  const [estimate, setEstimate] = useState<StorageEstimate | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [clearing, setClearing] = useState(false);

  const refresh = useCallback(async () => {
    const [est, persistent] = await Promise.all([estimateStorage(), readPersisted()]);
    setEstimate(est);
    setPersisted(persistent);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleRequestPersistence(): Promise<void> {
    setRequesting(true);
    try {
      const granted = await requestPersistentStorage();
      if (granted) toast.success('Persistent storage granted');
      else toast.warning('The browser declined the persistence request');
      await refresh();
    } finally {
      setRequesting(false);
    }
  }

  async function handleClearCache(): Promise<void> {
    setClearing(true);
    try {
      const count = await db.cache.count();
      await db.cache.clear();
      toast.success(`Cleared ${fmtNum(count)} cached AI responses`);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not clear the cache');
    } finally {
      setClearing(false);
    }
  }

  return (
    <div className="panel divide-y divide-hairline">
      <div className="px-3 py-2.5">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm text-ink">IndexedDB usage</span>
          {estimate ? (
            <span className="font-mono text-[13px] tabular-nums text-ink">
              {fmtBytes(estimate.usage)}{' '}
              <span className="text-ink-faint">of {fmtBytes(estimate.quota)}</span>
            </span>
          ) : (
            <span className="text-[13px] text-ink-faint">Not available</span>
          )}
        </div>
        <Progress
          value={estimate && estimate.quota > 0 ? estimate.usage / estimate.quota : 0}
          heat={false}
          className="mt-2"
        />
      </div>

      <div className="flex items-center justify-between gap-3 px-3 py-2.5">
        <div className="min-w-0">
          <div className="text-sm text-ink">Persistence</div>
          <p className="text-[13px] text-ink-dim">
            Persistent storage stops the browser from evicting your datasets under disk
            pressure.
          </p>
        </div>
        {persisted === null ? (
          <span className="shrink-0 text-[13px] text-ink-faint">Checking…</span>
        ) : persisted ? (
          <Badge tone="ok" className="shrink-0">
            <ShieldCheck className="size-3 shrink-0" />
            Persistent
          </Badge>
        ) : (
          <div className="flex shrink-0 items-center gap-2">
            <Badge tone="warn">
              <TriangleAlert className="size-3 shrink-0" />
              Evictable
            </Badge>
            <Button onClick={() => void handleRequestPersistence()} disabled={requesting}>
              Request persistence
            </Button>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 px-3 py-2.5">
        <div className="min-w-0">
          <div className="text-sm text-ink">AI response cache</div>
          <p className="text-[13px] text-ink-dim">
            Cached generations make interrupted runs resumable. Safe to clear at any
            time.
          </p>
        </div>
        <Button
          variant="ghost"
          className="shrink-0"
          onClick={() => void handleClearCache()}
          disabled={clearing}
        >
          <Eraser /> Clear AI response cache
        </Button>
      </div>
    </div>
  );
}
