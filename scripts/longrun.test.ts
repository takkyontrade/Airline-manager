import { test } from 'vitest';
import { advanceMonth, newGame, openRoute, setRoute, formatYen } from '../src/engine/sim';
import { acquireUsed } from '../src/engine/fleet';
import { hirePilots } from '../src/engine/staff';
import type { GameState } from '../src/engine/types';

// Plays 1960-2030 with a simple scripted player to catch crashes and slowdowns.
test('long run', () => {
  let s: GameState = { ...newGame('通し', 'HND', 99), cash: 5e11 };
  const t0 = Date.now();
  let slowest = 0;
  for (let i = 0; i < 12 * 70; i++) {
    if (s.month === 1 && s.year % 3 === 0) {
      const l = s.usedMarket[0];
      if (l) { const r = acquireUsed(s, l.id, 'buy'); if (r.ok) s = r.state; }
      for (const typeId of new Set(s.planes.map((p) => p.typeId))) { const r = hirePilots(s, typeId, 6); if (r.ok) s = r.state; }
      for (const [a, b] of [['HND', 'HAC'], ['HND', 'KIJ'], ['HND', 'CTS'], ['HND', 'FUK'], ['NRT', 'HNL'], ['NRT', 'ICN'], ['HND', 'OKA']]) {
        const r = openRoute(s, a, b);
        if (r.ok) { s = r.state; const x = setRoute(s, s.routes[s.routes.length - 1].id, { targetWeekly: 14 }); if (x.ok) s = x.state; }
      }
    }
    const t = Date.now();
    s = advanceMonth(s);
    slowest = Math.max(slowest, Date.now() - t);
    if (s.month === 1 && s.year % 10 === 0) console.log(`${s.year}: cash ${formatYen(s.cash)} planes ${s.planes.length} routes ${s.routes.length} rep ${s.reputation.toFixed(0)} news ${s.news.length} save ${(JSON.stringify(s).length / 1024).toFixed(0)}KB`);
  }
  console.log(`total ${Date.now() - t0}ms, slowest month ${slowest}ms, safety`, s.safety);
}, 300000);
