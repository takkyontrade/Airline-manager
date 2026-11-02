// Core game state transitions: new game, routes and the monthly simulation.
// All functions are pure: they take a state and return a new one (or an
// error), so the UI and tests share them.
import { AIRPORTS, AIRPORT_BY_CODE, isAirportOpen } from '../data/airports';
import { AIRCRAFT_TYPES } from '../data/aircraft';
import { econ, yearFrac } from '../data/economy';
import {
  ADMIN_SHARE, blockHours, cabinCostMonthly, flightCost, fuelFactor, groundCostPerPax,
  HEAVY_CHECK_HOURS, MAINT_LEVELS, maintAgeFactor,
  marketDemand, overheadMonthly, pilotWage, referenceFare, routeDistance, SALES_COMMISSION,
} from './model';
import {
  heavyCheckDue, heavyCheckOverdue, nowYM, planeAge, planeType, refreshUsedMarket, startHeavyCheck, ymLabel,
} from './fleet';
import { serviceLoans } from './finance';
import { crewedPlanes, graduateTrainees, traineeCount } from './staff';
import {
  autoSchedule, baseCostMonthly, dayCount, INITIAL_SLOTS, legMinutes, opsCostMonthly, routeWeekly,
  simulateDelays, slotAirports, validateRotation,
} from './schedule';
import type { GameState, MaintLevel, MonthCosts, MonthReport, Plane, Route, RouteResult, SchedulePolicy } from './types';
import { fail, formatYen, nextId, ok, rng, withNews, type Result } from './util';
import { isTrunk, competitors, pairKey, updatePressure, type Competitor } from './rivals';
import { fareBand, GROUNDINGS, HISTORY_NEWS, RAIL_OPENINGS, DEMAND_EVENTS, routeLicensing } from '../data/history';
import { RIVAL_EVENTS } from '../data/rivals';

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
    version: 3,
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
    crewBases: [baseAirport],
    bufferMin: 15,
    opsLevel: 0,
    slots: { ...INITIAL_SLOTS },
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

export function setOps(s: GameState, patch: { bufferMin?: number; opsLevel?: number }): Result {
  const next = { ...s, ...patch };
  next.bufferMin = Math.max(0, Math.min(90, Math.round(next.bufferMin)));
  next.opsLevel = Math.max(0, Math.min(3, Math.round(next.opsLevel)));
  return ok(autoSchedule(next));
}

export function toggleCrewBase(s: GameState, code: string): Result {
  if (code === s.baseAirport) return fail('本社のある拠点は外せません');
  const has = s.crewBases.includes(code);
  const crewBases = has ? s.crewBases.filter((c) => c !== code) : [...s.crewBases, code];
  return ok(withNews({ ...s, crewBases }, has ? `${AIRPORT_BY_CODE[code].name}の乗員基地を閉鎖しました。` : `${AIRPORT_BY_CODE[code].name}に乗員基地を開設しました。`));
}

// ---- routes -------------------------------------------------------------

/** Planes that can actually fly this month: delivered, not in heavy check, crewed, not grounded */
export function flyablePlanes(s: GameState): Set<string> {
  const crewed = crewedPlanes(s);
  return new Set(s.planes.filter((p) => p.status === 'active' && crewed.has(p.id) && !heavyCheckOverdue(p) && !isGrounded(p.typeId, s.year, s.month) && validateRotation(s, p).length === 0).map((p) => p.id));
}

export function isGrounded(typeId: string, year: number, month: number): boolean {
  const t = year * 12 + month;
  return GROUNDINGS.some((g) => g.typeId === typeId && t >= g.from[0] * 12 + g.from[1] && t <= g.to[0] * 12 + g.to[1]);
}

