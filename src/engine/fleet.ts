// Aircraft acquisition: new orders, used market, leases, disposal, heavy checks.
import { AIRCRAFT_TYPES, AIRCRAFT_BY_ID, conversionsFor, type AircraftType } from '../data/aircraft';
import { econ, loanRate, yearFrac } from '../data/economy';
import { CONVERSION_MONTHS, conversionCostYen, HEAVY_CHECK_HOURS, heavyCheckCost, heavyCheckMonths, newPriceYen, valueYen } from './model';
import { ym, ymMonth, ymYear, type GameState, type Plane, type UsedListing } from './types';
import { fail, formatYen, nextId, ok, rng, spend, withNews, type Result } from './util';

export const planeType = (p: Plane): AircraftType => AIRCRAFT_BY_ID[p.typeId];
export const planeAge = (p: Plane, year: number) => Math.max(0, year - p.builtYear);
export const nowYM = (s: GameState) => ym(s.year, s.month);
export const ymLabel = (t: number) => `${ymYear(t)}年${ymMonth(t)}月`;

// ---- new aircraft ---------------------------------------------------------

export const newTypesOnSale = (year: number) => AIRCRAFT_TYPES.filter((t) => !t.convertedOnly && year >= t.introYear && year <= t.endYear);

/** Months from order to delivery. Launch years have long backlogs. */
export function leadMonths(t: AircraftType, year: number): number {
  const sinceLaunch = year - t.introYear;
  if (sinceLaunch < 1) return 24;
  if (sinceLaunch < 3) return 18;
  return t.propulsion === 'jet' && t.seats > 200 ? 15 : 10;
}

export const ORDER_DEPOSIT = 0.2;

export const OPERATING_TERMS = [3, 5, 8, 12] as const;
export function operatingLeaseRate(years: number, used: boolean): number {
  const base = years <= 3 ? 0.012 : years <= 5 ? 0.011 : years <= 8 ? 0.0102 : 0.0096;
  return used ? base * 1.12 : base;
}

/** Finance lease: annuity over 10 years at bank rate + 1.5%, plane is ours at the end */
export function financeLeaseMonthly(price: number, year: number, month: number): number {
  const r = (loanRate(yearFrac(year, month)) + 0.015) / 12;
  const n = 120;
  return (price * r) / (1 - (1 + r) ** -n);
}

/** Wet lease (aircraft + crew + maintenance), monthly */
export const wetLeaseMonthly = (value: number, t: AircraftType, year: number, month: number) =>
  value * 0.016 + t.cockpitCrew * 5 * 90000 * econ.jpWage(yearFrac(year, month)) * 1.3;

function regNo(s: GameState): string {
  const r = rng(s.seed + s.nextId * 7919);
  return `JA${String(1000 + Math.floor(r() * 9000))}`;
}

function basePlane(s: GameState, id: string, t: AircraftType): Plane {
  return {
    id, typeId: t.id, regNo: regNo(s), builtYear: s.year, status: 'active', readyYM: nowYM(s),
    purchaseYen: 0, balanceDueYen: 0, lease: null, acquiredYM: nowYM(s), base: s.baseAirport, schedule: [], locked: false,
    condition: 100, totalHours: 0, hoursSinceHeavy: 0, heavyChecks: 0,
  };
}

export type OrderMode = 'buy' | 'operating' | 'finance';

/** Bulk discount on new aircraft: 3% from 3, 5% from 5, 8% from 10 */
export const bulkDiscount = (n: number) => (n >= 10 ? 0.08 : n >= 5 ? 0.05 : n >= 3 ? 0.03 : 0);
export const MAX_BULK = 20;

