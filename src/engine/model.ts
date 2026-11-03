// Pure game formulas: distances, block times, prices, demand, costs.
import { AIRPORT_BY_CODE, AIRPORTS, isAirportOpen, isForeign, runwayAt, type Airport } from '../data/airports';
import { DEMAND_EVENTS, RAIL_OPENINGS } from '../data/history';
import { AIRCRAFT_BY_ID, type AircraftType } from '../data/aircraft';
import { econ, SEASONALITY, yearFrac } from '../data/economy';

export const ISLANDS = new Set(AIRPORTS.filter((a) => a.island).map((a) => a.code));

export function distanceKm(a: Airport, b: Airport): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const routeDistance = (from: string, to: string) =>
  distanceKm(AIRPORT_BY_CODE[from], AIRPORT_BY_CODE[to]);

/** One-way block time in hours (gate to gate) */
export function blockHours(t: AircraftType, km: number): number {
  return (km * 1.05) / t.speedKmh + 0.3;
}

/** Minimum turnaround at an outstation, hours */
export function turnaroundHours(t: AircraftType): number {
  if (t.seats >= 250) return 1.25;
  if (t.propulsion === 'jet') return 0.75;
  return 0.5;
}

/** Operating window per week (12h/day) */
export const WEEKLY_OPS_HOURS = 12 * 7;

/** Max round trips per week one plane of this type can fly on a route */
export function maxWeeklyRoundTrips(t: AircraftType, km: number): number {
  const rt = 2 * (blockHours(t, km) + turnaroundHours(t));
  return Math.max(0, Math.floor(WEEKLY_OPS_HOURS / rt));
}

/** Number of engines, from the silhouette */
export function engineCount(t: AircraftType): number {
  if (t.silhouette === 'quadJet' || t.silhouette === 'quadProp' || t.silhouette === 'jumbo') return 4;
  if (t.silhouette === 'triJet' || t.silhouette === 'wideTri') return 3;
  return 2;
}

/** Longest allowed distance (in minutes on one engine) from a diversion airport */
export function etopsMinutes(t: AircraftType, year: number): number {
  if (engineCount(t) > 2) return 999;
  if (year < 1985) return 60;
  const id = t.id;
  if (/^(b787|a350)/.test(id)) return 330;
  if (/^(b777|a330)/.test(id)) return 180;
  if (/^b767/.test(id)) return year >= 1989 ? 180 : 120;
  if (id === 'a300-600r') return year >= 1986 ? 120 : 60;
  if (/^(b737-[78]|a32)/.test(id)) return year >= 1990 ? 120 : 60;
  return 60;
}

export type RouteCheck = { ok: true } | { ok: false; reason: string };

/** Airports used as technical (refuelling) stops on long routes */
export const TECH_STOPS = ['ANC', 'HNL', 'GUM'];

/**
 * Detour factor: before the end of the Cold War, flights to Europe could not
 * cross Soviet airspace freely and flew long way round.
 */
export function detour(from: string, to: string, year: number): number {
  const eu = AIRPORT_BY_CODE[from].region === 'ヨーロッパ' || AIRPORT_BY_CODE[to].region === 'ヨーロッパ';
  if (!eu || year >= 1991) return 1;
  return year < 1970 ? 1.35 : 1.15;
}

/** Distances of the legs actually flown (one leg, or two with a technical stop) */
export function legsKm(from: string, to: string, year: number, via?: string): number[] {
  if (via) return [routeDistance(from, via), routeDistance(via, to)];
  return [routeDistance(from, to) * detour(from, to, year)];
}

/** Total distance flown */
export const flownKm = (from: string, to: string, year: number, via?: string) => legsKm(from, to, year, via).reduce((a, b) => a + b, 0);

/** Block time including any technical stop (1 hour on the ground) */
export function routeBlockHours(t: AircraftType, from: string, to: string, year: number, via?: string): number {
  return legsKm(from, to, year, via).reduce((n, km) => n + blockHours(t, km), 0) + (via ? 1 : 0);
}

