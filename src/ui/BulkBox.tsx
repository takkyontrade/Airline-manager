import { useState } from 'react';
import { PRICING_LABEL, ROUTE_GROUP_LABEL, routeGroup, routeMarket, setPricingDefault, setRouteGroup, flyablePlanes, type BulkPatch, type Result } from '../engine/sim';
import { POLICY_LABEL, POLICY_LEVEL, OPS_LEVELS } from '../engine/schedule';
import { CABIN_LABEL } from '../engine/brand';
import type { CabinLayout, GameState, PricingMode, RouteGroup, SchedulePolicy } from '../engine/types';
import { PRICING_HELP } from './pricingHelp';
import { NumInput } from './NumInput';
import { AIRPORT_BY_CODE } from '../data/airports';
import { AIRCRAFT_BY_ID } from '../data/aircraft';

const GROUPS: (RouteGroup | 'all')[] = ['all', 'trunk', 'local', 'intl', 'cargo'];
const groupName = (g: RouteGroup | 'all') => (g === 'all' ? '全路線' : ROUTE_GROUP_LABEL[g]);
const yen = (n: number) => `${Math.round(n / 1e6).toLocaleString()}百万円`;

/** Change many routes at once, by group */
export function BulkBox({ s, apply, airport = '' }: { s: GameState; apply: (r: Result) => void; airport?: string }) {
  const [group, setGroup] = useState<RouteGroup | 'all'>('all');
  const [ratio, setRatio] = useState(100);
  const fly = flyablePlanes(s);
  const rep = s.history[s.history.length - 1];
  const rows = GROUPS.map((g) => {
    const rs = s.routes.filter((r) => (g === 'all' || routeGroup(r) === g) && (!airport || r.from === airport || r.to === airport));
    const res = rs.map((r) => rep?.routes.find((x) => x.routeId === r.id)).filter((x) => !!x);
    const seats = res.reduce((n, x) => n + x.seats, 0), pax = res.reduce((n, x) => n + x.pax, 0);
    const pr = rs.filter((r) => r.kind !== 'cargo');
    const fare = pr.length ? pr.reduce((n, r) => n + r.fareYen / routeMarket(s, r, fly).refFare, 0) / pr.length : 0;
    return { g, n: rs.length, weekly: rs.reduce((n, r) => n + r.targetWeekly, 0), lf: seats ? pax / seats : 0, profit: res.reduce((n, x) => n + x.revenue - x.cost, 0), fare };
  });
  const go = (p: BulkPatch) => apply(setRouteGroup(s, group, p, airport || undefined));
  const where = airport ? `${AIRPORT_BY_CODE[airport]?.name ?? airport}発着の` : '';
  const cargo = group === 'cargo';
  const types = [...new Set(s.planes.map((p) => p.typeId))].filter((id) => group === 'all' || !!AIRCRAFT_BY_ID[id].freighter === cargo);
  return (
    <div className="card">
      <div className="card-head"><strong>まとめて変更</strong></div>
      <label>
        会社の運賃方針（路線ごとに決めていない路線に使います）
        <select value={s.pricingDefault ?? 'track'} onChange={(e) => apply(setPricingDefault(s, e.target.value as PricingMode))}>
          {(Object.keys(PRICING_LABEL) as PricingMode[]).map((k) => <option key={k} value={k}>{PRICING_LABEL[k]}</option>)}
        </select>
        <span className="muted small-text">{PRICING_HELP[s.pricingDefault ?? 'track']}</span>
      </label>

      <table className="tt small-text bulk-table">
        <thead><tr><th></th><th>路線</th><th>週往復</th><th>搭乗率</th><th>運賃</th><th>先月の損益</th></tr></thead>
        <tbody>
          {rows.filter((x) => x.g === 'all' || x.n > 0).map((x) => (
            <tr key={x.g} className={group === x.g ? 'on' : ''} onClick={() => setGroup(x.g)}>
              <td><input type="radio" checked={group === x.g} onChange={() => setGroup(x.g)} /> {groupName(x.g)}</td>
              <td>{x.n}</td><td>{x.weekly}</td><td>{x.lf ? `${Math.round(x.lf * 100)}%` : '—'}</td>
              <td>{x.fare ? `相場の${Math.round(x.fare * 100)}%` : '—'}</td>
              <td className={x.profit < 0 ? 'neg' : 'pos'}>{rep ? yen(x.profit) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>{where}{groupName(group)}をまとめて</h3>
      {airport && <p className="muted small-text">左の出発案内で選んだ空港の路線だけが対象です。</p>}
      <div className="grid2">
        {!cargo && (
          <label>
            運賃の決め方
            <select value="" onChange={(e) => e.target.value && go({ pricing: e.target.value === 'default' ? null : (e.target.value as PricingMode) })}>
              <option value="">選んで適用…</option>
              <option value="default">会社の方針に戻す</option>
              {(Object.keys(PRICING_LABEL) as PricingMode[]).map((k) => <option key={k} value={k}>{PRICING_LABEL[k]}</option>)}
            </select>
          </label>
        )}
        {!cargo && (
          <label>
            運賃を相場の何%にするか
            <span className="row"><NumInput min={50} value={ratio} onCommit={setRatio} /><button className="small" onClick={() => go({ fareRatio: ratio / 100 })}>適用</button></span>
          </label>
        )}
        <label>
          便数（目標の週往復）
          <span className="row">
            <button className="small secondary" onClick={() => go({ weeklyScale: 0.9 })}>1割減らす</button>
            <button className="small secondary" onClick={() => go({ weeklyScale: 1.1 })}>1割増やす</button>
          </span>
        </label>
        <label>
          ダイヤの方針
          <select value="" onChange={(e) => e.target.value && go({ policy: e.target.value as SchedulePolicy })}>
            <option value="">選んで適用…</option>
            {(Object.keys(POLICY_LABEL) as SchedulePolicy[]).map((k) => (
              <option key={k} value={k} disabled={POLICY_LEVEL[k] > s.opsLevel}>{POLICY_LABEL[k]}{POLICY_LEVEL[k] > s.opsLevel ? `（${OPS_LEVELS[POLICY_LEVEL[k]].label}以上）` : ''}</option>
            ))}
          </select>
        </label>
        <label>
          使わない機種
          <span className="row">
            <select value="" onChange={(e) => e.target.value && go({ ban: e.target.value })}>
              <option value="">追加…</option>
              {types.map((id) => <option key={id} value={id}>{AIRCRAFT_BY_ID[id].name}</option>)}
            </select>
            <select value="" onChange={(e) => e.target.value && go({ unban: e.target.value })}>
              <option value="">解除…</option>
              {types.map((id) => <option key={id} value={id}>{AIRCRAFT_BY_ID[id].name}</option>)}
            </select>
          </span>
        </label>
        {!cargo && (
          <label>
            座席クラス
            <select value="" onChange={(e) => e.target.value && go({ cabin: e.target.value as CabinLayout })}>
              <option value="">選んで適用…</option>
              {(Object.keys(CABIN_LABEL) as CabinLayout[]).map((k) => <option key={k} value={k}>{CABIN_LABEL[k]}</option>)}
            </select>
          </label>
        )}
      </div>
      <p className="muted small-text">幹線は両端とも大都市の空港どうしの国内線、地方線はそれ以外の国内線です。運賃を自動にしておけば、物価の上昇や他社の値下げに毎月合わせて動くので、路線ごとに直す必要はありません。</p>
    </div>
  );
}