/** Order several of a type at once: a bulk discount, deliveries two a month after the usual lead time */
export function orderNewBulk(s0: GameState, typeId: string, mode: OrderMode, count: number, leaseYears = 8): Result {
  const n = Math.max(1, Math.min(MAX_BULK, Math.round(count)));
  if (n === 1) return orderNew(s0, typeId, mode, leaseYears);
  const t = AIRCRAFT_BY_ID[typeId];
  let s = s0;
  for (let i = 0; i < n; i++) {
    const r = orderNew(s, typeId, mode, leaseYears, { discount: bulkDiscount(n), extraMonths: Math.floor(i / 2), quiet: true });
    if (!r.ok) {
      if (i === 0) return r;
      s = withNews(s, `${t.name}を${i}機まとめて発注しました（${n}機の予定でしたが、${r.error}）。`);
      return ok(s);
    }
    s = r.state;
  }
  const first = nowYM(s0) + leadMonths(t, s0.year);
  const how = mode === 'buy' ? '購入' : mode === 'operating' ? `リース（${leaseYears}年）` : 'ファイナンスリース';
  return ok(withNews(s, `${t.name}を${n}機まとめて${how}で発注しました（${Math.round(bulkDiscount(n) * 100)}%割引）。納入は${ymLabel(first)}から${ymLabel(first + Math.floor((n - 1) / 2))}にかけての予定です。`));
}

export function orderNew(s: GameState, typeId: string, mode: OrderMode, leaseYears = 8, opts: { discount?: number; extraMonths?: number; quiet?: boolean } = {}): Result {
  if (s.gameOver) return fail('ゲームオーバーです');
  const t = AIRCRAFT_BY_ID[typeId];
  if (!t || s.year < t.introYear || s.year > t.endYear) return fail('この機種は今は発注できません');
  const price = newPriceYen(t, s.year, s.month) * (1 - (opts.discount ?? 0));
  const lead = leadMonths(t, s.year) + (opts.extraMonths ?? 0);
  const delivery = nowYM(s) + lead;
  let upfront: number;
  let lease: Plane['lease'] = null;
  if (mode === 'buy') {
    upfront = price * ORDER_DEPOSIT;
  } else if (mode === 'operating') {
    const monthly = price * operatingLeaseRate(leaseYears, false);
    lease = { kind: 'operating', monthlyYen: monthly, startYM: delivery, endYM: delivery + leaseYears * 12 - 1 };
    upfront = monthly * 2;
  } else {
    const monthly = financeLeaseMonthly(price, s.year, s.month);
    lease = { kind: 'finance', monthlyYen: monthly, startYM: delivery, endYM: delivery + 119 };
    upfront = monthly * 2;
  }
  if (s.cash < upfront) return fail(`手付金（${formatYen(upfront)}）が払えません`);
  const [id, s2] = nextId(s, 'P');
  const plane: Plane = {
    ...basePlane(s, id, t),
    builtYear: ymYear(delivery),
    status: 'onOrder',
    readyYM: delivery,
    purchaseYen: price,
    balanceDueYen: mode === 'buy' ? price - upfront : 0,
    lease,
  };
  const how = mode === 'buy' ? '発注' : mode === 'operating' ? `リース（${leaseYears}年）で発注` : 'ファイナンスリース（10年）で発注';
  if (opts.quiet) return ok({ ...s2, cash: s2.cash - upfront, planes: [...s2.planes, plane] });
  return ok(withNews({ ...s2, cash: s2.cash - upfront, planes: [...s2.planes, plane] },
    `${t.name}を${how}しました。納入は${ymLabel(delivery)}の予定です。`));
}

export function cancelOrder(s: GameState, planeId: string): Result {
  const p = s.planes.find((x) => x.id === planeId);
  if (!p || p.status !== 'onOrder') return fail('キャンセルできる発注がありません');
  return ok(withNews({ ...s, planes: s.planes.filter((x) => x.id !== planeId) },
    `${planeType(p).name}の発注をキャンセルしました（手付金は戻りません）。`));
}

// ---- used market ----------------------------------------------------------