export function canFly(t: AircraftType, from: string, to: string, year: number, via?: string): RouteCheck {
  const a = AIRPORT_BY_CODE[from];
  const b = AIRPORT_BY_CODE[to];
  const legs = legsKm(from, to, year, via);
  const km = Math.max(...legs);
  if (km > t.rangeKm) return { ok: false, reason: `航続距離が足りません（${Math.round(km)}km / ${t.rangeKm}km）${via ? '' : detour(from, to, year) > 1 ? '。ソ連上空を避けた遠回りの距離です。アンカレッジ経由も検討を' : ''}` };
  const stops = via ? [a, b, AIRPORT_BY_CODE[via]] : [a, b];
  const need = Math.max(...stops.map((x) => x.etops ?? 0));
  if (need > 0) {
    const have = etopsMinutes(t, year);
    if (have < need) return { ok: false, reason: `洋上飛行の制限（ETOPS）：${t.name}は${year}年時点で${have >= 999 ? '' : `${have}分`}までしか認められていません（必要${need}分）` };
  }
  for (const ap of stops) {
    const rw = runwayAt(ap, year);
    if (rw < t.minRunwayM)
      return { ok: false, reason: `${ap.name}の滑走路が短すぎます（${rw}m / 必要${t.minRunwayM}m）` };
  }
  return { ok: true };
}

// Real (inflation-adjusted) fare level, 1960 = 1
const REAL_FARE: [number, number][] = [
  [1960, 1], [1965, 0.9], [1970, 0.72], [1980, 0.55], [1990, 0.45], [2000, 0.35], [2010, 0.28], [2027, 0.26],
];
function realFareIndex(t: number): number {
  for (let i = 1; i < REAL_FARE.length; i++) {
    const [y1, v1] = REAL_FARE[i];
    const [y0, v0] = REAL_FARE[i - 1];
    if (t <= y1) return t <= y0 ? v0 : v0 + ((v1 - v0) * (t - y0)) / (y1 - y0);
  }
  return REAL_FARE[REAL_FARE.length - 1][1];
}

/** Reference (typical market) one-way fare in yen */
export function referenceFare(km: number, year: number, month: number): number {
  const t = yearFrac(year, month);
  // 1960: about 1,500 yen + 12 yen/km (Tokyo-Osaka ~6,300 yen)
  const base1960 = 1500 + 12 * km;
  // Real fares fell relative to prices as jets and competition arrived.
  return Math.round((base1960 * econ.jpCpi(t) * realFareIndex(t)) / 10) * 10;
}

/** Share of a city's traffic using this airport when the city has several */
export function airportShare(code: string, year: number): number {
  const a = AIRPORT_BY_CODE[code];
  if (!a.cityGroup) return 1;
  const open = AIRPORTS.filter((x) => x.cityGroup === a.cityGroup && isAirportOpen(x, year));
  if (open.length <= 1) return 1;
  const weight: Record<string, number> = { HND: 0.85, NRT: 0.15, ITM: 0.65, KIX: 0.28, UKB: 0.07 };
  const total = open.reduce((n, x) => n + (weight[x.code] ?? 0.5), 0);
  return (weight[code] ?? 0.5) / total;
}

/** Remaining air demand after high-speed rail lines opened */
export function railFactor(a: string, b: string, year: number, month: number): number {
  let f = 1;
  const t = year * 12 + month;
  const norm = (x: string) => (x === 'NRT' ? 'HND' : x === 'KIX' || x === 'UKB' ? 'ITM' : x === 'NGO' ? 'NKM' : x);
  const A = norm(a), B = norm(b);
  for (const r of RAIL_OPENINGS) {
    if (t < r.year * 12 + r.month) continue;
    for (const [x, y, share] of r.pairs) if ((x === A && y === B) || (x === B && y === A)) f = Math.min(f, share);
  }
  return f;
}

