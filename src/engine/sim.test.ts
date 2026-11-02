import { describe, expect, test } from 'vitest';
import {
  acquirePlane, advanceMonth, aircraftMarket, assignPlane, closeRoute, disposePlane, newGame,
  openRoute, routeCapacity, setRoute,
} from './sim';
import { canFly, marketDemand, referenceFare, routeDistance } from './model';
import { AIRCRAFT_BY_ID } from '../data/aircraft';
import type { GameState } from './types';

const must = (r: ReturnType<typeof openRoute>): GameState => {
  if (!r.ok) throw new Error(r.error);
  return r.state;
};

function setup() {
  let s = newGame('テスト航空', 'HND', 42);
  const offer = aircraftMarket(s.year, s.month).find((o) => o.type.id === 'v828' && o.condition === 'new')!;
  s = must(acquirePlane(s, offer, 'lease'));
  s = must(openRoute(s, 'HND', 'ITM'));
  s = must(assignPlane(s, s.planes[0].id, s.routes[0].id));
  return s;
}

describe('model', () => {
  test('Tokyo-Osaka distance is about 400 km', () => {
    expect(routeDistance('HND', 'ITM')).toBeGreaterThan(380);
    expect(routeDistance('HND', 'ITM')).toBeLessThan(420);
  });
  test('reference fare grows with distance', () => {
    expect(referenceFare(1000, 1960, 1)).toBeGreaterThan(referenceFare(400, 1960, 1));
  });
  test('air travel demand grows a lot between 1960 and 1990', () => {
    expect(marketDemand('HND', 'CTS', 1990, 6)).toBeGreaterThan(marketDemand('HND', 'CTS', 1960, 6) * 10);
  });
  test('jets cannot use a short 1960 runway', () => {
    expect(canFly(AIRCRAFT_BY_ID['dc8'], 'HND', 'KCZ').ok).toBe(false);
    expect(canFly(AIRCRAFT_BY_ID['dc3'], 'HND', 'KCZ').ok).toBe(true);
  });
});

describe('simulation', () => {
  test('market only offers types that exist in that year', () => {
    const ids = aircraftMarket(1960, 1).map((o) => o.type.id);
    expect(ids).toContain('dc3');
    expect(ids).not.toContain('b747-100');
    expect(aircraftMarket(1971, 1).map((o) => o.type.id)).toContain('b747-100');
  });
  test('cannot open a route to an airport that is not open yet', () => {
    const s = newGame('x', 'HND', 1);
    expect(openRoute(s, 'HND', 'OKA').ok).toBe(false);
  });
  test('frequency is capped by assigned aircraft', () => {
    let s = setup();
    const cap = routeCapacity(s.planes, s.routes[0]);
    expect(cap).toBeGreaterThan(0);
    s = must(setRoute(s, s.routes[0].id, { weeklyFreq: 999 }));
    expect(s.routes[0].weeklyFreq).toBe(cap);
    s = must(assignPlane(s, s.planes[0].id, null));
    expect(s.routes[0].weeklyFreq).toBe(0);
  });
  test('a month of flying produces passengers, revenue and costs', () => {
    let s = setup();
    s = must(setRoute(s, s.routes[0].id, { weeklyFreq: 14 }));
    const next = advanceMonth(s);
    expect(next.month).toBe(2);
    const rep = next.history[0];
    expect(rep.pax).toBeGreaterThan(0);
    expect(rep.revenue).toBeGreaterThan(0);
    expect(rep.costs.lease).toBeGreaterThan(0);
    expect(next.cash).toBeCloseTo(s.cash + rep.profit, 0);
  });
  test('year rolls over after December', () => {
    let s = newGame('x', 'HND', 1);
    for (let i = 0; i < 12; i++) s = advanceMonth(s);
    expect(s.year).toBe(1961);
    expect(s.month).toBe(1);
  });
  test('three months of negative cash means bankruptcy', () => {
    let s = { ...newGame('x', 'HND', 1), cash: -1e9 };
    for (let i = 0; i < 3; i++) s = advanceMonth(s);
    expect(s.gameOver).toBe(true);
  });
  test('returning a leased plane costs a penalty; closing a route frees planes', () => {
    let s = setup();
    s = must(closeRoute(s, s.routes[0].id));
    expect(s.planes[0].routeId).toBeNull();
    const cash = s.cash;
    s = must(disposePlane(s, s.planes[0].id));
    expect(s.cash).toBeLessThan(cash);
    expect(s.planes).toHaveLength(0);
  });
});
