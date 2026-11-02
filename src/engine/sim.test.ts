import { describe, expect, test } from 'vitest';
import { advanceMonth, closeRoute, newGame, openRoute, setOps, setRoute } from './sim';
import { autoSchedule, scheduledWeekly, setPlaneSchedule, slotUsage, validateRotation, legViews } from './schedule';
import { acquireUsed, disposePlane, orderNew, leadMonths, startHeavyCheck } from './fleet';
import { creditLimit, takeLoan, repayLoan } from './finance';
import { crewedPlanes, hirePilots, trainPilots } from './staff';
import { canFly, HEAVY_CHECK_HOURS, marketDemand, referenceFare, routeDistance } from './model';
import { AIRCRAFT_BY_ID } from '../data/aircraft';
import type { GameState, UsedListing } from './types';
import type { Result } from './util';

const must = (r: Result): GameState => {
  if (!r.ok) throw new Error(r.error);
  return r.state;
};

/** Put a specific used plane on the market so tests are deterministic */
function withListing(s: GameState, typeId: string, price = 50_000_000): [GameState, string] {
  const l: UsedListing = { id: 'Utest' + s.nextId, typeId, builtYear: s.year - 5, condition: 80, totalHours: 8000, priceYen: price, expiresYM: 999999 };
  return [{ ...s, usedMarket: [...s.usedMarket, l], nextId: s.nextId + 1 }, l.id];
}

