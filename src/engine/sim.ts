// Core game state transitions: new game, routes and the monthly simulation.
// All functions are pure: they take a state and return a new one (or an
// error), so the UI and tests share them.
import { AIRPORTS, AIRPORT_BY_CODE, isAirportOpen } from '../data/airports';
import { AIRCRAFT_TYPES } from '../data/aircraft';
import {
  ADMIN_SHARE, blockHours, cabinCostMonthly, canFly, flightCost, fuelFactor, groundCostPerPax,
  HEAVY_CHECK_HOURS, incumbentComfort, incumbentWeeklyFreq, MAINT_LEVELS, maintAgeFactor,
  marketDemand, maxWeeklyRoundTrips, overheadMonthly, pilotWage, referenceFare, routeDistance,
  SALES_COMMISSION,
} from './model';
import {
  heavyCheckDue, heavyCheckOverdue, nowYM, planeAge, planeType, refreshUsedMarket, startHeavyCheck, ymLabel,
} from './fleet';
import { serviceLoans } from './finance';
import { crewedPlanes, graduateTrainees, traineeCount } from './staff';
import type { GameState, MaintLevel, MonthCosts, MonthReport, Plane, Route, RouteResult } from './types';
import { fail, formatYen, nextId, ok, rng, withNews, type Result } from './util';

export { formatYen, type Result } from './util';
export { planeType, planeAge } from './fleet';

export const START_YEAR = 1960;
export const START_CASH = 500_000_000;
export const WEEKS_PER_MONTH = 4.33;

export const openAirports = (year: number) => AIRPORTS.filter((a) => isAirportOpen(a, year));

// ---- new game -----------------------------------------------------------

export function newGame(companyName: string, baseAirport: string, seed = Date.now()): GameState {
  const name = companyName.trim() || '新日本航空';
  const s: GameState = {
    version: 2,
    companyName: name,
    baseAirport,
    year: START_YEAR,
    month: 1,
    cash: START_CASH,
    reputation: 50,
    planes: [],
    routes: [],
    loans: [],
    // the founders bring a few pilots rated on the ubiquitous DC-3
    pilots: { dc3: { rated: 10, training: [] } },
    maintLevel: 'standard',
    usedMarket: [],
    history: [],
    news: [{
      year: START_YEAR, month: 1, kind: 'info',
      text: `${name}が${AIRPORT_BY_CODE[baseAirport].name}を拠点に設立されました。資本金は5億円、DC-3の資格を持つパイロットが10人います。`,
    }],
    negativeCashMonths: 0,
    gameOver: false,
    nextId: 1,
    seed: seed >>> 0,
  };
  return refreshUsedMarket(s);
}

export function setMaintLevel(s: GameState, level: MaintLevel): Result {
  return ok({ ...s, maintLevel: level });
}

// ---- routes -------------------------------------------------------------

export const planesOnRoute = (planes: Plane[], routeId: string) => planes.filter((p) => p.routeId === routeId);

/** Planes that can actually fly this month: delivered, not in heavy check, crewed, not grounded */
export function flyablePlanes(s: GameState): Set<string> {
  const crewed = crewedPlanes(s);
  return new Set(s.planes.filter((p) => p.status === 'active' && crewed.has(p.id) && !heavyCheckOverdue(p)).map((p) => p.id));
}

export function routeCapacity(s: GameState, route: Route): number {
  const km = routeDistance(route.from, route.to);
  const fly = flyablePlanes(s);
  return planesOnRoute(s.planes, route.id).filter((p) => fly.has(p.id)).reduce((n, p) => n + maxWeeklyRoundTrips(planeType(p), km), 0);
}

/** Capacity ignoring crew shortages and checks (what the player can plan for) */
export function routePlannedCapacity(s: GameState, route: Route): number {
  const km = routeDistance(route.from, route.to);
  return planesOnRoute(s.planes, route.id).filter((p) => p.status !== 'onOrder').reduce((n, p) => n + maxWeeklyRoundTrips(planeType(p), km), 0);
}

function clampRoutes(s: GameState): GameState {
  return { ...s, routes: s.routes.map((r) => {
    const cap = routePlannedCapacity(s, r);
    return r.weeklyFreq > cap ? { ...r, weeklyFreq: cap } : r;
  }) };
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
  return ok(withNews({ ...s2, routes: [...s2.routes, route] }, `${a.name}〜${b.name}線を開設しました。`));
}

