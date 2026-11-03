// "Live" view: where each plane is at a moment of the week, from its timetable.
import type { GameState, Plane } from './types';
import { legViews, type LegView } from './schedule';

export const WEEK_MIN = 7 * 1440;

export interface Airborne {
  plane: Plane;
  view: LegView;
  /** 0..1 along the leg */
  progress: number;
}

export interface LiveLeg { plane: Plane; view: LegView; cycle: number | null }

/** Every leg flown by an active plane (computed once per state) */
export function liveLegs(s: GameState): LiveLeg[] {
  return s.planes.filter((p) => p.status === 'active' && p.schedule.length).flatMap((p) => {
    const cycle = (p.cycleDays ?? 1) > 1 ? p.cycleDays! * 1440 : null;
    return legViews(s, p).filter((v) => v.arr > v.dep).map((view) => ({ plane: p, view, cycle }));
  });
}

/**
 * Planes in the air at minute `t` of the week (0 = Monday 00:00, Japan time).
 * Daily rotations fly on the days in each leg's mask (a leg can run past
 * midnight); multi-day long-haul rotations repeat every `cycleDays`.
 */
export function airborneAt(legs: LiveLeg[], t: number): Airborne[] {
  const out: Airborne[] = [];
  const tt = ((t % WEEK_MIN) + WEEK_MIN) % WEEK_MIN;
  for (const { plane, view: v, cycle } of legs) {
    const len = v.arr - v.dep;
    let elapsed: number | null = null;
    if (cycle) {
      const tc = tt % cycle;
      for (const c of [tc, tc + cycle]) if (elapsed === null && c >= v.dep && c < v.arr) elapsed = c - v.dep;
    } else {
      // the leg may have left today or (running past midnight) on an earlier day;
      // a negative day is last week's (Sunday = -1)
      const day = Math.floor(tt / 1440);
      for (let back = 0; back <= Math.floor(v.arr / 1440) && elapsed === null; back++) {
        const d = day - back;
        const e = tt - (d * 1440 + v.dep);
        if (v.leg.days & (1 << (((d % 7) + 7) % 7)) && e >= 0 && e < len) elapsed = e;
      }
    }
    if (elapsed !== null) out.push({ plane, view: v, progress: elapsed / len });
  }
  return out;
}

const DAY_NAMES = ['月', '火', '水', '木', '金', '土', '日'];
export function weekClock(t: number): string {
  const tt = ((Math.floor(t) % WEEK_MIN) + WEEK_MIN) % WEEK_MIN;
  const d = Math.floor(tt / 1440), m = tt % 1440;
  return `${DAY_NAMES[d]} ${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