/** Government approval for a new route (regulated eras) */
export function routeApproval(s: GameState, from: string, to: string): { ok: boolean; reason: string } {
  const lic = routeLicensing(s.year);
  if (!lic.required) return { ok: true, reason: lic.label };
  const rivals = competitors(s, from, to);
  if (rivals.length === 0) return { ok: true, reason: '他社が飛んでいない路線なので免許が下りました' };
  if (!isTrunk(from, to)) return { ok: true, reason: 'ローカル線なので免許が下りました' };
  const fleet = s.planes.filter((p) => p.status !== 'onOrder').length;
  const need = s.year < 1986 ? { rep: 52, fleet: 2 } : { rep: 45, fleet: 1 };
  if (s.reputation >= need.rep && fleet >= need.fleet) return { ok: true, reason: '実績が認められ、免許が下りました' };
  return { ok: false, reason: `${lic.label}。幹線への参入には評判${need.rep}以上・機材${need.fleet}機以上の実績が必要です` };
}

export const planesOnRoute = (s: GameState, routeId: string) => s.planes.filter((p) => p.schedule.some((l) => l.routeId === routeId));

/** `skipLicense` is for tests and sandbox tools only */
export function openRoute(s: GameState, from: string, to: string, opts: { skipLicense?: boolean } = {}): Result {
  if (from === to) return fail('同じ空港同士は結べません');
  const a = AIRPORT_BY_CODE[from];
  const b = AIRPORT_BY_CODE[to];
  if (!a || !b) return fail('空港が見つかりません');
  if (!isAirportOpen(a, s.year) || !isAirportOpen(b, s.year)) return fail('まだ開港していない空港があります');
  if (s.routes.some((r) => (r.from === from && r.to === to) || (r.from === to && r.to === from)))
    return fail('すでに開設済みの路線です');
  const approval = routeApproval(s, from, to);
  if (!approval.ok && !opts.skipLicense) return fail(approval.reason);
  const [id, s2] = nextId(s, 'R');
  const km = routeDistance(from, to);
  const route: Route = {
    id, from, to, targetWeekly: 7, typeId: null, policy: 'pack', fareYen: referenceFare(km, s.year, s.month),
    openedYear: s.year, openedMonth: s.month,
  };
  return ok(autoSchedule(withNews({ ...s2, routes: [...s2.routes, route] }, `${a.name}〜${b.name}線を開設しました。`)));
}

export function closeRoute(s: GameState, routeId: string): Result {
  const r = s.routes.find((x) => x.id === routeId);
  if (!r) return fail('路線が見つかりません');
  return ok(autoSchedule(withNews({
    ...s,
    routes: s.routes.filter((x) => x.id !== routeId),
    planes: s.planes.map((p) => ({ ...p, schedule: p.schedule.filter((l) => l.routeId !== routeId) })),
  }, `${AIRPORT_BY_CODE[r.from].name}〜${AIRPORT_BY_CODE[r.to].name}線を廃止しました。`)));
}

export type RoutePatch = Partial<{ fareYen: number; targetWeekly: number; typeId: string | null; policy: SchedulePolicy }>;

export function setRoute(s: GameState, routeId: string, patch: RoutePatch): Result {
  const r = s.routes.find((x) => x.id === routeId);
  if (!r) return fail('路線が見つかりません');
  const next = { ...r, ...patch };
  next.targetWeekly = Math.max(0, Math.min(140, Math.round(next.targetWeekly)));
  next.fareYen = Math.max(100, Math.round(next.fareYen / 10) * 10);
  const band = fareBand(s.year);
  if (band && patch.fareYen !== undefined) {
    const ref = referenceFare(routeDistance(r.from, r.to), s.year, s.month);
    next.fareYen = Math.round(Math.min(ref * band[1], Math.max(ref * band[0], next.fareYen)) / 10) * 10;
  }
  const s2 = { ...s, routes: s.routes.map((x) => (x.id === routeId ? next : x)) };
  // fares don't change the timetable
  const scheduleChanged = patch.targetWeekly !== undefined || patch.typeId !== undefined || patch.policy !== undefined;
  return ok(scheduleChanged ? autoSchedule(s2) : s2);
}

// ---- market ----------------------------------------------------------------

export interface RouteForecast {
  marketOneWay: number;
  share: number;
  rivals: Competitor[];
  refFare: number;
  weeklyRt: number;
}

