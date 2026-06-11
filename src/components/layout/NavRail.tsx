/**
 * 52px icon rail on the left edge of the workbench. Fixed width with
 * right-side tooltips (no expand-on-hover — steadier under the pointer).
 * Active page = 2px amber edge bar + amber icon.
 */
import { Link, NavLink } from 'react-router-dom';
import {
  ChartColumn,
  FolderInput,
  House,
  PackageOpen,
  Settings,
  ShieldCheck,
  Sparkles,
  Table2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Tip } from '@/components/ui/Tooltip';
import { BrandMark } from '@/components/layout/SiteHeader';
import { cn } from '@/lib/utils';

const PAGES: { to: string; label: string; icon: LucideIcon }[] = [
  { to: 'data', label: 'Data', icon: Table2 },
  { to: 'import', label: 'Import', icon: FolderInput },
  { to: 'generate', label: 'Generate', icon: Sparkles },
  { to: 'quality', label: 'Quality', icon: ShieldCheck },
  { to: 'analytics', label: 'Analytics', icon: ChartColumn },
  { to: 'export', label: 'Export', icon: PackageOpen },
];

const ITEM =
  'relative flex h-9 w-full items-center justify-center transition-colors duration-100';

export function NavRail() {
  return (
    <nav
      aria-label="Workbench"
      className="flex w-[52px] shrink-0 flex-col border-r border-hairline bg-surface"
    >
      <Link
        to="/"
        aria-label="DataForge Studio: all projects"
        className="flex h-11 w-full shrink-0 items-center justify-center border-b border-hairline transition-colors duration-100 hover:bg-surface-2"
      >
        <BrandMark className="size-5" />
      </Link>

      <div className="flex flex-1 flex-col gap-0.5 py-2">
        {PAGES.map((page) => (
          <Tip key={page.to} label={page.label} side="right">
            <NavLink
              to={page.to}
              aria-label={page.label}
              className={({ isActive }) =>
                cn(ITEM, isActive ? 'text-accent' : 'text-ink-dim hover:text-ink')
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <span
                      aria-hidden="true"
                      className="absolute inset-y-1.5 left-0 w-0.5 bg-accent"
                    />
                  )}
                  <page.icon className="size-4" aria-hidden="true" />
                </>
              )}
            </NavLink>
          </Tip>
        ))}
      </div>

      <div className="flex flex-col gap-0.5 border-t border-hairline py-2">
        <Tip label="Home" side="right">
          <Link to="/" aria-label="Home" className={cn(ITEM, 'text-ink-dim hover:text-ink')}>
            <House className="size-4" aria-hidden="true" />
          </Link>
        </Tip>
        <Tip label="Settings" side="right">
          <Link
            to="/settings"
            aria-label="Settings"
            className={cn(ITEM, 'text-ink-dim hover:text-ink')}
          >
            <Settings className="size-4" aria-hidden="true" />
          </Link>
        </Tip>
      </div>
    </nav>
  );
}
