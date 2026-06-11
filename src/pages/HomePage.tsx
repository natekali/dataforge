/**
 * Home — the project launcher. Hero wordmark, storage-persistence banner,
 * project grid, and entry points for new/demo projects.
 */
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Anvil, FlaskConical, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { DEFAULT_MODEL_ID } from '@/engine/registry';
import { bulkAddExamples } from '@/lib/db';
import { buildDemoExamples } from '@/lib/demoData';
import { useProjectCounts, useProjects } from '@/lib/hooks';
import { createProject } from '@/lib/mutations';
import { fmtNum } from '@/lib/utils';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { NewProjectDialog } from '@/components/home/NewProjectDialog';
import { ProjectCard } from '@/components/home/ProjectCard';
import { StorageBanner } from '@/components/home/StorageBanner';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Controls';
import { EmptyState } from '@/components/ui/EmptyState';

export function HomePage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const projects = useProjects();
  const counts = useProjectCounts();
  const [newOpen, setNewOpen] = useState(false);
  const [creatingDemo, setCreatingDemo] = useState(false);

  // Deep link: /#/?new=1 opens the create dialog (used by the shell + docs).
  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setNewOpen(true);
      const next = new URLSearchParams(searchParams);
      next.delete('new');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const totalExamples = counts
    ? Object.values(counts).reduce((sum, n) => sum + n, 0)
    : undefined;

  const loadDemo = async () => {
    if (creatingDemo) return;
    setCreatingDemo(true);
    try {
      const project = await createProject({
        name: 'Demo: DataForge tour',
        description:
          'A guided sample covering SFT, DPO, KTO and RL examples. Reasoning traces and tool calls included.',
        datasetType: 'sft',
        targetModelId: DEFAULT_MODEL_ID,
      });
      await bulkAddExamples(buildDemoExamples(project.id));
      toast.success('Demo project ready');
      navigate(`/p/${project.id}/data`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create the demo project');
      setCreatingDemo(false);
    }
  };

  const actionButtons = (
    <>
      <Button variant="solid" onClick={() => setNewOpen(true)} disabled={creatingDemo}>
        <Plus /> New project
      </Button>
      <Button variant="outline" onClick={loadDemo} disabled={creatingDemo}>
        {creatingDemo ? <Spinner /> : <FlaskConical />} Load demo project
      </Button>
    </>
  );

  return (
    <div className="min-h-screen">
      <SiteHeader />

      <main className="mx-auto w-full max-w-5xl space-y-5 px-4 pb-16 pt-5">
        <StorageBanner />

        <section className="texture-brushed animate-rise rounded-(--radius-panel) border border-hairline px-6 py-10 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">DataForge Studio</h1>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-dim">
            The fine-tuning dataset workbench. 100% local. Your data never leaves this browser.
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-(--radius-control) border border-hairline bg-surface/70 px-2.5 py-1">
              <span className="tech-label">Projects</span>
              <span className="font-mono text-[13px] tabular-nums text-ink">
                {fmtNum(projects?.length)}
              </span>
            </span>
            <span className="inline-flex items-center gap-2 rounded-(--radius-control) border border-hairline bg-surface/70 px-2.5 py-1">
              <span className="tech-label">Examples</span>
              <span className="font-mono text-[13px] tabular-nums text-ink">
                {fmtNum(totalExamples)}
              </span>
            </span>
          </div>
        </section>

        {projects && projects.length === 0 ? (
          <EmptyState
            icon={Anvil}
            title="Forge your first dataset"
            description="Create a project or load the demo to start building instruction, preference and RL training data, entirely in your browser."
            className="animate-rise"
            action={<div className="flex flex-wrap items-center justify-center gap-2">{actionButtons}</div>}
          />
        ) : projects ? (
          <section className="animate-rise space-y-3" aria-label="Projects">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="tech-label">Projects · {fmtNum(projects.length)}</h2>
              <div className="flex items-center gap-2">{actionButtons}</div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {projects.map((p, i) => (
                <div
                  key={p.id}
                  className="animate-rise"
                  style={{ animationDelay: `${Math.min(i, 9) * 35}ms` }}
                >
                  <ProjectCard project={p} exampleCount={counts?.[p.id]} />
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </main>

      <NewProjectDialog open={newOpen} onOpenChange={setNewOpen} />
    </div>
  );
}
