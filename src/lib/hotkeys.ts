/**
 * Global keyboard shortcuts, bound once by App:
 *   Ctrl/Cmd+K            → toggle command palette (works everywhere)
 *   Ctrl/Cmd+Z            → undo   (suppressed inside editable fields)
 *   Ctrl/Cmd+Shift+Z / +Y → redo   (suppressed inside editable fields)
 */
import { useEffect } from 'react';
import { toast } from 'sonner';
import { useUiStore } from '@/lib/store';
import { redo, undo } from '@/lib/undo';

function isEditableTarget(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return el instanceof HTMLElement && el.isContentEditable;
}

export function useGlobalHotkeys(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      // Skip Alt combinations so AltGr (Ctrl+Alt on Windows) typing is untouched.
      if (!mod || e.altKey) return;
      const key = e.key.toLowerCase();

      // Palette toggle stays global, even while typing in a field.
      if (key === 'k') {
        e.preventDefault();
        const { commandPaletteOpen, setCommandPaletteOpen } = useUiStore.getState();
        setCommandPaletteOpen(!commandPaletteOpen);
        return;
      }

      // Inside inputs/textareas/contenteditable, leave native text undo alone.
      if (isEditableTarget(document.activeElement)) return;

      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        void undo().then((label) => {
          if (label) toast(`Undid: ${label}`);
        });
        return;
      }
      if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault();
        void redo().then((label) => {
          if (label) toast(`Redid: ${label}`);
        });
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
