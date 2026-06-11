import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  BarChart3,
  Brain,
  Calculator,
  CheckCircle2,
  Flag,
  Gauge,
  Upload,
  Wrench,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { db } from '@/lib/db';
import { useFilteredExamples, type ExampleFilters } from '@/lib/hooks';
import { countTokensFor } from '@/lib/workerClient';
import { cn, fmtNum } from '@/lib/utils';
import { DATASET_TYPES, SPLITS } from '@/engine/types';
import type { DatasetType, Message, SplitName } from '@/engine/types';

import { Button, buttonVariants } from '@/components/ui/Button';
import { HeatBadge, TypeBadge } from '@/components/ui/Badge';
import { Progress, Spinner } from '@/components/ui/Controls';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatCard } from '@/components/analytics/StatCard';
import { BarList, type BarListItem } from '@/components/analytics/BarList';
import { Histogram, type HistogramBucket } from '@/components/analytics/Histogram';

const NO_FILTERS: ExampleFilters = {};
const PAGE = { offset: 0, limit: 100000 };

const ROLE_ORDER = ['system', 'developer', 'user', 'assistant', 'tool'] as const;

const TOKEN_BUCKETS: { label: string; max: number }[] = [
  { label: '0-256', max: 256 },
  { label: '257-512', max: 512 },
  { label: '513-1k', max: 1024 },
  { label: '1k-2k', max: 2048 },
  { label: '2k-4k', max: 4096 },
  { label: '4k-8k', max: 8192 },
  { label: '8k+', max: Infinity },
];

/** Heat-tinted score buckets, cold steel → molten (index-aligned with stats). */
const QUALITY_BUCKETS = [
  { key: 'poor', label: 'Poor', range: '<35', barClassName: 'bg-heat-cold' },
  { key: 'fair', label: 'Fair', range: '35-55', barClassName: 'bg-heat-cool' },
  { key: 'good', label: 'Good', range: '55-75', barClassName: 'bg-heat-warm' },
  { key: 'strong', label: 'Strong', range: '75-90', barClassName: 'bg-heat-hot' },
  { key: 'excellent', label: 'Excellent', range: '90+', barClassName: 'bg-heat-molten' },
] as const;

/** Bar colors matching the TypeBadge tones. */
const TYPE_BAR: Record<DatasetType, string> = {
  sft: 'bg-info',
  preference: 'bg-ember-500',
  kto: 'bg-warn',
  rl: 'bg-ok',
};

interface PageStats {
  count: number;
  totalTokens: number;
  tokenized: number;
  untokenized: number;
  avgTurns: number;
  totalMessages: number;
  scored: number;
  avgScore: number | null;
  byType: Record<DatasetType, number>;
  bySplit: Record<SplitName, number>;
  roleCounts: Record<string, number>;
  histogram: HistogramBucket[];
  withReasoning: number;
  withToolCalls: number;
  reviewed: number;
  flagged: number;
  qualityBuckets: number[];
  topTags: { tag: string; count: number }[];
  uniqueTags: number;
}

function pctLabel(n: number, total: number): string {
  if (total === 0 || n === 0) return '0%';
  const p = (n / total) * 100;
  if (p < 1) return '<1%';
  if (p > 99 && n < total) return '99%';
  return `${Math.round(p)}%`;
}