/** Temporary demand shocks or booms */
export function eventFactor(a: string, b: string, year: number, month: number): number {
  const t = year * 12 + month;
  let f = 1;
  for (const e of DEMAND_EVENTS) {
    if (t < e.from[0] * 12 + e.from[1] || t > e.to[0] * 12 + e.to[1]) continue;
    if (!e.airports || e.airports.includes(a) || e.airports.includes(b)) f *= e.multiplier;
  }
  return f;
}

/** Monthly one-direction market demand at reference fare */
export function marketDemand(from: string, to: string, year: number, month: number): number {
  if (isForeign(from) && isForeign(to)) return beyondDemand(from, to, year, month);
  if (isForeign(from) || isForeign(to)) return intlDemand(from, to, year, month);
  const a = AIRPORT_BY_CODE[from];
  const b = AIRPORT_BY_CODE[to];
  const km = distanceKm(a, b);
  const t = yearFrac(year, month);
  const island = !!(a.island || b.island);
  // Rail/ferry competition makes short routes unattractive, except to islands
  const distF = island ? 1 : Math.min(1, Math.max(0.12, (km / 800) ** 0.7));
  const tourF = Math.sqrt(a.tourism * b.tourism);
  // gravity: demand grows with the product of the two catchments (small towns
  // generate little traffic between themselves). Islands draw visitors beyond
  // their own population.
  const pop = (x: Airport) => (x.island ? Math.max(x.popM, 0.04 * x.tourism) : x.popM);
  const K = 204;
  return K * pop(a) * pop(b) * distF * tourF * econ.airPropensity(t) * SEASONALITY[month - 1]
    * airportShare(from, year) * airportShare(to, year) * railFactor(from, to, year, month) * eventFactor(from, to, year, month);
}

// ---- international -------------------------------------------------------

const ASIA = new Set(['東アジア', '東南アジア']);

/** Share of a Japanese city's international traffic using this airport */
export function intlGatewayShare(code: string, year: number): number {
  switch (code) {
    case 'HND': return year < 1978 ? 1 : year < 2010 ? 0 : year < 2014 ? 0.2 : year < 2020 ? 0.35 : 0.5;
    case 'NRT': return year < 2010 ? 1 : year < 2014 ? 0.8 : year < 2020 ? 0.65 : 0.5;
    case 'ITM': return year < 1994 ? 1 : 0;
    case 'UKB': return 0;
    default: return 1;
  }
}

/** Population of the city an airport serves (largest among airports sharing a city) */
function cityPop(code: string): number {
  const a = AIRPORT_BY_CODE[code];
  if (!a.cityGroup) return a.popM;
  return Math.max(...AIRPORTS.filter((x) => x.cityGroup === a.cityGroup).map((x) => x.popM));
}

/** Share of a foreign city's traffic using this airport */
function foreignShare(code: string, year: number): number {
  const a = AIRPORT_BY_CODE[code];
  if (!a.cityGroup) return 1;
  const open = AIRPORTS.filter((x) => x.cityGroup === a.cityGroup && isAirportOpen(x, year));
  const total = open.reduce((n, x) => n + (x.intlWeight ?? 1), 0);
  return total ? (a.intlWeight ?? 1) / total : 0;
}

/**
 * Monthly one-direction demand between a Japanese and a foreign airport.
 * `ignoreGateway` gives the demand of the whole Japanese city regardless of
 * whether this airport handles international flights (used for connections).
 */
