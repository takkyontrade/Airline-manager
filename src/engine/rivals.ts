// Rival airlines: who flies each airport pair, how often and at what fare.
// The AI is deliberately conservative: it serves markets big enough for its
// aircraft, follows the regulatory era, and reacts slowly when the player
// takes a large share of one of its routes.
import { AIRPORT_BY_CODE, isAirportOpen, isForeign, AIRPORTS } from '../data/airports';
import { ALLIANCES, ALLIANCE_BY_ID } from '../data/alliances';
import { RIVALS, RIVAL_EVENTS, type Rival } from '../data/rivals';
import { cargoDemandT, marketDemand, routeDistance } from './model';
import type { GameState } from './types';
import { slotAirports } from './schedule';
import { slotHolding } from './slots';

export interface Competitor {
  rival: Rival;
  weeklyFreq: number;
  seats: number;
  fareMul: number;
  comfort: number;
}

export const pairKey = (a: string, b: string) => (a < b ? `${a}-${b}` : `${b}-${a}`);

const HUB_GROUPS = new Set(['HND', 'NRT', 'ITM', 'KIX', 'NKM', 'NGO', 'CTS', 'FUK', 'OKA']);

export function isTrunk(a: string, b: string): boolean {
  const A = AIRPORT_BY_CODE[a], B = AIRPORT_BY_CODE[b];
  const big = (x: typeof A) => x.popM >= 1.4;
  return big(A) && big(B);
}

/** Typical seats of the aircraft a rival uses on an international route */
export function intlSeats(year: number, km: number): number {
  if (km > 3500) return year < 1970 ? 140 : year < 1985 ? 380 : year < 2005 ? 400 : 300;
  return year < 1970 ? 110 : year < 1980 ? 240 : year < 2000 ? 280 : 240;
}

export function rivalSeats(year: number, role: Rival['role']): number {
  const base = year < 1965 ? 60 : year < 1970 ? 100 : year < 1975 ? 140 : year < 1985 ? 260 : year < 2000 ? 300 : 260;
  if (role === 'local') return Math.round(base * (year < 1985 ? 0.6 : 0.5));
  if (role === 'okinawa') return Math.round(base * 0.5);
  if (role === 'entrant' || role === 'lcc') return year < 2000 ? 165 : 170;
  return base;
}

export function rivalComfort(year: number, r: Rival): number {
  const era = year < 1964 ? 0.8 : year < 1970 ? 0.95 : year < 1990 ? 1.03 : 1.08;
  return era * r.comfortMul;
}

const active = (r: Rival, year: number) => year >= r.from && (r.until === undefined || year < r.until);

/** Shares of the AI capacity on a pair by airline */
function shares(a: string, b: string, year: number): [Rival, number][] {
  const out: [Rival, number][] = [];
  const add = (id: string, w: number) => {
    const r = RIVALS.find((x) => x.id === id)!;
    if (active(r, year)) out.push([r, w]);
  };
  if (isForeign(a) || isForeign(b)) {
    const country = AIRPORT_BY_CODE[isForeign(a) ? a : b].country;
    add('JIA', year < 1986 ? 0.6 : 0.5);
    if (year >= 1986) add('YMT', year < 2000 ? 0.2 : 0.3);
    const home = RIVALS.find((x) => x.role === 'foreign' && x.country === country);
    if (home) add(home.id, 0.4);
    const total = out.reduce((n, [, w]) => n + w, 0);
    return out.map(([r, w]) => [r, w / total]);
  }
  const okinawaLocal = AIRPORT_BY_CODE[a].region === '沖縄' && AIRPORT_BY_CODE[b].region === '沖縄';
  if (okinawaLocal) {
    add('NSA', 1);
  } else if (isTrunk(a, b)) {
    if (year < 1986) { add('JIA', 0.45); add('YMT', 0.55); }
    else if (year < 2004) { add('JIA', 0.4); add('YMT', 0.45); add('JRA', 0.15); }
    else { add('JIA', 0.5); add('YMT', 0.5); }
    if (year >= 1993 && (a === 'OKA' || b === 'OKA')) add('NSA', 0.1);
  } else {
    if (year < 2004) { add('JRA', 0.6); add('YMT', 0.4); }
    else { add('JIA', 0.5); add('YMT', 0.5); }
  }
  const total = out.reduce((n, [, w]) => n + w, 0);
  return out.map(([r, w]) => [r, w / total]);
}

function capacityMul(r: Rival, year: number): number {
  let m = 1;
  for (const e of RIVAL_EVENTS) if (e.rival === r.id && e.capacityMul && year >= e.capacityMul[0] && year <= e.capacityMul[1]) m *= 0.75;
  return m;
}

/**
 * At slot-controlled airports rivals can only fly what the player doesn't
 * hold: their frequencies shrink as our share of the airport grows.
 */
export function rivalSlotFactor(s: GameState, code: string, year = s.year): number {
  if (!slotAirports(year).includes(code)) return 1;
  return Math.max(0.3, 1 - slotHolding(s, code));
}

