// Slot allocation at congested airports, modelled on how Japan's transport
// ministry really did it: capacity grows in steps when new runways open, new
// slots are handed out by an evaluation (reputation, regional network,
// safety, how well existing slots are used), newcomers get a priority share
// from 1997, and from 2005 slots are partly taken back every five years.
import { AIRPORT_BY_CODE } from '../data/airports';
import { isForeign } from '../data/airports';
import type { GameState } from './types';
import { isTrunk } from './rivals';
import { nowYM } from './fleet';
import { slotAirports, slotUsage } from './schedule';

export interface SlotEvent {
  code: string;
  year: number;
  month: number;
  /** new daily movements released at the whole airport */
  pool: number;
  /** extra movements reserved for newcomers (given if we hold few slots there) */
  newcomer?: number;
  label: string;
}

/** Capacity steps (approximate; daily movements, both directions counted) */
export const SLOT_EVENTS: SlotEvent[] = [
  { code: 'HND', year: 1964, month: 4, pool: 40, label: '滑走路の延長（東京オリンピックに向けた整備）' },
  { code: 'HND', year: 1978, month: 5, pool: 60, label: '国際線の成田移転で空いた枠の再配分' },
  { code: 'HND', year: 1988, month: 7, pool: 60, label: '沖合展開・新A滑走路の供用' },
  { code: 'HND', year: 1997, month: 3, pool: 80, newcomer: 12, label: '新C滑走路の供用（新規参入枠あり）' },
  { code: 'HND', year: 2000, month: 7, pool: 114, newcomer: 12, label: '新B滑走路の供用（新規参入枠あり）' },
  { code: 'HND', year: 2010, month: 10, pool: 74, newcomer: 8, label: 'D滑走路（4本目）の供用' },
  { code: 'HND', year: 2013, month: 3, pool: 50, newcomer: 6, label: '管制の見直しによる増枠' },
  { code: 'ITM', year: 1970, month: 4, pool: 40, label: '大阪万博に向けたB滑走路（3,000m）の供用' },
  { code: 'ITM', year: 1977, month: 4, pool: 20, label: '騒音対策の進展による増便' },
  { code: 'ITM', year: 1994, month: 9, pool: 30, label: '関西空港の開港で国際線が移り、空いた枠の再配分' },
  { code: 'NRT', year: 2002, month: 4, pool: 60, newcomer: 6, label: '暫定平行滑走路（B滑走路）の供用' },
  { code: 'NRT', year: 2015, month: 4, pool: 60, newcomer: 6, label: '年間30万回への容量拡大' },
];

/** Years when part of everyone's slots are taken back and reassigned */
export const RECOLLECT_YEARS = [2005, 2015, 2020, 2025, 2030, 2035, 2040];

export interface SlotScore {
  total: number; // 0..1
  parts: { label: string; value: number; weight: number }[];
}

/** The ministry's evaluation of our airline at a slot airport */
export function slotScore(s: GameState, code: string): SlotScore {
  const rep = Math.max(0, Math.min(1, (s.reputation - 30) / 60));
  const regional = s.routes.filter((r) => (r.kind ?? 'pax') === 'pax' && (r.from === code || r.to === code) && !isForeign(r.from) && !isForeign(r.to) && !isTrunk(r.from, r.to)).length;
  const net = Math.min(1, regional / 5);
  const last = s.safety?.lastAccidentYM;
  const safety = last !== undefined && nowYM(s) - last < 60 ? 0 : (s.safety?.serious ?? 0) > 0 ? 0.7 : 1;
  const total = s.slots[code] ?? 0;
  const use = total > 0 ? Math.min(1, (slotUsage(s)[code] ?? 0) / total) : 1;
  const parts = [
    { label: '評判', value: rep, weight: 0.45 },
    { label: '地方路線網', value: net, weight: 0.25 },
    { label: '安全性', value: safety, weight: 0.15 },
    { label: '今の枠の使用率', value: use, weight: 0.15 },
  ];
  return { total: parts.reduce((a, p) => a + p.value * p.weight, 0), parts };
}

