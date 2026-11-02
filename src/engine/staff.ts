// Pilots and type ratings.
import { AIRCRAFT_BY_ID, ratingOf } from '../data/aircraft';
import { HIRE_LIMIT_PER_MONTH, hireCost, pilotsNeeded, TRAINING_MONTHS, trainingCost } from './model';
import { nowYM, planeType } from './fleet';
import type { GameState, PilotPool } from './types';
import { fail, formatYen, ok, spend, withNews, type Result } from './util';

const empty: PilotPool = { rated: 0, training: [] };
/** Pilots are rated per type family (a converted freighter shares its rating with the airliner) */
export const pool = (s: GameState, typeId: string): PilotPool => s.pilots[ratingOf(typeId)] ?? empty;
export const traineeCount = (p: PilotPool) => p.training.reduce((n, t) => n + t.count, 0);
export const totalPilots = (s: GameState) =>
  Object.values(s.pilots).reduce((n, p) => n + p.rated + traineeCount(p), 0);

/** Pilots needed for a type: planes in service or in heavy check need crews (wet leases bring their own) */
export function pilotsRequired(s: GameState, typeId: string): number {
  return s.planes
    .filter((p) => ratingOf(p.typeId) === ratingOf(typeId) && p.status !== 'onOrder' && p.lease?.kind !== 'wet')
    .reduce((n, p) => n + pilotsNeeded(planeType(p)), 0);
}

/** Types the company flies, has on order, or has pilots for */
export function relevantTypes(s: GameState): string[] {
  const ids = new Set<string>([...s.planes.map((p) => ratingOf(p.typeId)), ...Object.keys(s.pilots)]);
  return [...ids].filter((id) => AIRCRAFT_BY_ID[id]);
}

/** Set of plane ids that have enough rated pilots to fly this month */
export function crewedPlanes(s: GameState): Set<string> {
  const crewed = new Set<string>();
  const left: Record<string, number> = {};
  for (const p of s.planes) {
    if (p.status !== 'active') continue;
    if (p.lease?.kind === 'wet') { crewed.add(p.id); continue; }
    const t = planeType(p);
    const key = ratingOf(t.id);
    left[key] ??= pool(s, t.id).rated;
    const need = pilotsNeeded(t);
    if (left[key] >= need) {
      left[key] -= need;
      crewed.add(p.id);
    }
  }
  return crewed;
}

function setPool(s: GameState, typeId: string, p: PilotPool): GameState {
  return { ...s, pilots: { ...s.pilots, [ratingOf(typeId)]: p } };
}

/** Hire experienced pilots already rated on the type (limited supply each month) */
export function hirePilots(s: GameState, typeId: string, count: number): Result {
  const t = AIRCRAFT_BY_ID[typeId];
  if (!t) return fail('機種が見つかりません');
  const already = s.hiresThisMonth?.[typeId] ?? 0;
  if (already + count > HIRE_LIMIT_PER_MONTH) return fail(`今月この機種の経験者はあと${HIRE_LIMIT_PER_MONTH - already}人しか採用できません`);
  const cost = hireCost(s.year, s.month) * count;
  if (s.cash < cost) return fail('採用費用が足りません');
  const p = pool(s, typeId);
  const s2 = setPool(s, typeId, { ...p, rated: p.rated + count });
  return ok(withNews({ ...spend(s2, 'training', cost), hiresThisMonth: { ...(s.hiresThisMonth ?? {}), [typeId]: already + count } },
    `${t.name}の経験者パイロットを${count}人採用しました（${formatYen(cost)}）。`));
}

/** Train new pilots (or convert, from another type) on a type: ready after TRAINING_MONTHS */
export function trainPilots(s: GameState, typeId: string, count: number, fromTypeId?: string): Result {
  const t = AIRCRAFT_BY_ID[typeId];
  if (!t) return fail('機種が見つかりません');
  if (count <= 0) return fail('人数を入力してください');
  const cost = trainingCost(t, s.year, s.month) * count;
  if (s.cash < cost) return fail('訓練費用が足りません');
  let s2 = s;
  if (fromTypeId) {
    const from = pool(s, fromTypeId);
    const spare = from.rated - pilotsRequired(s, fromTypeId);
    if (count > from.rated) return fail('移行できるパイロットが足りません');
    if (count > spare) return fail(`${AIRCRAFT_BY_ID[fromTypeId].name}の運航に必要なパイロットまで移行することになります（余裕は${Math.max(0, spare)}人）`);
    s2 = setPool(s2, fromTypeId, { ...from, rated: from.rated - count });
  }
  const p = pool(s2, typeId);
  s2 = setPool(s2, typeId, { ...p, training: [...p.training, { count, readyYM: nowYM(s) + TRAINING_MONTHS }] });
  const what = fromTypeId ? `${AIRCRAFT_BY_ID[fromTypeId].name}から${t.name}への移行訓練` : `${t.name}の新人パイロット訓練`;
  return ok(withNews(spend(s2, 'training', cost), `${what}を${count}人で開始しました（${TRAINING_MONTHS}か月、${formatYen(cost)}）。`));
}

export function releasePilots(s: GameState, typeId: string, count: number): Result {
  const p = pool(s, typeId);
  if (count > p.rated) return fail('その人数はいません');
  // severance: 3 months' wage handled as a flat cost
  return ok(withNews(setPool(s, typeId, { ...p, rated: p.rated - count }),
    `${AIRCRAFT_BY_ID[typeId].name}のパイロット${count}人が退職しました。`));
}

/** Monthly: trainees finishing training become rated */
export function graduateTrainees(s: GameState): GameState {
  const now = nowYM(s);
  const pilots: Record<string, PilotPool> = {};
  for (const [id, p] of Object.entries(s.pilots)) {
    const done = p.training.filter((t) => t.readyYM <= now).reduce((n, t) => n + t.count, 0);
    pilots[id] = { rated: p.rated + done, training: p.training.filter((t) => t.readyYM > now) };
  }
  return { ...s, pilots };
}
