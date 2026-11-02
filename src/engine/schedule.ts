// Timetables: airport hours, slots, rotation validation, the auto-scheduler
// and the delay simulation that produces on-time performance.
import { AIRPORT_BY_CODE } from '../data/airports';
import { econ, yearFrac } from '../data/economy';
import { blockHours, canFly, ISLANDS, routeDistance, turnaroundHours } from './model';
import { planeType } from './fleet';
import type { GameState, Leg, Plane, Route, SchedulePolicy } from './types';
import { fail, ok, rng, type Result } from './util';

export const DAILY = 127;
export const DAY_NAMES = ['月', '火', '水', '木', '金', '土', '日'];
export const dayCount = (mask: number) => { let n = 0; for (let i = 0; i < 7; i++) if (mask & (1 << i)) n++; return n; };

export const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.round(m % 60)).padStart(2, '0')}`;

// ---- airports: hours, congestion, slots ----------------------------------

/** Operating hours [open, close] in minutes after midnight */
export function airportHours(code: string, year: number): [number, number] {
  if (code === 'HND') return year >= 2010 ? [0, 1440] : [360, 1380];
  if (code === 'ITM') return [420, 1260];
  if (code === 'KIX') return [0, 1440];
  if (code === 'NRT') return [360, 1380];
  if (code === 'NGO') return [0, 1440];
  if (['CTS', 'FUK', 'NKM', 'OKA'].includes(code)) return [390, 1320];
  if (ISLANDS.has(code)) return [480, 1170];
  return [450, 1230];
}

/** Slot-controlled airports in a given year */
export function slotAirports(year: number): string[] {
  return year >= 1970 ? ['HND', 'ITM'] : ['HND'];
}

export const INITIAL_SLOTS: Record<string, number> = { HND: 12, ITM: 12 };

/** Extra delay probability from congestion */
function congestion(code: string, year: number): number {
  if (code === 'HND') return year < 2010 ? 0.06 : 0.04;
  if (code === 'ITM' || code === 'FUK') return 0.03;
  return 0;
}

/** Snowy airports get winter delays */
const SNOWY = new Set(['CTS', 'HKD', 'KUH', 'OBO', 'MMB', 'WKJ', 'AKJ', 'AOJ', 'MSJ', 'HNA', 'AXT', 'GAJ', 'KIJ', 'KMQ', 'TOY']);
function weather(code: string, month: number): number {
  if (SNOWY.has(code) && (month === 12 || month <= 2)) return 0.08;
  if (ISLANDS.has(code) && month >= 7 && month <= 9) return 0.05; // typhoons
  return month >= 7 && month <= 9 ? 0.02 : 0;
}

// ---- leg helpers -----------------------------------------------------------

export const legFrom = (r: Route, l: Leg) => (l.dir === 0 ? r.from : r.to);
export const legTo = (r: Route, l: Leg) => (l.dir === 0 ? r.to : r.from);

export function legMinutes(p: Plane, r: Route): number {
  return Math.round(blockHours(planeType(p), routeDistance(r.from, r.to)) * 60);
}
export const minTurnMin = (p: Plane) => Math.round(turnaroundHours(planeType(p)) * 60);

export interface LegView { leg: Leg; route: Route; from: string; to: string; dep: number; arr: number }

export function legViews(s: GameState, p: Plane): LegView[] {
  const out: LegView[] = [];
  for (const leg of [...p.schedule].sort((a, b) => a.dep - b.dep)) {
    const route = s.routes.find((r) => r.id === leg.routeId);
    if (!route) continue;
    out.push({ leg, route, from: legFrom(route, leg), to: legTo(route, leg), dep: leg.dep, arr: leg.dep + legMinutes(p, route) });
  }
  return out;
}

/** Problems with a plane's rotation (empty = valid) */
export function validateRotation(s: GameState, p: Plane, legs = p.schedule, base = p.base): string[] {
  const errs: string[] = [];
  const plane = { ...p, schedule: legs, base };
  const views = legViews(s, plane);
  let at = base;
  let ready = 0;
  for (const v of views) {
    const [open] = airportHours(v.from, s.year);
    const [, close] = airportHours(v.to, s.year);
    if (v.from !== at) errs.push(`${hhmm(v.dep)}発の便は${AIRPORT_BY_CODE[v.from].name}発ですが、機体は${AIRPORT_BY_CODE[at].name}にいます`);
    if (v.dep < ready) errs.push(`${hhmm(v.dep)}発の便は折り返し時間が足りません（${hhmm(ready)}以降）`);
    if (v.dep < open) errs.push(`${AIRPORT_BY_CODE[v.from].name}は${hhmm(open)}まで使えません`);
    if (v.arr > close) errs.push(`${AIRPORT_BY_CODE[v.to].name}の運用時間（〜${hhmm(close)}）を過ぎて到着します`);
    const check = canFly(planeType(p), v.route.from, v.route.to, s.year);
    if (!check.ok) errs.push(check.reason);
    at = v.to;
    ready = v.arr + minTurnMin(p);
  }
  if (views.length && at !== base) errs.push(`最終便が拠点（${AIRPORT_BY_CODE[base].name}）に戻っていません`);
  return errs;
}

/** Daily movements we use at each slot airport */
export function slotUsage(s: GameState, planes = s.planes): Record<string, number> {
  const use: Record<string, number> = {};
  const slotSet = new Set(slotAirports(s.year));
  for (const p of planes) {
    if (p.status === 'onOrder') continue;
    for (const leg of p.schedule) {
      const r = s.routes.find((x) => x.id === leg.routeId);
      if (!r) continue;
      for (const code of [r.from, r.to]) if (slotSet.has(code)) use[code] = (use[code] ?? 0) + 1;
    }
  }
  return use;
}

// ---- weekly route stats ----------------------------------------------------

/** Weekly departures per direction, seats and time-of-day quality for a route */
export function routeWeekly(s: GameState, route: Route, fly: Set<string>) {
  const deps = [0, 0];
  const seats = [0, 0];
  const weight = [0, 0];
  const legs: { plane: Plane; leg: Leg; perWeek: number }[] = [];
  for (const p of s.planes) {
    if (!fly.has(p.id)) continue;
    for (const leg of p.schedule) {
      if (leg.routeId !== route.id) continue;
      const n = dayCount(leg.days);
      deps[leg.dir] += n;
      seats[leg.dir] += n * planeType(p).seats;
      weight[leg.dir] += n * timeWeight(leg.dep);
      legs.push({ plane: p, leg, perWeek: n });
    }
  }
  return { deps, seats, weight, legs, roundTrips: Math.min(deps[0], deps[1]) };
}

/** How attractive a departure time is to passengers */
export function timeWeight(dep: number): number {
  const h = dep / 60;
  if (h < 6) return 0.5;
  if (h < 9) return 1.25;
  if (h < 12) return 1.0;
  if (h < 16) return 0.85;
  if (h < 20) return 1.2;
  if (h < 22) return 0.8;
  return 0.55;
}

// ---- auto scheduler ----------------------------------------------------------

export const POLICY_LABEL: Record<SchedulePolicy, string> = {
  pack: '詰めて組む',
  even: '一日に均等',
  peak: '朝夕を厚く',
  bank: 'ハブで乗り継ぎ',
};
/** Ops-planning level needed for each policy */
export const POLICY_LEVEL: Record<SchedulePolicy, number> = { pack: 0, even: 1, peak: 1, bank: 2 };
export const OPS_LEVELS = [
  { label: 'なし', monthly: 0, note: '詰めて組むだけ' },
  { label: '小', monthly: 3_000_000, note: '均等・朝夕重視が使える' },
  { label: '中', monthly: 8_000_000, note: 'ハブ乗り継ぎ型が使える・遅延が少し減る' },
  { label: '大', monthly: 15_000_000, note: '遅延がさらに減る' },
];
export const opsCostMonthly = (s: GameState) => OPS_LEVELS[s.opsLevel].monthly * econ.jpCpi(yearFrac(s.year, s.month));
export const BASE_COST_MONTHLY = 4_000_000;
export const baseCostMonthly = (s: GameState) =>
  Math.max(0, s.crewBases.length - 1) * BASE_COST_MONTHLY * econ.jpCpi(yearFrac(s.year, s.month));

/** Preferred departure times from the plane's base for a policy */
function preferredTimes(policy: SchedulePolicy, open: number, close: number, k: number): number[] {
  if (policy === 'peak') return [450, 1050, 480, 1080, 540, 1020, 600, 960, 690, 900, 780];
  if (policy === 'bank') return [480, 720, 1020, 540, 780, 1080];
  if (policy === 'even') {
    const span = close - open - 120;
    return Array.from({ length: k }, (_, i) => open + Math.round((span * (i + 0.2)) / Math.max(1, k)));
  }
  return [];
}

interface Need { route: Route; remainingWeekly: number }

/**
 * Rebuild schedules of all unlocked, delivered planes from route targets.
 * Each plane flies out-and-back trips from its base. Planes not useful for
 * any route keep an empty schedule.
 */
export function autoSchedule(s: GameState): GameState {
  const unlocked = s.planes.filter((p) => !p.locked && p.status !== 'onOrder');
  // targets minus what locked planes already fly
  const lockedPlanes = s.planes.filter((p) => p.locked);
  const needs: Need[] = s.routes.map((route) => {
    const flown = lockedPlanes.reduce((n, p) => n + p.schedule.filter((l) => l.routeId === route.id && l.dir === 0).reduce((m, l) => m + dayCount(l.days), 0), 0);
    return { route, remainingWeekly: Math.max(0, route.targetWeekly - flown) };
  });
  const slotLeft: Record<string, number> = {};
  const usedByLocked = slotUsage(s, lockedPlanes);
  for (const code of slotAirports(s.year)) slotLeft[code] = (s.slots[code] ?? 0) - (usedByLocked[code] ?? 0);

  const result = new Map<string, Plane>();
  // longest routes first: they are the hardest to fit
  needs.sort((a, b) => routeDistance(b.route.from, b.route.to) - routeDistance(a.route.from, a.route.to));

  const planes = [...unlocked].sort((a, b) => planeType(b).seats - planeType(a).seats).map((p) => ({ ...p, schedule: [] as Leg[] }));
  const state = { time: new Map<string, number>(), at: new Map<string, string>() };
  for (const p of planes) {
    state.time.set(p.id, 0);
    state.at.set(p.id, p.base);
  }

  // round-robin: every route gets one round trip per pass, so one long route
  // cannot swallow all the aircraft time
  const stuck = new Set<Need>();
  for (let pass = 0; pass < 60; pass++) {
    const open = needs.filter((n) => n.remainingWeekly > 0 && !stuck.has(n));
    if (!open.length) break;
    for (const need of open) {
    const r = need.route;
    {
      // a "daily" round trip covers 7 per week; the last one may run on fewer days
      const perWeek = Math.min(7, need.remainingWeekly);
      const days = perWeek >= 7 ? DAILY : spreadDays(perWeek);
      let placed = false;
      // if no plane is based at either end, move an idle plane there
      if (!planes.some((p) => (p.base === r.from || p.base === r.to) && (!r.typeId || p.typeId === r.typeId) && canFly(planeType(p), r.from, r.to, s.year).ok)) {
        const idle = planes.find((p) => p.schedule.length === 0 && (!r.typeId || p.typeId === r.typeId) && canFly(planeType(p), r.from, r.to, s.year).ok);
        if (idle) idle.base = s.crewBases.includes(r.to) ? r.to : r.from;
      }
      for (const p of planes) {
        if (r.typeId && p.typeId !== r.typeId) continue;
        if (!canFly(planeType(p), r.from, r.to, s.year).ok) continue;
        if (p.base !== r.from && p.base !== r.to) continue;
        const outDir: 0 | 1 = p.base === r.from ? 0 : 1;
        const away = outDir === 0 ? r.to : r.from;
        const block = legMinutes(p, r);
        const turn = minTurnMin(p) + s.bufferMin;
        const [openB, closeB] = airportHours(p.base, s.year);
        const [openA, closeA] = airportHours(away, s.year);
        const ready = Math.max(state.time.get(p.id)!, openB);
        const pref = POLICY_LEVEL[r.policy] <= s.opsLevel ? preferredTimes(r.policy, openB, closeB, Math.ceil(r.targetWeekly / 7)) : [];
        const candidates = [...pref.filter((t) => t >= ready), ready];
        let chosen: number | null = null;
        for (const dep of candidates) {
          const arr = dep + block;
          const back = Math.max(arr + turn, openA);
          const backArr = back + block;
          if (arr <= closeA && back >= openA && backArr <= closeB) { chosen = dep; break; }
        }
        if (chosen === null) continue;
        // slots: each round trip uses 2 movements at each slot airport it touches
        const touches = [r.from, r.to].filter((c) => c in slotLeft);
        if (touches.some((c) => slotLeft[c] < 2)) continue;
        for (const c of touches) slotLeft[c] -= 2;
        const arr = chosen + block;
        const back = Math.max(arr + turn, openA);
        p.schedule.push({ routeId: r.id, dir: outDir, dep: chosen, days }, { routeId: r.id, dir: (1 - outDir) as 0 | 1, dep: back, days });
        state.time.set(p.id, back + block + turn);
        need.remainingWeekly -= perWeek;
        placed = true;
        break;
      }
      if (!placed) stuck.add(need);
    }
    }
  }
  for (const p of planes) result.set(p.id, { ...p, schedule: p.schedule.sort((a, b) => a.dep - b.dep) });
  return { ...s, planes: s.planes.map((p) => result.get(p.id) ?? p) };
}

/** Spread n (<7) weekly flights over the week, e.g. 3 -> Mon/Wed/Fri */
export function spreadDays(n: number): number {
  let mask = 0;
  for (let i = 0; i < n; i++) mask |= 1 << Math.floor((i * 7) / n);
  return mask;
}

/** How many weekly round trips the auto-scheduler managed for a route */
export function scheduledWeekly(s: GameState, routeId: string): number {
  return s.planes.reduce((n, p) => n + p.schedule.filter((l) => l.routeId === routeId && l.dir === 0).reduce((m, l) => m + dayCount(l.days), 0), 0);
}

// ---- manual edits --------------------------------------------------------

export function setPlaneSchedule(s: GameState, planeId: string, legs: Leg[], base?: string): Result {
  const p = s.planes.find((x) => x.id === planeId);
  if (!p) return fail('機体が見つかりません');
  const b = base ?? p.base;
  // rotation problems are allowed while editing; such planes stay on the ground until fixed
  const planes = s.planes.map((x) => (x.id === planeId ? { ...x, schedule: legs, base: b, locked: true } : x));
  const use = slotUsage(s, planes);
  for (const code of slotAirports(s.year)) if ((use[code] ?? 0) > (s.slots[code] ?? 0)) return fail(`${AIRPORT_BY_CODE[code].name}の発着枠が足りません（${use[code]} / ${s.slots[code] ?? 0}）`);
  return ok({ ...s, planes });
}

export function setPlaneLock(s: GameState, planeId: string, locked: boolean): Result {
  return ok({ ...s, planes: s.planes.map((x) => (x.id === planeId ? { ...x, locked } : x)) });
}

export function setPlaneBase(s: GameState, planeId: string, base: string): Result {
  const p = s.planes.find((x) => x.id === planeId);
  if (!p) return fail('機体が見つかりません');
  return ok(autoSchedule({ ...s, planes: s.planes.map((x) => (x.id === planeId ? { ...x, base, schedule: [], locked: false } : x)) }));
}

// ---- delays --------------------------------------------------------------

export interface DelayStats { onTime: number; cancelled: number; delayed: number; flights: number }

/**
 * Monte-Carlo the plane's rotation over a number of days to estimate on-time
 * performance per leg. Delays propagate through the day; slack absorbs them.
 */
export function simulateDelays(s: GameState, p: Plane, seed: number, days = 20): Map<Leg, DelayStats> {
  const views = legViews(s, p);
  const out = new Map<Leg, DelayStats>();
  for (const v of views) out.set(v.leg, { onTime: 0, cancelled: 0, delayed: 0, flights: 0 });
  if (!views.length) return out;
  const r = rng(seed);
  const turn = minTurnMin(p);
  for (let d = 0; d < days; d++) {
    let prevArrActual = -Infinity;
    for (const v of views) {
      const st = out.get(v.leg)!;
      st.flights++;
      const pNew = Math.max(0.01, 0.05 + congestion(v.from, s.year) + congestion(v.to, s.year) * 0.5
        + weather(v.from, s.month) + weather(v.to, s.month) + (100 - p.condition) / 600 - Math.max(0, s.opsLevel - 1) * 0.012);
      const fresh = r() < pNew ? -Math.log(1 - r()) * 35 : r() * 6;
      const readyAt = prevArrActual + turn;
      const depActual = Math.max(v.dep, readyAt) + fresh;
      const arrActual = depActual + (v.arr - v.dep) + (r() - 0.5) * 8;
      const [, close] = airportHours(v.to, s.year);
      if (arrActual > close + 30) {
        st.cancelled++;
        // the plane stays put; the rest of the day's legs start late from scratch
        prevArrActual = arrActual;
        continue;
      }
      const late = arrActual - v.arr;
      if (late < 15) st.onTime++; else st.delayed++;
      prevArrActual = arrActual;
    }
  }
  return out;
}
