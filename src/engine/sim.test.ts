import { describe, expect, test } from 'vitest';
import { applyPricing, bestFareRatio, setRouteGroup, addCircuit, advanceMonth, closeRoute, removeCircuit, setCircuit, joinAlliance, newGame, openRoute, routeMarket, setOps, setRoute, START_CASH } from './sim';
import { allocateSlots } from './slots';
import { competitors } from './rivals';
import { circuitScheduled, setPlaneBase, autoSchedule, scheduledWeekly, setPlaneSchedule, slotUsage, validateRotation, legViews } from './schedule';
import { acquireUsed, disposePlane, orderNew, orderNewBulk, leadMonths, startConversion, startHeavyCheck } from './fleet';
import { creditLimit, takeLoan, repayLoan } from './finance';
import { crewedPlanes, hirePilots, trainPilots } from './staff';
import { accidentRatePerFlight, canFly, HEAVY_CHECK_HOURS, intlReferenceFare, routeReferenceFare, riskFactor, marketDemand, referenceFare, routeDistance } from './model';
import { AIRCRAFT_BY_ID, ratingOf } from '../data/aircraft';
import type { GameState, UsedListing } from './types';
import { aircraftTour, cabinAcceptance, farewellCandidates, farewellFlight, paintSpecial } from './brand';
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
  s = must(openRoute(s, 'HND', 'ITM', { skipLicense: true }));
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
    expect(canFly(AIRCRAFT_BY_ID['dc8'], 'HND', 'KCZ', 1960).ok).toBe(false);
    expect(canFly(AIRCRAFT_BY_ID['dc3'], 'HND', 'KCZ', 1960).ok).toBe(true);
  });
});

