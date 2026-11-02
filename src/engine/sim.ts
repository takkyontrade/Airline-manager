// Core game state transitions: new game, routes and the monthly simulation.
// All functions are pure: they take a state and return a new one (or an
// error), so the UI and tests share them.
import { AIRPORTS, AIRPORT_BY_CODE, isAirportOpen, isForeign } from '../data/airports';
import { ALLIANCE_BY_ID } from '../data/alliances';
import { RIVAL_BY_ID } from '../data/rivals';
import { AIRCRAFT_BY_ID, AIRCRAFT_TYPES, cargoCapacity } from '../data/aircraft';
import { econ, yearFrac } from '../data/economy';
import {
  ADMIN_SHARE, blockHours, cabinCostMonthly, flightCost, fuelFactor, groundCostPerPax,
  HEAVY_CHECK_HOURS, MAINT_LEVELS, maintAgeFactor,
  accidentRatePerFlight, cargoDemandT, flownKm, TECH_STOPS, cargoHandlingPerKg, cargoReferenceRate, MINOR_PER_ACCIDENT, riskFactor, SERIOUS_PER_ACCIDENT,
  marketDemand, intlDemand, intlGatewayShare, isIntlRoute, overheadMonthly, pilotWage, routeReferenceFare, SALES_COMMISSION,
} from './model';
import {
  heavyCheckDue, heavyCheckOverdue, nowYM, planeValue, planeAge, planeType, refreshUsedMarket, startHeavyCheck, ymLabel,
} from './fleet';
import { serviceLoans } from './finance';
import { crewedPlanes, graduateTrainees, traineeCount } from './staff';
import {
  autoSchedule, baseCostMonthly, dayCount, INITIAL_SLOTS, legMinutes, opsCostMonthly, routeWeekly,
  simulateDelays, slotAirports, validateRotation,
} from './schedule';
import type { CabinLayout, GameState, MaintLevel, MonthCosts, MonthReport, Plane, Route, RouteResult, SchedulePolicy } from './types';
import { fail, formatYen, nextId, ok, rng, withNews, type Result } from './util';
import { allianceMembers, isTrunk, competitors, pairKey, partners, rivalCargoWeeklyT, updatePressure, type Competitor } from './rivals';
import { fareBand, GROUNDINGS, HISTORY_NEWS, RAIL_OPENINGS, DEMAND_EVENTS, routeLicensing } from '../data/history';
import { RIVAL_EVENTS } from '../data/rivals';
import { cabinAcceptance, cabinSeats, DEFAULT_COMPANY_LIVERY, liveryBonus, noteCabin, premiumDemandShare, premiumFareMul } from './brand';

export { formatYen, type Result } from './util';
export { planeType, planeAge } from './fleet';

export const START_YEAR = 1960;
export const START_CASH = 500_000_000;
export const WEEKS_PER_MONTH = 4.33;

export const openAirports = (year: number) => AIRPORTS.filter((a) => isAirportOpen(a, year));

// ---- new game -----------------------------------------------------------

export type Difficulty = 'easy' | 'normal' | 'hard';
export const DIFFICULTY: Record<Difficulty, { label: string; cash: number; rivals: number; note: string }> = {
  easy: { label: 'やさしい', cash: 2, rivals: 0.8, note: '資本金2倍、ライバルは控えめ' },
  normal: { label: 'ふつう', cash: 1, rivals: 1, note: '' },
  hard: { label: 'むずかしい', cash: 0.6, rivals: 1.2, note: '資本金6割、ライバルが積極的' },
};

/** Start years with a matching founding crew */
export const START_OPTIONS: { year: number; label: string; pilotType: string; note: string }[] = [
  { year: 1960, label: '1960年 プロペラ機の時代', pilotType: 'dc3', note: '航空の夜明け。中古のDC-3から始めて、ジェット時代を迎えます。' },
  { year: 1972, label: '1972年 ジャンボと45・47体制', pilotType: 'ys11', note: '沖縄が復帰し、国内線は規制の時代。YS-11の資格を持つ乗員で始めます。' },
  { year: 1986, label: '1986年 規制緩和と国際線開放', pilotType: 'b737-200', note: '国際線に参入できるようになった年。737の乗員で始めます。' },
  { year: 2000, label: '2000年 自由化と新規参入', pilotType: 'b737-500', note: '運賃も路線も自由に。新規参入の航空会社として始めます。' },
];