function setup() {
  let s = newGame('テスト航空', 'HND', 42);
  let id: string;
  [s, id] = withListing(s, 'dc3');
  s = must(acquireUsed(s, id, 'buy'));
  s = must(openRoute(s, 'HND', 'ITM'));
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

describe('routes and months', () => {
  test('cannot open a route to an airport that is not open yet', () => {
    expect(openRoute(newGame('x', 'HND', 1), 'HND', 'OKA').ok).toBe(false);
  });
  test('opening a route builds a valid daily rotation', () => {
    const s = setup();
    expect(scheduledWeekly(s, s.routes[0].id)).toBe(7);
    expect(s.planes[0].schedule).toHaveLength(2);
    expect(validateRotation(s, s.planes[0])).toEqual([]);
  });
  test('the auto-scheduler cannot exceed what aircraft time and airport hours allow', () => {
    let s = setup();
    s = must(setRoute(s, s.routes[0].id, { targetWeekly: 140 }));
    const n = scheduledWeekly(s, s.routes[0].id);
    expect(n).toBeGreaterThan(7);
    expect(n).toBeLessThan(140);
    expect(validateRotation(s, s.planes[0])).toEqual([]);
  });
  test('one plane is shared fairly between two routes', () => {
    let s = setup();
    s = must(openRoute(s, 'HND', 'SDJ'));
    s = must(setRoute(s, s.routes[0].id, { targetWeekly: 140 }));
    expect(scheduledWeekly(s, s.routes[1].id)).toBe(7);
  });
  test('slots at Haneda limit flights', () => {
    let s = setup();
    s = { ...s, slots: { HND: 4 } };
    s = must(setRoute(s, s.routes[0].id, { targetWeekly: 140 }));
    expect(slotUsage(s).HND).toBeLessThanOrEqual(4);
  });
  test('manual edits are validated and locked planes survive the auto-scheduler', () => {
    let s = setup();
    const p = s.planes[0];
    const legs = p.schedule.map((l) => ({ ...l }));
    // departing before the airport opens grounds the plane until fixed
    const bad = must(setPlaneSchedule(s, p.id, [{ ...legs[0], dep: 120 }, legs[1]]));
    expect(validateRotation(bad, bad.planes[0]).length).toBeGreaterThan(0);
    const moved = [{ ...legs[0], dep: legs[0].dep + 60 }, { ...legs[1], dep: legs[1].dep + 60 }];
    s = must(setPlaneSchedule(s, p.id, moved));
    expect(s.planes[0].locked).toBe(true);
    s = autoSchedule(s);
    expect(s.planes[0].schedule[0].dep).toBe(legs[0].dep + 60);
    expect(legViews(s, s.planes[0])[0].from).toBe('HND');
  });
  test('bigger turnaround buffers improve punctuality', () => {
    const run = (buffer: number) => {
      let s = setup();
      s = must(setOps(s, { bufferMin: buffer }));
      s = must(setRoute(s, s.routes[0].id, { targetWeekly: 140 }));
      let otp = 0;
      for (let i = 0; i < 12; i++) { s = advanceMonth(s); otp += s.history[s.history.length - 1].onTime; }
      return otp / 12;
    };
    expect(run(60)).toBeGreaterThan(run(0));
  });
  test('a month of flying produces passengers, revenue and costs', () => {
    let s = setup();
    const next = advanceMonth(s);
    expect(next.month).toBe(2);
    const rep = next.history[0];
    expect(rep.pax).toBeGreaterThan(0);
    expect(rep.revenue).toBeGreaterThan(0);
    expect(next.cash).toBeCloseTo(s.cash + rep.profit + rep.costs.training + rep.costs.heavyChecks - rep.principalRepaid - rep.deliveriesPaid, 0);
    expect(next.planes[0].totalHours).toBeGreaterThan(8000);
  });
  test('year rolls over after December', () => {
    let s = newGame('x', 'HND', 1);
    for (let i = 0; i < 12; i++) s = advanceMonth(s);
    expect([s.year, s.month]).toEqual([1961, 1]);
  });
  test('three months of negative cash means bankruptcy', () => {
    let s = { ...newGame('x', 'HND', 1), cash: -1e9 };
    for (let i = 0; i < 3; i++) s = advanceMonth(s);
    expect(s.gameOver).toBe(true);
  });
  test('closing a route frees its planes; selling an owned plane brings cash', () => {
    let s = setup();
    s = must(closeRoute(s, s.routes[0].id));
    expect(s.planes[0].schedule).toHaveLength(0);
    const cash = s.cash;
    s = must(disposePlane(s, s.planes[0].id));
    expect(s.cash).toBeGreaterThan(cash);
    expect(s.planes).toHaveLength(0);
  });
});

describe('fleet', () => {
  test('new orders are delivered after the lead time and the balance is paid then', () => {
    let s = newGame('x', 'HND', 1);
    const lead = leadMonths(AIRCRAFT_BY_ID['f27'], 1960);
    s = must(orderNew(s, 'f27', 'buy'));
    expect(s.planes[0].status).toBe('onOrder');
    const due = s.planes[0].balanceDueYen;
    for (let i = 0; i < lead; i++) s = advanceMonth(s);
    expect(s.planes[0].status).toBe('onOrder');
    s = advanceMonth(s);
    expect(s.planes[0].status).toBe('active');
    expect(s.history[s.history.length - 1].deliveriesPaid).toBeCloseTo(due, 0);
  });
  test('cannot order a type before it exists', () => {
    expect(orderNew(newGame('x', 'HND', 1), 'b747-100', 'buy').ok).toBe(false);
  });
  test('operating lease ends and the plane is returned', () => {
    let s = newGame('x', 'HND', 1);
    let id: string;
    [s, id] = withListing(s, 'dc3');
    s = must(acquireUsed(s, id, 'wet', 2)); // 2 months
    expect(s.planes).toHaveLength(1);
    s = advanceMonth(advanceMonth(s));
    s = advanceMonth(s);
    expect(s.planes).toHaveLength(0);
  });
  test('heavy check takes the plane out of service and restores condition', () => {
    let s = setup();
    s = { ...s, planes: s.planes.map((p) => ({ ...p, condition: 50, hoursSinceHeavy: HEAVY_CHECK_HOURS - 1 })) };
    s = must(startHeavyCheck(s, s.planes[0].id));
    expect(s.planes[0].status).toBe('heavyCheck');
    s = advanceMonth(s);
    s = advanceMonth(s);
    expect(s.planes[0].status).toBe('active');
    expect(s.planes[0].hoursSinceHeavy).toBeLessThan(1000);
  });
});

describe('people and money', () => {
  test('planes without rated pilots cannot fly', () => {
    let s = newGame('x', 'HND', 1);
    let id: string;
    [s, id] = withListing(s, 'v828');
    s = must(acquireUsed(s, id, 'buy'));
    expect(crewedPlanes(s).size).toBe(0);
    s = must(hirePilots(s, 'v828', 6));
    expect(hirePilots(s, 'v828', 1).ok).toBe(false); // monthly hiring limit
    s = must(trainPilots(s, 'v828', 4));
    expect(crewedPlanes(s).size).toBe(0);
    for (let i = 0; i < 5; i++) s = advanceMonth(s);
    expect(s.pilots['v828'].rated).toBe(10);
    expect(crewedPlanes(s).size).toBe(1);
  });
  test('loans add cash, are limited by credit, and can be repaid', () => {
    let s = newGame('x', 'HND', 1);
    const limit = creditLimit(s);
    expect(takeLoan(s, limit * 2, 5).ok).toBe(false);
    s = must(takeLoan(s, 100_000_000, 5));
    expect(s.cash).toBe(600_000_000);
    s = advanceMonth(s);
    expect(s.loans[0].balanceYen).toBeLessThan(100_000_000);
    expect(s.history[0].costs.interest).toBeGreaterThan(0);
    s = must(repayLoan(s, s.loans[0].id));
    expect(s.loans).toHaveLength(0);
  });
});
