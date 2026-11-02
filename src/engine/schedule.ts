// Timetables: airport hours, slots, rotation validation, the auto-scheduler
// and the delay simulation that produces on-time performance.
import { AIRPORT_BY_CODE, isForeign } from '../data/airports';
import { econ, yearFrac } from '../data/economy';
import { canFly, ISLANDS, routeBlockHours, routeDistance, turnaroundHours } from './model';
import { heavyCheckOverdue, planeType } from './fleet';
import { GROUNDINGS } from '../data/history';
import type { Circuit, GameState, Leg, Plane, Route, SchedulePolicy } from './types';
import { fail, ok, rng, type Result } from './util';

export const DAILY = 127;
export const DAY_NAMES = ['月', '火', '水', '木', '金', '土', '日'];
export const dayCount = (mask: number) => { let n = 0; for (let i = 0; i < 7; i++) if (mask & (1 << i)) n++; return n; };

/** Weekly frequency of one leg of a plane's rotation */
export const legsPerWeek = (p: Plane, leg: Leg) => ((p.cycleDays ?? 1) > 1 ? 7 / p.cycleDays! : dayCount(leg.days));
/** Day offset label for multi-day rotations, e.g. "+1日" */
export const dayTag = (m: number) => (m >= 1440 ? `+${Math.floor(m / 1440)}日` : '');
export const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.round(m % 60)).padStart(2, '0')}`;

// ---- airports: hours, congestion, slots ----------------------------------

/** Operating hours [open, close] in minutes after midnight */
export function airportHours(code: string, year: number): [number, number] {
  if (isForeign(code)) return [0, 1440];
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
  const out = ['HND'];
  if (year >= 1970) out.push('ITM');
  if (year >= 1978) out.push('NRT');
  return out;
}

export const INITIAL_SLOTS: Record<string, number> = { HND: 12, ITM: 12, NRT: 6 };

/** Is a local time (minutes, any day) inside the airport's operating hours? */
export function inHours(code: string, year: number, m: number): boolean {
  const [open, close] = airportHours(code, year);
  if (open === 0 && close >= 1440) return true;
  const t = ((m % 1440) + 1440) % 1440;
  return t >= open && t <= close;
}

/** Extra delay probability from congestion */
function congestion(code: string, year: number): number {
  if (code === 'HND') return year < 2010 ? 0.06 : 0.04;
  if (code === 'ITM' || code === 'FUK' || code === 'NRT') return 0.03;
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

export function legMinutes(p: Plane, r: Route, year: number): number {
  return Math.round(routeBlockHours(planeType(p), r.from, r.to, year, r.via) * 60);
}
export const minTurnMin = (p: Plane) => Math.round(turnaroundHours(planeType(p)) * 60);

export interface LegView { leg: Leg; route: Route; from: string; to: string; dep: number; arr: number }

export function legViews(s: GameState, p: Plane): LegView[] {
  const out: LegView[] = [];
  for (const leg of [...p.schedule].sort((a, b) => a.dep - b.dep)) {
    const route = s.routes.find((r) => r.id === leg.routeId);
    if (!route) continue;
    out.push({ leg, route, from: legFrom(route, leg), to: legTo(route, leg), dep: leg.dep, arr: leg.dep + legMinutes(p, route, s.year) });
  }
  return out;
}

/** Problems with a plane's rotation (empty = valid) */
export function validateRotation(s: GameState, p: Plane, legs = p.schedule, base = p.base): string[] {
  const errs: string[] = [];
  const plane = { ...p, schedule: legs, base };
  const views = legViews(s, plane);
  const cycle = p.cycleDays ?? 1;
  const multi = p.cycleDays !== undefined;
  let at = base;
  let ready = -Infinity;
  for (const v of views) {
    const [open] = airportHours(v.from, s.year);
    const [, close] = airportHours(v.to, s.year);
    const t = `${dayTag(v.dep)}${hhmm(v.dep)}`;
    if (v.from !== at) errs.push(`${t}発の便は${AIRPORT_BY_CODE[v.from].name}発ですが、機体は${AIRPORT_BY_CODE[at].name}にいます`);
    if (v.dep < ready) errs.push(`${t}発の便は折り返し時間が足りません（${hhmm(ready)}以降）`);
    if (!multi) {
      if (v.dep < open) errs.push(`${AIRPORT_BY_CODE[v.from].name}は${hhmm(open)}まで使えません`);
      if (v.arr > close) errs.push(`${AIRPORT_BY_CODE[v.to].name}の運用時間（〜${hhmm(close)}）を過ぎて到着します`);
    } else {
      if (!inHours(v.from, s.year, v.dep)) errs.push(`${AIRPORT_BY_CODE[v.from].name}の運用時間外に出発します`);
      if (!inHours(v.to, s.year, v.arr)) errs.push(`${AIRPORT_BY_CODE[v.to].name}の運用時間外に到着します`);
    }
    const check = canFly(planeType(p), v.route.from, v.route.to, s.year, v.route.via);
    if (!check.ok) errs.push(check.reason);
    at = v.to;
    ready = v.arr + minTurnMin(p);
  }
  if (views.length && at !== base) errs.push(`最終便が拠点（${AIRPORT_BY_CODE[base].name}）に戻っていません`);
  if (multi && views.length && ready > views[0].dep + cycle * 1440) errs.push(`${cycle}日のサイクルに収まっていません`);
  return errs;
}

/** Daily movements we use at each slot airport */
export function slotUsage(s: GameState, planes = s.planes): Record<string, number> {
  const use: Record<string, number> = {};
  const slotSet = new Set(slotAirports(s.year));
  for (const p of planes) {
    if (p.status === 'onOrder') continue;
    const perDay = 1 / (p.cycleDays ?? 1);
    for (const leg of p.schedule) {
      const r = s.routes.find((x) => x.id === leg.routeId);
      if (!r) continue;
      for (const code of [r.from, r.to]) if (slotSet.has(code)) use[code] = (use[code] ?? 0) + perDay;
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
      const n = legsPerWeek(p, leg);
      deps[leg.dir] += n;
      seats[leg.dir] += n * planeType(p).seats;
      weight[leg.dir] += n * (isForeign(legFrom(route, leg)) ? 1 : timeWeight(leg.dep % 1440));
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

/** Freighters fly cargo routes, airliners fly passenger routes */
export const suits = (p: Plane, r: Route) => !!planeType(p).freighter === (r.kind === 'cargo');

/**
 * Rebuild schedules of all unlocked, delivered planes from route targets.
 * Each plane flies out-and-back trips from its base. Planes not useful for
 * any route keep an empty schedule.
 */
/** Can this plane be given flights now? (not in heavy check, repair, conversion, overdue check or grounding) */
export function schedulable(s: GameState, p: Plane): boolean {
  if (p.status !== 'active' || heavyCheckOverdue(p)) return false;
  const t = s.year * 12 + s.month;
  return !GROUNDINGS.some((g) => g.typeId === p.typeId && t >= g.from[0] * 12 + g.from[1] && t <= g.to[0] * 12 + g.to[1]);
}

/** True when the timetable no longer matches which planes can fly */
export function scheduleStale(s: GameState): boolean {
  return s.planes.some((p) => !p.locked && p.status !== 'onOrder' && (schedulable(s, p) ? p.schedule.length === 0 : p.schedule.length > 0));
}

export function autoSchedule(s: GameState): GameState {
  const unlocked = s.planes.filter((p) => !p.locked && schedulable(s, p));
  // planes in the shop give their flights to the others (locked ones keep theirs for when they return)
  const resting = s.planes.filter((p) => !p.locked && p.status !== 'onOrder' && !schedulable(s, p));
  // targets minus what locked planes already fly
  const lockedPlanes = s.planes.filter((p) => p.locked && schedulable(s, p));
  const needs: Need[] = s.routes.map((route) => {
    const flown = lockedPlanes.reduce((n, p) => n + p.schedule.filter((l) => l.routeId === route.id && l.dir === 0).reduce((m, l) => m + legsPerWeek(p, l), 0), 0);
    return { route, remainingWeekly: Math.max(0, route.targetWeekly - flown) };
  });
  const slotLeft: Record<string, number> = {};
  const usedByLocked = slotUsage(s, lockedPlanes);
  for (const code of slotAirports(s.year)) slotLeft[code] = (s.slots[code] ?? 0) - (usedByLocked[code] ?? 0);

  const result = new Map<string, Plane>();
  // longest routes first: they are the hardest to fit
  needs.sort((a, b) => routeDistance(b.route.from, b.route.to) - routeDistance(a.route.from, a.route.to));

  const planes = [...unlocked].sort((a, b) => planeType(b).seats - planeType(a).seats).map((p) => ({ ...p, schedule: [] as Leg[], cycleDays: undefined as number | undefined }));
  const state = { time: new Map<string, number>(), at: new Map<string, string>() };
  for (const p of planes) {
    state.time.set(p.id, 0);
    state.at.set(p.id, p.base);
  }

  // departures placed so far, per route direction and per airport (to spread them out)
  const routeDeps = new Map<string, number[]>();
  const aptDeps = new Map<string, number[]>();
  const note = (key: string, apt: string, t: number) => {
    routeDeps.set(key, [...(routeDeps.get(key) ?? []), t]);
    aptDeps.set(apt, [...(aptDeps.get(apt) ?? []), t]);
  };
  for (const p of lockedPlanes) for (const l of p.schedule) {
    const r = s.routes.find((x) => x.id === l.routeId);
    if (r) note(`${l.routeId}:${l.dir}`, l.dir === 0 ? r.from : r.to, l.dep % 1440);
  }

  // multi-stop circuits first: each needs one plane to fly all its legs in a day
  for (const c of s.circuits ?? []) {
    const segs = circuitSegments(s, c);
    if (!segs) continue;
    let remaining = c.targetWeekly;
    for (let guard = 0; remaining > 0 && guard < 30; guard++) {
      const perWeek = Math.min(7, remaining);
      const days = perWeek >= 7 ? DAILY : spreadDays(perWeek);
      const ok = (p: Plane) => !planeType(p).freighter && (!c.typeId || p.typeId === c.typeId) && segs.every((g) => canFly(planeType(p), g.route.from, g.route.to, s.year, g.route.via).ok);
      if (!planes.some((p) => p.base === c.stops[0] && ok(p))) {
        const idle = planes.find((p) => p.schedule.length === 0 && !p.baseFixed && ok(p));
        if (idle) idle.base = c.stops[0];
      }
      let placed = false;
      for (const p of planes) {
        if (p.base !== c.stops[0] || !ok(p) || (p.cycleDays ?? 1) > 1) continue;
        const turn = minTurnMin(p) + s.bufferMin;
        let ready = Math.max(state.time.get(p.id)!, airportHours(c.stops[0], s.year)[0]);
        const legs: Leg[] = [];
        let fits = true;
        for (const g of segs) {
          const [open] = airportHours(g.from, s.year);
          const [, close] = airportHours(g.to, s.year);
          const dep = Math.max(ready, open);
          const arr = dep + legMinutes(p, g.route, s.year);
          if (arr > close) { fits = false; break; }
          legs.push({ routeId: g.route.id, dir: g.dir, dep, days });
          ready = arr + turn;
        }
        if (!fits) continue;
        const touches: Record<string, number> = {};
        for (const g of segs) for (const code of [g.from, g.to]) if (code in slotLeft) touches[code] = (touches[code] ?? 0) + 1;
        if (Object.entries(touches).some(([code, n]) => slotLeft[code] < n)) continue;
        for (const [code, n] of Object.entries(touches)) slotLeft[code] -= n;
        p.schedule.push(...legs);
        state.time.set(p.id, ready);
        remaining -= perWeek;
        placed = true;
        break;
      }
      if (!placed) break;
    }
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
      if (!planes.some((p) => (p.base === r.from || p.base === r.to) && suits(p, r) && (!r.typeId || p.typeId === r.typeId) && canFly(planeType(p), r.from, r.to, s.year, r.via).ok)) {
        const idle = planes.find((p) => p.schedule.length === 0 && !p.baseFixed && suits(p, r) && (!r.typeId || p.typeId === r.typeId) && canFly(planeType(p), r.from, r.to, s.year, r.via).ok);
        if (idle) idle.base = isForeign(r.from) ? r.to : isForeign(r.to) ? r.from : s.crewBases.includes(r.to) ? r.to : r.from;
      }
      for (const p of planes) {
        if (!suits(p, r)) continue;
        if (r.typeId && p.typeId !== r.typeId) continue;
        if (!canFly(planeType(p), r.from, r.to, s.year, r.via).ok) continue;
        if (p.base !== r.from && p.base !== r.to) continue;
        const outDir: 0 | 1 = p.base === r.from ? 0 : 1;
        const away = outDir === 0 ? r.to : r.from;
        const block = legMinutes(p, r, s.year);
        const turn = minTurnMin(p) + s.bufferMin;
        const [openB, closeB] = airportHours(p.base, s.year);
        const [openA, closeA] = airportHours(away, s.year);
        const ready = Math.max(state.time.get(p.id)!, openB);
        const pref = POLICY_LEVEL[r.policy] <= s.opsLevel ? preferredTimes(r.policy, openB, closeB, Math.ceil(r.targetWeekly / 7)) : [];
        const fits = (dep: number) => {
          const arr = dep + block;
          const back = Math.ceil(Math.max(arr + turn, openA) / 5) * 5;
          return arr <= closeA && back >= openA && back + block <= closeB;
        };
        let chosen: number | null = pref.find((t) => t >= ready && fits(t)) ?? null;
        if (chosen === null) {
          // spread the route's flights over the day instead of sending every plane at opening time
          const key = `${r.id}:${outDir}`;
          const same = routeDeps.get(key) ?? [];
          const others = aptDeps.get(p.base) ?? [];
          const daily = Math.max(1, Math.ceil(r.targetWeekly / 7));
          const gap = Math.min(150, Math.max(30, ((closeB - openB) / daily) * 0.7));
          const dist = (t: number, list: number[]) => list.reduce((m, x) => Math.min(m, Math.abs(x - t)), Infinity);
          const start = Math.ceil(ready / 5) * 5;
          let best = -1;
          for (let t = start; t <= Math.min(start + 240, closeB); t += 5) {
            if (!fits(t) || dist(t, others) < 10) continue;
            // earliest time that is as far as possible (up to the ideal gap) from the route's other flights
            const score = Math.min(gap, dist(t, same));
            if (score > best) { best = score; chosen = t; }
            if (score >= gap) break;
          }
          if (chosen === null && fits(ready)) chosen = ready;
        }
        if (chosen === null) {
          // long-haul: an idle plane flies a dedicated rotation over several days
          if (p.schedule.length || state.time.get(p.id)! > 0) continue;
          const cyc = longHaulCycle(s, p, r, outDir, turn);
          if (!cyc) continue;
          const touchesL = [r.from, r.to].filter((c) => c in slotLeft);
          if (touchesL.some((c) => slotLeft[c] < 2 / cyc.days)) continue;
          for (const c of touchesL) slotLeft[c] -= 2 / cyc.days;
          p.schedule.push(...cyc.legs);
          p.cycleDays = cyc.days;
          state.time.set(p.id, Infinity);
          need.remainingWeekly -= 7 / cyc.days;
          placed = true;
          break;
        }
        // slots: each round trip uses 2 movements at each slot airport it touches
        const touches = [r.from, r.to].filter((c) => c in slotLeft);
        if (touches.some((c) => slotLeft[c] < 2)) continue;
        for (const c of touches) slotLeft[c] -= 2;
        const arr = chosen + block;
        const back = Math.ceil(Math.max(arr + turn, openA) / 5) * 5;
        p.schedule.push({ routeId: r.id, dir: outDir, dep: chosen, days }, { routeId: r.id, dir: (1 - outDir) as 0 | 1, dep: back, days });
        note(`${r.id}:${outDir}`, p.base, chosen);
        note(`${r.id}:${1 - outDir}`, away, back);
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
  for (const p of resting) result.set(p.id, { ...p, schedule: [], cycleDays: undefined });
  return { ...s, planes: s.planes.map((p) => result.get(p.id) ?? p) };
}

/**
 * A multi-day out-and-back rotation for routes too long for a day trip.
 * Departs from the base when it opens; the return waits at the far end until
 * it can arrive home inside operating hours. Returns null if nothing fits.
 */
function longHaulCycle(s: GameState, p: Plane, r: Route, outDir: 0 | 1, turn: number): { legs: Leg[]; days: number } | null {
  const away = outDir === 0 ? r.to : r.from;
  const block = legMinutes(p, r, s.year);
  const [openB] = airportHours(p.base, s.year);
  // evening departures suit long-haul best; try a few departure times
  for (const dep0 of [1080, 1200, 660, 780, 900, openB]) {
    const dep = Math.max(dep0, openB);
    if (!inHours(p.base, s.year, dep) || !inHours(away, s.year, dep + block)) continue;
    let back = dep + block + turn;
    let tries = 0;
    while ((!inHours(away, s.year, back) || !inHours(p.base, s.year, back + block)) && tries++ < 96) back += 15;
    if (tries >= 96) continue;
    const end = back + block + turn;
    const days = Math.max(1, Math.ceil((end - dep) / 1440));
    return {
      days,
      legs: [
        { routeId: r.id, dir: outDir, dep, days: DAILY },
        { routeId: r.id, dir: (1 - outDir) as 0 | 1, dep: back, days: DAILY },
      ],
    };
  }
  return null;
}

/** The legs of a circuit with the route and direction used for each (null if a leg has no route) */
export function circuitSegments(s: GameState, c: Circuit): { from: string; to: string; route: Route; dir: 0 | 1 }[] | null {
  const out: { from: string; to: string; route: Route; dir: 0 | 1 }[] = [];
  for (let i = 0; i < c.stops.length; i++) {
    const from = c.stops[i];
    const to = c.stops[(i + 1) % c.stops.length];
    const route = s.routes.find((r) => (r.kind ?? 'pax') === 'pax' && ((r.from === from && r.to === to) || (r.from === to && r.to === from)));
    if (!route) return null;
    out.push({ from, to, route, dir: route.from === from ? 0 : 1 });
  }
  return out;
}

/** Times per week a circuit got into the timetable */
export function circuitScheduled(s: GameState, c: Circuit): number {
  const segs = circuitSegments(s, c);
  if (!segs) return 0;
  const first = segs[0];
  // count planes whose rotation contains the whole circuit in order
  let n = 0;
  for (const p of s.planes) {
    const legs = [...p.schedule].sort((a, b) => a.dep - b.dep);
    for (let i = 0; i + segs.length <= legs.length; i++) {
      if (legs[i].routeId !== first.route.id || legs[i].dir !== first.dir) continue;
      if (segs.every((g, k) => legs[i + k].routeId === g.route.id && legs[i + k].dir === g.dir)) n += legsPerWeek(p, legs[i]);
    }
  }
  return n;
}

/** Spread n (<7) weekly flights over the week, e.g. 3 -> Mon/Wed/Fri */
export function spreadDays(n: number): number {
  let mask = 0;
  for (let i = 0; i < n; i++) mask |= 1 << Math.floor((i * 7) / n);
  return mask;
}

/** How many weekly round trips the auto-scheduler managed for a route */
export function scheduledWeekly(s: GameState, routeId: string): number {
  const n = s.planes.reduce((n, p) => n + p.schedule.filter((l) => l.routeId === routeId && l.dir === 0).reduce((m, l) => m + legsPerWeek(p, l), 0), 0);
  return Math.round(n * 10) / 10;
}

// ---- manual edits --------------------------------------------------------

export function setPlaneSchedule(s: GameState, planeId: string, legs: Leg[], base?: string, cycleDays?: number): Result {
  const p = s.planes.find((x) => x.id === planeId);
  if (!p) return fail('機体が見つかりません');
  const b = base ?? p.base;
  const cycle = cycleDays === undefined ? p.cycleDays : Math.max(1, Math.min(7, Math.round(cycleDays)));
  // rotation problems are allowed while editing; such planes stay on the ground until fixed
  const planes = s.planes.map((x) => (x.id === planeId ? { ...x, schedule: legs, base: b, locked: true, cycleDays: cycle } : x));
  const use = slotUsage(s, planes);
  for (const code of slotAirports(s.year)) if ((use[code] ?? 0) > (s.slots[code] ?? 0)) return fail(`${AIRPORT_BY_CODE[code].name}の発着枠が足りません（${use[code]} / ${s.slots[code] ?? 0}）`);
  return ok({ ...s, planes });
}

export function setPlaneLock(s: GameState, planeId: string, locked: boolean): Result {
  return ok({ ...s, planes: s.planes.map((x) => (x.id === planeId ? { ...x, locked } : x)) });
}

/** Move a plane's home base. base null = let the auto-scheduler choose again. */
export function setPlaneBase(s: GameState, planeId: string, base: string | null): Result {
  const p = s.planes.find((x) => x.id === planeId);
  if (!p) return fail('機体が見つかりません');
  if (base && AIRPORT_BY_CODE[base]?.foreign) return fail('海外の空港は拠点にできません');
  return ok(autoSchedule({ ...s, planes: s.planes.map((x) => (x.id === planeId ? { ...x, base: base ?? x.base, baseFixed: base !== null, schedule: [], locked: false, cycleDays: undefined } : x)) }));
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
      if (close < 1440 && (v.arr % 1440) + (arrActual - v.arr) > close + 30) {
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