/** Refresh the used-aircraft listings: drop expired ones and add new ones. */
export function refreshUsedMarket(s: GameState): GameState {
  const now = nowYM(s);
  const r = rng(s.seed + now * 31);
  let listings = s.usedMarket.filter((l) => l.expiresYM >= now);
  let next = s.nextId;
  const candidates = AIRCRAFT_TYPES.filter((t) => s.year >= t.introYear + 2 && s.year <= t.endYear + 28);
  const target = 10;
  let guard = 0;
  while (listings.length < target && candidates.length && guard++ < 50) {
    const t = candidates[Math.floor(r() * candidates.length)];
    const newest = Math.min(s.year - 1, t.endYear);
    const oldest = Math.max(t.introYear, s.year - 30);
    if (newest < oldest) continue;
    const built = oldest + Math.floor(r() * (newest - oldest + 1));
    const age = s.year - built;
    const condition = Math.round(Math.max(35, Math.min(92, 88 - age * 1.2 + (r() - 0.5) * 30)));
    const hours = Math.round(age * (1800 + r() * 1400));
    const price = valueYen(t, age, s.year, s.month) * (0.7 + condition / 300);
    const l: UsedListing = { id: `U${next++}`, typeId: t.id, builtYear: built, condition, totalHours: hours, priceYen: price, expiresYM: now + 2 + Math.floor(r() * 5) };
    listings = [...listings, l];
  }
  return { ...s, usedMarket: listings, nextId: next };
}

export type UsedMode = 'buy' | 'operating' | 'wet';

export function acquireUsed(s: GameState, listingId: string, mode: UsedMode, leaseYears = 3): Result {
  if (s.gameOver) return fail('ゲームオーバーです');
  const l = s.usedMarket.find((x) => x.id === listingId);
  if (!l) return fail('この中古機はもう売れてしまいました');
  const t = AIRCRAFT_BY_ID[l.typeId];
  const now = nowYM(s);
  let upfront: number;
  let lease: Plane['lease'] = null;
  if (mode === 'buy') {
    upfront = l.priceYen;
  } else if (mode === 'operating') {
    const monthly = l.priceYen * operatingLeaseRate(leaseYears, true);
    lease = { kind: 'operating', monthlyYen: monthly, startYM: now, endYM: now + leaseYears * 12 - 1 };
    upfront = monthly * 2;
  } else {
    const monthly = wetLeaseMonthly(l.priceYen, t, s.year, s.month);
    lease = { kind: 'wet', monthlyYen: monthly, startYM: now, endYM: now + leaseYears - 1 }; // wet: leaseYears means months
    upfront = 0;
  }
  if (s.cash < upfront) return fail(mode === 'buy' ? '資金が足りません' : '保証金（リース料2か月分）が払えません');
  const [id, s2] = nextId(s, 'P');
  const plane: Plane = {
    ...basePlane(s, id, t),
    builtYear: l.builtYear,
    purchaseYen: mode === 'buy' ? l.priceYen : 0,
    lease,
    condition: l.condition,
    totalHours: l.totalHours,
    hoursSinceHeavy: Math.round((l.totalHours % HEAVY_CHECK_HOURS) * 0.8),
    heavyChecks: Math.floor(l.totalHours / HEAVY_CHECK_HOURS),
  };
  const how = mode === 'buy' ? '購入' : mode === 'operating' ? `リース導入（${leaseYears}年）` : `ウェットリース（${leaseYears}か月）`;
  return ok(withNews({
    ...s2,
    cash: s2.cash - upfront,
    planes: [...s2.planes, plane],
    usedMarket: s2.usedMarket.filter((x) => x.id !== listingId),
  }, `中古の${t.name}（${plane.regNo}、${l.builtYear}年製）を${how}しました。`));
}

// ---- disposal --------------------------------------------------------------

export function planeValue(s: GameState, p: Plane): number {
  const t = planeType(p);
  return valueYen(t, planeAge(p, s.year), s.year, s.month) * (0.7 + p.condition / 300);
}

export function disposalTerms(s: GameState, p: Plane): { label: string; cash: number } {
  if (p.status === 'onOrder') return { label: 'キャンセル', cash: 0 };
  if (!p.lease) return { label: '売却', cash: planeValue(s, p) };
  const remaining = Math.max(0, p.lease.endYM - nowYM(s));
  if (p.lease.kind === 'wet') return { label: '返却', cash: 0 };
  if (p.lease.kind === 'finance') {
    // pay off the remaining finance lease, then the plane is sold
    const payoff = p.lease.monthlyYen * remaining * 0.85;
    return { label: '売却', cash: planeValue(s, p) - payoff };
  }
  const penalty = p.lease.monthlyYen * Math.min(remaining, 3 + remaining * 0.3);
  const returnFee = p.condition < 60 ? planeValue(s, p) * 0.05 : 0;
  return { label: '返却', cash: -(penalty + returnFee) };
}

