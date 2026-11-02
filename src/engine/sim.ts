// Game state transitions. All functions are pure: they take a state and
// return a new one (or an error string), so the UI and tests share them.
import { AIRPORTS, AIRPORT_BY_CODE, isAirportOpen } from '../data/airports';
import { AIRCRAFT_TYPES, AIRCRAFT_BY_ID, type AircraftType } from '../data/aircraft';
import {
  canFly, crewCostMonthly, flightCost, groundCostPerPax, incumbentComfort,
  incumbentWeeklyFreq, LEASE_RATE_MONTHLY, marketDemand, maxWeeklyRoundTrips, newPriceYen,
  overheadMonthly, referenceFare, ADMIN_SHARE, routeDistance, SALES_COMMISSION, valueYen,
} from './model';
import type { GameState, MonthReport, Plane, Route, RouteResult } from './types';

export const START_YEAR = 1960;
export const START_CASH = 500_000_000;
const WEEKS_PER_MONTH = 4.33;

// ---- helpers ------------------------------------------------------------

function rng(seed: number) {
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

export const planeType = (p: Plane): AircraftType => AIRCRAFT_BY_ID[p.typeId];
export const planeAge = (p: Plane, year: number) => Math.max(0, year - p.builtYear);
export const openAirports = (year: number) => AIRPORTS.filter((a) => isAirportOpen(a, year));

export type Result = { ok: true; state: GameState } | { ok: false; error: string };
const fail = (error: string): Result => ({ ok: false, error });
const ok = (state: GameState): Result => ({ ok: true, state });

function nextId(s: GameState, prefix: string): [string, GameState] {
  return [`${prefix}${s.nextId}`, { ...s, nextId: s.nextId + 1 }];
}

// ---- new game -----------------------------------------------------------

export function newGame(companyName: string, baseAirport: string, seed = Date.now()): GameState {
  return {
    version: 1,
    companyName: companyName.trim() || '新日本航空',
    baseAirport,
    year: START_YEAR,
    month: 1,
    cash: START_CASH,
    reputation: 50,
    planes: [],
    routes: [],
    history: [],
    news: [
      {
        year: START_YEAR, month: 1, kind: 'info',
        text: `${companyName.trim() || '新日本航空'}が${AIRPORT_BY_CODE[baseAirport].name}を拠点に設立されました。資本金は5億円です。`,
      },
    ],
    negativeCashMonths: 0,
    gameOver: false,
    nextId: 1,
    seed: seed >>> 0,
  };
}

// ---- aircraft market ----------------------------------------------------

export interface MarketOffer {
  type: AircraftType;
  condition: 'new' | 'used';
  ageYears: number;
  priceYen: number;
  leaseMonthlyYen: number;
}

export function aircraftMarket(year: number, month: number): MarketOffer[] {
  const offers: MarketOffer[] = [];
  for (const t of AIRCRAFT_TYPES) {
    if (year < t.introYear) continue;
    if (year <= t.endYear) {
      const price = newPriceYen(t, year, month);
      offers.push({ type: t, condition: 'new', ageYears: 0, priceYen: price, leaseMonthlyYen: price * LEASE_RATE_MONTHLY });
    }
    // used examples from 3 years after intro until 25 years after end of production
    if (year >= t.introYear + 3 && year <= t.endYear + 25) {
      const age = Math.min(year - t.introYear, Math.max(5, year - t.endYear + 5));
      const price = valueYen(t, age, year, month);
      offers.push({ type: t, condition: 'used', ageYears: age, priceYen: price, leaseMonthlyYen: price * LEASE_RATE_MONTHLY * 1.15 });
    }
  }
  return offers;
}

function regNo(s: GameState): string {
  const r = rng(s.seed + s.nextId * 7919);
  return `JA${String(1000 + Math.floor(r() * 9000))}`;
}

export function acquirePlane(s: GameState, offer: MarketOffer, mode: 'buy' | 'lease'): Result {
  if (s.gameOver) return fail('ゲームオーバーです');
  const deposit = mode === 'buy' ? offer.priceYen : offer.leaseMonthlyYen * 2;
  if (s.cash < deposit) return fail(mode === 'buy' ? '資金が足りません' : '保証金（リース料2か月分）が払えません');
  const [id, s2] = nextId(s, 'P');
  const plane: Plane = {
    id,
    typeId: offer.type.id,
    regNo: regNo(s),
    builtYear: s.year - offer.ageYears,
    ownership: mode === 'buy' ? 'owned' : 'leased',
    leaseMonthlyYen: mode === 'lease' ? offer.leaseMonthlyYen : 0,
    purchaseYen: mode === 'buy' ? offer.priceYen : 0,
    acquiredYear: s.year,
    routeId: null,
  };
  const how = mode === 'buy' ? '購入' : 'リース導入';
  return ok({
    ...s2,
    cash: s2.cash - deposit,
    planes: [...s2.planes, plane],
    news: [...s2.news, { year: s.year, month: s.month, kind: 'info', text: `${offer.type.name}（${plane.regNo}）を${how}しました。` }],
  });
}

export function disposePlane(s: GameState, planeId: string): Result {
  const p = s.planes.find((x) => x.id === planeId);
  if (!p) return fail('機体が見つかりません');
  const t = planeType(p);
  let cash = s.cash;
  let text: string;
  if (p.ownership === 'owned') {
    const v = valueYen(t, planeAge(p, s.year), s.year, s.month);
    cash += v;
    text = `${t.name}（${p.regNo}）を売却しました（${formatYen(v)}）。`;
  } else {
    const penalty = p.leaseMonthlyYen * 3;
    cash -= penalty;
    text = `${t.name}（${p.regNo}）のリースを解約しました（違約金${formatYen(penalty)}）。`;
  }
  const planes = s.planes.filter((x) => x.id !== planeId);
  const routes = s.routes.map((r) => clampFreq(r, planes));
  return ok({ ...s, cash, planes, routes, news: [...s.news, { year: s.year, month: s.month, kind: 'info', text }] });
}

// ---- routes -------------------------------------------------------------

export const planesOnRoute = (planes: Plane[], routeId: string) => planes.filter((p) => p.routeId === routeId);

export function routeCapacity(planes: Plane[], route: Route): number {
  const km = routeDistance(route.from, route.to);
  return planesOnRoute(planes, route.id).reduce((n, p) => n + maxWeeklyRoundTrips(planeType(p), km), 0);
}

function clampFreq(r: Route, planes: Plane[]): Route {
  const cap = routeCapacity(planes, r);
  return r.weeklyFreq > cap ? { ...r, weeklyFreq: cap } : r;
}

export function openRoute(s: GameState, from: string, to: string): Result {
  if (from === to) return fail('同じ空港同士は結べません');
  const a = AIRPORT_BY_CODE[from];
  const b = AIRPORT_BY_CODE[to];
  if (!a || !b) return fail('空港が見つかりません');
  if (!isAirportOpen(a, s.year) || !isAirportOpen(b, s.year)) return fail('まだ開港していない空港があります');
  if (s.routes.some((r) => (r.from === from && r.to === to) || (r.from === to && r.to === from)))
    return fail('すでに開設済みの路線です');
  const [id, s2] = nextId(s, 'R');
  const km = routeDistance(from, to);
  const route: Route = {
    id, from, to, weeklyFreq: 0, fareYen: referenceFare(km, s.year, s.month),
    openedYear: s.year, openedMonth: s.month,
  };
  return ok({
    ...s2,
    routes: [...s2.routes, route],
    news: [...s2.news, { year: s.year, month: s.month, kind: 'info', text: `${a.name}〜${b.name}線を開設しました。` }],
  });
}

export function closeRoute(s: GameState, routeId: string): Result {
  const r = s.routes.find((x) => x.id === routeId);
  if (!r) return fail('路線が見つかりません');
  return ok({
    ...s,
    routes: s.routes.filter((x) => x.id !== routeId),
    planes: s.planes.map((p) => (p.routeId === routeId ? { ...p, routeId: null } : p)),
    news: [...s.news, { year: s.year, month: s.month, kind: 'info', text: `${AIRPORT_BY_CODE[r.from].name}〜${AIRPORT_BY_CODE[r.to].name}線を廃止しました。` }],
  });
}

export function assignPlane(s: GameState, planeId: string, routeId: string | null): Result {
  const p = s.planes.find((x) => x.id === planeId);
  if (!p) return fail('機体が見つかりません');
  if (routeId) {
    const r = s.routes.find((x) => x.id === routeId);
    if (!r) return fail('路線が見つかりません');
    const check = canFly(planeType(p), r.from, r.to);
    if (!check.ok) return fail(check.reason);
  }
  const planes = s.planes.map((x) => (x.id === planeId ? { ...x, routeId } : x));
  const routes = s.routes.map((r) => clampFreq(r, planes));
  return ok({ ...s, planes, routes });
}

export function setRoute(s: GameState, routeId: string, patch: Partial<Pick<Route, 'weeklyFreq' | 'fareYen'>>): Result {
  const r = s.routes.find((x) => x.id === routeId);
  if (!r) return fail('路線が見つかりません');
  let next = { ...r, ...patch };
  next.weeklyFreq = Math.max(0, Math.round(next.weeklyFreq));
  next.fareYen = Math.max(100, Math.round(next.fareYen / 10) * 10);
  next = clampFreq(next, s.planes);
  return ok({ ...s, routes: s.routes.map((x) => (x.id === routeId ? next : x)) });
}

// ---- monthly simulation -------------------------------------------------

/** Average seats and comfort of the planes flying a route, weighted by trips */
function routeFleetMix(planes: Plane[], route: Route) {
  const km = routeDistance(route.from, route.to);
  const ps = planesOnRoute(planes, route.id);
  // distribute weekly round trips over planes in order, each up to its capacity
  let remaining = route.weeklyFreq;
  const usage: { plane: Plane; rt: number }[] = [];
  for (const p of ps) {
    const cap = maxWeeklyRoundTrips(planeType(p), km);
    const rt = Math.min(cap, remaining);
    remaining -= rt;
    usage.push({ plane: p, rt });
  }
  const totalRt = usage.reduce((n, u) => n + u.rt, 0);
  const seatsPerRt = totalRt ? usage.reduce((n, u) => n + u.rt * planeType(u.plane).seats, 0) / totalRt : 0;
  const comfort = totalRt ? usage.reduce((n, u) => n + u.rt * planeType(u.plane).comfort, 0) / totalRt : 1;
  return { usage, totalRt, seatsPerRt, comfort, km };
}

export interface RouteForecast {
  marketOneWay: number;
  share: number;
  incumbentFreq: number;
  refFare: number;
}

export function routeMarket(s: GameState, route: Route, year = s.year, month = s.month): RouteForecast {
  const km = routeDistance(route.from, route.to);
  const ref = referenceFare(km, year, month);
  const base = marketDemand(route.from, route.to, year, month);
  const inc = incumbentWeeklyFreq(route.from, route.to, year, month);
  const { totalRt, comfort } = routeFleetMix(s.planes, route);
  const repF = (s.reputation / 50) ** 0.3;
  const priceRatio = route.fareYen / ref;
  const aUs = totalRt > 0 ? totalRt ** 0.8 * priceRatio ** -2 * comfort * repF : 0;
  const aInc = inc > 0 ? inc ** 0.8 * incumbentComfort(year) : 0;
  const share = aUs + aInc > 0 ? aUs / (aUs + aInc) : 0;
  // market stimulation: fares and convenience change total demand
  const totalFreq = totalRt + inc;
  const avgPriceRatio = aUs + aInc > 0 ? (aUs * priceRatio + aInc * 1) / (aUs + aInc) : 1;
  const freqF = 0.6 + 0.4 * Math.min(1.3, totalFreq / 14);
  const marketOneWay = base * avgPriceRatio ** -1.1 * freqF;
  return { marketOneWay, share, incumbentFreq: inc, refFare: ref };
}

function simulateRoute(s: GameState, route: Route, noise: number): { result: RouteResult; parts: Record<string, number> } {
  const mix = routeFleetMix(s.planes, route);
  const f = routeMarket(s, route);
  const flights = mix.totalRt * WEEKS_PER_MONTH * 2; // one-way departures
  const seats = mix.seatsPerRt * flights;
  const wantOneWay = f.marketOneWay * f.share * noise;
  const pax = Math.min(wantOneWay * 2, seats);
  const revenue = pax * route.fareYen;
  const parts = { fuel: 0, maintenance: 0, airport: 0, ground: 0, sales: 0 };
  for (const u of mix.usage) {
    const c = flightCost(planeType(u.plane), mix.km, s.year, s.month);
    const n = u.rt * WEEKS_PER_MONTH * 2;
    parts.fuel += c.fuel * n;
    parts.maintenance += c.maintenance * n;
    parts.airport += c.airport * n;
  }
  parts.ground = pax * groundCostPerPax(s.year, s.month);
  parts.sales = revenue * SALES_COMMISSION;
  const cost = Object.values(parts).reduce((a, b) => a + b, 0);
  return {
    result: {
      routeId: route.id, flights, seats, pax, demand: wantOneWay * 2,
      marketDemand: f.marketOneWay * 2, share: f.share, revenue, cost,
    },
    parts,
  };
}

export function advanceMonth(s: GameState): GameState {
  if (s.gameOver) return s;
  const r = rng(s.seed + s.year * 12 + s.month);
  const costs = { fuel: 0, maintenance: 0, crew: 0, airport: 0, ground: 0, sales: 0, lease: 0, overhead: 0 };
  const routes: RouteResult[] = [];
  let revenue = 0;
  for (const route of s.routes) {
    const { result, parts } = simulateRoute(s, route, 0.93 + r() * 0.14);
    routes.push(result);
    revenue += result.revenue;
    costs.fuel += parts.fuel;
    costs.maintenance += parts.maintenance;
    costs.airport += parts.airport;
    costs.ground += parts.ground;
    costs.sales += parts.sales;
  }
  for (const p of s.planes) {
    costs.crew += crewCostMonthly(planeType(p), s.year, s.month);
    if (p.ownership === 'leased') costs.lease += p.leaseMonthlyYen;
  }
  costs.overhead = overheadMonthly(s.planes.length, s.year, s.month) + revenue * ADMIN_SHARE;
  const totalCost = Object.values(costs).reduce((a, b) => a + b, 0);
  const profit = revenue - totalCost;
  const cash = s.cash + profit;
  const pax = routes.reduce((n, x) => n + x.pax, 0);

  const report: MonthReport = { year: s.year, month: s.month, revenue, costs, profit, cashEnd: cash, pax, routes };

  // reputation drifts toward a level set by comfort and load factor
  const seats = routes.reduce((n, x) => n + x.seats, 0);
  const avgComfort = s.planes.length ? s.planes.reduce((n, p) => n + planeType(p).comfort, 0) / s.planes.length : 0.9;
  const spill = seats > 0 ? routes.reduce((n, x) => n + Math.max(0, x.demand - x.pax), 0) / Math.max(1, pax) : 0;
  const target = Math.max(20, Math.min(80, 30 + 30 * avgComfort - 10 * Math.min(1, spill)));
  const reputation = s.reputation + (target - s.reputation) * 0.05;

  const news = [...s.news];
  const negativeCashMonths = cash < 0 ? s.negativeCashMonths + 1 : 0;
  let gameOver = false;
  if (cash < 0) {
    if (negativeCashMonths >= 3) {
      gameOver = true;
      news.push({ year: s.year, month: s.month, kind: 'bad', text: '資金不足が3か月続き、会社は倒産しました。' });
    } else {
      news.push({ year: s.year, month: s.month, kind: 'bad', text: `資金がマイナスです。あと${3 - negativeCashMonths}か月で立て直せないと倒産します。` });
    }
  }

  // advance calendar
  let year = s.year;
  let month = s.month + 1;
  if (month > 12) { month = 1; year++; }

  // calendar news: airports opening and new aircraft types
  if (month === 1) {
    for (const a of AIRPORTS) if (a.openYear === year) news.push({ year, month, kind: 'history', text: `${a.name}空港（${a.city}）が開港し、定期便を飛ばせるようになりました。` });
    for (const t of AIRCRAFT_TYPES) if (t.introYear === year) news.push({ year, month, kind: 'history', text: `新型機「${t.name}」（${t.maker}）が発売されました。` });
  }

  return {
    ...s,
    year, month, cash, reputation,
    history: [...s.history, report].slice(-120),
    news: news.slice(-300),
    negativeCashMonths,
    gameOver,
  };
}

// ---- formatting (shared with UI) ----------------------------------------

export function formatYen(v: number): string {
  const sign = v < 0 ? '-' : '';
  const a = Math.abs(v);
  if (a >= 1e8) return `${sign}${(a / 1e8).toFixed(a >= 1e10 ? 0 : 2)}億円`;
  if (a >= 1e4) return `${sign}${Math.round(a / 1e4).toLocaleString('ja-JP')}万円`;
  return `${sign}${Math.round(a).toLocaleString('ja-JP')}円`;
}
