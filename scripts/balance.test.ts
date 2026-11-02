import { test } from 'vitest';
import { newGame, openRoute, assignPlane, setRoute, advanceMonth, routeCapacity, formatYen, routeMarket } from '../src/engine/sim';
import { orderNew } from '../src/engine/fleet';
import type { GameState } from '../src/engine/types';
import type { Result } from '../src/engine/util';

const must = (r: Result) => { if (!r.ok) throw new Error(r.error); return r.state; };

function run(label: string, from: string, to: string, typeId: string, n = 1, fareMul = 1, startYear = 1960, freqMul = 1) {
  let s: GameState = { ...newGame('Test', from, 1), year: startYear };
  s = { ...s, cash: 1e13, pilots: { [typeId]: { rated: 15 * n, training: [] } } };
  if (typeId !== 'dc3') for (let i = 0; i < n; i++) s = must(orderNew(s, typeId, 'operating', 8));
  if (typeId === 'dc3') s = { ...s, year: 1946 }, s = must(orderNew(s, typeId, 'buy')), s = { ...s, year: startYear, planes: s.planes.slice(-1) };
  s = { ...s, planes: s.planes.map((p) => ({ ...p, status: 'active' as const, readyYM: 0, lease: p.lease && { ...p.lease, startYM: 0 } })) };
  s = must(openRoute(s, from, to));
  for (const p of s.planes) s = must(assignPlane(s, p.id, s.routes[0].id));
  const cap = routeCapacity(s, s.routes[0]);
  s = must(setRoute(s, s.routes[0].id, { weeklyFreq: Math.round(cap * freqMul), fareYen: s.routes[0].fareYen * fareMul }));
  const f = routeMarket(s, s.routes[0]);
  for (let i = 0; i < 12; i++) s = advanceMonth(s);
  const h = s.history;
  const rev = h.reduce((a, x) => a + x.revenue, 0), prof = h.reduce((a, x) => a + x.profit, 0);
  const lf = h.reduce((a, x) => a + x.routes[0].pax, 0) / h.reduce((a, x) => a + x.routes[0].seats, 0);
  console.log(`${label}: cap ${cap}/wk share ${(f.share * 100).toFixed(0)}% inc ${f.incumbentFreq}/wk LF ${(lf * 100).toFixed(0)}% rev/yr ${formatYen(rev)} profit/yr ${formatYen(prof)} margin ${(prof / rev * 100).toFixed(0)}%`);
  if (process.env.DETAIL) { const c: Record<string, number> = {}; for (const x of h) for (const [k, v] of Object.entries(x.costs)) c[k] = (c[k] ?? 0) + v; console.log(Object.entries(c).map(([k, v]) => `${k} ${formatYen(v)}`).join(' / ')); }
}
test('balance', () => {
  run('HND-ITM V828', 'HND', 'ITM', 'v828');
  run('HND-CTS DC6B', 'HND', 'CTS', 'dc6b');
  run('HND-ITM V828 x3', 'HND', 'ITM', 'v828', 3);
  run('ITM-MYJ F27 0.3', 'ITM', 'MYJ', 'f27', 1, 1, 1960, 0.3);
  run('ITM-KCZ DC3 0.4', 'ITM', 'KCZ', 'dc3', 1, 1, 1960, 0.4);
  run('HND-HAC F27 0.3', 'HND', 'HAC', 'f27', 1, 1.1, 1960, 0.3);
  run('1966 HND-FUK 727 x2', 'HND', 'FUK', 'b727', 2, 1, 1966);
  run('1975 HND-CTS 747SR', 'HND', 'CTS', 'b747sr', 1, 1, 1975);
  run('1990 HND-FUK 767-300', 'HND', 'FUK', 'b767-300', 1, 1, 1990);
  run('2019 HND-OKA 737-800', 'HND', 'OKA', 'b737-800', 1, 1, 2019);
});
