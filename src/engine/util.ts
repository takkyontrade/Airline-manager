import type { GameState, NewsItem } from './types';

export function rng(seed: number) {
  // mulberry32
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Result = { ok: true; state: GameState } | { ok: false; error: string };
export const fail = (error: string): Result => ({ ok: false, error });
export const ok = (state: GameState): Result => ({ ok: true, state });

export function nextId(s: GameState, prefix: string): [string, GameState] {
  return [`${prefix}${s.nextId}`, { ...s, nextId: s.nextId + 1 }];
}

export function withNews(s: GameState, text: string, kind: NewsItem['kind'] = 'info'): GameState {
  return { ...s, news: [...s.news, { year: s.year, month: s.month, kind, text }].slice(-300) };
}

export function formatYen(v: number): string {
  const sign = v < 0 ? '-' : '';
  const a = Math.abs(v);
  if (a >= 1e8) return `${sign}${(a / 1e8).toFixed(a >= 1e10 ? 0 : 2)}億円`;
  if (a >= 1e4) return `${sign}${Math.round(a / 1e4).toLocaleString('ja-JP')}万円`;
  return `${sign}${Math.round(a).toLocaleString('ja-JP')}円`;
}

/** Record a cost paid immediately in cash so it appears in this month's P&L */
export function spend(s: GameState, kind: 'training' | 'heavyChecks' | 'marketing', amount: number): GameState {
  const e = s.monthExpenses ?? {};
  return { ...s, cash: s.cash - amount, monthExpenses: { ...e, [kind]: (e[kind] ?? 0) + amount } };
}