function routeComfort(legs: { plane: Plane; perWeek: number }[]): number {
  const n = legs.reduce((a, l) => a + l.perWeek, 0);
  return n ? legs.reduce((a, l) => a + l.perWeek * planeType(l.plane).comfort * (0.9 + l.plane.condition / 1000), 0) / n : 1;
}

/** Last month's on-time rate of a route (0.85 if no history) */
function lastOnTime(s: GameState, routeId: string): number {
  const r = s.history[s.history.length - 1]?.routes.find((x) => x.routeId === routeId);
  return r && r.flights > 0 ? r.onTime : 0.85;
}

export function routeMarket(s: GameState, route: Route, fly = flyablePlanes(s)): RouteForecast {
  const { year, month } = s;
  const km = routeDistance(route.from, route.to);
  const ref = referenceFare(km, year, month);
  const base = marketDemand(route.from, route.to, year, month);
  const rivals = competitors(s, route.from, route.to);
  const wk = routeWeekly(s, route, fly);
  const effFreq = (wk.weight[0] + wk.weight[1]) / 2; // time-of-day weighted weekly departures
  const repF = (s.reputation / 50) ** 0.3;
  const otpF = 0.8 + 0.25 * lastOnTime(s, route.id);
  const priceRatio = route.fareYen / ref;
  const aUs = effFreq > 0 ? effFreq ** 0.8 * priceRatio ** -2 * routeComfort(wk.legs) * repF * otpF : 0;
  let aRivals = 0;
  let rivalPriceSum = 0;
  let rivalFreq = 0;
  for (const c of rivals) {
    const a = c.weeklyFreq ** 0.8 * c.fareMul ** -2 * c.comfort;
    aRivals += a;
    rivalPriceSum += a * c.fareMul;
    rivalFreq += c.weeklyFreq;
  }
  const total = aUs + aRivals;
  const share = total > 0 ? aUs / total : 0;
  const totalFreq = wk.roundTrips + rivalFreq;
  const avgPriceRatio = total > 0 ? (aUs * priceRatio + rivalPriceSum) / total : 1;
  const freqF = 0.6 + 0.4 * Math.min(1.3, totalFreq / 14);
  const marketOneWay = base * avgPriceRatio ** -1.1 * freqF;
  return { marketOneWay, share, rivals, refFare: ref, weeklyRt: wk.roundTrips };
}

// ---- monthly simulation -------------------------------------------------

function emptyCosts(): MonthCosts {
  return { fuel: 0, maintenance: 0, heavyChecks: 0, crew: 0, training: 0, airport: 0, ground: 0, sales: 0, delays: 0, bases: 0, lease: 0, interest: 0, overhead: 0 };
}

/** Start-of-month events: deliveries, checks finishing, leases ending, auto heavy checks, slots */
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
  for (const p of s.planes) {
    if (p.status === 'active' && heavyCheckDue(p)) {
      const r = startHeavyCheck(s, p.id);
      if (r.ok) s = r.state;
    }
  }
  // April: the ministry allocates additional slots at congested airports
  if (s.month === 4) {
    const extra: Record<string, number> = {};
    for (const code of slotAirports(s.year)) {
      const growth = 2 + Math.floor(s.reputation / 25) + (s.year === 2010 && code === 'HND' ? 10 : 0) + (s.year >= 1988 && s.year <= 2000 && code === 'HND' ? 2 : 0);
      extra[code] = (s.slots[code] ?? INITIAL_SLOTS[code] ?? 8) + growth;
    }
    s = withNews({ ...s, slots: { ...s.slots, ...extra } }, `今年度の発着枠の配分が決まりました（${Object.entries(extra).map(([c, n]) => `${AIRPORT_BY_CODE[c].name} 1日${n}回`).join('、')}）。`);
  }
  s = graduateTrainees(s);
  return { s: autoSchedule(s), deliveriesPaid };
}