export function intlDemand(from: string, to: string, year: number, month: number, ignoreGateway = false): number {
  const jp = isForeign(from) ? to : from;
  const fx = isForeign(from) ? from : to;
  if (isForeign(jp)) return 0; // foreign-foreign pairs are not part of the game
  const f = AIRPORT_BY_CODE[fx];
  if (!isAirportOpen(f, year)) return 0;
  const t = yearFrac(year, month);
  const idx = ASIA.has(f.region) ? econ.intlAsia(t) : econ.intlLong(t);
  // weights of airports sharing a city add up to the city's total; open airports split it
  const groupTotal = f.cityGroup ? AIRPORTS.filter((x) => x.cityGroup === f.cityGroup).reduce((n, x) => n + (x.intlWeight ?? 0), 0) : f.intlWeight ?? 0;
  const jpScale = (cityPop(jp) / 17) ** 0.85;
  const gate = ignoreGateway ? 1 : intlGatewayShare(jp, year);
  return groupTotal * 1000 * jpScale * idx * SEASONALITY[month - 1] * gate * foreignShare(fx, year) * eventFactor(jp, fx, year, month);
}

/** An airport's share of its city's international weight this year */
function foreignWeight(code: string, year: number): number {
  const a = AIRPORT_BY_CODE[code];
  const groupTotal = a.cityGroup ? AIRPORTS.filter((x) => x.cityGroup === a.cityGroup).reduce((n, x) => n + (x.intlWeight ?? 0), 0) : a.intlWeight ?? 0;
  return groupTotal * foreignShare(code, year);
}

/**
 * Monthly one-direction demand between two foreign airports, which a Japanese
 * airline can only carry with beyond (fifth freedom) rights. Flights inside one
 * country are cabotage and not allowed.
 */
export function beyondDemand(from: string, to: string, year: number, month: number): number {
  const a = AIRPORT_BY_CODE[from], b = AIRPORT_BY_CODE[to];
  if (!isAirportOpen(a, year) || !isAirportOpen(b, year)) return 0;
  if (a.country === b.country) return 0;
  const t = yearFrac(year, month);
  const idx = ASIA.has(a.region) && ASIA.has(b.region) ? econ.intlAsia(t) : econ.intlLong(t);
  const km = distanceKm(a, b);
  const w = Math.sqrt(foreignWeight(from, year) * foreignWeight(to, year));
  return 600 * w * idx * SEASONALITY[month - 1] / (1 + km / 3000) * eventFactor(from, to, year, month);
}

export const isBeyondRoute = (from: string, to: string) => isForeign(from) && isForeign(to);

/** Reference one-way international fare in yen (set in dollars, so it moves with the exchange rate) */
export function intlReferenceFare(km: number, year: number, month: number): number {
  const t = yearFrac(year, month);
  const usd = (90 + 0.045 * km) * (econ.usCpi(t) / econ.usCpi(1960)) * econ.intlRealFare(t);
  return Math.round((usd * econ.jpyPerUsd(t)) / 100) * 100;
}

export const isIntlRoute = (from: string, to: string) => isForeign(from) || isForeign(to);

/** Reference fare for any route */
export function routeReferenceFare(from: string, to: string, year: number, month: number): number {
  const km = routeDistance(from, to);
  return isIntlRoute(from, to) ? intlReferenceFare(km, year, month) : referenceFare(km, year, month);
}

// ---- cargo ------------------------------------------------------------------

/** Monthly one-direction air cargo market in tonnes (Japan exports make international cargo heavy) */
export function cargoDemandT(from: string, to: string, year: number, month: number): number {
  const intl = isIntlRoute(from, to);
  const t = yearFrac(year, month);
  // air cargo grew faster than passengers until the 2000s (electronics, express parcels)
  const intensity = Math.min(1, 0.45 + (t - 1960) * 0.014);
  return marketDemand(from, to, year, month) * (intl ? 0.06 : 0.009) * intensity;
}

/** Market cargo rate in yen per kg */
export function cargoReferenceRate(from: string, to: string, year: number, month: number): number {
  const km = routeDistance(from, to);
  const t = yearFrac(year, month);
  if (isIntlRoute(from, to)) {
    const usd = (0.6 + 0.0003 * km) * (econ.usCpi(t) / econ.usCpi(1960)) * econ.intlRealFare(t);
    return Math.round(usd * econ.jpyPerUsd(t));
  }
  return Math.round((40 + 0.06 * km) * econ.jpCpi(t) * realFareIndex(t));
}