export function closeRoute(s: GameState, routeId: string): Result {
  const r = s.routes.find((x) => x.id === routeId);
  if (!r) return fail('路線が見つかりません');
  return ok(withNews({
    ...s,
    routes: s.routes.filter((x) => x.id !== routeId),
    planes: s.planes.map((p) => (p.routeId === routeId ? { ...p, routeId: null } : p)),
  }, `${AIRPORT_BY_CODE[r.from].name}〜${AIRPORT_BY_CODE[r.to].name}線を廃止しました。`));
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
  return ok(clampRoutes({ ...s, planes: s.planes.map((x) => (x.id === planeId ? { ...x, routeId } : x)) }));
}

export function setRoute(s: GameState, routeId: string, patch: Partial<Pick<Route, 'weeklyFreq' | 'fareYen'>>): Result {
  const r = s.routes.find((x) => x.id === routeId);
  if (!r) return fail('路線が見つかりません');
  const next = { ...r, ...patch };
  next.weeklyFreq = Math.max(0, Math.min(routePlannedCapacity(s, r), Math.round(next.weeklyFreq)));
  next.fareYen = Math.max(100, Math.round(next.fareYen / 10) * 10);
  return ok({ ...s, routes: s.routes.map((x) => (x.id === routeId ? next : x)) });
}

// ---- monthly simulation -------------------------------------------------

interface Usage { plane: Plane; rt: number }

/** Distribute a route's weekly round trips over its flyable planes */
function routeFleetMix(s: GameState, route: Route, fly: Set<string>) {
  const km = routeDistance(route.from, route.to);
  let remaining = route.weeklyFreq;
  const usage: Usage[] = [];
  for (const p of planesOnRoute(s.planes, route.id)) {
    if (!fly.has(p.id)) continue;
    const rt = Math.min(maxWeeklyRoundTrips(planeType(p), km), remaining);
    remaining -= rt;
    usage.push({ plane: p, rt });
  }
  const totalRt = usage.reduce((n, u) => n + u.rt, 0);
  const seatsPerRt = totalRt ? usage.reduce((n, u) => n + u.rt * planeType(u.plane).seats, 0) / totalRt : 0;
  const comfort = totalRt
    ? usage.reduce((n, u) => n + u.rt * planeType(u.plane).comfort * (0.9 + u.plane.condition / 1000), 0) / totalRt
    : 1;
  return { usage, totalRt, seatsPerRt, comfort, km };
}

export interface RouteForecast {
  marketOneWay: number;
  share: number;
  incumbentFreq: number;
  refFare: number;
  flyingRt: number;
}

export function routeMarket(s: GameState, route: Route, fly = flyablePlanes(s)): RouteForecast {
  const { year, month } = s;
  const km = routeDistance(route.from, route.to);
  const ref = referenceFare(km, year, month);
  const base = marketDemand(route.from, route.to, year, month);
  const inc = incumbentWeeklyFreq(route.from, route.to, year, month);
  const { totalRt, comfort } = routeFleetMix(s, route, fly);
  const repF = (s.reputation / 50) ** 0.3;
  const priceRatio = route.fareYen / ref;
  const aUs = totalRt > 0 ? totalRt ** 0.8 * priceRatio ** -2 * comfort * repF : 0;
  const aInc = inc > 0 ? inc ** 0.8 * incumbentComfort(year) : 0;
  const share = aUs + aInc > 0 ? aUs / (aUs + aInc) : 0;
  const totalFreq = totalRt + inc;
  const avgPriceRatio = aUs + aInc > 0 ? (aUs * priceRatio + aInc) / (aUs + aInc) : 1;
  const freqF = 0.6 + 0.4 * Math.min(1.3, totalFreq / 14);
  const marketOneWay = base * avgPriceRatio ** -1.1 * freqF;
  return { marketOneWay, share, incumbentFreq: inc, refFare: ref, flyingRt: totalRt };
}

function emptyCosts(): MonthCosts {
  return { fuel: 0, maintenance: 0, heavyChecks: 0, crew: 0, training: 0, airport: 0, ground: 0, sales: 0, lease: 0, interest: 0, overhead: 0 };
}