export function advanceMonth(s0: GameState): GameState {
  if (s0.gameOver) return s0;
  const { s, deliveriesPaid } = beginMonth(s0);
  const r = rng(s.seed + s.year * 12 + s.month);
  const costs = emptyCosts();
  const prepaid = (s.monthExpenses?.training ?? 0) + (s.monthExpenses?.heavyChecks ?? 0);
  costs.training = s.monthExpenses?.training ?? 0;
  costs.heavyChecks = s.monthExpenses?.heavyChecks ?? 0;
  const fly = flyablePlanes(s);
  const level = MAINT_LEVELS[s.maintLevel];
  const cpi = econ.jpCpi(yearFrac(s.year, s.month));

  // delays: simulate every flying plane's rotation
  const legStats = new Map<object, { onTime: number; cancelled: number; flights: number }>();
  for (const p of s.planes) {
    if (!fly.has(p.id)) continue;
    for (const [leg, st] of simulateDelays(s, p, s.seed + nowYM(s) * 97 + Number(p.id.slice(1)))) legStats.set(leg, st);
  }

  const hours: Record<string, number> = {};
  const routes: RouteResult[] = [];
  const shareByPair: Record<string, number> = {};
  let revenue = 0;
  let delayedFlights = 0;
  let totalFlights = 0;
  let onTimeFlights = 0;

  for (const route of s.routes) {
    const wk = routeWeekly(s, route, fly);
    const f = routeMarket(s, route, fly);
    const km = routeDistance(route.from, route.to);
    let flights = 0, seats = 0, cancelled = 0, onTime = 0, cost = 0;
    for (const { plane, leg, perWeek } of wk.legs) {
      const t = planeType(plane);
      const st = legStats.get(leg);
      const cancelRate = st && st.flights ? st.cancelled / st.flights : 0;
      const n = perWeek * WEEKS_PER_MONTH;
      const flown = n * (1 - cancelRate);
      flights += flown;
      cancelled += n - flown;
      seats += flown * t.seats;
      onTime += st && st.flights ? (st.onTime / st.flights) * n : n;
      delayedFlights += st && st.flights ? (st.flights - st.onTime - st.cancelled) / st.flights * n : 0;
      const c = flightCost(t, km, s.year, s.month);
      const age = planeAge(plane, s.year);
      const fuel = c.fuel * fuelFactor(age, plane.condition) * flown;
      const wet = plane.lease?.kind === 'wet';
      const maint = wet ? 0 : c.maintenance * level.costMul * maintAgeFactor(age) * flown;
      costs.fuel += fuel;
      costs.maintenance += maint;
      costs.airport += c.airport * flown;
      cost += fuel + maint + c.airport * flown;
      hours[plane.id] = (hours[plane.id] ?? 0) + (legMinutes(plane, route) / 60) * flown;
    }
    const want = f.marketOneWay * f.share * (0.93 + r() * 0.14) * 2;
    const pax = Math.min(want, seats);
    const rev = pax * route.fareYen;
    const ground = pax * groundCostPerPax(s.year, s.month);
    const sales = rev * SALES_COMMISSION;
    costs.ground += ground;
    costs.sales += sales;
    cost += ground + sales;
    revenue += rev;
    totalFlights += flights + cancelled;
    onTimeFlights += onTime;
    shareByPair[pairKey(route.from, route.to)] = f.share;
    routes.push({
      routeId: route.id, flights, seats, pax, demand: want, marketDemand: f.marketOneWay * 2, share: f.share,
      revenue: rev, cost, onTime: flights + cancelled > 0 ? onTime / (flights + cancelled) : 1, cancelled,
    });
  }

  // delay compensation, crew overtime, rebooking
  costs.delays = delayedFlights * 15000 * cpi;

  // people
  const pilots = Object.values(s.pilots).reduce((n, p) => n + p.rated + traineeCount(p), 0);
  costs.crew += pilots * pilotWage(s.year, s.month);
  const now = nowYM(s);
  for (const p of s.planes) {
    if (p.status === 'onOrder') continue;
    const t = planeType(p);
    if (p.lease?.kind !== 'wet') costs.crew += cabinCostMonthly(t, s.year, s.month);
    if (p.lease && p.lease.startYM <= now && now <= p.lease.endYM) costs.lease += p.lease.monthlyYen;
    // crews overnighting away from a crew base need hotels
    if (fly.has(p.id) && p.schedule.length && !s.crewBases.includes(p.base)) {
      const nights = Math.max(...p.schedule.map((l) => dayCount(l.days))) * WEEKS_PER_MONTH;
      costs.bases += nights * (t.cockpitCrew + t.cabinCrew) * 6000 * cpi;
    }
  }
  costs.bases += baseCostMonthly(s) + opsCostMonthly(s);
  const activePlanes = s.planes.filter((p) => p.status !== 'onOrder').length;
  costs.overhead = overheadMonthly(activePlanes, s.year, s.month) + revenue * ADMIN_SHARE;

  const debtService = serviceLoans(s.loans);
  costs.interest = debtService.interest;

  const totalCost = Object.values(costs).reduce((a, b) => a + b, 0);
  const profit = revenue - totalCost;
  const cash = s.cash + profit + prepaid - debtService.principal - deliveriesPaid;
  const pax = routes.reduce((n, x) => n + x.pax, 0);
  const companyOnTime = totalFlights > 0 ? onTimeFlights / totalFlights : 1;
  const report: MonthReport = {
    year: s.year, month: s.month, revenue, costs, profit,
    principalRepaid: debtService.principal, deliveriesPaid, cashEnd: cash, pax, onTime: companyOnTime, routes,
  };

  // aircraft wear
  const planes = s.planes.map((p) => {
    if (p.status === 'onOrder') return p;
    const h = hours[p.id] ?? 0;
    const target = level.target - planeAge(p, s.year) * 0.5;
    const condition = Math.max(10, Math.min(100, p.condition + (target - p.condition) * 0.12 - h / 500));
    return { ...p, condition, totalHours: p.totalHours + h, hoursSinceHeavy: p.hoursSinceHeavy + h };
  });

  // reputation: comfort, unmet demand and punctuality
  const seats = routes.reduce((n, x) => n + x.seats, 0);
  const inService = planes.filter((p) => p.status !== 'onOrder');
  const avgComfort = inService.length
    ? inService.reduce((n, p) => n + planeType(p).comfort * (0.9 + p.condition / 1000), 0) / inService.length
    : 0.9;
  const spill = seats > 0 ? routes.reduce((n, x) => n + Math.max(0, x.demand - x.pax), 0) / Math.max(1, pax) : 0;
  const otpTerm = totalFlights > 0 ? (companyOnTime - 0.85) * 60 : 0;
  const repTarget = Math.max(15, Math.min(90, 30 + 30 * avgComfort - 10 * Math.min(1, spill) + otpTerm));
  const reputation = s.reputation + (repTarget - s.reputation) * 0.05;

  let next: GameState = { ...s, planes, cash, reputation, loans: debtService.loans, hiresThisMonth: {}, monthExpenses: {}, aiPressure: updatePressure(s, shareByPair) };

  const grounded = s.planes.filter((p) => p.status === 'active' && heavyCheckOverdue(p));
  for (const p of grounded) next = withNews(next, `${planeType(p).name}（${p.regNo}）は重整備の期限切れで飛行停止中です。`, 'bad');
  const badRotation = s.planes.filter((p) => p.status === 'active' && validateRotation(s, p).length > 0);
  for (const p of badRotation) next = withNews(next, `${planeType(p).name}（${p.regNo}）のダイヤに問題があり、運休しました：${validateRotation(s, p)[0]}`, 'bad');
  const uncrewed = s.planes.filter((p) => p.status === 'active' && !fly.has(p.id) && !heavyCheckOverdue(p) && validateRotation(s, p).length === 0);
  if (uncrewed.length) next = withNews(next, `パイロット不足で${uncrewed.length}機が飛べませんでした。「人員・整備」で採用や訓練をしましょう。`, 'bad');
  const cancelledTotal = routes.reduce((n, x) => n + x.cancelled, 0);
  if (cancelledTotal >= 1) next = withNews(next, `遅延の連鎖で${Math.round(cancelledTotal)}便が欠航しました。折り返し時間に余裕を持たせると減らせます。`, 'bad');

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

  let year = s.year;
  let month = s.month + 1;
  if (month > 12) { month = 1; year++; }
  next = { ...next, year, month, negativeCashMonths, gameOver, history: [...s.history, report].slice(-120) };

  if (month === 1) {
    for (const a of AIRPORTS) if (a.openYear === year) next = withNews(next, `${a.name}空港（${a.city}）が開港し、定期便を飛ばせるようになりました。`, 'history');
    for (const t of AIRCRAFT_TYPES) if (t.introYear === year) next = withNews(next, `新型機「${t.name}」（${t.maker}）の受注が始まりました。`, 'history');
  }
  next = historyNews(next);
  for (const p of next.planes) {
    if (p.status === 'onOrder' && p.readyYM === nowYM(next) + 1) next = withNews(next, `来月（${ymLabel(p.readyYM)}）${planeType(p).name}が納入されます。パイロットの準備をしておきましょう。`);
  }
  return refreshUsedMarket(next);
}

