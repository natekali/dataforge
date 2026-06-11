/**
 * /settings — workbench configuration, outside the project shell.
 * Sections: AI providers (BYOK), storage, backup, danger zone, appearance,
 * about. All data lives in this browser; nothing is sent anywhere except the
 * provider the user explicitly calls.
 */
import { ExternalLink } from 'lucide-react';
import type { ReactNode } from 'react';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { PROVIDERS } from '@/lib/providers';
import { useProviderConfigs } from '@/lib/hooks';
import { useUiStore } from '@/lib/store';
import { Badge } from '@/components/ui/Badge';
import { Spinner, Switch } from '@/components/ui/Controls';
import { ProviderCard } from '@/components/settings/ProviderCard';
import { StorageSection } from '@/components/settings/StorageSection';
import { BackupSection, DangerZone } from '@/components/settings/BackupSection';

const ADAPTERS = Object.values(PROVIDERS);

function Section({
  kicker,
  title,
  intro,
  children,
}: {
  kicker: string;
  title: string;
  intro?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <header>
        <p className="tech-label">{kicker}</p>
        <h2 className="mt-0.5 text-sm font-semibold text-ink">{title}</h2>
        {intro && <p className="mt-1 text-xs text-ink-dim">{intro}</p>}
      </header>
      {children}
    </section>
  );
}

export function SettingsPage() {
  const configs = useProviderConfigs();
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);

  return (
    <div className="min-h-screen bg-bg">
      <SiteHeader />
      <main className="mx-auto max-w-3xl space-y-8 p-6 animate-rise">
        <header>
          <p className="tech-label">Workbench configuration</p>
          <h1 className="mt-0.5 text-lg font-semibold text-ink">Settings</h1>
        </header>

        <Section
          kicker="Byok"
          title="AI Providers"
          intro="Bring your own keys. They are stored only in this browser (IndexedDB) and sent only to the provider you call."
        >
          {configs === undefined ? (
            <div className="panel flex items-center gap-2 px-3 py-4 text-xs text-ink-dim">
              <Spinner /> Loading provider configuration…
            </div>
          ) : (
            <div className="space-y-3">
              {ADAPTERS.map((adapter) => (
                <ProviderCard
                  key={adapter.id}
                  adapter={adapter}
                  initial={configs.find((c) => c.id === adapter.id)}
                />
              ))}
            </div>
          )}
        </Section>

        <Section kicker="Local data" title="Storage">
          <StorageSection />
        </Section>

        <Section kicker="Portability" title="Backup">
          <BackupSection />
        </Section>

        <Section kicker="Irreversible" title="Danger zone">
          <DangerZone />
        </Section>

        <Section kicker="Interface" title="Appearance">
          <div className="panel flex items-center justify-between gap-3 px-3 py-2.5">
            <div>
              <label htmlFor="light-theme" className="text-[13px] text-ink">
                Light theme
              </label>
              <p className="text-xs text-ink-dim">
                Workshop daylight. The Forge defaults to dark.
              </p>
            </div>
            <Switch
              id="light-theme"
              checked={theme === 'light'}
              onCheckedChange={(checked) => setTheme(checked ? 'light' : 'dark')}
            />
          </div>
        </Section>

        <Section kicker="DataForge Studio" title="About">
          <div className="panel divide-y divide-hairline">
            <div className="flex items-center justify-between gap-3 px-3 py-2.5">
              <span className="text-[13px] text-ink">DataForge Studio</span>
              <Badge tone="neutral">v2.0.0</Badge>
            </div>
            <p className="px-3 py-2.5 text-xs text-ink-dim">
              100% client-side: datasets, settings and API keys never leave this
              browser.
            </p>
            <div className="flex items-center justify-between gap-3 px-3 py-2.5">
              <a
                href="https://github.com/natekali/dataforge"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-accent hover:underline"
              >
                GitHub repository <ExternalLink className="size-3" />
              </a>
              <span className="text-xs text-ink-faint">
                Built with the Forge design system
              </span>
            </div>
          </div>
        </Section>
      </main>
    </div>
  );
}