describe('routes and months', () => {
  test('in 1960 a newcomer needs a track record to enter routes rivals already fly', () => {
    const s = newGame('x', 'HND', 1);
    expect(openRoute(s, 'HND', 'ITM').ok).toBe(false);
    expect(openRoute(s, 'HND', 'HAC').ok).toBe(true);
    expect(openRoute({ ...s, year: 2005 }, 'HND', 'ITM').ok).toBe(true);
  });
  test('fares are regulated before 1996', () => {
    let s = setup();
    s = must(setRoute(s, s.routes[0].id, { fareYen: 1 }));
    expect(s.routes[0].fareYen).toBeGreaterThan(5000);
  });
  test('the Tokaido Shinkansen cuts Tokyo-Osaka air demand', () => {
    expect(marketDemand('HND', 'ITM', 1965, 6) / marketDemand('HND', 'ITM', 1964, 6)).toBeLessThan(0.75);
  });
  test('the old Nagoya airport closes when Chubu opens', () => {
    expect(openRoute({ ...newGame('x', 'HND', 1), year: 2006 }, 'HND', 'NKM').ok).toBe(false);
  });
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
    s = must(openRoute(s, 'HND', 'SDJ', { skipLicense: true }));
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

describe('international', () => {
  function fleet(year: number, typeId: string, n: number, base = 'NRT') {
    let s: GameState = { ...newGame('国際テスト', 'HND', 7), year, month: 6, reputation: 70, cash: 1e12 };
    s = { ...s, crewBases: [...s.crewBases, base], pilots: { ...s.pilots, [typeId]: { rated: 60, training: [] } }, slots: { ...s.slots, NRT: 99, HND: 99 } };
    for (let i = 0; i < n; i++) {
      let id: string;
      [s, id] = withListing(s, typeId);
      s = must(acquireUsed(s, id, 'buy'));
    }
    return { ...s, planes: s.planes.map((p) => ({ ...p, base })) };
  }

  test('only the flag carrier flies abroad before 1986', () => {
    const s = fleet(1980, 'b747-200b', 4);
    expect(openRoute(s, 'NRT', 'HNL').ok).toBe(false);
    expect(openRoute({ ...s, year: 1990 }, 'NRT', 'HNL').ok).toBe(true);
  });
  test('foreign airports cannot be linked to each other, and Haneda is domestic-only 1978-2009', () => {
    const s = fleet(1995, 'b747-400', 4);
    expect(openRoute(s, 'HNL', 'LAX').ok).toBe(false);
    expect(openRoute(s, 'HND', 'HNL').ok).toBe(false);
  });
  test('ETOPS: a 767 cannot cross the Pacific before twin-engine rules allow it', () => {
    const t = AIRCRAFT_BY_ID['b767-300er'];
    expect(canFly(t, 'NRT', 'HNL', 1984).ok).toBe(false);
    expect(canFly(t, 'NRT', 'HNL', 1990).ok).toBe(true);
    expect(canFly(AIRCRAFT_BY_ID['b747-400'], 'NRT', 'HNL', 1990).ok).toBe(true);
  });
  test('long-haul planes fly rotations that cross midnight and stay valid', () => {
    let s = fleet(1995, 'b747-400', 4);
    s = must(openRoute(s, 'NRT', 'JFK'));
    for (const p of s.planes) expect(validateRotation(s, p)).toEqual([]);
    expect(s.planes[0].cycleDays).toBeGreaterThanOrEqual(1);
    expect(scheduledWeekly(s, s.routes[0].id)).toBeGreaterThan(3);
    const before = s.cash;
    s = advanceMonth(s);
    expect(s.history[0].routes[0].pax).toBeGreaterThan(0);
    expect(s.cash).not.toBe(before);
  });
  test('domestic feeder flights add connecting passengers to an international route', () => {
    let s = fleet(1995, 'b747-400', 4);
    s = must(openRoute(s, 'NRT', 'HNL'));
    const alone = routeMarket(s, s.routes[0]).marketOneWay;
    s = must(openRoute(s, 'NRT', 'CTS', { skipLicense: true }));
    const fed = routeMarket(s, s.routes[0]);
    expect(fed.connecting).toBeGreaterThan(0);
    expect(fed.marketOneWay).toBeGreaterThan(alone);
  });
  test('alliances need international routes and take one Japanese airline', () => {
    let s = fleet(2001, 'b777-200er', 4);
    expect(joinAlliance(s, 'SKT').ok).toBe(false);
    s = must(openRoute(s, 'NRT', 'CDG'));
    s = must(openRoute(s, 'NRT', 'ICN'));
    expect(joinAlliance(s, 'ARC').ok).toBe(false); // the domestic major is already in
    s = must(joinAlliance(s, 'SKT'));
    const m = routeMarket(s, s.routes[0]);
    expect(m.partnerIds).toContain('LUM');
  });
  test('international fares move with the exchange rate', () => {
    expect(intlReferenceFare(6000, 1984, 6) / intlReferenceFare(6000, 1988, 6)).toBeGreaterThan(1.1);
  });
});

describe('cargo and safety', () => {
  function co(year: number, typeId: string, n: number, base = 'HND') {
    let s: GameState = { ...newGame('貨物テスト', base, 11), year, month: 6, reputation: 70, cash: 1e12 };
    s = { ...s, pilots: { ...s.pilots, [ratingOf(typeId)]: { rated: 60, training: [] } }, slots: { ...s.slots, NRT: 99, HND: 99 } };
    for (let i = 0; i < n; i++) {
      let id: string;
      [s, id] = withListing(s, typeId);
      s = must(acquireUsed(s, id, 'buy'));
    }
    return { ...s, crewBases: [...new Set([...s.crewBases, base])], planes: s.planes.map((p) => ({ ...p, base, builtYear: year - 12 })) };
  }

  test('passenger flights carry belly cargo', () => {
    let s = co(1990, 'b767-300', 2);
    s = must(openRoute(s, 'HND', 'FUK', { skipLicense: true }));
    s = advanceMonth(s);
    const r = s.history[0].routes[0];
    expect(r.cargoT).toBeGreaterThan(0);
    expect(r.cargoRevenue).toBeGreaterThan(0);
  });
  test('freighters only fly cargo routes, airliners only passenger routes', () => {
    let s = co(1995, 'b747-400f', 1, 'NRT');
    s = must(openRoute(s, 'NRT', 'HKG', { skipLicense: true }));
    expect(scheduledWeekly(s, s.routes[0].id)).toBe(0);
    s = must(openRoute(s, 'NRT', 'HKG', { kind: 'cargo', skipLicense: true }));
    expect(scheduledWeekly(s, s.routes[1].id)).toBeGreaterThan(0);
    s = advanceMonth(s);
    const cargoRoute = s.history[0].routes.find((x) => x.routeId === s.routes[1].id)!;
    expect(cargoRoute.pax).toBe(0);
    expect(cargoRoute.cargoT).toBeGreaterThan(100);
  });
  test('a 747-400 can be converted into a 747-400BCF and keeps its pilots', () => {
    let s = co(2006, 'b747-400', 1, 'NRT');
    const id = s.planes[0].id;
    expect(startConversion(s, id, 'b747-400f').ok).toBe(false); // factory-built freighter is not a conversion
    s = must(startConversion(s, id, 'b747-400bcf'));
    expect(s.planes[0].status).toBe('shop');
    for (let i = 0; i < 5; i++) s = advanceMonth(s);
    expect(s.planes[0].typeId).toBe('b747-400bcf');
    expect(crewedPlanes(s).has(id)).toBe(true);
  });
  test('conversions follow real programs: no 767 conversions in 1990', () => {
    const s = co(1990, 'b767-300er', 1, 'NRT');
    expect(startConversion(s, s.planes[0].id, 'b767-300bcf').ok).toBe(false);
  });
  test('maintenance quality drives risk, which never reaches zero', () => {
    expect(riskFactor(96, 5, 1, 3, 0.9)).toBeLessThan(riskFactor(86, 5, 1, 0, 1));
    expect(riskFactor(50, 30, 6, 0, 1.15)).toBeGreaterThan(5);
    expect(riskFactor(100, 0, 1, 3, 0.9)).toBeGreaterThan(0);
    expect(accidentRatePerFlight(2027)).toBeGreaterThan(0);
  });
  test('a badly maintained fleet has incidents and pays more for insurance', () => {
    let good = co(1965, 'f27', 3);
    good = must(openRoute(good, 'HND', 'SDJ', { skipLicense: true }));
    good = must(setRoute(good, good.routes[0].id, { targetWeekly: 40 }));
    const bad: GameState = { ...good, maintLevel: 'low', planes: good.planes.map((p) => ({ ...p, condition: 25 })) };
    let a = good, b = bad;
    for (let i = 0; i < 12; i++) { a = advanceMonth(a); b = advanceMonth(b); b = { ...b, planes: b.planes.map((p) => ({ ...p, condition: 25 })) }; }
    const ev = (x: GameState) => (x.safety?.incidents ?? 0) + (x.safety?.serious ?? 0) * 10 + (x.safety?.accidents ?? 0) * 100;
    expect(ev(b)).toBeGreaterThan(ev(a));
    expect(b.history[0].costs.insurance!).toBeGreaterThan(a.history[0].costs.insurance!);
  });
});

describe('cabins and fan service', () => {
  test('a premium cabin takes years to catch on, then earns more per flight', () => {
    let s: GameState = { ...newGame('クラス', 'NRT', 5), year: 1995, reputation: 65, cash: 1e12, slots: { HND: 99, ITM: 99, NRT: 99 } };
    s = { ...s, pilots: { 'b747-400': { rated: 60, training: [] } } };
    for (let i = 0; i < 4; i++) { let id: string; [s, id] = withListing(s, 'b747-400'); s = must(acquireUsed(s, id, 'buy')); }
    s = { ...s, planes: s.planes.map((p) => ({ ...p, base: 'NRT' })) };
    s = must(openRoute(s, 'NRT', 'LAX'));
    s = must(setRoute(s, s.routes[0].id, { cabin: 'three' }));
    expect(cabinAcceptance(s, 'three')).toBe(0);
    for (let i = 0; i < 40; i++) s = advanceMonth(s);
    expect(cabinAcceptance(s, 'three')).toBeGreaterThan(0.9);
    const last = s.history[s.history.length - 1].routes[0];
    expect(last.premiumPax).toBeGreaterThan(0);
  });
  test('special liveries, tours and farewell flights please fans', () => {
    let s = setup();
    const rep = s.reputation;
    s = must(paintSpecial(s, s.planes[0].id, 'special', '五輪応援'));
    expect(s.reputation).toBeGreaterThan(rep);
    expect(paintSpecial(s, s.planes[0].id, 'retro', '').ok).toBe(false);
    s = must(aircraftTour(s));
    expect(aircraftTour(s).ok).toBe(false); // twice a year at most
    expect(farewellCandidates(s)).toContain('dc3'); // old DC-3s
    s = must(farewellFlight(s, 'dc3'));
    expect(farewellFlight(s, 'dc3').ok).toBe(false);
  });
});

describe('technical stops and the Cold War detour', () => {
  test('in the 1960s Europe needs a stop in Anchorage', () => {
    const t = AIRCRAFT_BY_ID['dc8'];
    expect(canFly(t, 'HND', 'LHR', 1965).ok).toBe(false);
    expect(canFly(t, 'HND', 'LHR', 1965, 'ANC').ok).toBe(true);
    expect(routeDistance('HND', 'LHR')).toBeLessThan(10000);
  });
  test('a route can be given a refuelling stop, which lengthens the flight', () => {
    let s: GameState = { ...newGame('経由', 'NRT', 9), year: 1995, reputation: 70, cash: 1e12, slots: { HND: 99, ITM: 99, NRT: 99 } };
    s = { ...s, pilots: { 'b747-400': { rated: 60, training: [] } } };
    for (let i = 0; i < 4; i++) { let id: string; [s, id] = withListing(s, 'b747-400f'); s = must(acquireUsed(s, id, 'buy')); }
    s = { ...s, planes: s.planes.map((p) => ({ ...p, base: 'NRT' })) };
    s = must(openRoute(s, 'NRT', 'ORD', { kind: 'cargo' }));
    expect(scheduledWeekly(s, s.routes[0].id)).toBe(0); // too far nonstop for a 747-400F
    s = must(setRoute(s, s.routes[0].id, { via: 'ANC' }));
    expect(scheduledWeekly(s, s.routes[0].id)).toBeGreaterThan(0);
    expect(setRoute(s, s.routes[0].id, { via: 'HND' }).ok).toBe(false);
  });
});

describe('start options and long-haul editing', () => {
  test('later start years bring era-appropriate pilots and capital', () => {
    const s = newGame('x', 'HND', 1, { startYear: 1986, difficulty: 'hard' });
    expect(s.year).toBe(1986);
    expect(s.pilots['b737-200'].rated).toBe(10);
    expect(s.cash).toBeGreaterThan(START_CASH); // inflation outweighs the hard-mode cut
    const easy = newGame('x', 'HND', 1, { startYear: 1986, difficulty: 'easy' });
    expect(easy.cash).toBeGreaterThan(s.cash * 3);
  });
  test('a long-haul rotation can be retimed by hand', () => {
    let s: GameState = { ...newGame('長距離', 'NRT', 4), year: 1995, reputation: 70, cash: 1e12, slots: { HND: 99, ITM: 99, NRT: 99 } };
    s = { ...s, pilots: { 'b747-400': { rated: 60, training: [] } } };
    for (let i = 0; i < 4; i++) { let id: string; [s, id] = withListing(s, 'b747-400'); s = must(acquireUsed(s, id, 'buy')); }
    s = { ...s, planes: s.planes.map((p) => ({ ...p, base: 'NRT' })) };
    s = must(openRoute(s, 'NRT', 'JFK'));
    const p = s.planes.find((x) => x.schedule.length)!;
    const legs = p.schedule.map((l, i) => (i === 0 ? { ...l, dep: 600 } : { ...l, dep: 600 + 1440 }));
    s = must(setPlaneSchedule(s, p.id, legs, undefined, 3));
    const q = s.planes.find((x) => x.id === p.id)!;
    expect(q.locked).toBe(true);
    expect(q.cycleDays).toBe(3);
    expect(validateRotation(s, q)).toEqual([]);
  });
});

describe('circuits', () => {
  function base2000() {
    let s = newGame('t', 'HND', 1, { startYear: 2000 });
    let id: string;
    [s, id] = withListing(s, 'b737-500', 100_000_000);
    return must(acquireUsed(s, id, 'buy'));
  }
  test('a triangle opens missing legs and is flown by one plane in order', () => {
    const s = must(addCircuit(base2000(), ['HND', 'KOJ', 'FUK']));
    expect(s.routes).toHaveLength(3);
    const c = s.circuits![0];
    expect(circuitScheduled(s, c)).toBe(7);
    const legs = s.planes[0].schedule;
    expect(legs).toHaveLength(3);
    expect(validateRotation(s, s.planes[0])).toEqual([]);
    for (const r of s.routes) expect(scheduledWeekly(s, r.id)).toBe(7);
  });
  test('an airport can be visited twice', () => {
    const s = must(addCircuit(base2000(), ['ITM', 'SDJ', 'CTS', 'SDJ']));
    expect(s.circuits![0].stops).toEqual(['ITM', 'SDJ', 'CTS', 'SDJ']);
    expect(s.routes).toHaveLength(2);
    expect(circuitScheduled(s, s.circuits![0])).toBe(7);
    expect(s.planes[0].schedule).toHaveLength(4);
  });
  test('weekly target can be lowered and the circuit removed', () => {
    let s = must(addCircuit(base2000(), ['HND', 'KOJ', 'FUK']));
    const id = s.circuits![0].id;
    s = must(setCircuit(s, id, { targetWeekly: 3 }));
    expect(circuitScheduled(s, s.circuits![0])).toBe(3);
    s = must(removeCircuit(s, id));
    expect(s.circuits).toHaveLength(0);
    expect(s.planes[0].schedule).toHaveLength(0);
  });
  test('needs three different domestic airports', () => {
    const s = base2000();
    expect(addCircuit(s, ['HND', 'FUK']).ok).toBe(false);
    expect(addCircuit(s, ['HND', 'FUK', 'HND']).ok).toBe(false);
    expect(addCircuit(s, ['HND', 'FUK', 'FUK', 'KOJ']).ok).toBe(false);
  });
  test('closing one leg stops the circuit without breaking the schedule', () => {
    let s = must(addCircuit(base2000(), ['HND', 'KOJ', 'FUK']));
    s = must(closeRoute(s, s.routes[1].id));
    expect(circuitScheduled(s, s.circuits![0])).toBe(0);
  });
});

describe('plane base', () => {
  test('a chosen base sticks and the auto-scheduler flies from it', () => {
    let s = newGame('t', 'HND', 1, { startYear: 2000 });
    let id: string;
    [s, id] = withListing(s, 'b737-500', 100_000_000);
    s = must(acquireUsed(s, id, 'buy'));
    const planeId = s.planes[0].id;
    s = must(setPlaneBase(s, planeId, 'FUK'));
    expect(s.planes[0].base).toBe('FUK');
    s = must(openRoute(s, 'HND', 'ITM'));
    // no route touches FUK: the plane stays there instead of being moved
    expect(s.planes[0].base).toBe('FUK');
    s = must(openRoute(s, 'FUK', 'KOJ'));
    expect(s.planes[0].schedule.length).toBeGreaterThan(0);
    s = must(setPlaneBase(s, planeId, null));
    expect(s.planes[0].baseFixed).toBe(false);
  });
});

describe('trunk licence', () => {
  test('uses the reputation as shown on screen (rounded)', () => {
    let s = newGame('t', 'KMQ', 1);
    for (let i = 0; i < 3; i++) { let id: string; [s, id] = withListing(s, 'dc3', 1); s = must(acquireUsed(s, id, 'buy')); }
    expect(openRoute({ ...s, reputation: 49.6 }, 'HND', 'ITM').ok).toBe(true);
    const r = openRoute({ ...s, reputation: 47 }, 'HND', 'ITM');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('今は評判47');
  });
});

describe('planes in the shop', () => {
  test('flights move to an idle plane when one goes into heavy check', () => {
    let s = newGame('t', 'HND', 1, { startYear: 2000 });
    for (let i = 0; i < 2; i++) { let id: string; [s, id] = withListing(s, 'b737-500', 1); s = must(acquireUsed(s, id, 'buy')); }
    s = must(openRoute(s, 'HND', 'FUK'));
    s = must(setRoute(s, s.routes[0].id, { targetWeekly: 7 }));
    const busy = s.planes.find((p) => p.schedule.length > 0)!;
    const idle = s.planes.find((p) => p.id !== busy.id)!;
    s = autoSchedule(must(startHeavyCheck(s, busy.id)));
    expect(s.planes.find((p) => p.id === busy.id)!.schedule).toHaveLength(0);
    expect(s.planes.find((p) => p.id === idle.id)!.schedule.length).toBeGreaterThan(0);
    expect(scheduledWeekly(s, s.routes[0].id)).toBe(7);
  });
});

describe('slot allocation', () => {
  test('a new runway releases slots, newcomers get a priority share', () => {
    const s = { ...newGame('t', 'HND', 1, { startYear: 1986 }), year: 1997, month: 3 };
    const { s: after, news } = allocateSlots(s);
    expect(after.slots.HND).toBeGreaterThan(s.slots.HND + 12);
    expect(news.join()).toContain('新規参入枠');
  });
  test('no slots appear outside the scheduled steps for an average airline', () => {
    const s = { ...newGame('t', 'HND', 1, { startYear: 1986 }), year: 1990, month: 4 };
    expect(allocateSlots(s).s.slots.HND).toBe(s.slots.HND);
  });
  test('unused slots are taken back in recollection years', () => {
    const s = { ...newGame('t', 'HND', 1, { startYear: 2000 }), year: 2005, month: 4 };
    const big = { ...s, slots: { ...s.slots, HND: 100 } };
    expect(allocateSlots(big).s.slots.HND).toBeLessThan(100);
  });
});

describe('slots per weekday', () => {
  test('a 3x and a 4x weekly route share one daily round-trip slot', () => {
    let s = newGame('t', 'HND', 1, { startYear: 2000 });
    for (let i = 0; i < 2; i++) { let id: string; [s, id] = withListing(s, 'b737-500', 1); s = must(acquireUsed(s, id, 'buy')); }
    s = { ...s, slots: { ...s.slots, HND: 2 } };
    s = must(openRoute(s, 'HND', 'FUK'));
    s = must(setRoute(s, s.routes[0].id, { targetWeekly: 3 }));
    s = must(openRoute(s, 'HND', 'CTS'));
    s = must(setRoute(s, s.routes[1].id, { targetWeekly: 4 }));
    expect(scheduledWeekly(s, s.routes[0].id)).toBe(3);
    expect(scheduledWeekly(s, s.routes[1].id)).toBe(4);
    expect(slotUsage(s).HND).toBe(2);
  });
});

describe('bulk orders', () => {
  test('ordering five at once is cheaper and deliveries are spread', () => {
    const s = { ...newGame('t', 'HND', 1, { startYear: 2000 }), cash: 1e12 };
    const one = must(orderNew(s, 'b737-800', 'buy'));
    const five = must(orderNewBulk(s, 'b737-800', 'buy', 5));
    const ordered = five.planes.filter((p) => p.status === 'onOrder');
    expect(ordered).toHaveLength(5);
    expect(ordered[0].purchaseYen).toBeLessThan(one.planes[one.planes.length - 1].purchaseYen);
    expect(Math.max(...ordered.map((p) => p.readyYM)) - Math.min(...ordered.map((p) => p.readyYM))).toBe(2);
  });
  test('stops when the deposit runs out', () => {
    const s = { ...newGame('t', 'HND', 1, { startYear: 2000 }), cash: 2e9 };
    const r = must(orderNewBulk(s, 'b737-800', 'buy', 20));
    expect(r.planes.filter((p) => p.status === 'onOrder').length).toBeLessThan(20);
  });
});

describe('aircraft type priority', () => {
  function fleet() {
    let s: GameState = { ...newGame('t', 'HND', 1, { startYear: 1972 }), slots: { HND: 200, ITM: 200, NRT: 20 } };
    for (const t of ['l1011', 'ys11']) { let id: string; [s, id] = withListing(s, t, 1); s = must(acquireUsed(s, id, 'buy')); }
    s = must(openRoute(s, 'HND', 'HAC', { skipLicense: true }));
    s = must(setRoute(s, s.routes[0].id, { targetWeekly: 7 }));
    s = must(openRoute(s, 'HND', 'CTS', { skipLicense: true }));
    s = must(setRoute(s, s.routes[1].id, { targetWeekly: 7 }));
    return s;
  }
  const typeOn = (s: GameState, routeId: string) => s.planes.find((p) => p.schedule.some((l) => l.routeId === routeId))?.typeId;
  test('without a priority the busy trunk route gets the big plane', () => {
    const s = fleet();
    expect(typeOn(s, s.routes[1].id)).toBe('l1011');
  });
  test('a jumbo is not sent to a quiet local route', () => {
    let s: GameState = { ...newGame('t', 'HND', 1, { startYear: 1975 }), slots: { HND: 200, ITM: 200, NRT: 20 } };
    let id: string;
    [s, id] = withListing(s, 'b747-100', 1); s = must(acquireUsed(s, id, 'buy'));
    s = must(openRoute(s, 'HND', 'MMB', { skipLicense: true }));
    expect(s.planes[0].schedule).toHaveLength(0);
    s = must(openRoute(s, 'HND', 'CTS', { skipLicense: true }));
    expect(s.planes[0].schedule.length).toBeGreaterThan(0);
  });
  test('a priority list is followed', () => {
    let s = fleet();
    s = must(setRoute(s, s.routes[1].id, { typePriority: ['ys11'] }));
    expect(typeOn(s, s.routes[1].id)).toBe('ys11');
  });
});

describe('rival slots', () => {
  test('rivals fly less at a slot airport as our holding grows', () => {
    const s = { ...newGame('x', 'HND', 1, { startYear: 1960 }), year: 1990 };
    const weekly = (g: GameState) => competitors(g, 'HND', 'CTS').reduce((n, c) => n + c.weeklyFreq, 0);
    const few = weekly(s);
    const many = weekly({ ...s, slots: { ...s.slots, HND: 100 } });
    expect(many).toBeLessThan(few * 0.8);
  });
});

describe('pricing', () => {
  const at = (year: number) => {
    let s: GameState = { ...newGame('t', 'HND', 1, { startYear: 1960 }), year: 2005, month: 6, cash: 1e12, slots: { HND: 200, ITM: 200, NRT: 20 } };
    let id: string;
    [s, id] = withListing(s, 'b737-800', 1);
    s = must(acquireUsed(s, id, 'buy'));
    s = { ...s, pilots: { ...s.pilots, 'b737-800': { rated: 20, training: [] } } };
    s = must(openRoute(s, 'HND', 'CTS', { skipLicense: true }));
    return { ...s, year };
  };
  test('tracking keeps the share of the market fare as prices rise', () => {
    let s = at(2005);
    const r = s.routes[0];
    s = must(setRoute(s, r.id, { fareYen: Math.round(r.fareYen * 1.1), pricing: 'track' }));
    const before = s.routes[0].fareYen;
    const moved = applyPricing({ ...s, year: 2015 }, { [r.id]: routeReferenceFare(r.from, r.to, 2005, 6) });
    const ratio = moved.routes[0].fareYen / routeReferenceFare(r.from, r.to, 2015, 6);
    expect(ratio).toBeCloseTo(before / routeReferenceFare(r.from, r.to, 2005, 6), 1);
  });
  test('manual fares stay put; revenue mode finds a fare', () => {
    let s = at(2005);
    const id = s.routes[0].id;
    s = must(setRoute(s, id, { pricing: 'manual' }));
    expect(applyPricing({ ...s, year: 2015 }, { [id]: 1 }).routes[0].fareYen).toBe(s.routes[0].fareYen);
    const x = bestFareRatio(s, s.routes[0]);
    expect(x).toBeGreaterThanOrEqual(0.5);
    expect(x).toBeLessThanOrEqual(2);
  });
  test('a route group can be changed at once', () => {
    let s = at(2005);
    s = must(openRoute(s, 'HND', 'KMQ', { skipLicense: true }));
    s = must(setRouteGroup(s, 'trunk', { pricing: 'share', fareRatio: 0.9 }));
    const trunk = s.routes.find((r) => r.to === 'CTS')!, local = s.routes.find((r) => r.to === 'KMQ')!;
    expect(trunk.pricing).toBe('share');
    expect(local.pricing).toBeUndefined();
    expect(trunk.fareYen / routeReferenceFare('HND', 'CTS', 2005, 6)).toBeCloseTo(0.9, 1);
  });
});

describe('bulk by airport', () => {
  test('only routes at the chosen airport change', () => {
    let s: GameState = { ...newGame('t', 'HND', 1, { startYear: 1960 }), year: 2005, month: 6, slots: { HND: 200, ITM: 200, NRT: 20 } };
    s = must(openRoute(s, 'HND', 'CTS', { skipLicense: true }));
    s = must(openRoute(s, 'ITM', 'FUK', { skipLicense: true }));
    s = must(setRouteGroup(s, 'all', { pricing: 'revenue' }, 'ITM'));
    expect(s.routes.find((r) => r.from === 'HND')!.pricing).toBeUndefined();
    expect(s.routes.find((r) => r.from === 'ITM')!.pricing).toBe('revenue');
  });
});

describe('cargo circuits', () => {
  test('a cargo triangle opens cargo legs and is flown by a freighter', () => {
    let s: GameState = { ...newGame('t', 'NRT', 1, { startYear: 2005 }), reputation: 80, cash: 1e12, slots: { HND: 99, ITM: 99, NRT: 99 } };
    let id: string;
    [s, id] = withListing(s, 'b767-300', 1);
    s = must(acquireUsed(s, id, 'buy'));
    [s, id] = withListing(s, 'a300b4f', 1);
    s = must(acquireUsed(s, id, 'buy'));
    s = { ...s, crewBases: [...s.crewBases, 'NRT'], pilots: { ...s.pilots, a300: { rated: 20, training: [] }, 'b767-300': { rated: 20, training: [] } } };
    s = { ...s, planes: s.planes.map((p) => ({ ...p, base: 'NRT' })) };
    s = must(addCircuit(s, ['NRT', 'ICN', 'KIX'], 7, null, 'cargo'));
    expect(s.routes.every((r) => r.kind === 'cargo')).toBe(true);
    const c = s.circuits![0];
    expect(c.kind).toBe('cargo');
    const freighter = s.planes.find((p) => p.typeId === 'a300b4f')!;
    expect(freighter.schedule.length).toBe(3);
    expect(s.planes.find((p) => p.typeId === 'b767-300')!.schedule).toHaveLength(0);
  });
  test('beyond rights: a foreign-foreign leg inside a circuit, but no cabotage or standalone route', () => {
    let s: GameState = { ...newGame('t', 'NRT', 1, { startYear: 2000 }), reputation: 80, cash: 1e12, slots: { HND: 99, ITM: 99, NRT: 99 } };
    let id: string;
    [s, id] = withListing(s, 'b767-300', 1);
    s = must(acquireUsed(s, id, 'buy'));
    [s, id] = withListing(s, 'b767-300', 1);
    s = must(acquireUsed(s, id, 'buy'));
    s = { ...s, crewBases: [...s.crewBases, 'NRT'], pilots: { ...s.pilots, 'b767-300': { rated: 20, training: [] } }, planes: s.planes.map((p) => ({ ...p, base: 'NRT' })) };
    expect(openRoute(s, 'HKG', 'BKK').ok).toBe(false);
    expect(addCircuit(s, ['NRT', 'LAX', 'JFK']).ok).toBe(false);
    expect(marketDemand('HKG', 'BKK', 2000, 6)).toBeGreaterThan(0);
    s = must(addCircuit(s, ['NRT', 'HKG', 'BKK']));
    const beyond = s.routes.find((r) => r.from === 'HKG' && r.to === 'BKK')!;
    expect(beyond).toBeTruthy();
    expect(circuitScheduled(s, s.circuits![0])).toBe(7);
    const s2 = advanceMonth(s);
    const res = s2.history[s2.history.length - 1].routes.find((x) => x.routeId === beyond.id)!;
    expect(res.pax).toBeGreaterThan(0);
  });
});

describe('long circuits', () => {
  test('a long cargo circuit is flown over several days', () => {
    let s: GameState = { ...newGame('t', 'NRT', 1, { startYear: 2005 }), reputation: 80, cash: 1e12, slots: { HND: 99, ITM: 99, NRT: 99 } };
    for (let i = 0; i < 3; i++) { let id: string; [s, id] = withListing(s, 'b747-200f', 1); s = must(acquireUsed(s, id, 'buy')); }
    s = { ...s, crewBases: [...s.crewBases, 'NRT'], pilots: { ...s.pilots, 'b747-200': { rated: 40, training: [] } }, planes: s.planes.map((p) => ({ ...p, base: 'NRT' })) };
    s = must(addCircuit(s, ['NRT', 'ANC', 'FRA', 'LHR', 'ANC'], 7, null, 'cargo'));
    const flying = s.planes.filter((p) => p.schedule.length);
    expect(flying.length).toBeGreaterThan(0);
    expect(flying.every((p) => (p.cycleDays ?? 1) > 1)).toBe(true);
    expect(circuitScheduled(s, s.circuits![0])).toBeGreaterThan(2);
  });
});

describe('type ban', () => {
  test('a banned type never flies the route', () => {
    let s: GameState = { ...newGame('t', 'HND', 1, { startYear: 1972 }), slots: { HND: 200, ITM: 200, NRT: 20 } };
    for (const t of ['ys11', 'ys11']) { let id: string; [s, id] = withListing(s, t, 1); s = must(acquireUsed(s, id, 'buy')); }
    s = must(openRoute(s, 'HND', 'CTS', { skipLicense: true }));
    const id = s.routes[0].id;
    expect(s.planes.some((p) => p.schedule.some((l) => l.routeId === id))).toBe(true);
    s = must(setRoute(s, id, { typeBan: ['ys11'] }));
    expect(s.planes.some((p) => p.schedule.some((l) => l.routeId === id))).toBe(false);
    s = must(setRouteGroup(s, 'all', { unban: 'ys11' }));
    expect(s.routes[0].typeBan).toEqual([]);
    expect(s.planes.some((p) => p.schedule.some((l) => l.routeId === id))).toBe(true);
  });
});
