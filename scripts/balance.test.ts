import { test } from 'vitest';
import { newGame, aircraftMarket, acquirePlane, openRoute, assignPlane, setRoute, advanceMonth, routeCapacity, formatYen, routeMarket } from '../src/engine/sim';
import type { GameState } from '../src/engine/types';

function run(label: string, from: string, to: string, typeId: string, mode: 'buy'|'lease', n=1, fareMul=1, startYear=1960, freqMul=1) {
  let s: GameState = newGame('Test', from, 1);
  s = { ...s, year: startYear };
  const offer = aircraftMarket(s.year, 1).find(o => o.type.id === typeId)!;
  for (let i=0;i<n;i++){ const r = acquirePlane(s, offer, mode); if (!r.ok) throw new Error(r.error); s = r.state; }
  let r = openRoute(s, from, to); if (!r.ok) throw new Error(r.error); s = r.state;
  const route = s.routes[0];
  for (const p of s.planes) { r = assignPlane(s, p.id, route.id); if (!r.ok) throw new Error(r.error); s = r.state; }
  const cap = routeCapacity(s.planes, s.routes[0]);
  r = setRoute(s, route.id, { weeklyFreq: Math.round(cap*freqMul), fareYen: s.routes[0].fareYen*fareMul }); if (!r.ok) throw new Error(r.error); s = r.state;
  const f = routeMarket(s, s.routes[0]);
  const cash0 = s.cash;
  for (let i=0;i<12;i++) s = advanceMonth(s);
  const h = s.history;
  const rev = h.reduce((a,x)=>a+x.revenue,0), prof = h.reduce((a,x)=>a+x.profit,0);
  const lf = h.reduce((a,x)=>a+x.routes[0].pax,0)/h.reduce((a,x)=>a+x.routes[0].seats,0);
  console.log(`${label}: offer ${formatYen(offer.priceYen)} cap ${cap}/wk fare ${s.routes[0].fareYen} share ${(f.share*100).toFixed(0)}% inc ${f.incumbentFreq}/wk mkt ${Math.round(f.marketOneWay)}/mo LF ${(lf*100).toFixed(0)}% rev/yr ${formatYen(rev)} profit/yr ${formatYen(prof)} cash ${formatYen(cash0)}->${formatYen(s.cash)}`);
}
test('balance', () => {
  run('HND-ITM DC3 buy', 'HND','ITM','dc3','buy');
  run('HND-ITM V828 lease', 'HND','ITM','v828','lease');
  run('HND-CTS DC6B lease', 'HND','CTS','dc6b','lease');
  run('HND-FUK DC6B lease', 'HND','FUK','dc6b','lease');
  run('ITM-KCZ DC3 buy', 'ITM','KCZ','dc3','buy');
  run('HND-HAC DC3 buy', 'HND','HAC','dc3','buy');
  run('FUK-KMI DC3 buy', 'FUK','KMI','dc3','buy');
  run('ITM-MYJ F27 lease', 'ITM','MYJ','f27','lease');
  run('ITM-KCZ DC3 buy half', 'ITM','KCZ','dc3','buy',1,1,1960,0.5);
  run('FUK-KMI DC3 buy 40%', 'FUK','KMI','dc3','buy',1,1,1960,0.4);
  run('ITM-MYJ F27 lease half', 'ITM','MYJ','f27','lease',1,1,1960,0.5);
  run('HND-HAC DC3 fare1.2', 'HND','HAC','dc3','buy',1,1.2,1960,0.7);
  run('HND-ITM V828 lease x3', 'HND','ITM','v828','lease',3);
  run('1975 HND-CTS 747SR lease', 'HND','CTS','b747sr','lease',1,1,1975);
  run('1990 HND-FUK 767-300 lease', 'HND','FUK','b767-300','lease',1,1,1990);
  run('2019 HND-OKA 737-800 lease', 'HND','OKA','b737-800','lease',1,1,2019);
});
