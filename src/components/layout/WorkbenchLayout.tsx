/**
 * The frame every project page lives in: NavRail on the left, TopBar above,
 * page content in a no-overflow main region (pages own their own scroll).
 */
import { useEffect } from 'react';
import { Link, Outlet, useParams } from 'react-router-dom';
import { CircleAlert } from 'lucide-react';
import { buttonVariants } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Controls';
import { EmptyState } from '@/components/ui/EmptyState';
import { NavRail } from '@/components/layout/NavRail';
import { TopBar } from '@/components/layout/TopBar';
import { useProject, useProjects } from '@/lib/hooks';
import { useUndoStore } from '@/lib/undo';

export function WorkbenchLayout() {
  const { projectId } = useParams<{ projectId: string }>();
  const projects = useProjects();
  const project = useProject(projectId);

  // Undo history must never cross projects: clear it when the project
  // changes and when the workbench unmounts.
  useEffect(() => {
    return () => useUndoStore.getState().clear();
  }, [projectId]);

  // Projects are loaded and the id is not among them → friendly dead end.
  if (projects && !projects.some((p) => p.id === projectId)) {
    return (
      <div className="flex h-screen items-center justify-center p-6">
        <EmptyState
          icon={CircleAlert}
          title="Project not found"
          description="This project does not exist in this browser's local storage. It may have been deleted, or the link came from a different machine."
          action={
            <Link to="/" className={buttonVariants({ variant: 'solid', size: 'sm' })}>
              Back to projects
            </Link>
          }
          className="w-full max-w-md animate-rise"
        />
      </div>
    );
  }

  // Dexie live queries still resolving on first paint.
  if (!project) {
    return (
      <div className="flex h-screen items-center justify-center" aria-busy="true">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <NavRail />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar project={project} />
        <main className="min-h-0 flex-1 overflow-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