export function AnalyticsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const data = useFilteredExamples(projectId, NO_FILTERS, PAGE);
  const [computing, setComputing] = useState(false);

  const stats = useMemo<PageStats>(() => {
    const rows = data?.rows ?? [];
    const byType: Record<DatasetType, number> = { sft: 0, preference: 0, kto: 0, rl: 0 };
    const bySplit: Record<SplitName, number> = { train: 0, validation: 0, test: 0 };
    const roleCounts: Record<string, number> = {};
    const histogram: HistogramBucket[] = TOKEN_BUCKETS.map((b) => ({
      label: b.label,
      count: 0,
    }));
    const qualityBuckets = [0, 0, 0, 0, 0];
    const tagCounts = new Map<string, number>();
    let totalTokens = 0;
    let tokenized = 0;
    let totalMessages = 0;
    let scored = 0;
    let scoreSum = 0;
    let withReasoning = 0;
    let withToolCalls = 0;
    let reviewed = 0;
    let flagged = 0;

    for (const e of rows) {
      byType[e.type] += 1;
      bySplit[e.split] += 1;
      totalMessages += e.messages.length;
      if (e.reviewed) reviewed += 1;
      if (e.flagged) flagged += 1;

      let hasReasoning = false;
      let hasToolCalls = false;
      const scan = (msgs: Message[] | undefined) => {
        if (!msgs) return;
        for (const m of msgs) {
          roleCounts[m.role] = (roleCounts[m.role] ?? 0) + 1;
          if (m.reasoning) hasReasoning = true;
          if (m.toolCalls && m.toolCalls.length > 0) hasToolCalls = true;
        }
      };
      scan(e.messages);
      scan(e.chosen);
      scan(e.rejected);
      scan(e.completion);
      if (hasReasoning) withReasoning += 1;
      if (hasToolCalls) withToolCalls += 1;

      const tc = e.tokenCount;
      if (tc != null) {
        tokenized += 1;
        totalTokens += tc;
        const idx = TOKEN_BUCKETS.findIndex((b) => tc <= b.max);
        histogram[idx === -1 ? TOKEN_BUCKETS.length - 1 : idx].count += 1;
      }

      const score = e.qualityScore;
      if (score != null) {
        scored += 1;
        scoreSum += score;
        const qi = score < 35 ? 0 : score < 55 ? 1 : score < 75 ? 2 : score < 90 ? 3 : 4;
        qualityBuckets[qi] += 1;
      }

      for (const t of e.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
    }

    const topTags = [...tagCounts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
      .slice(0, 12);

    return {
      count: rows.length,
      totalTokens,
      tokenized,
      untokenized: rows.length - tokenized,
      avgTurns: rows.length ? totalMessages / rows.length : 0,
      totalMessages,
      scored,
      avgScore: scored ? scoreSum / scored : null,
      byType,
      bySplit,
      roleCounts,
      histogram,
      withReasoning,
      withToolCalls,
      reviewed,
      flagged,
      qualityBuckets,
      topTags,
      uniqueTags: tagCounts.size,
    };
  }, [data]);

  async function handleComputeTokens() {
    if (computing || !data) return;
    const targets = data.rows.filter((e) => e.tokenCount == null);
    if (targets.length === 0) return;
    setComputing(true);
    const toastId = toast.loading(`Counting tokens for ${fmtNum(targets.length)} examples…`);
    try {
      const CHUNK = 1000;
      let done = 0;
      for (let i = 0; i < targets.length; i += CHUNK) {
        const slice = targets.slice(i, i + CHUNK);
        const counts = await countTokensFor(slice);
        // Partial updates only: full-row writes would clobber edits made while
        // counting runs, and derived metadata must not bump updatedAt.
        await db.examples.bulkUpdate(
          slice.map((e, j) => ({ key: e.id, changes: { tokenCount: counts[j] ?? null } })),
        );
        done += slice.length;
        toast.loading(`Counting tokens… ${fmtNum(done)} / ${fmtNum(targets.length)}`, {
          id: toastId,
        });
      }
      toast.success(`Tokenized ${fmtNum(targets.length)} examples`, { id: toastId });
    } catch (err) {
      toast.error(
        `Token counting failed: ${err instanceof Error ? err.message : String(err)}`,
        { id: toastId },
      );
    } finally {
      setComputing(false);
    }
  }

  if (!data) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-5" />
      </div>
    );
  }

  if (data.projectTotal === 0) {
    return (
      <div className="flex h-full items-center justify-center overflow-y-auto p-6">
        <EmptyState
          icon={BarChart3}
          title="Nothing to measure yet"
          description="Analytics light up once the dataset has examples. Import a file to see composition, token telemetry and coverage."
          action={
            <Link to="../import" className={cn(buttonVariants({ variant: 'solid', size: 'sm' }))}>
              <Upload />
              Import data
            </Link>
          }
          className="w-full max-w-xl"
        />
      </div>
    );
  }

  const typeItems: BarListItem[] = DATASET_TYPES.map((t) => ({
    key: t,
    label: <TypeBadge type={t} />,
    value: stats.byType[t],
    barClassName: TYPE_BAR[t],
  }));

  const splitItems: BarListItem[] = SPLITS.map((s) => ({
    key: s,
    label: <span className="font-mono text-xs uppercase tracking-wide">{s}</span>,
    value: stats.bySplit[s],
  }));

  const roleItems: BarListItem[] = ROLE_ORDER.filter(
    (r) => (stats.roleCounts[r] ?? 0) > 0,
  ).map((r) => ({
    key: r,
    label: <span className="font-mono text-xs">{r}</span>,
    value: stats.roleCounts[r],
  }));

  const qualityItems: BarListItem[] = QUALITY_BUCKETS.map((b, i) => ({
    key: b.key,
    label: (
      <span className="flex items-baseline gap-1.5">
        <span className="text-[13px] text-ink-dim">{b.label}</span>
        <span className="font-mono text-[11px] tabular-nums text-ink-faint">{b.range}</span>
      </span>
    ),
    value: stats.qualityBuckets[i],
    barClassName: b.barClassName,
  }));

  const tagItems: BarListItem[] = stats.topTags.map((t) => ({
    key: t.tag,
    label: <span className="truncate font-mono text-xs text-ink-dim">{t.tag}</span>,
    value: t.count,
  }));

  const coverage: { icon: LucideIcon; label: string; count: number }[] = [
    { icon: Brain, label: 'Reasoning traces', count: stats.withReasoning },
    { icon: Wrench, label: 'Tool calls', count: stats.withToolCalls },
    { icon: CheckCircle2, label: 'Reviewed', count: stats.reviewed },
    { icon: Flag, label: 'Flagged', count: stats.flagged },
    { icon: Gauge, label: 'Quality scored', count: stats.scored },
  ];

  const tokenSub =
    stats.untokenized > 0 ? (
      <>
        <span className="font-mono tabular-nums">{fmtNum(stats.untokenized)} untokenized</span>
        <Button variant="solid" size="xs" onClick={handleComputeTokens} disabled={computing}>
          {computing ? (
            <Spinner className="size-3.5 border-accent-ink/30 border-t-accent-ink" />
          ) : (
            <Calculator />
          )}
          Compute tokens
        </Button>
      </>
    ) : (
      <span className="font-mono tabular-nums">
        avg {fmtNum(stats.tokenized ? Math.round(stats.totalTokens / stats.tokenized) : null)} /
        example
      </span>
    );

  const scoredSub =
    stats.scored > 0 ? (
      <>
        <span>avg</span>
        <HeatBadge score={stats.avgScore} />
        <span className="font-mono tabular-nums text-ink-faint">
          {fmtNum(stats.scored)}/{fmtNum(stats.count)}
        </span>
      </>
    ) : (
      <span>not scored yet</span>
    );

  let riseIdx = 0;
  const rise = () => ({ animationDelay: `${riseIdx++ * 40}ms` });

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-4 p-6">
        <header className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-ink">Analytics</h1>
            <p className="mt-0.5 text-[13px] text-ink-dim">
              Composition, token telemetry and coverage for this dataset.
            </p>
          </div>
          {data.total > stats.count && (
            <p className="font-mono text-xs tabular-nums text-ink-faint">
              measuring first {fmtNum(stats.count)} of {fmtNum(data.total)}
            </p>
          )}
        </header>

        {/* 1 — stat readouts */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard
            className="animate-rise"
            style={rise()}
            label="Examples"
            value={fmtNum(stats.count)}
            sub={
              <span className="font-mono tabular-nums">
                {fmtNum(stats.bySplit.train)} train · {fmtNum(stats.bySplit.validation)} val ·{' '}
                {fmtNum(stats.bySplit.test)} test
              </span>
            }
          />
          <StatCard
            className="animate-rise"
            style={rise()}
            label="Total tokens"
            value={stats.tokenized > 0 ? fmtNum(stats.totalTokens) : '—'}
            sub={tokenSub}
          />
          <StatCard
            className="animate-rise"
            style={rise()}
            label="Avg turns"
            value={stats.avgTurns.toFixed(1)}
            sub={
              <span className="font-mono tabular-nums">
                {fmtNum(stats.totalMessages)} messages total
              </span>
            }
          />
          <StatCard
            className="animate-rise"
            style={rise()}
            label="Scored"
            value={pctLabel(stats.scored, stats.count)}
            sub={scoredSub}
          />
        </div>

        {/* 2 — composition */}
        <div className="grid gap-4 md:grid-cols-3">
          <section className="panel animate-rise" style={rise()}>
            <div className="panel-header">
              <h2 className="tech-label">By type</h2>
            </div>
            <div className="p-3">
              <BarList items={typeItems} />
            </div>
          </section>
          <section className="panel animate-rise" style={rise()}>
            <div className="panel-header">
              <h2 className="tech-label">By split</h2>
            </div>
            <div className="p-3">
              <BarList items={splitItems} />
            </div>
          </section>
          <section className="panel animate-rise" style={rise()}>
            <div className="panel-header">
              <h2 className="tech-label">Roles</h2>
            </div>
            <div className="p-3">
              {roleItems.length > 0 ? (
                <BarList items={roleItems} />
              ) : (
                <p className="py-2 text-[13px] text-ink-faint">No messages yet.</p>
              )}
            </div>
          </section>
        </div>

        {/* 3 — token histogram */}
        <section className="panel animate-rise" style={rise()}>
          <div className="panel-header">
            <h2 className="tech-label">Token distribution</h2>
            <span className="font-mono text-xs tabular-nums text-ink-faint">
              {fmtNum(stats.tokenized)} of {fmtNum(stats.count)} tokenized
            </span>
          </div>
          <div className="p-4">
            {stats.tokenized > 0 ? (
              <Histogram buckets={stats.histogram} />
            ) : (
              <p className="py-8 text-center text-[13px] text-ink-faint">
                No token counts yet. Run "Compute tokens" above to populate the histogram.
              </p>
            )}
          </div>
        </section>

        {/* 4 + 5 — coverage & quality distribution */}
        <div className="grid gap-4 md:grid-cols-2">
          <section
            className={cn('panel animate-rise', stats.scored === 0 && 'md:col-span-2')}
            style={rise()}
          >
            <div className="panel-header">
              <h2 className="tech-label">Coverage</h2>
            </div>
            <div className="flex flex-col gap-2.5 p-3">
              {coverage.map(({ icon: Icon, label, count }) => (
                <div key={label} className="flex items-center gap-3">
                  <Icon className="size-4 shrink-0 text-ink-faint" aria-hidden />
                  <span className="w-28 shrink-0 text-[13px] text-ink-dim">{label}</span>
                  <Progress
                    value={stats.count ? count / stats.count : 0}
                    className="min-w-0 flex-1"
                  />
                  <span className="w-10 shrink-0 text-right font-mono text-[13px] tabular-nums text-ink">
                    {pctLabel(count, stats.count)}
                  </span>
                  <span className="w-24 shrink-0 text-right font-mono text-xs tabular-nums text-ink-faint">
                    {fmtNum(count)}/{fmtNum(stats.count)}
                  </span>
                </div>
              ))}
            </div>
          </section>

          {stats.scored > 0 && (
            <section className="panel animate-rise" style={rise()}>
              <div className="panel-header">
                <h2 className="tech-label">Quality distribution</h2>
                <span className="flex items-center gap-1.5 text-xs text-ink-faint">
                  avg <HeatBadge score={stats.avgScore} />
                </span>
              </div>
              <div className="p-3">
                <BarList items={qualityItems} labelClassName="w-32" />
              </div>
            </section>
          )}
        </div>

        {/* 6 — top tags */}
        {tagItems.length > 0 && (
          <section className="panel animate-rise" style={rise()}>
            <div className="panel-header">
              <h2 className="tech-label">Top tags</h2>
              <span className="font-mono text-xs tabular-nums text-ink-faint">
                {fmtNum(stats.uniqueTags)} unique
              </span>
            </div>
            <div className="p-3">
              <BarList items={tagItems} labelClassName="w-44" />
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