/** Handling cost per kg */
export const cargoHandlingPerKg = (intl: boolean, year: number, month: number) => (intl ? 4 : 3) * econ.jpCpi(yearFrac(year, month));

// ---- safety -------------------------------------------------------------------

// accidents with loss of the aircraft, per departure, industry average
const ACCIDENT_RATE: [number, number][] = [
  [1960, 6e-6], [1970, 3e-6], [1980, 1.5e-6], [1990, 1e-6], [2000, 0.6e-6], [2010, 0.35e-6], [2027, 0.25e-6],
];
export function accidentRatePerFlight(year: number): number {
  for (let i = 1; i < ACCIDENT_RATE.length; i++) {
    const [y1, v1] = ACCIDENT_RATE[i];
    const [y0, v0] = ACCIDENT_RATE[i - 1];
    if (year <= y1) return year <= y0 ? v0 : v0 + ((v1 - v0) * (year - y0)) / (y1 - y0);
  }
  return ACCIDENT_RATE[ACCIDENT_RATE.length - 1][1];
}
/** Serious incidents (aircraft damaged, out of service) and minor ones, relative to accidents */
export const SERIOUS_PER_ACCIDENT = 15;
export const MINOR_PER_ACCIDENT = 250;

/**
 * Risk multiplier for one aircraft compared with the industry average.
 * Condition (maintenance) matters most; old airframes, a mixed fleet and a
 * thin operations department add risk. It never reaches zero.
 */
export function riskFactor(condition: number, ageYears: number, fleetTypes: number, opsLevel: number, maintMul: number): number {
  const cond = Math.exp((86 - condition) / 24);
  const age = 1 + 0.02 * Math.max(0, ageYears - 10);
  const mix = 1 + 0.04 * Math.max(0, fleetTypes - 1);
  const ops = 1 - 0.05 * opsLevel;
  return Math.max(0.3, cond * age * mix * ops * maintMul);
}

// ---- prices -------------------------------------------------------------

export function newPriceYen(t: AircraftType, year: number, month: number): number {
  // converted freighters are valued like a mid-life airliner plus the conversion
  if (t.convertedOnly && t.conversion) {
    const base = AIRCRAFT_BY_ID[t.conversion.from];
    return newPriceYen(base, Math.min(year, base.endYear), month) * 0.45 + conversionCostYen(t, year, month);
  }
  const tf = yearFrac(year, month);
  const inflation = econ.usCpi(tf) / econ.usCpi(t.introYear);
  return t.priceMUsd * 1e6 * inflation * econ.jpyPerUsd(tf);
}

/** Market value of a plane of given age (years) */
export function valueYen(t: AircraftType, ageYears: number, year: number, month: number): number {
  // price indexed to a "new" plane at current prices (or last production year)
  const refYear = Math.min(year, t.endYear);
  const base = newPriceYen(t, refYear, refYear === year ? month : 12);
  const factor = Math.max(0.2, 1 - 0.04 * ageYears);
  return base * factor;
}

/** Cost of a passenger-to-freighter conversion */
export function conversionCostYen(t: AircraftType, year: number, month: number): number {
  if (!t.conversion) return 0;
  const tf = yearFrac(year, month);
  return t.conversion.costMUsd * 1e6 * (econ.usCpi(tf) / econ.usCpi(t.conversion.since)) * econ.jpyPerUsd(tf);
}
export const CONVERSION_MONTHS = 4;

export const LEASE_RATE_MONTHLY = 0.011;

// ---- costs --------------------------------------------------------------

export interface FlightCost {
  fuel: number;
  maintenance: number;
  airport: number;
}