/** Start-of-month events: deliveries, checks finishing, leases ending, auto heavy checks */
function beginMonth(s0: GameState): { s: GameState; deliveriesPaid: number } {
  let s = s0;
  const now = nowYM(s);
  let deliveriesPaid = 0;
  const planes: Plane[] = [];
  for (const p of s.planes) {
    const t = planeType(p);
    if (p.status === 'onOrder' && p.readyYM <= now) {
      deliveriesPaid += p.balanceDueYen;
      s = withNews(s, `${t.name}（${p.regNo}）が納入されました${p.balanceDueYen ? `（残金${formatYen(p.balanceDueYen)}を支払い）` : ''}。`, 'good');
      planes.push({ ...p, status: 'active', balanceDueYen: 0, builtYear: s.year, acquiredYM: now });
      continue;
    }
    if (p.status === 'heavyCheck' && p.readyYM <= now) {
      s = withNews(s, `${t.name}（${p.regNo}）が重整備を終えて復帰しました。`);
      planes.push({ ...p, status: 'active', condition: Math.min(100, p.condition + 25), hoursSinceHeavy: 0, heavyChecks: p.heavyChecks + 1 });
      continue;
    }
    if (p.lease && p.status !== 'onOrder' && p.lease.endYM < now) {
      if (p.lease.kind === 'finance') {
        s = withNews(s, `${t.name}（${p.regNo}）のファイナンスリースが満了し、自社保有機になりました。`, 'good');
        planes.push({ ...p, lease: null });
      } else {
        s = withNews(s, `${t.name}（${p.regNo}）のリース期間が満了し、返却しました。`);
      }
      continue;
    }
    planes.push(p);
  }
  s = { ...s, planes };
  // planes reaching their heavy-check interval go in automatically
  for (const p of s.planes) {
    if (p.status === 'active' && heavyCheckDue(p)) {
      const r = startHeavyCheck(s, p.id);
      if (r.ok) s = r.state;
    }
  }
  s = graduateTrainees(s);
  return { s: clampRoutes(s), deliveriesPaid };
}

