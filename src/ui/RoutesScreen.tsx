import { useEffect, useState } from 'react';
import { AIRPORT_BY_CODE } from '../data/airports';
import { openAirports, openRoute, routeApproval, type Result } from '../engine/sim';
import { dayTag, DAILY, hhmm, legViews, scheduledWeekly } from '../engine/schedule';
import { routeDistance } from '../engine/model';
import type { GameState, Route } from '../engine/types';
import { RouteDetail } from './panels';
import { CircuitsBox } from './CircuitsBox';
import { BulkBox } from './BulkBox';
import { planeType } from '../engine/sim';

type Sel = { kind: 'route'; id: string } | { kind: 'new' } | { kind: 'circuits' } | { kind: 'bulk' } | null;
const name = (c: string) => AIRPORT_BY_CODE[c]?.name ?? c;
/** board names: drop the bracketed part, e.g. 千歳（新千歳） → 千歳 */
const short = (c: string) => name(c).replace(/（.*?）/g, '');

export function flightCode(s: GameState): string {
  return (s.flightCode ?? 'NJ').toUpperCase();
}
/** Outbound/inbound flight numbers, stable per route */
export function flightNumbers(s: GameState, r: Route): [string, string] {
  const same = sortedRoutes(s).filter((x) => (x.kind === 'cargo') === (r.kind === 'cargo'));
  const n = same.findIndex((x) => x.id === r.id) + 1;
  const base = (r.kind === 'cargo' ? 800 : 100) + (n - 1) * 2 + 1;
  return [`${flightCode(s)}${base}`, `${flightCode(s)}${base + 1}`];
}

const sortedRoutes = (s: GameState) => [...s.routes].sort((a, b) => Number(a.id.replace(/\D/g, '')) - Number(b.id.replace(/\D/g, '')));

/** Characters on split-flap tiles; re-flips when the text changes */
function Flap({ text, width, className = '' }: { text: string; width: number; className?: string }) {
  const [k, setK] = useState(0);
  useEffect(() => setK((x) => x + 1), [text]);
  const chars = [...text.padEnd(width, ' ')].slice(0, width);
  return (
    <span className={`flap ${className}`} key={k}>
      {chars.map((c, i) => <span key={i} className="flap-c" style={{ animationDelay: `${i * 35}ms` }}>{c === ' ' ? ' ' : c}</span>)}
    </span>
  );
}