export function disposePlane(s: GameState, planeId: string): Result {
  const p = s.planes.find((x) => x.id === planeId);
  if (!p) return fail('機体が見つかりません');
  if (p.status === 'onOrder') return cancelOrder(s, planeId);
  if (p.status === 'heavyCheck' || p.status === 'shop') return fail('整備・改修中の機体は手放せません');
  const t = planeType(p);
  const terms = disposalTerms(s, p);
  const text = terms.cash >= 0
    ? `${t.name}（${p.regNo}）を${terms.label}しました（${formatYen(terms.cash)}）。`
    : `${t.name}（${p.regNo}）を${terms.label}しました（費用${formatYen(-terms.cash)}）。`;
  return ok(withNews({ ...s, cash: s.cash + terms.cash, planes: s.planes.filter((x) => x.id !== planeId) }, text));
}

// ---- heavy checks ----------------------------------------------------------

export const heavyCheckDue = (p: Plane) => p.lease?.kind !== 'wet' && p.hoursSinceHeavy >= HEAVY_CHECK_HOURS;
/** Overdue planes are grounded by the regulator */
export const heavyCheckOverdue = (p: Plane) => p.lease?.kind !== 'wet' && p.hoursSinceHeavy >= HEAVY_CHECK_HOURS * 1.15;
export const nextCheckIsD = (p: Plane) => (p.heavyChecks + 1) % 3 === 0;

export function startHeavyCheck(s: GameState, planeId: string): Result {
  const p = s.planes.find((x) => x.id === planeId);
  if (!p || p.status !== 'active') return fail('この機体は今は重整備に入れません');
  if (p.lease?.kind === 'wet') return fail('ウェットリース機の整備はリース会社が行います');
  const t = planeType(p);
  const isD = nextCheckIsD(p);
  const cost = heavyCheckCost(t, isD, s.year, s.month);
  const months = heavyCheckMonths(isD);
  const planes = s.planes.map((x) => (x.id === planeId ? { ...x, status: 'heavyCheck' as const, readyYM: nowYM(s) + months } : x));
  return ok(withNews(spend({ ...s, planes }, 'heavyChecks', cost),
    `${t.name}（${p.regNo}）が${isD ? '重整備（Dチェック）' : '重整備（Cチェック）'}に入りました（${months}か月、${formatYen(cost)}）。`));
}

/** Send a passenger plane to be converted into a freighter (real conversion programs only) */
export function startConversion(s: GameState, planeId: string, toTypeId: string): Result {
  const p = s.planes.find((x) => x.id === planeId);
  if (!p) return fail('機体が見つかりません');
  if (p.status !== 'active') return fail('運航中の機体だけ改修に出せます');
  if (p.lease) return fail('リース機は改修できません（自社保有機のみ）');
  const to = conversionsFor(p.typeId, s.year).find((t) => t.id === toTypeId);
  if (!to) return fail('この機体に使える貨物機改修プログラムがありません');
  if (planeAge(p, s.year) < 8) return fail('改修は機齢8年以上の機体が対象です');
  const cost = conversionCostYen(to, s.year, s.month);
  if (s.cash < cost) return fail(`資金が足りません（改修費 ${formatYen(cost)}）`);
  const planes = s.planes.map((x) => (x.id === planeId ? { ...x, status: 'shop' as const, readyYM: nowYM(s) + CONVERSION_MONTHS, convertTo: to.id, schedule: [], locked: false, cycleDays: undefined } : x));
  return ok(withNews(spend({ ...s, planes }, 'heavyChecks', cost), `${planeType(p).name}（${p.regNo}）を${to.name}への改修に出しました（${CONVERSION_MONTHS}か月、${formatYen(cost)}）。`));
}