export function advanceMonth(s0: GameState): GameState {
  if (s0.gameOver) return s0;
  const { s, deliveriesPaid } = beginMonth(s0);
  const r = rng(s.seed + s.year * 12 + s.month);
  const costs = emptyCosts();
  // costs already paid in cash during the month (training, hiring, heavy checks)
  const prepaid = (s.monthExpenses?.training ?? 0) + (s.monthExpenses?.heavyChecks ?? 0);
  costs.training = s.monthExpenses?.training ?? 0;
  costs.heavyChecks = s.monthExpenses?.heavyChecks ?? 0;
  const fly = flyablePlanes(s);
  const hours: Record<string, number> = {};
  const routes: RouteResult[] = [];
  let revenue = 0;
  const level = MAINT_LEVELS[s.maintLevel];

  for (const route of s.routes) {
    const mix = routeFleetMix(s, route, fly);
    const f = routeMarket(s, route, fly);
    const flights = mix.totalRt * WEEKS_PER_MONTH * 2;
    const seats = mix.seatsPerRt * flights;
    const want = f.marketOneWay * f.share * (0.93 + r() * 0.14) * 2;
    const pax = Math.min(want, seats);
    const rev = pax * route.fareYen;
    let cost = 0;
    for (const u of mix.usage) {
      const t = planeType(u.plane);
      const n = u.rt * WEEKS_PER_MONTH * 2;
      const c = flightCost(t, mix.km, s.year, s.month);
      const age = planeAge(u.plane, s.year);
      const fuel = c.fuel * fuelFactor(age, u.plane.condition) * n;
      const wet = u.plane.lease?.kind === 'wet';
      const maint = wet ? 0 : c.maintenance * level.costMul * maintAgeFactor(age) * n;
      costs.fuel += fuel;
      costs.maintenance += maint;
      costs.airport += c.airport * n;
      cost += fuel + maint + c.airport * n;
      hours[u.plane.id] = (hours[u.plane.id] ?? 0) + blockHours(t, mix.km) * n;
    }
    const ground = pax * groundCostPerPax(s.year, s.month);
    const sales = rev * SALES_COMMISSION;
    costs.ground += ground;
    costs.sales += sales;
    cost += ground + sales;
    revenue += rev;
    routes.push({ routeId: route.id, flights, seats, pax, demand: want, marketDemand: f.marketOneWay * 2, share: f.share, revenue: rev, cost });
  }

  // people
  const pilots = Object.values(s.pilots).reduce((n, p) => n + p.rated + traineeCount(p), 0);
  costs.crew += pilots * pilotWage(s.year, s.month);
  const now = nowYM(s);
  for (const p of s.planes) {
    if (p.status === 'onOrder') continue;
    if (p.lease?.kind !== 'wet') costs.crew += cabinCostMonthly(planeType(p), s.year, s.month);
    if (p.lease && p.lease.startYM <= now && now <= p.lease.endYM) costs.lease += p.lease.monthlyYen;
  }
  const activePlanes = s.planes.filter((p) => p.status !== 'onOrder').length;
  costs.overhead = overheadMonthly(activePlanes, s.year, s.month) + revenue * ADMIN_SHARE;

  // debt service
  const debtService = serviceLoans(s.loans);
  costs.interest = debtService.interest;

  const totalCost = Object.values(costs).reduce((a, b) => a + b, 0);
  const profit = revenue - totalCost;
  const cash = s.cash + profit + prepaid - debtService.principal - deliveriesPaid;
  const pax = routes.reduce((n, x) => n + x.pax, 0);
  const report: MonthReport = {
    year: s.year, month: s.month, revenue, costs, profit,
    principalRepaid: debtService.principal, deliveriesPaid, cashEnd: cash, pax, routes,
  };

  // aircraft wear: condition drifts toward the maintenance target, minus wear from flying
  const planes = s.planes.map((p) => {
    if (p.status === 'onOrder') return p;
    const h = hours[p.id] ?? 0;
    const target = level.target - planeAge(p, s.year) * 0.5;
    const condition = Math.max(10, Math.min(100, p.condition + (target - p.condition) * 0.12 - h / 500));
    return { ...p, condition, totalHours: p.totalHours + h, hoursSinceHeavy: p.hoursSinceHeavy + h };
  });

  // reputation drifts toward a level set by comfort and unmet demand
  const seats = routes.reduce((n, x) => n + x.seats, 0);
  const inService = planes.filter((p) => p.status !== 'onOrder');
  const avgComfort = inService.length
    ? inService.reduce((n, p) => n + planeType(p).comfort * (0.9 + p.condition / 1000), 0) / inService.length
    : 0.9;
  const spill = seats > 0 ? routes.reduce((n, x) => n + Math.max(0, x.demand - x.pax), 0) / Math.max(1, pax) : 0;
  const repTarget = Math.max(20, Math.min(80, 30 + 30 * avgComfort - 10 * Math.min(1, spill)));
  const reputation = s.reputation + (repTarget - s.reputation) * 0.05;

  let next: GameState = { ...s, planes, cash, reputation, loans: debtService.loans, hiresThisMonth: {}, monthExpenses: {} };

  // warnings
  const grounded = s.planes.filter((p) => p.status === 'active' && heavyCheckOverdue(p));
  for (const p of grounded) next = withNews(next, `${planeType(p).name}（${p.regNo}）は重整備の期限切れで飛行停止中です。`, 'bad');
  const uncrewed = s.planes.filter((p) => p.status === 'active' && !fly.has(p.id) && !heavyCheckOverdue(p));
  if (uncrewed.length) next = withNews(next, `パイロット不足で${uncrewed.length}機が飛べませんでした。「人員・整備」で採用や訓練をしましょう。`, 'bad');

  const negativeCashMonths = cash < 0 ? s.negativeCashMonths + 1 : 0;
  let gameOver = false;
  if (cash < 0) {
    if (negativeCashMonths >= 3) {
      gameOver = true;
      next = withNews(next, '資金不足が3か月続き、会社は倒産しました。', 'bad');
    } else {
      next = withNews(next, `資金がマイナスです。あと${3 - negativeCashMonths}か月で立て直せないと倒産します（銀行借入も検討しましょう）。`, 'bad');
    }
  }

  // advance calendar
  let year = s.year;
  let month = s.month + 1;
  if (month > 12) { month = 1; year++; }
  next = { ...next, year, month, negativeCashMonths, gameOver, history: [...s.history, report].slice(-120) };

  if (month === 1) {
    for (const a of AIRPORTS) if (a.openYear === year) next = withNews(next, `${a.name}空港（${a.city}）が開港し、定期便を飛ばせるようになりました。`, 'history');
    for (const t of AIRCRAFT_TYPES) if (t.introYear === year) next = withNews(next, `新型機「${t.name}」（${t.maker}）の受注が始まりました。`, 'history');
  }
  // upcoming deliveries reminder
  for (const p of next.planes) {
    if (p.status === 'onOrder' && p.readyYM === nowYM(next) + 1) next = withNews(next, `来月（${ymLabel(p.readyYM)}）${planeType(p).name}が納入されます。路線とパイロットの準備をしておきましょう。`);
  }
  return refreshUsedMarket(next);
}

export { HEAVY_CHECK_HOURS };