export function RoutesScreen({ s, apply, onHover }: { s: GameState; apply: (r: Result) => void; onHover: (id: string | null) => void }) {
  const [sel, setSel] = useState<Sel>(s.routes.length ? { kind: 'route', id: s.routes[s.routes.length - 1].id } : { kind: 'new' });
  const route = sel?.kind === 'route' ? s.routes.find((r) => r.id === sel.id) : undefined;
  useEffect(() => { onHover(route?.id ?? null); }, [route?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [apt, setApt] = useState(() => { try { return localStorage.getItem('airline-route-apt') ?? ''; } catch { return ''; } });
  const pickApt = (c: string) => { setApt(c); try { localStorage.setItem('airline-route-apt', c); } catch { /* ignore */ } };
  const aptCount = new Map<string, number>();
  for (const r of s.routes) for (const c of [r.from, r.to]) aptCount.set(c, (aptCount.get(c) ?? 0) + 1);
  const filter = apt && aptCount.has(apt) ? apt : '';
  const all = sortedRoutes(s);
  const rows = filter ? all.filter((r) => r.from === filter || r.to === filter) : all;
  // with an airport chosen, show it as the departure end
  const ends = (r: Route): [string, string] => (filter && r.to === filter ? [r.to, r.from] : [r.from, r.to]);
  const wName = Math.min(5, Math.max(3, ...rows.flatMap((r) => [short(r.from).length, short(r.to).length])));
  return (
    <div className="routes-screen">
      <div className="board">
        <div className="board-head">
          <span className="board-title">DEPARTURES <small>出発案内</small></span>
          <label className="board-code">会社コード
            <input value={flightCode(s)} maxLength={2} onChange={(e) => {
              const v = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 2);
              if (v.length === 2) apply({ ok: true, state: { ...s, flightCode: v } });
            }} />
          </label>
        </div>
        <div className="board-filter">
          <select value={filter} onChange={(e) => pickApt(e.target.value)}>
            <option value="">すべての空港（{all.length}路線）</option>
            {[...aptCount.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => <option key={c} value={c}>{name(c)}（{n}路線）</option>)}
          </select>
        </div>
        <div className="board-row board-cols" style={{ ['--wn' as string]: wName }}>
          <span>便名</span><span>出発</span><span>到着</span><span className="r">週</span>
        </div>
        <div className="board-body">
          {rows.length === 0 && <div className="board-empty">路線はまだありません</div>}
          {rows.map((r) => {
            const weekly = scheduledWeekly(s, r.id);
            const lack = weekly < r.targetWeekly;
            return (
              <button key={r.id} style={{ ['--wn' as string]: wName }} className={`board-row ${sel?.kind === 'route' && sel.id === r.id ? 'on' : ''}`} onClick={() => setSel({ kind: 'route', id: r.id })}>
                <Flap text={flightNumbers(s, r)[filter && r.to === filter ? 1 : 0]} width={6} className={r.kind === 'cargo' ? 'cargo' : ''} />
                <Flap text={short(ends(r)[0])} width={wName} />
                <Flap text={short(ends(r)[1])} width={wName} />
                <Flap text={String(weekly).padStart(3)} width={3} className={`r ${lack ? 'short' : ''}`} />
              </button>
            );
          })}
        </div>
        <div className="board-actions">
          <button className={sel?.kind === 'new' ? '' : 'secondary'} onClick={() => setSel({ kind: 'new' })}>＋ 新しい路線</button>
          <button className={sel?.kind === 'circuits' ? '' : 'secondary'} onClick={() => setSel({ kind: 'circuits' })}>周回ルート{(s.circuits?.length ?? 0) > 0 && `（${s.circuits!.length}）`}</button>
          <button className={sel?.kind === 'bulk' ? '' : 'secondary'} onClick={() => setSel({ kind: 'bulk' })}>まとめて変更</button>
        </div>
      </div>
      <div className="route-pane">
        {route && <>
          <div className="pane-title">
            <span className="fno">{flightNumbers(s, route).join(' / ')}</span>
          </div>
          <RouteDetail s={s} r={route} apply={apply} />
          <Timetable s={s} r={route} />
        </>}
        {sel?.kind === 'route' && !route && <p className="muted">この路線は廃止されました。左から選んでください。</p>}
        {sel?.kind === 'new' && <NewRoute s={s} apply={apply} onOpened={(id) => setSel({ kind: 'route', id })} />}
        {sel?.kind === 'circuits' && <CircuitsBox s={s} apply={apply} />}
        {sel?.kind === 'bulk' && <BulkBox s={s} apply={apply} airport={filter} />}
      </div>
    </div>
  );
}

/** Today's departures on this route, both directions */
function Timetable({ s, r }: { s: GameState; r: Route }) {
  const [out, back] = flightNumbers(s, r);
  const legs = s.planes.flatMap((p) => legViews(s, p).filter((v) => v.route.id === r.id).map((v) => ({ v, p })));
  const dirs: [0 | 1, string, string, string][] = [[0, r.from, r.to, out], [1, r.to, r.from, back]];
  return (
    <div className="card">
      <strong>時刻表</strong>
      <div className="tt-grid">
        {dirs.map(([dir, from, to, fno]) => (
          <div key={dir}>
            <div className="muted small-text">{name(from)} → {name(to)}（{fno}）</div>
            <table className="tt small-text">
              <tbody>
                {legs.filter((x) => x.v.leg.dir === dir).sort((a, b) => (a.v.dep % 1440) - (b.v.dep % 1440)).map(({ v, p }, i) => (
                  <tr key={i}>
                    <td className="t">{dayTag(v.dep)}{hhmm(v.dep)}</td>
                    <td>→ {dayTag(v.arr)}{hhmm(v.arr)}</td>
                    <td className="muted">{planeType(p).name} {p.regNo}</td>
                    <td className="muted">{v.leg.days === DAILY ? '毎日' : `週${[...Array(7)].filter((_, d) => v.leg.days & (1 << d)).length}`}</td>
                  </tr>
                ))}
                {legs.every((x) => x.v.leg.dir !== dir) && <tr><td className="muted">便はありません</td></tr>}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}

function NewRoute({ s, apply, onOpened }: { s: GameState; apply: (r: Result) => void; onOpened: (id: string) => void }) {
  const apts = openAirports(s.year).sort((a, b) => Number(!!a.foreign) - Number(!!b.foreign) || b.popM - a.popM);
  const [from, setFrom] = useState(s.baseAirport);
  const [to, setTo] = useState('');
  const [kind, setKind] = useState<'pax' | 'cargo'>('pax');
  const approval = to && from !== to ? routeApproval(s, from, to) : null;
  const select = (v: string, set: (x: string) => void) => (
    <select value={v} onChange={(e) => set(e.target.value)}>
      <option value="">—</option>
      <optgroup label="国内">{apts.filter((a) => !a.foreign).map((a) => <option key={a.code} value={a.code}>{a.name}</option>)}</optgroup>
      <optgroup label="海外">{apts.filter((a) => a.foreign).map((a) => <option key={a.code} value={a.code}>{a.name}（{a.country}）</option>)}</optgroup>
    </select>
  );
  return (
    <div className="card">
      <strong>新しい路線を開設</strong>
      <div className="grid2">
        <label>出発{select(from, setFrom)}</label>
        <label>到着{select(to, setTo)}</label>
        <label>種類
          <select value={kind} onChange={(e) => setKind(e.target.value as 'pax' | 'cargo')}>
            <option value="pax">旅客</option>
            <option value="cargo">貨物</option>
          </select>
        </label>
      </div>
      {to && from !== to && <div className="small-text muted">{Math.round(routeDistance(from, to)).toLocaleString()}km{approval && kind === 'pax' && <> ／ <span className={approval.ok ? 'pos' : 'neg'}>{approval.reason}</span></>}</div>}
      <div className="row">
        <button disabled={!from || !to || from === to} onClick={() => {
          const r = openRoute(s, from, to, { kind });
          apply(r);
          if (r.ok) onOpened(r.state.routes[r.state.routes.length - 1].id);
        }}>開設する</button>
        <span className="muted small-text">地図で空港を2つ順にタップしても開設できます</span>
      </div>
    </div>
  );
}
