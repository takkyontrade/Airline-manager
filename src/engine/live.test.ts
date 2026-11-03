import { describe, expect, test } from 'vitest';
import { airborneAt, weekClock, type LiveLeg } from './live';
import type { Plane, Route } from './types';

const route = { id: 'R1', from: 'HND', to: 'CTS' } as Route;
const leg = (dep: number, arr: number, days = 127, cycle: number | null = null): LiveLeg => ({
  plane: { id: 'P1' } as Plane, cycle,
  view: { leg: { routeId: 'R1', dir: 0, dep, days }, route, from: 'HND', to: 'CTS', dep, arr },
});

describe('live map', () => {
  test('a daily flight is in the air between departure and arrival', () => {
    const l = [leg(480, 570)];
    expect(airborneAt(l, 470)).toHaveLength(0);
    expect(airborneAt(l, 525)[0].progress).toBeCloseTo(0.5);
    expect(airborneAt(l, 1440 * 3 + 500)).toHaveLength(1);
    expect(airborneAt(l, 600)).toHaveLength(0);
  });
  test('day masks and flights past midnight', () => {
    const tueOnly = [leg(480, 570, 2)];
    expect(airborneAt(tueOnly, 500)).toHaveLength(0);
    expect(airborneAt(tueOnly, 1440 + 500)).toHaveLength(1);
    // Sunday 23:00 departure still flying on Monday 00:30
    const late = [leg(1380, 1500, 64)];
    expect(airborneAt(late, 30)).toHaveLength(1);
  });
  test('multi-day rotations repeat every cycle', () => {
    const l = [leg(1500, 2100, 127, 2880)];
    expect(airborneAt(l, 1600)).toHaveLength(1);
    expect(airborneAt(l, 2880 + 1600)).toHaveLength(1);
    expect(airborneAt(l, 2880 + 100)).toHaveLength(0);
  });
  test('clock label', () => {
    expect(weekClock(1440 * 2 + 8 * 60 + 5)).toBe('水 08:05');
  });
});
