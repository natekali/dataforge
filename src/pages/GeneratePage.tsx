/**
 * Generate workbench — /p/:projectId/generate.
 *
 * Four AI sections stacked in one scroll column: synthetic data, enhancement,
 * preference pairs and LLM judging. One ProviderSelection chosen at the top
 * (sticky panel) powers every section; each section resolves its own targets
 * with TargetPicker and reports through a shared JobProgress readout.
 */
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  ProviderModelPicker,
  type ProviderSelection,
} from '@/components/shared/ProviderModelPicker';
import { SyntheticSection } from '@/components/generate/SyntheticSection';
import { EnhanceSection } from '@/components/generate/EnhanceSection';
import { PreferenceSection } from '@/components/generate/PreferenceSection';
import { JudgeSection } from '@/components/generate/JudgeSection';

export function GeneratePage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [provider, setProvider] = useState<ProviderSelection | null>(null);

  if (!projectId) return null;

  let riseIdx = 0;
  const rise = () => ({ animationDelay: `${riseIdx++ * 40}ms` });

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-4xl flex-col gap-4 p-6">
        <header className="animate-rise" style={rise()}>
          <h1 className="text-lg font-semibold text-ink">Generate</h1>
          <p className="mt-0.5 text-[13px] text-ink-dim">
            Synthetic data, enhancement, preference pairs and judging. Calls go straight from
            this browser to your provider.
          </p>
        </header>

        <div className="animate-rise sticky top-0 z-20 -my-2 bg-bg py-2" style={rise()}>
          <section className="panel">
            <div className="panel-header">
              <h2 className="tech-label">Model</h2>
              <span className="text-xs text-ink-faint">Used by every section below.</span>
            </div>
            <div className="p-3">
              <ProviderModelPicker value={provider} onChange={setProvider} />
            </div>
          </section>
        </div>

        <div className="animate-rise" style={rise()}>
          <SyntheticSection projectId={projectId} provider={provider} />
        </div>
        <div className="animate-rise" style={rise()}>
          <EnhanceSection projectId={projectId} provider={provider} />
        </div>
        <div className="animate-rise" style={rise()}>
          <PreferenceSection projectId={projectId} provider={provider} />
        </div>
        <div className="animate-rise" style={rise()}>
          <JudgeSection projectId={projectId} provider={provider} />
        </div>
      </div>
    </div>
  );
}
