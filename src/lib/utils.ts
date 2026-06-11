import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const NUM_FMT = new Intl.NumberFormat('en-US');

/** 12480 → "12,480" — every count in the app goes through this. */
export function fmtNum(n: number | null | undefined): string {
  return n == null ? '—' : NUM_FMT.format(n);
}

/** 131072 → "128K" context-length style formatting. */
export function fmtCtx(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1024) return `${Math.round(n / 1024)}K`;
  return String(n);
}

export function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

export function fmtRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

/** Quality score (0–100) → forge heat color classes. Cold steel = poor, molten = excellent. */
export function heatClasses(score: number | null | undefined): string {
  if (score == null) return 'text-ink-faint border-hairline';
  if (score >= 90) return 'text-heat-white border-heat-molten/50 bg-heat-hot/10';
  if (score >= 75) return 'text-heat-molten border-heat-hot/40 bg-heat-hot/5';
  if (score >= 55) return 'text-heat-warm border-heat-warm/40';
  if (score >= 35) return 'text-heat-cool border-heat-cool/40';
  return 'text-heat-cold border-heat-cold/40';
}