/** All rival airlines flying a pair this month */
export function competitors(s: GameState, a: string, b: string, year = s.year, month = s.month): Competitor[] {
  if (!isAirportOpen(AIRPORT_BY_CODE[a], year) || !isAirportOpen(AIRPORT_BY_CODE[b], year)) return [];
  if (isForeign(a) && isForeign(b)) return [];
  const intl = isForeign(a) || isForeign(b);
  const km = routeDistance(a, b);
  // airlines plan capacity on an average month of the year
  const demand = marketDemand(a, b, year, 6);
  const pressure = s.aiPressure?.[pairKey(a, b)] ?? 0;
  const out: Competitor[] = [];
  const slotF = Math.min(rivalSlotFactor(s, a, year), rivalSlotFactor(s, b, year));

  for (const [r, share] of shares(a, b, year)) {
    const seats = intl ? intlSeats(year, km) : rivalSeats(year, r.role);
    // a market must fill at least one daily round trip at 60% before majors bother
    // point-to-point flying between two regional airports needs a much bigger market
    const hub = intl || HUB_GROUPS.has(a) || HUB_GROUPS.has(b);
    const threshold = seats * 0.6 * 30 * (r.role === 'local' || r.role === 'okinawa' ? 0.5 : 1) * (hub ? 1 : 3);
    if (demand < (intl ? seats * 0.6 * 2 * 4.33 * (r.role === 'foreign' ? 1 : 1.5) : threshold)) continue;
    const diff = s.difficulty === 'easy' ? 0.8 : s.difficulty === 'hard' ? 1.2 : 1;
    const supply = demand * 0.8 * share * capacityMul(r, year) * (1 + 0.3 * pressure) * diff;
    const minWeekly = intl ? 2 : r.role === 'local' ? 3 : 7;
    const weekly = Math.max(minWeekly, Math.round((supply * slotF) / (seats * 0.68 * 4.33)));
    out.push({ rival: r, weeklyFreq: weekly, seats, fareMul: r.fareMul * (1 - 0.12 * pressure), comfort: rivalComfort(year, r) });
  }

  // new entrants and LCCs on their own routes
  for (const r of RIVALS) {
    if (!r.routes || !active(r, year)) continue;
    for (const [x, y, since] of r.routes) {
      if (year < since || pairKey(x, y) !== pairKey(a, b)) continue;
      const seats = rivalSeats(year, r.role);
      const weekly = Math.max(7, Math.round((demand * 0.12) / (seats * 0.75 * 4.33)));
      out.push({ rival: r, weeklyFreq: Math.max(7, Math.round(Math.min(weekly, 42) * slotF)), seats, fareMul: r.fareMul * (1 - 0.08 * pressure), comfort: rivalComfort(year, r) });
    }
  }
  void month;
  return out;
}

/** Update AI pressure on pairs where the player is taking a large share */
export function updatePressure(s: GameState, shareByPair: Record<string, number>): Record<string, number> {
  const next: Record<string, number> = {};
  const keys = new Set([...Object.keys(s.aiPressure ?? {}), ...Object.keys(shareByPair)]);
  for (const k of keys) {
    const cur = s.aiPressure?.[k] ?? 0;
    const share = shareByPair[k] ?? 0;
    const v = share > 0.25 ? Math.min(1, cur + 0.08) : Math.max(0, cur - 0.03);
    if (v > 0) next[k] = v;
  }
  return next;
}

/** Overview of each rival's network this year (for the rivals screen) */
export function rivalOverview(s: GameState): { rival: Rival; routes: number; weekly: number; top: string[] }[] {
  const open = AIRPORTS.filter((x) => isAirportOpen(x, s.year));
  const stats = new Map<string, { routes: number; weekly: number; list: [string, number][] }>();
  for (let i = 0; i < open.length; i++) {
    for (let j = i + 1; j < open.length; j++) {
      for (const c of competitors(s, open[i].code, open[j].code)) {
        const st = stats.get(c.rival.id) ?? { routes: 0, weekly: 0, list: [] };
        st.routes++;
        st.weekly += c.weeklyFreq;
        st.list.push([`${open[i].name}〜${open[j].name}`, c.weeklyFreq]);
        stats.set(c.rival.id, st);
      }
    }
  }
  return RIVALS.filter((r) => stats.has(r.id)).map((r) => {
    const st = stats.get(r.id)!;
    return { rival: r, routes: st.routes, weekly: st.weekly, top: st.list.sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n, f]) => `${n}（週${f}）`) };
  }).sort((a, b) => b.weekly - a.weekly);
}

/** Alliance members that have joined by this year (the Japanese member only if the player isn't in it) */
export function allianceMembers(s: GameState, allianceId: string, year = s.year): string[] {
  const al = ALLIANCE_BY_ID[allianceId];
  if (!al || year < al.from) return [];
  const ids = al.members.filter(([, y]) => year >= y).map(([id]) => id);
  if (al.japanese && year >= al.japanese[1] && s.alliance !== al.id) ids.push(al.japanese[0]);
  return ids;
}

/** Which alliance (if any) a rival belongs to this year */
export function rivalAlliance(s: GameState, rivalId: string): string | null {
  for (const al of ALLIANCES) if (allianceMembers(s, al.id).includes(rivalId)) return al.id;
  return null;
}

/** Airlines cooperating with the player: alliance partners and individual codeshares */
export function partners(s: GameState): Set<string> {
  const out = new Set(s.codeshares ?? []);
  if (s.alliance) for (const id of allianceMembers(s, s.alliance)) out.add(id);
  return out;
}

/** Rivals' weekly cargo capacity on a pair in tonnes (belly holds, plus freighters on big international markets) */
export function rivalCargoWeeklyT(s: GameState, a: string, b: string): number {
  let t = 0;
  for (const c of competitors(s, a, b)) t += c.weeklyFreq * (c.seats >= 350 ? 20 : c.seats >= 200 ? 12 : c.seats >= 100 ? 2.5 : 0.6);
  if ((isForeign(a) || isForeign(b)) && s.year >= 1965) {
    const monthly = cargoDemandT(a, b, s.year, 6);
    const freighters = Math.floor((monthly * 0.35) / (100 * 4.33));
    t += freighters * 100;
  }
  return t;
}