/** News and world changes at the start of a new month */
function historyNews(s0: GameState): GameState {
  let s = s0;
  const { year, month } = s;
  const t = year * 12 + month;
  for (const n of HISTORY_NEWS) if (n.year === year && n.month === month) s = withNews(s, n.text, 'history');
  for (const r of RAIL_OPENINGS) if (r.year === year && r.month === month) s = withNews(s, `${r.name}が開業しました。並行する航空路線の需要が減ります。`, 'history');
  for (const e of DEMAND_EVENTS) if (e.from[0] * 12 + e.from[1] === t) s = withNews(s, `${e.title}${e.multiplier >= 1 ? '（需要が増えています）' : '（需要が落ち込んでいます）'}`, 'history');
  for (const g of GROUNDINGS) if (g.from[0] * 12 + g.from[1] === t && (s.planes.some((p) => p.typeId === g.typeId) || g.typeId === 'dc10')) s = withNews(s, g.title, 'bad');
  for (const e of RIVAL_EVENTS) if (e.year === year && e.month === month) s = withNews(s, e.text, 'history');
  // routes touching airports that closed this year
  if (month === 1) {
    if (AIRPORT_BY_CODE[s.baseAirport].closeYear === year) {
      const successor = AIRPORTS.find((a) => a.cityGroup && a.cityGroup === AIRPORT_BY_CODE[s.baseAirport].cityGroup && isAirportOpen(a, year));
      if (successor) s = withNews({ ...s, baseAirport: successor.code, crewBases: [...new Set([...s.crewBases, successor.code])] }, `本社の拠点を${successor.name}に移しました。`, 'history');
    }
    const closed = s.routes.filter((r) => [r.from, r.to].some((c) => AIRPORT_BY_CODE[c].closeYear === year));
    for (const r of closed) {
      const res = closeRoute(s, r.id);
      if (res.ok) s = withNews(res.state, `${AIRPORT_BY_CODE[r.from].name}〜${AIRPORT_BY_CODE[r.to].name}線は空港の移転・閉鎖で廃止になりました。`, 'bad');
    }
    for (const p of s.planes) if (AIRPORT_BY_CODE[p.base].closeYear === year) s = { ...s, planes: s.planes.map((x) => (x.id === p.id ? { ...x, base: s.baseAirport, schedule: [], locked: false } : x)) };
  }
  // runway extensions
  if (month === 1) {
    for (const a of AIRPORTS) {
      const ext = a.runways.find(([y], i) => i > 0 && y === year);
      if (ext && isAirportOpen(a, year)) s = withNews(s, `${a.name}空港の滑走路が${ext[1]}mになり、大きな機体が使えるようになりました。`, 'history');
    }
  }
  return s;
}

export { HEAVY_CHECK_HOURS, blockHours };