/** Rough daily movements at the whole airport before any capacity step */
const BASE_CAPACITY: Record<string, number> = { HND: 120, ITM: 100, NRT: 120 };

/** Total daily movements at the airport in the current year (all airlines) */
export function airportCapacity(s: GameState, code: string): number {
  const now = nowYM(s);
  return (BASE_CAPACITY[code] ?? 100) + SLOT_EVENTS.filter((e) => e.code === code && e.year * 12 + e.month - 1 <= now).reduce((a, e) => a + e.pool, 0);
}

/** Our share of all slots at the airport */
export const slotHolding = (s: GameState, code: string) => Math.min(1, (s.slots[code] ?? 0) / airportCapacity(s, code));

/** Most of a released pool we can get: 20%, rising to 40% as we hold a bigger part of the airport (like the majors) */
export const slotCap = (s: GameState, code: string) => 0.2 + Math.min(0.2, slotHolding(s, code) * 0.6);

/** Share of a released pool we get: 3% up to the cap, by the evaluation */
export const slotShare = (score: number, s?: GameState, code?: string) => 0.03 + ((s && code ? slotCap(s, code) : 0.2) - 0.03) * score;

export function nextSlotEvent(s: GameState, code: string): SlotEvent | null {
  const now = nowYM(s);
  return SLOT_EVENTS.find((e) => e.code === code && e.year * 12 + e.month - 1 > now) ?? null;
}

/** Monthly: apply capacity steps, the yearly small adjustment and the five-yearly recollection */
export function allocateSlots(s0: GameState): { s: GameState; news: string[] } {
  let s = s0;
  const news: string[] = [];
  const airports = slotAirports(s.year);
  const add = (code: string, n: number) => { s = { ...s, slots: { ...s.slots, [code]: Math.max(0, (s.slots[code] ?? 0) + n) } }; };
  for (const e of SLOT_EVENTS) {
    if (e.year !== s.year || e.month !== s.month || !airports.includes(e.code)) continue;
    const score = slotScore(s, e.code).total;
    let gain = Math.round(e.pool * slotShare(score, s, e.code) / 2) * 2;
    const newcomer = e.newcomer && (s.slots[e.code] ?? 0) < 40 ? e.newcomer : 0;
    gain += newcomer;
    add(e.code, gain);
    news.push(`${AIRPORT_BY_CODE[e.code].name}：${e.label}。全体で1日${e.pool}回の枠が増え、評価点${Math.round(score * 100)}の当社には${gain}回${newcomer ? `（うち新規参入枠${newcomer}回）` : ''}が配分されました。`);
  }
  // April: small adjustments (unused slots returned by others), at most a round trip
  if (s.month === 4) {
    for (const code of airports) {
      const score = slotScore(s, code).total;
      const n = score >= 0.8 ? 6 : score >= 0.6 ? 4 : score >= 0.4 ? 2 : 0;
      if (n) { add(code, n); news.push(`${AIRPORT_BY_CODE[code].name}：他社が使わなかった枠の再配分で、1日${n}回の枠を得ました。`); }
    }
  }
  // five-yearly recollection: unused slots and a slice of large holdings go back to the pool
  if (s.month === 4 && RECOLLECT_YEARS.includes(s.year)) {
    const use = slotUsage(s);
    for (const code of airports) {
      const have = s.slots[code] ?? 0;
      if (have === 0) continue;
      const unused = Math.max(0, have - Math.ceil((use[code] ?? 0) * 1.1));
      const slice = have > 60 ? Math.round(have * 0.05) : 0;
      const back = Math.round((40 * slotShare(slotScore(s, code).total, s, code)) / 2) * 2;
      add(code, back - unused - slice);
      news.push(`${AIRPORT_BY_CODE[code].name}：5年ごとの枠の回収・再配分がありました（回収${unused + slice}回、再配分${back}回）。`);
    }
  }
  return { s, news };
}
