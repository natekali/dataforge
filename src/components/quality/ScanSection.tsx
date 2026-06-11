/**
 * Quality scan — scores every example in the worker (model-aware when the
 * project has a fine-tune target) and writes qualityScore/qualityIssues back
 * in 1k chunks. Results render from the stored fields, so they survive a
 * revisit; the freshest scan summary is preferred while live rows catch up.
 */
import { useMemo, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { CheckCircle2, Play } from 'lucide-react';

import { db } from '@/lib/db';
import { useFilteredExamples, type ExampleFilters } from '@/lib/hooks';
import { analyzeExamples } from '@/lib/workerClient';
import { cn, fmtNum } from '@/lib/utils';
import { getModel } from '@/engine/registry';
import type {
  DatasetQualitySummary,
  IssueSeverity,
  IssueType,
  Project,
} from '@/engine/types';

import { Badge, HeatBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Progress, Spinner } from '@/components/ui/Controls';

const NO_FILTERS: ExampleFilters = {};
const ALL_PAGE = { offset: 0, limit: 100_000 };
const WRITE_CHUNK = 1000;

/** Heat-tinted score buckets, cold steel to molten (matches Analytics). */
const SCORE_BUCKETS = [
  { key: 'poor', label: 'Poor', bar: 'bg-heat-cold' },
  { key: 'fair', label: 'Fair', bar: 'bg-heat-cool' },
  { key: 'good', label: 'Good', bar: 'bg-heat-warm' },
  { key: 'strong', label: 'Strong', bar: 'bg-heat-hot' },
  { key: 'excellent', label: 'Excellent', bar: 'bg-heat-molten' },
] as const;

function bucketIndex(score: number): number {
  if (score < 35) return 0;
  if (score < 55) return 1;
  if (score < 75) return 2;
  if (score < 90) return 3;
  return 4;
}

const SEVERITY_RANK: Record<IssueSeverity, number> = {
  critical: 3,
  high: 2,
  medium: 1,
  low: 0,
};

const SEVERITY_TONE: Record<IssueSeverity, 'danger' | 'warn' | 'neutral'> = {
  critical: 'danger',
  high: 'danger',
  medium: 'warn',
  low: 'neutral',
};

/** Representative severity per issue type (used when no live issue carries one). */
const FALLBACK_SEVERITY: Record<IssueType, IssueSeverity> = {
  empty_field: 'critical',
  missing_role: 'critical',
  invalid_role: 'high',
  duplicate: 'high',
  near_duplicate: 'medium',
  too_short: 'medium',
  too_long: 'high',
  context_overflow: 'critical',
  refusal_pattern: 'high',
  pii_detected: 'high',
  encoding_error: 'medium',
  imbalanced_ratio: 'medium',
  special_token_conflict: 'medium',
  malformed_tool_call: 'high',
  orphan_tool_result: 'high',
  benchmark_contamination: 'high',
  incoherent_turn_order: 'medium',
};

interface ScanStats {
  total: number;
  scored: number;
  avg: number | null;
  buckets: number[];
  issueCounts: Partial<Record<IssueType, number>>;
  severities: Map<IssueType, IssueSeverity>;
}

type ScanPhase = 'idle' | 'analyzing' | 'saving';

export function ScanSection({
  projectId,
  project,
  style,
}: {
  projectId: string;
  project: Project;
  style?: CSSProperties;
}) {
  const data = useFilteredExamples(projectId, NO_FILTERS, ALL_PAGE);
  const [phase, setPhase] = useState<ScanPhase>('idle');
  const [progress, setProgress] = useState(0);
  const [summary, setSummary] = useState<DatasetQualitySummary | null>(null);

  const model = project.targetModelId ? getModel(project.targetModelId) : undefined;

  const stats = useMemo<ScanStats>(() => {
    const rows = data?.rows ?? [];
    let scored = 0;
    let sum = 0;
    const buckets = [0, 0, 0, 0, 0];
    const issueCounts: Partial<Record<IssueType, number>> = {};
    const severities = new Map<IssueType, IssueSeverity>();
    for (const e of rows) {
      const score = e.qualityScore;
      if (score != null) {
        scored += 1;
        sum += score;
        buckets[bucketIndex(score)] += 1;
      }
      for (const issue of e.qualityIssues) {
        issueCounts[issue.type] = (issueCounts[issue.type] ?? 0) + 1;
        const prev = severities.get(issue.type);
        if (prev === undefined || SEVERITY_RANK[issue.severity] > SEVERITY_RANK[prev]) {
          severities.set(issue.type, issue.severity);
        }
      }
    }
    return {
      total: rows.length,
      scored,
      avg: scored > 0 ? sum / scored : null,
      buckets,
      issueCounts,
      severities,
    };
  }, [data]);

  const issueRows = useMemo(() => {
    const counts = summary?.issueCounts ?? stats.issueCounts;
    return (Object.entries(counts) as [IssueType, number][])
      .filter(([, count]) => count > 0)
      .map(([type, count]) => ({
        type,
        count,
        severity: stats.severities.get(type) ?? FALLBACK_SEVERITY[type],
      }))
      .sort(
        (a, b) =>
          SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || b.count - a.count,
      );
  }, [summary, stats]);

  async function runScan(): Promise<void> {
    if (phase !== 'idle') return;
    setPhase('analyzing');
    const toastId = toast.loading('Scanning examples…');
    try {
      const examples = await db.examples.where('projectId').equals(projectId).toArray();
      if (examples.length === 0) {
        toast.error('No examples to scan.', { id: toastId });
        return;
      }
      toast.loading(`Analyzing ${fmtNum(examples.length)} examples…`, { id: toastId });
      const result = await analyzeExamples(examples, model);

      setPhase('saving');
      setProgress(0);
      // Partial updates only: writing full rows captured before the (long)
      // analysis would clobber edits made meanwhile. Derived metadata also
      // must not bump updatedAt — these are not user edits.
      for (let i = 0; i < examples.length; i += WRITE_CHUNK) {
        const slice = examples.slice(i, i + WRITE_CHUNK);
        await db.examples.bulkUpdate(
          slice.map((e, j) => ({
            key: e.id,
            changes: {
              qualityScore: result.reports[i + j]?.score ?? null,
              qualityIssues: result.reports[i + j]?.issues ?? [],
            },
          })),
        );
        setProgress(Math.min(1, (i + slice.length) / examples.length));
      }
      setSummary(result.summary);
      toast.success(`Scored ${fmtNum(examples.length)} examples`, { id: toastId });
    } catch (err) {
      toast.error(`Scan failed: ${err instanceof Error ? err.message : String(err)}`, {
        id: toastId,
      });
    } finally {
      setPhase('idle');
    }
  }

  const busy = phase !== 'idle';

  return (
    <section className="panel animate-rise" style={style}>
      <div className="panel-header">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <h2 className="tech-label">Quality scan</h2>
          <span className="truncate text-xs text-ink-faint">
            {model ? (
              <>
                Validating against {model.name}, seq len{' '}
                <span className="font-mono tabular-nums">
                  {fmtNum(model.recommendedSeqLen)}
                </span>
              </>
            ) : (
              'No target model set. Context checks skipped.'
            )}
          </span>
        </div>
        <Button variant="solid" size="sm" onClick={() => void runScan()} disabled={busy}>
          {busy ? (
            <Spinner className="size-3.5 border-accent-ink/30 border-t-accent-ink" />
          ) : (
            <Play />
          )}
          {phase === 'analyzing' ? 'Analyzing' : phase === 'saving' ? 'Saving' : 'Run scan'}
        </Button>
      </div>

      {phase === 'saving' && (
        <div className="flex items-center gap-2 border-b border-hairline px-3 py-2">
          <Progress value={progress} className="flex-1" />
          <span className="w-10 text-right font-mono text-xs tabular-nums text-ink-faint">
            {Math.round(progress * 100)}%
          </span>
        </div>
      )}

      {stats.scored === 0 ? (
        <p className="px-3 py-6 text-center text-[13px] text-ink-faint">
          No scores yet. Run a scan to grade every example.
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-4 p-3 sm:flex-row">
            <div className="flex shrink-0 flex-col gap-1.5 sm:w-44">
              <span className="tech-label">Avg score</span>
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-[28px] font-medium leading-none tabular-nums text-ink">
                  {stats.avg == null ? '—' : stats.avg.toFixed(1)}
                </span>
                <HeatBadge score={stats.avg} />
              </div>
              <span className="font-mono text-xs tabular-nums text-ink-faint">
                {fmtNum(stats.scored)} of {fmtNum(stats.total)} scored
              </span>
            </div>

            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <span className="tech-label">Distribution</span>
              <div
                className="flex h-2 w-full overflow-hidden rounded-full bg-surface-3"
                role="img"
                aria-label={`Score distribution: ${SCORE_BUCKETS.map(
                  (b, i) => `${stats.buckets[i]} ${b.label.toLowerCase()}`,
                ).join(', ')}`}
              >
                {SCORE_BUCKETS.map(
                  (b, i) =>
                    stats.buckets[i] > 0 && (
                      <div
                        key={b.key}
                        className={b.bar}
                        style={{ width: `${(stats.buckets[i] / stats.scored) * 100}%` }}
                      />
                    ),
                )}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {SCORE_BUCKETS.map((b, i) => (
                  <span key={b.key} className="flex items-center gap-1.5">
                    <span className={cn('size-2 rounded-[2px]', b.bar)} aria-hidden="true" />
                    <span className="text-xs text-ink-dim">{b.label}</span>
                    <span className="font-mono text-xs tabular-nums text-ink-faint">
                      {fmtNum(stats.buckets[i])}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          </div>

          {issueRows.length === 0 ? (
            <p className="flex items-center gap-1.5 border-t border-hairline px-3 py-2.5 text-[13px] text-ok">
              <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
              No issues found.
            </p>
          ) : (
            <table className="w-full border-t border-hairline text-left">
              <thead>
                <tr className="border-b border-hairline">
                  <th className="tech-label px-3 py-1.5 font-medium">Issue type</th>
                  <th className="tech-label py-1.5 font-medium">Severity</th>
                  <th className="tech-label py-1.5 text-right font-medium">Count</th>
                  <th className="px-3 py-1.5" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {issueRows.map((row) => (
                  <tr key={row.type} className="border-b border-hairline last:border-b-0">
                    <td className="px-3 py-1.5 font-mono text-[13px] text-ink">{row.type}</td>
                    <td className="py-1.5">
                      <Badge tone={SEVERITY_TONE[row.severity]}>{row.severity}</Badge>
                    </td>
                    <td className="py-1.5 text-right font-mono text-[13px] tabular-nums text-ink">
                      {fmtNum(row.count)}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <Link
                        to="../data?issues=1"
                        className="font-mono text-xs text-accent hover:underline"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  );
}
