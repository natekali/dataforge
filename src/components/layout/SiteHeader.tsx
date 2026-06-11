/**
 * Slim top bar for the non-project pages (Home, Settings).
 * Also exports the shared brand + GitHub marks used by the workbench chrome.
 */
import { Link, NavLink } from 'react-router-dom';
import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Tip } from '@/components/ui/Tooltip';
import { useUiStore } from '@/lib/store';
import { cn } from '@/lib/utils';

export const GITHUB_URL = 'https://github.com/natekali/dataforge';

/** The DataForge anvil glyph (same paths as public/favicon.svg, transparent bg). */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true" focusable="false">
      <path
        d="M7 12h18c0 3-3 5-7 5h-1v4h3v3H12v-3h3v-4h-2c-4 0-6-2-6-5z"
        fill="var(--color-accent)"
      />
      <circle cx="24.5" cy="8.5" r="1.6" fill="var(--color-heat-white)" />
      <circle cx="20.5" cy="6.5" r="1" fill="var(--color-heat-molten)" />
    </svg>
  );
}

/** GitHub octocat mark (lucide no longer ships brand icons). */
export function GitHubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

function navLinkClass(isActive: boolean): string {
  return cn(
    'rounded-(--radius-control) px-2.5 py-1 text-[13px] font-medium transition-colors duration-100',
    isActive ? 'text-accent' : 'text-ink-dim hover:bg-surface-3 hover:text-ink',
  );
}

export function SiteHeader() {
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const themeLabel = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';

  return (
    <header className="flex h-11 shrink-0 items-center justify-between border-b border-hairline bg-surface px-4">
      <Link to="/" className="flex items-center gap-2" aria-label="DataForge Studio home">
        <BrandMark className="size-5" />
        <span className="text-sm font-semibold tracking-tight text-ink">DataForge Studio</span>
        <span className="tech-label mt-px">v2</span>
      </Link>

      <nav aria-label="Primary" className="flex items-center gap-0.5">
        <NavLink to="/" end className={({ isActive }) => navLinkClass(isActive)}>
          Projects
        </NavLink>
        <NavLink to="/settings" className={({ isActive }) => navLinkClass(isActive)}>
          Settings
        </NavLink>
        <div className="mx-1.5 h-4 w-px bg-hairline" aria-hidden="true" />
        <Tip label={themeLabel}>
          <Button
            variant="ghost"
            size="icon"
            aria-label={themeLabel}
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            {theme === 'dark' ? <Sun /> : <Moon />}
          </Button>
        </Tip>
        <Tip label="View source on GitHub">
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="DataForge on GitHub"
            className="flex size-8 items-center justify-center rounded-(--radius-control) text-ink-dim transition-colors duration-100 hover:bg-surface-3 hover:text-ink"
          >
            <GitHubMark className="size-4" />
          </a>
        </Tip>
      </nav>
    </header>
  );
}
