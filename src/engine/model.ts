// Pure game formulas: distances, block times, prices, demand, costs.
import { AIRPORT_BY_CODE, type Airport } from '../data/airports';
import { AIRCRAFT_BY_ID, type AircraftType } from '../data/aircraft';
import { econ, SEASONALITY, yearFrac } from '../data/economy';

export const ISLANDS = new Set(['OIM', 'HAC', 'ASJ', 'OKA', 'ISG', 'MMY']);

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

export type RouteCheck = { ok: true } | { ok: false; reason: string };

export function canFly(t: AircraftType, from: string, to: string): RouteCheck {
  const a = AIRPORT_BY_CODE[from];
  const b = AIRPORT_BY_CODE[to];
  const km = distanceKm(a, b);
  if (km > t.rangeKm) return { ok: false, reason: `航続距離が足りません（${Math.round(km)}km / ${t.rangeKm}km）` };
  for (const ap of [a, b]) {
    if (ap.runwayM < t.minRunwayM)
      return { ok: false, reason: `${ap.name}の滑走路が短すぎます（${ap.runwayM}m / 必要${t.minRunwayM}m）` };
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

/** Monthly one-direction market demand at reference fare */
export function marketDemand(from: string, to: string, year: number, month: number): number {
  const a = AIRPORT_BY_CODE[from];
  const b = AIRPORT_BY_CODE[to];
  const km = distanceKm(a, b);
  const t = yearFrac(year, month);
  const island = ISLANDS.has(a.code) || ISLANDS.has(b.code);
  // Rail/ferry competition makes short routes unattractive, except to islands
  const distF = island ? 1 : Math.min(1, Math.max(0.12, (km / 800) ** 0.7));
  const tourF = Math.sqrt(a.tourism * b.tourism);
  const K = 1460;
  return K * Math.sqrt(a.popM * b.popM) * distF * tourF * econ.airPropensity(t) * SEASONALITY[month - 1];
}

// ---- prices -------------------------------------------------------------

export function newPriceYen(t: AircraftType, year: number, month: number): number {
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

export const LEASE_RATE_MONTHLY = 0.011;

// ---- costs --------------------------------------------------------------

export interface FlightCost {
  fuel: number;
  maintenance: number;
  airport: number;
}

export function flightCost(t: AircraftType, km: number, year: number, month: number): FlightCost {
  const tf = yearFrac(year, month);
  const bh = blockHours(t, km);
  const fx = econ.jpyPerUsd(tf);
  const fuelPerKgUsd = econ.fuelUsdPerGal(tf) / 3.03;
  const fuelPremium = t.propulsion === 'piston' ? 1.4 : 1; // avgas costs more
  return {
    fuel: bh * t.fuelKgH * fuelPerKgUsd * fuelPremium * fx,
    maintenance: bh * t.maintUsdH * econ.usCpi(tf) * fx,
    airport: (t.seats * 250 + 15000) * econ.jpCpi(tf), // landing, navigation, handling
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
  return (2_000_000 + 400_000 * planes) * c;
}

// ---- incumbent competitor (placeholder until AI airlines in stage 4) ----

export function incumbentSeats(year: number): number {
  if (year < 1965) return 60;
  if (year < 1970) return 100;
  if (year < 1975) return 140;
  if (year < 1985) return 280;
  return 300;
}

export function incumbentComfort(year: number): number {
  if (year < 1964) return 0.8;
  if (year < 1970) return 0.95;
  return 1.05;
}

/** Weekly round trips the established airlines fly on a route (0 if none) */
export function incumbentWeeklyFreq(from: string, to: string, year: number, month: number): number {
  const a = AIRPORT_BY_CODE[from];
  const b = AIRPORT_BY_CODE[to];
  const big = (x: Airport) => x.popM >= 1.4;
  const trunk = (big(a) && big(b)) || (Math.max(a.popM, b.popM) >= 5 && Math.min(a.popM, b.popM) >= 0.8);
  if (!trunk) return 0;
  const m = marketDemand(from, to, year, 6); // plan on an average month
  void month;
  const freq = (m * 0.75) / (4.33 * incumbentSeats(year) * 0.7);
  return Math.max(1, Math.round(freq));
}

export { AIRCRAFT_BY_ID };