export function flightCost(t: AircraftType, km: number, year: number, month: number, intl = false): FlightCost {
  const tf = yearFrac(year, month);
  const bh = blockHours(t, km);
  const fx = econ.jpyPerUsd(tf);
  const fuelPerKgUsd = econ.fuelUsdPerGal(tf) / 3.03;
  const fuelPremium = t.propulsion === 'piston' ? 1.4 : 1; // avgas costs more
  // freighters pay landing fees by weight: treat each tonne of payload like 3 seats
  const seats = t.freighter ? (t.cargoT ?? 0) * 3 : t.seats;
  return {
    fuel: bh * t.fuelKgH * fuelPerKgUsd * fuelPremium * fx,
    maintenance: bh * t.maintUsdH * econ.usCpi(tf) * fx,
    airport: intl
      // half the landings are in Japan (expensive) and half abroad (billed in dollars)
      ? 0.5 * (seats * 400 + 30000) * econ.jpCpi(tf) + 0.5 * (seats * 1.5 + 500) * (econ.usCpi(tf) / econ.usCpi(1960)) * fx
      : (seats * 200 + 8000) * econ.jpCpi(tf), // landing, navigation, handling
  };
}

export const groundCostPerPax = (year: number, month: number) => 700 * econ.jpCpi(yearFrac(year, month));
export const SALES_COMMISSION = 0.1;
/** General & administrative costs as a share of revenue (head office, IT, insurance) */
export const ADMIN_SHARE = 0.18;

/** Crew sets per aircraft (pilots needed = sets x cockpit crew) */
export const CREW_SETS = 5;
export const pilotsNeeded = (t: AircraftType) => CREW_SETS * t.cockpitCrew;

/** Monthly wage of one pilot */
export const pilotWage = (year: number, month: number) => 90000 * econ.jpWage(yearFrac(year, month));

/** Monthly cabin crew cost of one plane (cabin crew are hired automatically) */
export function cabinCostMonthly(t: AircraftType, year: number, month: number): number {
  return CREW_SETS * t.cabinCrew * 28000 * econ.jpWage(yearFrac(year, month));
}

/** Hiring an experienced, already-rated pilot: one-off cost */
export const hireCost = (year: number, month: number) => pilotWage(year, month) * 8;
/** Training one pilot on a type (new hire or conversion): one-off cost, takes months */
export const trainingCost = (t: AircraftType, year: number, month: number) =>
  pilotWage(year, month) * (t.propulsion === 'jet' ? 14 : 8);
export const TRAINING_MONTHS = 4;
/** Experienced rated pilots available to hire per type per month */
export const HIRE_LIMIT_PER_MONTH = 6;

// ---- maintenance ---------------------------------------------------------

export const MAINT_LEVELS = {
  low: { label: '節約', costMul: 0.8, target: 72 },
  standard: { label: '標準', costMul: 1.0, target: 86 },
  high: { label: '手厚い', costMul: 1.3, target: 96 },
} as const;

/** Flight hours between heavy checks (C-check equivalent) */
export const HEAVY_CHECK_HOURS = 5000;
/** Heavy check cost as share of the type's current new price; every 3rd is a D-check */
export function heavyCheckCost(t: AircraftType, isD: boolean, year: number, month: number): number {
  return newPriceYen(t, Math.min(year, t.endYear), month) * (isD ? 0.07 : 0.025);
}
export const heavyCheckMonths = (isD: boolean) => (isD ? 2 : 1);

/** Multiplier on fuel burn from age and condition */
export const fuelFactor = (ageYears: number, condition: number) => (1 + 0.004 * ageYears) * (1 + (90 - Math.min(90, condition)) * 0.002);
/** Multiplier on routine maintenance cost from age */
export const maintAgeFactor = (ageYears: number) => 1 + 0.025 * ageYears;

export function overheadMonthly(planes: number, year: number, month: number): number {
  const c = econ.jpCpi(yearFrac(year, month));
  return (1_200_000 + 400_000 * planes) * c;
}

export { AIRCRAFT_BY_ID };
