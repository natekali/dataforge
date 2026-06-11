/**
 * Warns when IndexedDB storage is best-effort (evictable — Safari purges
 * after 7 idle days). Shown on the home page until the user enables
 * persistence or dismisses it; dismissal is remembered in db.settings.
 */
import { useEffect, useState } from 'react';
import { TriangleAlert, X } from 'lucide-react';
import { toast } from 'sonner';
import { db, requestPersistentStorage } from '@/lib/db';
import { useSetting } from '@/lib/hooks';
import { Button } from '@/components/ui/Button';

const DISMISS_KEY = 'storage-banner-dismissed';

export function StorageBanner() {
  const dismissed = useSetting<boolean>(DISMISS_KEY, false);
  /** null = still checking; banner only renders once we know it is false. */
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [requesting, setRequesting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const granted = navigator.storage?.persisted
          ? await navigator.storage.persisted()
          : false;
        if (!cancelled) setPersisted(granted);
      } catch {
        if (!cancelled) setPersisted(false);
      }
    };
    void check();
    return () => {
      cancelled = true;
    };
  }, []);

  if (dismissed !== false || persisted !== false) return null;

  const enable = async () => {
    setRequesting(true);
    try {
      const granted = await requestPersistentStorage();
      if (granted) {
        setPersisted(true);
        toast.success('Persistent storage enabled. Your datasets are safe from eviction.');
      } else {
        toast.warning('The browser declined persistent storage. It may grant it after more use of this site.');
      }
    } finally {
      setRequesting(false);
    }
  };

  const dismiss = () => {
    void db.settings.put({ key: DISMISS_KEY, value: true });
  };

  return (
    <div
      role="status"
      className="animate-rise flex items-center gap-2.5 rounded-(--radius-panel) border border-warn/40 bg-warn/10 px-3 py-2"
    >
      <TriangleAlert className="size-4 shrink-0 text-warn" aria-hidden="true" />
      <p className="flex-1 text-[13px] text-ink">
        Browser storage is not persistent. Your datasets could be evicted.
      </p>
      <Button size="xs" variant="outline" className="shrink-0" onClick={enable} disabled={requesting}>
        Enable persistence
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7 shrink-0"
        onClick={dismiss}
        aria-label="Dismiss storage warning"
      >
        <X />
      </Button>
    </div>
  );
}
