import { useState } from 'react';
import { AIRPORT_BY_CODE } from '../data/airports';
import {
  aircraftMarket, acquirePlane, assignPlane, closeRoute, disposePlane, formatYen,
  planeAge, planeType, planesOnRoute, routeCapacity, routeMarket, setRoute, type Result,
} from '../engine/sim';
import { canFly, routeDistance, valueYen, blockHours } from '../engine/model';
import type { GameState, MonthReport } from '../engine/types';
import { PlaneSilhouette } from './PlaneSilhouette';

type Apply = (r: Result) => void;

const pct = (v: number) => `${Math.round(v * 100)}%`;
const num = (v: number) => Math.round(v).toLocaleString('ja-JP');
const aptName = (c: string) => AIRPORT_BY_CODE[c]?.name ?? c;

function lastReport(s: GameState): MonthReport | undefined {
  return s.history[s.history.length - 1];
}

// ---- routes --------------------------------------------------------------

export function RoutesPanel({ s, apply, onHover }: { s: GameState; apply: Apply; onHover: (id: string | null) => void }) {
  const rep = lastReport(s);
  if (s.routes.length === 0)
    return <p className="hint">まだ路線がありません。地図で空港を2つ順にクリックすると路線を開設できます。</p>;
  return (
    <div className="list">
      {s.routes.map((r) => {
        const km = routeDistance(r.from, r.to);
        const cap = routeCapacity(s.planes, r);
        const f = routeMarket(s, r);
        const res = rep?.routes.find((x) => x.routeId === r.id);
        const assigned = planesOnRoute(s.planes, r.id);
        const idle = s.planes.filter((p) => p.routeId === null && canFly(planeType(p), r.from, r.to).ok);
        return (
          <div key={r.id} className="card" onMouseEnter={() => onHover(r.id)} onMouseLeave={() => onHover(null)}>
            <div className="card-head">
              <strong>{aptName(r.from)} 〜 {aptName(r.to)}</strong>
              <span className="muted">{num(km)}km</span>
              <button className="danger small" onClick={() => confirm('この路線を廃止しますか？') && apply(closeRoute(s, r.id))}>廃止</button>
            </div>
            <div className="grid2">
              <label>
                運賃（片道）
                <input type="number" step={100} value={r.fareYen} onChange={(e) => apply(setRoute(s, r.id, { fareYen: Number(e.target.value) }))} />
                <span className="muted">相場 {num(f.refFare)}円</span>
              </label>
              <label>
                週の往復便数
                <input type="number" min={0} max={cap} value={r.weeklyFreq} onChange={(e) => apply(setRoute(s, r.id, { weeklyFreq: Number(e.target.value) }))} />
                <span className="muted">最大 {cap}便（機材による）</span>
              </label>
            </div>
            <div className="muted small-text">
              他社：週{f.incumbentFreq}往復 ／ 市場：月{num(f.marketOneWay * 2)}人 ／ 予想シェア {pct(f.share)}
            </div>
            {res && (
              <div className="small-text">
                先月：旅客 {num(res.pax)}人 ／ 搭乗率 {res.seats ? pct(res.pax / res.seats) : '-'} ／ 収入 {formatYen(res.revenue)} ／ 運航費 {formatYen(res.cost)}
              </div>
            )}
            <div className="assigned">
              {assigned.map((p) => (
                <span key={p.id} className="chip">
                  {planeType(p).name} {p.regNo}（{blockHours(planeType(p), km).toFixed(1)}h）
                  <button className="link" onClick={() => apply(assignPlane(s, p.id, null))}>外す</button>
                </span>
              ))}
              {idle.length > 0 && (
                <select value="" onChange={(e) => e.target.value && apply(assignPlane(s, e.target.value, r.id))}>
                  <option value="">＋ 機体を割り当てる</option>
                  {idle.map((p) => (
                    <option key={p.id} value={p.id}>{planeType(p).name} {p.regNo}</option>
                  ))}
                </select>
              )}
              {assigned.length === 0 && idle.length === 0 && <span className="muted">この路線を飛べる空き機体がありません</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---- fleet ---------------------------------------------------------------

export function FleetPanel({ s, apply }: { s: GameState; apply: Apply }) {
  if (s.planes.length === 0) return <p className="hint">機体がありません。「機材市場」で購入またはリースしましょう。</p>;
  return (
    <table className="tbl">
      <thead>
        <tr><th></th><th>機種</th><th>記号</th><th>機齢</th><th>契約</th><th>路線</th><th></th></tr>
      </thead>
      <tbody>
        {s.planes.map((p) => {
          const t = planeType(p);
          const age = planeAge(p, s.year);
          const v = valueYen(t, age, s.year, s.month);
          return (
            <tr key={p.id}>
              <td><PlaneSilhouette kind={t.silhouette} width={56} /></td>
              <td>{t.name}</td>
              <td>{p.regNo}</td>
              <td>{age}年</td>
              <td>{p.ownership === 'owned' ? '自社保有' : `リース 月${formatYen(p.leaseMonthlyYen)}`}</td>
              <td>
                <select value={p.routeId ?? ''} onChange={(e) => apply(assignPlane(s, p.id, e.target.value || null))}>
                  <option value="">（待機）</option>
                  {s.routes.map((r) => (
                    <option key={r.id} value={r.id} disabled={!canFly(t, r.from, r.to).ok}>
                      {aptName(r.from)}〜{aptName(r.to)}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <button
                  className="danger small"
                  onClick={() => {
                    const msg = p.ownership === 'owned' ? `${formatYen(v)}で売却しますか？` : `リースを解約しますか？（違約金 ${formatYen(p.leaseMonthlyYen * 3)}）`;
                    if (confirm(msg)) apply(disposePlane(s, p.id));
                  }}
                >
                  {p.ownership === 'owned' ? '売却' : '返却'}
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ---- market --------------------------------------------------------------

export function MarketPanel({ s, apply }: { s: GameState; apply: Apply }) {
  const [filter, setFilter] = useState<'all' | 'new' | 'used'>('all');
  const offers = aircraftMarket(s.year, s.month).filter((o) => filter === 'all' || o.condition === filter);
  return (
    <div>
      <div className="seg">
        {(['all', 'new', 'used'] as const).map((f) => (
          <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
            {f === 'all' ? 'すべて' : f === 'new' ? '新造機' : '中古機'}
          </button>
        ))}
      </div>
      <div className="list">
        {offers.map((o) => (
          <div key={`${o.type.id}-${o.condition}`} className="card market">
            <PlaneSilhouette kind={o.type.silhouette} width={110} />
            <div className="grow">
              <div className="card-head">
                <strong>{o.type.name}</strong>
                <span className="muted">{o.type.maker}</span>
                <span className={`tag ${o.condition}`}>{o.condition === 'new' ? '新造' : `中古・機齢${o.ageYears}年`}</span>
              </div>
              <div className="small-text muted">
                {o.type.seats}席 ／ 航続{num(o.type.rangeKm)}km ／ 巡航{o.type.speedKmh}km/h ／ 必要滑走路{num(o.type.minRunwayM)}m ／ 乗員{o.type.cockpitCrew}+{o.type.cabinCrew}名
              </div>
              <div className="row">
                <button onClick={() => apply(acquirePlane(s, o, 'buy'))}>購入 {formatYen(o.priceYen)}</button>
                <button className="secondary" onClick={() => apply(acquirePlane(s, o, 'lease'))}>リース 月{formatYen(o.leaseMonthlyYen)}</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- finance -------------------------------------------------------------

const COST_LABELS: Record<keyof MonthReport['costs'], string> = {
  fuel: '燃料費', maintenance: '整備費', crew: '乗員人件費', airport: '空港使用料', ground: '地上・旅客サービス',
  sales: '販売手数料', lease: 'リース料', overhead: '本社経費',
};

export function FinancePanel({ s }: { s: GameState }) {
  const rep = lastReport(s);
  const hist = s.history.slice(-24);
  if (!rep) return <p className="hint">まだ決算がありません。「1か月進める」を押すと、月ごとの収支がここに出ます。</p>;
  return (
    <div>
      <h3>{rep.year}年{rep.month}月の収支</h3>
      <table className="tbl">
        <tbody>
          <tr><td>旅客収入</td><td className="r">{formatYen(rep.revenue)}</td></tr>
          {Object.entries(rep.costs).map(([k, v]) => (
            <tr key={k}><td className="muted">{COST_LABELS[k as keyof MonthReport['costs']]}</td><td className="r">-{formatYen(v)}</td></tr>
          ))}
          <tr className="total"><td>損益</td><td className={`r ${rep.profit < 0 ? 'neg' : 'pos'}`}>{formatYen(rep.profit)}</td></tr>
          <tr><td>旅客数</td><td className="r">{num(rep.pax)}人</td></tr>
        </tbody>
      </table>
      <h3>資金の推移</h3>
      <CashChart hist={hist} />
    </div>
  );
}

function CashChart({ hist }: { hist: MonthReport[] }) {
  if (hist.length < 2) return <p className="hint">2か月以上進めるとグラフが表示されます。</p>;
  const w = 360, h = 140, pad = 4;
  const vals = hist.map((x) => x.cashEnd);
  const min = Math.min(0, ...vals), max = Math.max(...vals);
  const x = (i: number) => pad + (i * (w - 2 * pad)) / (hist.length - 1);
  const y = (v: number) => h - pad - ((v - min) * (h - 2 * pad)) / (max - min || 1);
  const d = vals.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="chart">
      <line x1={0} x2={w} y1={y(0)} y2={y(0)} className="zero" />
      <path d={d} className="line" />
      <text x={w - 4} y={12} textAnchor="end" className="lbl">{formatYen(max)}</text>
      <text x={4} y={h - 6} className="lbl">{hist[0].year}/{hist[0].month}</text>
      <text x={w - 4} y={h - 6} textAnchor="end" className="lbl">{hist[hist.length - 1].year}/{hist[hist.length - 1].month}</text>
    </svg>
  );
}

// ---- news ----------------------------------------------------------------

export function NewsPanel({ s }: { s: GameState }) {
  return (
    <ul className="news">
      {[...s.news].reverse().map((n, i) => (
        <li key={i} className={n.kind}>
          <span className="muted">{n.year}年{n.month}月</span> {n.text}
        </li>
      ))}
    </ul>
  );
}