export function newGame(companyName: string, baseAirport: string, seed = Date.now(), opts: { startYear?: number; difficulty?: Difficulty } = {}): GameState {
  const name = companyName.trim() || '新日本航空';
  const year = opts.startYear ?? START_YEAR;
  const diff = opts.difficulty ?? 'normal';
  const start = START_OPTIONS.find((o) => o.year === year) ?? START_OPTIONS[0];
  const cash = Math.round((START_CASH * econ.jpCpi(year) * DIFFICULTY[diff].cash) / 1e6) * 1e6;
  const s: GameState = {
    version: 3,
    companyName: name,
    baseAirport,
    year,
    month: 1,
    cash,
    reputation: 50,
    planes: [],
    routes: [],
    loans: [],
    // the founders bring a few pilots rated on a common type of the era
    pilots: { [start.pilotType]: { rated: 10, training: [] } },
    maintLevel: 'standard',
    crewBases: [baseAirport],
    bufferMin: 15,
    opsLevel: 0,
    slots: { ...INITIAL_SLOTS },
    usedMarket: [],
    history: [],
    news: [{
      year, month: 1, kind: 'info',
      text: `${name}が${AIRPORT_BY_CODE[baseAirport].name}を拠点に設立されました。資本金は${formatYen(cash)}、${AIRCRAFT_BY_ID[start.pilotType].name}の資格を持つパイロットが10人います。`,
    }],
    negativeCashMonths: 0,
    gameOver: false,
    nextId: 1,
    seed: seed >>> 0,
    foundedYear: year,
    livery: { ...DEFAULT_COMPANY_LIVERY },
    fan: { farewells: [] },
    difficulty: diff,
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
  return ok(autoSchedule(withNews({ ...s, crewBases }, has ? `${AIRPORT_BY_CODE[code].name}の乗員基地を閉鎖しました。` : `${AIRPORT_BY_CODE[code].name}に乗員基地を開設しました。`)));
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
  if (isIntlRoute(from, to)) {
    const jp = isForeign(from) ? to : from;
    if (intlGatewayShare(jp, s.year) === 0) return { ok: false, reason: `${AIRPORT_BY_CODE[jp].name}は${s.year}年には国際線を扱っていません` };
    if (s.year < 1986) return { ok: false, reason: 'この時代、日本の国際線は日本国際航空だけが飛べます（1986年から他社も参入できます）' };
    const fleet = s.planes.filter((p) => p.status !== 'onOrder').length;
    const need = s.year < 2000 ? { rep: 55, fleet: 4 } : { rep: 45, fleet: 2 };
    if (s.reputation >= need.rep && fleet >= need.fleet) return { ok: true, reason: '国際線の運航が認められました' };
    return { ok: false, reason: `国際線の開設には評判${need.rep}以上・機材${need.fleet}機以上の実績が必要です` };
  }
  const lic = routeLicensing(s.year);
  if (!lic.required) return { ok: true, reason: lic.label };
  const rivals = competitors(s, from, to);
  if (rivals.length === 0) return { ok: true, reason: '他社が飛んでいない路線なので免許が下りました' };
  if (!isTrunk(from, to)) return { ok: true, reason: 'ローカル線なので免許が下りました' };
  const fleet = s.planes.filter((p) => p.status !== 'onOrder').length;
  const need = s.year < 1986 ? { rep: 50, fleet: 3 } : { rep: 45, fleet: 2 };
  if (s.reputation >= need.rep && fleet >= need.fleet) return { ok: true, reason: '実績が認められ、免許が下りました' };
  return { ok: false, reason: `${lic.label}。幹線への参入には評判${need.rep}以上・機材${need.fleet}機以上の実績が必要です` };
}

export const planesOnRoute = (s: GameState, routeId: string) => s.planes.filter((p) => p.schedule.some((l) => l.routeId === routeId));

/** `skipLicense` is for tests and sandbox tools only */
export function openRoute(s: GameState, from: string, to: string, opts: { skipLicense?: boolean; kind?: 'pax' | 'cargo' } = {}): Result {
  const kind = opts.kind ?? 'pax';
  if (from === to) return fail('同じ空港同士は結べません');
  const a = AIRPORT_BY_CODE[from];
  const b = AIRPORT_BY_CODE[to];
  if (!a || !b) return fail('空港が見つかりません');
  if (!isAirportOpen(a, s.year) || !isAirportOpen(b, s.year)) return fail('まだ開港していない空港があります');
  if (s.routes.some((r) => (r.kind ?? 'pax') === kind && ((r.from === from && r.to === to) || (r.from === to && r.to === from))))
    return fail(kind === 'cargo' ? 'すでに開設済みの貨物路線です' : 'すでに開設済みの路線です');
  if (a.foreign && b.foreign) return fail('外国の空港同士は結べません（日本発着の路線のみ）');
  // domestic cargo routes were not restricted like passenger trunk routes
  const approval = kind === 'cargo' && !isIntlRoute(from, to) ? { ok: true, reason: '' } : routeApproval(s, from, to);
  if (!approval.ok && !opts.skipLicense) return fail(approval.reason);
  const [id, s2] = nextId(s, 'R');
  const route: Route = {
    id, from, to, targetWeekly: 7, typeId: null, policy: 'pack', fareYen: routeReferenceFare(from, to, s.year, s.month),
    openedYear: s.year, openedMonth: s.month, kind,
  };
  return ok(autoSchedule(withNews({ ...s2, routes: [...s2.routes, route] }, `${a.name}〜${b.name}${kind === 'cargo' ? '貨物線' : '線'}を開設しました。`)));
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

export type RoutePatch = Partial<{ fareYen: number; targetWeekly: number; typeId: string | null; policy: SchedulePolicy; cargoRateYen: number; cabin: CabinLayout; via: string | null }>;

export function setRoute(s: GameState, routeId: string, patch: RoutePatch): Result {
  const r = s.routes.find((x) => x.id === routeId);
  if (!r) return fail('路線が見つかりません');
  const { via: _via, ...rest } = patch;
  const next: Route = { ...r, ...rest };
  next.targetWeekly = Math.max(0, Math.min(140, Math.round(next.targetWeekly)));
  next.fareYen = Math.max(100, Math.round(next.fareYen / 10) * 10);
  if (next.cargoRateYen !== undefined) next.cargoRateYen = Math.max(1, Math.round(next.cargoRateYen));
  if (patch.via !== undefined) {
    if (patch.via === null || patch.via === '') delete next.via;
    else if (!TECH_STOPS.includes(patch.via) || patch.via === r.from || patch.via === r.to || !isIntlRoute(r.from, r.to)) return fail('経由地にできない空港です');
    else next.via = patch.via;
  }
  const band = fareBand(s.year);
  if (band && patch.fareYen !== undefined) {
    const ref = routeReferenceFare(r.from, r.to, s.year, s.month);
    next.fareYen = Math.round(Math.min(ref * band[1], Math.max(ref * band[0], next.fareYen)) / 10) * 10;
  }
  let s2: GameState = { ...s, routes: s.routes.map((x) => (x.id === routeId ? next : x)) };
  if (patch.cabin) s2 = noteCabin(s2, patch.cabin);
  // fares don't change the timetable
  const scheduleChanged = patch.targetWeekly !== undefined || patch.typeId !== undefined || patch.policy !== undefined || patch.via !== undefined;
  return ok(scheduleChanged ? autoSchedule(s2) : s2);
}

// ---- market ----------------------------------------------------------------

export interface RouteForecast {
  marketOneWay: number;
  share: number;
  rivals: Competitor[];
  refFare: number;
  weeklyRt: number;
  /** of marketOneWay: passengers connecting to/from our other flights */
  connecting: number;
  /** rivals we cooperate with on this route */
  partnerIds: string[];
}

/** Our frequency share on a route (used to estimate how much connecting traffic we capture) */
function feedShare(s: GameState, r: Route, fly: Set<string>): number {
  const ours = routeWeekly(s, r, fly).roundTrips;
  if (!ours) return 0;
  const theirs = competitors(s, r.from, r.to).reduce((n, c) => n + c.weeklyFreq, 0);
  return ours / (ours + theirs);
}

/**
 * Connecting passengers: travellers from a domestic city who change at our
 * gateway onto our international flight (or the reverse, on the domestic leg).
 */
export function connectingDemand(s: GameState, route: Route, fly = flyablePlanes(s)): number {
  const { year, month } = s;
  let total = 0;
  const intl = isIntlRoute(route.from, route.to);
  const gw = intl ? (isForeign(route.from) ? route.to : route.from) : null;
  for (const other of s.routes) {
    if (other.id === route.id) continue;
    const bank = route.policy === 'bank' || other.policy === 'bank' ? 1.3 : 1;
    if (intl) {
      // domestic feeder D-G into our international route G-X
      if (isIntlRoute(other.from, other.to)) continue;
      if (other.from !== gw && other.to !== gw) continue;
      const d = other.from === gw ? other.to : other.from;
      const x = route.from === gw ? route.to : route.from;
      total += intlDemand(d, x, year, month, true) * 0.6 * feedShare(s, other, fly) * bank;
    } else {
      // our international route G-X fed by this domestic route D-G
      if (!isIntlRoute(other.from, other.to)) continue;
      const g = isForeign(other.from) ? other.to : other.from;
      if (route.from !== g && route.to !== g) continue;
      const d = route.from === g ? route.to : route.from;
      const x = isForeign(other.from) ? other.from : other.to;
      total += intlDemand(d, x, year, month, true) * 0.6 * feedShare(s, other, fly) * bank;
    }
  }
  return total;
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
  const ref = routeReferenceFare(route.from, route.to, year, month);
  const intl = isIntlRoute(route.from, route.to);
  const connecting = connectingDemand(s, route, fly);
  const rivals = competitors(s, route.from, route.to);
  const ptn = partners(s);
  const partnerIds = rivals.filter((c) => ptn.has(c.rival.id)).map((c) => c.rival.id);
  // a foreign partner feeds passengers from its own network at the far end
  const farFeed = intl && rivals.some((c) => c.rival.role === 'foreign' && ptn.has(c.rival.id)) ? 1.2 : 1;
  const base = marketDemand(route.from, route.to, year, month) * farFeed + connecting;
  const wk = routeWeekly(s, route, fly);
  const effFreq = (wk.weight[0] + wk.weight[1]) / 2; // time-of-day weighted weekly departures
  const repF = (s.reputation / 50) ** 0.3;
  const otpF = 0.8 + 0.25 * lastOnTime(s, route.id);
  const priceRatio = route.fareYen / ref;
  // after an accident, travellers avoid the airline for a while
  const scare = (s.safety?.scareUntilYM ?? -1) >= nowYM(s) ? 0.8 : 1;
  const cabinF = 1 + (route.cabin === 'three' ? 0.08 : route.cabin === 'two' ? 0.05 : 0) * cabinAcceptance(s, route.cabin);
  const liveryF = liveryBonus(s, wk.legs.map((l) => l.plane.id));
  // passengers prefer nonstop flights
  const stopF = route.via ? 0.85 : 1;
  const aUs = effFreq > 0 ? effFreq ** 0.8 * priceRatio ** -2 * routeComfort(wk.legs) * repF * otpF * scare * cabinF * liveryF * stopF : 0;
  let aRivals = 0;
  let rivalPriceSum = 0;
  let rivalFreq = 0;
  for (const c of rivals) {
    // partners coordinate with us instead of competing head-on
    const a = c.weeklyFreq ** 0.8 * c.fareMul ** -2 * c.comfort * (ptn.has(c.rival.id) ? 0.5 : 1);
    aRivals += a;
    rivalPriceSum += a * c.fareMul;
    rivalFreq += c.weeklyFreq;
  }
  const total = aUs + aRivals;
  const share = total > 0 ? aUs / total : 0;
  const totalFreq = wk.roundTrips + rivalFreq;
  const avgPriceRatio = total > 0 ? (aUs * priceRatio + rivalPriceSum) / total : 1;
  const freqF = 0.6 + 0.4 * Math.min(1.3, totalFreq / (intl ? 7 : 14));
  const marketOneWay = base * avgPriceRatio ** -1.1 * freqF;
  return { marketOneWay, share, rivals, refFare: ref, weeklyRt: wk.roundTrips, connecting: connecting * avgPriceRatio ** -1.1 * freqF, partnerIds };
}

// ---- cargo ------------------------------------------------------------------

export interface CargoResult { t: number; rev: number; marketT: number; share: number; rate: number }

/**
 * Air cargo on each route this month. Our routes on the same airport pair
 * (passenger bellies and freighters) sell together against the rivals and the
 * tonnage is split by capacity.
 */
export function cargoResults(s: GameState, fly = flyablePlanes(s), rand: () => number = () => 0.5): Map<string, CargoResult> {
  const byPair = new Map<string, { routes: { route: Route; capW: number; capM: number }[] }>();
  for (const route of s.routes) {
    const wk = routeWeekly(s, route, fly);
    let capW = 0, capM = 0;
    for (const { plane, perWeek } of wk.legs) {
      const t = planeType(plane);
      const c = cargoCapacity(t);
      capW += perWeek * c * (t.freighter ? 1.3 : 1);
      capM += perWeek * c * WEEKS_PER_MONTH;
    }
    const k = pairKey(route.from, route.to);
    const g = byPair.get(k) ?? { routes: [] };
    g.routes.push({ route, capW, capM });
    byPair.set(k, g);
  }
  const out = new Map<string, CargoResult>();
  for (const g of byPair.values()) {
    const { from, to } = g.routes[0].route;
    const marketT = cargoDemandT(from, to, s.year, s.month) * 2;
    const ref = cargoReferenceRate(from, to, s.year, s.month);
    const capW = g.routes.reduce((n, x) => n + x.capW, 0);
    const capM = g.routes.reduce((n, x) => n + x.capM, 0);
    const rate = capW > 0 ? g.routes.reduce((n, x) => n + x.capW * (x.route.cargoRateYen ?? ref), 0) / capW : ref;
    const pr = rate / ref;
    const ours = capW ** 0.9 * pr ** -1.5 * (s.reputation / 50) ** 0.3;
    const theirs = rivalCargoWeeklyT(s, from, to) ** 0.9;
    const share = ours + theirs > 0 ? ours / (ours + theirs) : 0;
    const carried = Math.min(marketT * share * pr ** -0.5 * (0.9 + rand() * 0.2), capM * 0.8);
    for (const x of g.routes) {
      const t = capM > 0 ? (carried * x.capM) / capM : 0;
      out.set(x.route.id, { t, rev: t * 1000 * (x.route.cargoRateYen ?? ref), marketT, share, rate: x.route.cargoRateYen ?? ref });
    }
  }
  return out;
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
    if (p.status === 'shop' && p.readyYM <= now) {
      if (p.convertTo) {
        const to = AIRCRAFT_BY_ID[p.convertTo];
        s = withNews(s, `${t.name}（${p.regNo}）が${to.name}への改修を終えて復帰しました。貨物路線で使えます。`, 'good');
        planes.push({ ...p, typeId: to.id, convertTo: undefined, status: 'active', condition: Math.min(100, p.condition + 20), hoursSinceHeavy: 0 });
      } else {
        s = withNews(s, `${t.name}（${p.regNo}）が修理を終えて復帰しました。`);
        planes.push({ ...p, status: 'active' });
      }
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
  const prepaid = (s.monthExpenses?.training ?? 0) + (s.monthExpenses?.heavyChecks ?? 0) + (s.monthExpenses?.marketing ?? 0);
  costs.marketing = s.monthExpenses?.marketing ?? 0;
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

  const cargo = cargoResults(s, fly, r);
  const planeFlights: Record<string, number> = {};
  for (const route of s.routes) {
    const wk = routeWeekly(s, route, fly);
    const f = routeMarket(s, route, fly);
    const km = flownKm(route.from, route.to, s.year, route.via);
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
      const c = flightCost(t, km, s.year, s.month, isIntlRoute(route.from, route.to));
      // a technical stop means an extra landing
      if (route.via) c.airport *= 1.5;
      const age = planeAge(plane, s.year);
      const fuel = c.fuel * fuelFactor(age, plane.condition) * flown;
      const wet = plane.lease?.kind === 'wet';
      const maint = wet ? 0 : c.maintenance * level.costMul * maintAgeFactor(age) * flown;
      costs.fuel += fuel;
      costs.maintenance += maint;
      costs.airport += c.airport * flown;
      cost += fuel + maint + c.airport * flown;
      hours[plane.id] = (hours[plane.id] ?? 0) + (legMinutes(plane, route, s.year) / 60) * flown;
      planeFlights[plane.id] = (planeFlights[plane.id] ?? 0) + flown;
    }
    const want = f.marketOneWay * f.share * (0.93 + r() * 0.14) * 2;
    // cabin classes: premium seats take more room but earn a multiple of the fare
    const cab = route.cabin ?? 'mono';
    const cs = cabinSeats(seats, cab);
    const wantPrem = cab === 'mono' ? 0 : want * premiumDemandShare(route) * cabinAcceptance(s, cab);
    const premiumPax = Math.min(wantPrem, cs.premium);
    // premium travellers who find no seat partly fly economy instead
    const econPax = Math.min(want - wantPrem + (wantPrem - premiumPax) * 0.5, cs.econ);
    const pax = econPax + premiumPax;
    const cg = cargo.get(route.id);
    const cargoT = cg?.t ?? 0;
    const cargoRev = cg?.rev ?? 0;
    const cargoCost = cargoT * 1000 * cargoHandlingPerKg(isIntlRoute(route.from, route.to), s.year, s.month);
    costs.cargo = (costs.cargo ?? 0) + cargoCost;
    cost += cargoCost;
    const rev = econPax * route.fareYen + premiumPax * route.fareYen * premiumFareMul(route) + cargoRev;
    // international passengers need more service (meals, check-in, immigration handling)
    const ground = pax * groundCostPerPax(s.year, s.month) * (isIntlRoute(route.from, route.to) ? 1.5 : 1);
    const sales = rev * SALES_COMMISSION;
    costs.ground += ground;
    costs.sales += sales;
    cost += ground + sales;
    revenue += rev;
    totalFlights += flights + cancelled;
    onTimeFlights += onTime;
    if (route.kind !== 'cargo') shareByPair[pairKey(route.from, route.to)] = f.share;
    routes.push({
      routeId: route.id, flights, seats: cs.econ + cs.premium, pax, premiumPax, demand: want, marketDemand: f.marketOneWay * 2, share: f.share,
      revenue: rev, cost, onTime: flights + cancelled > 0 ? onTime / (flights + cancelled) : 1, cancelled,
      cargoT, cargoRevenue: cargoRev, cargoMarketT: cg?.marketT ?? 0,
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
    // long-haul crews lay over abroad
    if (fly.has(p.id) && (p.cycleDays ?? 1) > 1) {
      const nights = (7 * (p.cycleDays! - 1)) / p.cycleDays! * WEEKS_PER_MONTH;
      costs.bases += nights * (t.cockpitCrew + t.cabinCrew) * 12000 * cpi;
    }
  }
  costs.bases += baseCostMonthly(s) + opsCostMonthly(s) + partnershipCostMonthly(s);
  const activePlanes = s.planes.filter((p) => p.status !== 'onOrder').length;
  costs.overhead = overheadMonthly(activePlanes, s.year, s.month) + revenue * ADMIN_SHARE;

  // safety: incidents and accidents depend on maintenance, age, fleet mix and ops; never zero
  const safetyOut = safetyEvents(s, planeFlights, r);
  costs.safety = safetyOut.cost;
  costs.insurance = safetyOut.insurance;

  const debtService = serviceLoans(s.loans);
  costs.interest = debtService.interest;

  const totalCost = Object.values(costs).reduce((a, b) => a + b, 0);
  const profit = revenue - totalCost;
  const cash = s.cash + profit + prepaid - debtService.principal - deliveriesPaid + safetyOut.payout;
  const pax = routes.reduce((n, x) => n + x.pax, 0);
  const companyOnTime = totalFlights > 0 ? onTimeFlights / totalFlights : 1;
  const report: MonthReport = {
    year: s.year, month: s.month, revenue, costs, profit,
    principalRepaid: debtService.principal, deliveriesPaid, cashEnd: cash, pax, onTime: companyOnTime, routes,
  };

  // aircraft wear
  const planes = s.planes.filter((p) => !safetyOut.lost.has(p.id)).map((p) => {
    if (safetyOut.repair.has(p.id)) return { ...p, status: 'shop' as const, readyYM: nowYM(s) + safetyOut.repair.get(p.id)!, schedule: [], locked: false, cycleDays: undefined };
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
  const reputation = Math.max(5, s.reputation + (repTarget - s.reputation) * 0.05 - safetyOut.repHit);

  let next: GameState = { ...s, planes, cash, reputation, safety: safetyOut.record, loans: debtService.loans, hiresThisMonth: {}, monthExpenses: {}, aiPressure: updatePressure(s, shareByPair) };

  for (const n of safetyOut.news) next = withNews(next, n.text, n.kind);
  if (safetyOut.lost.size || safetyOut.repair.size) next = autoSchedule(next);

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
    for (const t of AIRCRAFT_TYPES) {
      if (t.convertedOnly && t.conversion?.since === year) next = withNews(next, `旅客機を貨物機に改修する「${t.name}」のプログラムが始まりました。`, 'history');
      else if (!t.convertedOnly && t.introYear === year) next = withNews(next, `新型機「${t.name}」（${t.maker}）の受注が始まりました。`, 'history');
    }
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
  if (month === 1) {
    for (const al of Object.values(ALLIANCE_BY_ID)) {
      if (al.from === year) s = withNews(s, `航空連合「${al.name}」が発足しました。国際線を2路線以上運航し評判60以上なら加盟を申し込めます。`, 'history');
      if (al.japanese && al.japanese[1] === year && s.alliance !== al.id) s = withNews(s, `${RIVAL_BY_ID[al.japanese[0]].name}が「${al.name}」に加盟しました。`, 'history');
    }
  }
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

// ---- alliances and codeshares --------------------------------------------

export const ALLIANCE_FEE_MONTHLY = 15_000_000;
export const CODESHARE_FEE_MONTHLY = 3_000_000;

export function partnershipCostMonthly(s: GameState): number {
  const cpi = econ.jpCpi(yearFrac(s.year, s.month));
  return ((s.alliance ? ALLIANCE_FEE_MONTHLY : 0) + (s.codeshares?.length ?? 0) * CODESHARE_FEE_MONTHLY) * cpi;
}

const intlRouteCount = (s: GameState) => s.routes.filter((r) => isIntlRoute(r.from, r.to)).length;

/** Can the player join this alliance now? */
export function allianceEligibility(s: GameState, id: string): { ok: boolean; reason: string } {
  const al = ALLIANCE_BY_ID[id];
  if (!al) return { ok: false, reason: 'アライアンスが見つかりません' };
  if (s.year < al.from) return { ok: false, reason: `${al.from}年に発足します` };
  if (s.alliance) return { ok: false, reason: 'すでに別のアライアンスに加盟しています' };
  if (al.japanese && s.year >= al.japanese[1]) return { ok: false, reason: `日本からは${RIVAL_BY_ID[al.japanese[0]].name}が加盟済みです` };
  if (s.reputation < 60) return { ok: false, reason: '評判60以上が必要です' };
  if (intlRouteCount(s) < 2) return { ok: false, reason: '国際線を2路線以上運航している必要があります' };
  return { ok: true, reason: '加盟できます' };
}

export function joinAlliance(s: GameState, id: string): Result {
  const e = allianceEligibility(s, id);
  if (!e.ok) return fail(e.reason);
  const al = ALLIANCE_BY_ID[id];
  // individual codeshares with members are absorbed into the alliance
  const members = new Set(allianceMembers({ ...s, alliance: id }, id));
  return ok(withNews({ ...s, alliance: id, codeshares: (s.codeshares ?? []).filter((c) => !members.has(c)), reputation: s.reputation + 2 },
    `${al.name}に加盟しました。加盟各社とのコードシェアと乗り継ぎが始まります。`, 'good'));
}

export function leaveAlliance(s: GameState): Result {
  if (!s.alliance) return fail('アライアンスに加盟していません');
  const al = ALLIANCE_BY_ID[s.alliance];
  return ok(withNews({ ...s, alliance: null, reputation: s.reputation - 3 }, `${al.name}を脱退しました。`));
}

export function codeshareEligibility(s: GameState, rivalId: string): { ok: boolean; reason: string } {
  const r = RIVAL_BY_ID[rivalId];
  if (!r || r.role !== 'foreign') return { ok: false, reason: '海外の航空会社とだけ提携できます' };
  if (s.year < 1990) return { ok: false, reason: 'コードシェアは1990年から結べます' };
  if (s.year < r.from) return { ok: false, reason: 'まだ運航していない会社です' };
  if (partners(s).has(rivalId)) return { ok: false, reason: 'すでに提携しています' };
  if ((s.codeshares?.length ?? 0) >= 3) return { ok: false, reason: '個別提携は3社までです' };
  if (s.reputation < 55) return { ok: false, reason: '評判55以上が必要です' };
  if (intlRouteCount(s) < 1) return { ok: false, reason: '国際線を運航している必要があります' };
  return { ok: true, reason: '提携できます' };
}

export function addCodeshare(s: GameState, rivalId: string): Result {
  const e = codeshareEligibility(s, rivalId);
  if (!e.ok) return fail(e.reason);
  return ok(withNews({ ...s, codeshares: [...(s.codeshares ?? []), rivalId] }, `${RIVAL_BY_ID[rivalId].name}とコードシェア提携を結びました。`, 'good'));
}

export function removeCodeshare(s: GameState, rivalId: string): Result {
  return ok({ ...s, codeshares: (s.codeshares ?? []).filter((c) => c !== rivalId) });
}

// ---- safety ---------------------------------------------------------------

export const MAINT_RISK: Record<MaintLevel, number> = { low: 1.15, standard: 1, high: 0.9 };

/** Company-wide risk compared with the industry average (flight-weighted; 1 = average) */
export function companyRisk(s: GameState): number {
  const types = new Set(s.planes.filter((p) => p.status !== 'onOrder').map((p) => p.typeId)).size;
  const active = s.planes.filter((p) => p.status === 'active');
  if (!active.length) return 1;
  return active.reduce((n, p) => n + riskFactor(p.condition, planeAge(p, s.year), types, s.opsLevel, MAINT_RISK[s.maintLevel]), 0) / active.length;
}

interface SafetyOutcome {
  lost: Set<string>;
  repair: Map<string, number>;
  cost: number;
  insurance: number;
  payout: number;
  repHit: number;
  record: NonNullable<GameState['safety']>;
  news: { text: string; kind: 'bad' | 'good' | 'history' | undefined }[];
}

function safetyEvents(s: GameState, flights: Record<string, number>, r: () => number): SafetyOutcome {
  const cpi = econ.jpCpi(yearFrac(s.year, s.month));
  const base = accidentRatePerFlight(s.year);
  const types = new Set(s.planes.filter((p) => p.status !== 'onOrder').map((p) => p.typeId)).size;
  const out: SafetyOutcome = {
    lost: new Set(), repair: new Map(), cost: 0, insurance: 0, payout: 0, repHit: 0,
    record: { incidents: 0, serious: 0, accidents: 0, ...(s.safety ?? {}) }, news: [],
  };
  let minor = 0;
  for (const p of s.planes) {
    if (p.status === 'onOrder') continue;
    const t = planeType(p);
    const risk = riskFactor(p.condition, planeAge(p, s.year), types, s.opsLevel, MAINT_RISK[s.maintLevel]);
    const value = planeValue(s, p);
    // hull and liability insurance, priced on value and risk
    out.insurance += (value * 0.001 + (t.seats * 1500 + 200000) * cpi) * Math.sqrt(risk);
    const n = flights[p.id] ?? 0;
    if (!n) continue;
    const lam = base * risk * n;
    const label = `${t.name}（${p.regNo}）`;
    if (r() < 1 - Math.exp(-lam)) {
      out.lost.add(p.id);
      out.cost += (t.seats * 300000 + 30_000_000) * cpi;
      if (!p.lease) out.payout += value * 0.9;
      out.repHit += 20;
      out.record.accidents++;
      out.record.lastAccidentYM = nowYM(s);
      out.record.scareUntilYM = nowYM(s) + 8;
      out.news.push({ text: `【重大事故】${label}が機体を失う事故を起こしました。事故調査が始まり、しばらく利用者が離れます。${p.lease ? 'リース機は保険で清算されます。' : `保険金${formatYen(value * 0.9)}が支払われます。`}`, kind: 'bad' });
      continue;
    }
    if (r() < 1 - Math.exp(-lam * SERIOUS_PER_ACCIDENT)) {
      const months = 1 + Math.floor(r() * 2);
      out.repair.set(p.id, months);
      out.cost += value * 0.03 + 5_000_000 * cpi;
      out.repHit += 3;
      out.record.serious++;
      out.news.push({ text: `【重大インシデント】${label}が運航中のトラブルで損傷し、${months}か月の修理に入ります。`, kind: 'bad' });
      continue;
    }
    minor += Math.floor(lam * MINOR_PER_ACCIDENT + r());
  }
  if (minor > 0) {
    out.cost += minor * 500_000 * cpi;
    out.repHit += Math.min(2, minor * 0.15);
    out.record.incidents += minor;
    out.news.push({ text: `今月は軽微なトラブル（引き返し・部品不具合など）が${minor}件ありました。`, kind: undefined });
  }
  return out;
}

// ---- circuits (triangle routes etc.) ---------------------------------------

/**
 * Create a multi-stop circuit such as HND→ITM→FUK→HND. Missing legs are
 * opened as routes (with licensing rules) and filled only by the circuit.
 */
export function addCircuit(s0: GameState, stops: string[], targetWeekly = 7, typeId: string | null = null): Result {
  const clean = stops.filter(Boolean);
  if (clean.length < 3) return fail('周回ルートには3つ以上の空港が必要です');
  if (new Set(clean).size !== clean.length) return fail('同じ空港は1回だけ選んでください');
  if (clean.some((c) => isForeign(c))) return fail('周回ルートは今のところ国内線だけです');
  let s = s0;
  for (let i = 0; i < clean.length; i++) {
    const a = clean[i], b = clean[(i + 1) % clean.length];
    if (s.routes.some((r) => (r.kind ?? 'pax') === 'pax' && ((r.from === a && r.to === b) || (r.from === b && r.to === a)))) continue;
    const r = openRoute(s, a, b);
    if (!r.ok) return fail(`${AIRPORT_BY_CODE[a].name}〜${AIRPORT_BY_CODE[b].name}：${r.error}`);
    s = { ...r.state, routes: r.state.routes.map((x, k) => (k === r.state.routes.length - 1 ? { ...x, targetWeekly: 0 } : x)) };
  }
  const [id, s2] = nextId(s, 'C');
  const circuit = { id, stops: clean, targetWeekly: Math.max(0, Math.min(70, Math.round(targetWeekly))), typeId };
  const label = [...clean, clean[0]].map((c) => AIRPORT_BY_CODE[c].name).join('→');
  return ok(autoSchedule(withNews({ ...s2, circuits: [...(s2.circuits ?? []), circuit] }, `周回ルート ${label} を設定しました。`)));
}

export function setCircuit(s: GameState, id: string, patch: Partial<{ targetWeekly: number; typeId: string | null }>): Result {
  if (!(s.circuits ?? []).some((c) => c.id === id)) return fail('周回ルートが見つかりません');
  const circuits = s.circuits!.map((c) => (c.id === id ? { ...c, ...patch, targetWeekly: Math.max(0, Math.min(70, Math.round(patch.targetWeekly ?? c.targetWeekly))) } : c));
  return ok(autoSchedule({ ...s, circuits }));
}

export function removeCircuit(s: GameState, id: string): Result {
  return ok(autoSchedule({ ...s, circuits: (s.circuits ?? []).filter((c) => c.id !== id) }));
}
