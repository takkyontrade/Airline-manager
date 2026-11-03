import { useMemo, useState } from 'react';
import type { GameState, StatPoint } from '../engine/types';
import { formatYen } from '../engine/sim';

type Range = 'all' | '10y' | '3y';
type Key = keyof Omit<StatPoint, 'year' | 'month'>;
interface Metric { key: Key; title: string; flow: boolean; fmt: (v: number) => string; bars?: boolean }

const n0 = (v: number) => Math.round(v).toLocaleString('ja-JP');
const METRICS: Metric[] = [
  { key: 'netWorth', title: '純資産（現金＋機材−借入）', flow: false, fmt: formatYen },
  { key: 'cash', title: '現金', flow: false, fmt: formatYen },
  { key: 'revenue', title: '売上', flow: true, fmt: formatYen },
  { key: 'profit', title: '利益', flow: true, fmt: formatYen, bars: true },
  { key: 'pax', title: '旅客数', flow: true, fmt: (v) => `${n0(v)}人` },
  { key: 'cargoT', title: '貨物量', flow: true, fmt: (v) => `${n0(v)}t` },
  { key: 'fleet', title: '機材数', flow: false, fmt: (v) => `${n0(v)}機` },
  { key: 'routes', title: '路線数', flow: false, fmt: (v) => `${n0(v)}路線` },
  { key: 'reputation', title: '評判', flow: false, fmt: (v) => n0(v) },
  { key: 'onTime', title: '定時率', flow: false, fmt: (v) => `${Math.round(v * 100)}%` },
];

/** Stats for saves made before the statistics existed: rebuild what the monthly reports still hold */
function pointsOf(s: GameState): StatPoint[] {
  if (s.stats?.length) return s.stats;
  return s.history.map((h) => ({
    year: h.year, month: h.month, cash: h.cashEnd, netWorth: h.cashEnd, revenue: h.revenue, profit: h.profit, pax: h.pax,
    cargoT: h.routes.reduce((a, r) => a + (r.cargoT ?? 0), 0), fleet: NaN, routes: h.routes.length, reputation: NaN, onTime: h.onTime,
  }));
}

interface Pt { label: string; v: number }

function series(points: StatPoint[], m: Metric, yearly: boolean): Pt[] {
  if (!yearly) return points.map((p) => ({ label: `${p.year}年${p.month}月`, v: p[m.key] }));
  const byYear = new Map<number, StatPoint[]>();
  for (const p of points) byYear.set(p.year, [...(byYear.get(p.year) ?? []), p]);
  return [...byYear.entries()].map(([y, ps]) => ({
    label: `${y}年${m.flow ? '（年計）' : '末'}`,
    v: m.flow ? ps.reduce((a, p) => a + p[m.key], 0) : ps[ps.length - 1][m.key],
  }));
}

export function StatsScreen({ s }: { s: GameState }) {
  const [range, setRange] = useState<Range>('all');
  const all = pointsOf(s);
  const points = range === 'all' ? all : all.slice(-(range === '10y' ? 120 : 36));
  const yearly = points.length > 72;
  const last = all[all.length - 1];
  const lastYear = all.filter((p) => last && p.year === last.year);
  if (!last) return <div className="stats-screen"><p className="muted">まだ記録がありません。1か月進めると、ここに推移が出ます。</p></div>;
  const sum = (k: Key) => lastYear.reduce((a, p) => a + p[k], 0);
  return (
    <div className="stats-screen">
      <div className="stats-top">
        <div className="tiles">
          <div className="tile"><span className="muted">純資産</span><strong>{formatYen(last.netWorth)}</strong></div>
          <div className="tile"><span className="muted">{last.year}年の売上</span><strong>{formatYen(sum('revenue'))}</strong></div>
          <div className="tile"><span className="muted">{last.year}年の利益</span><strong className={sum('profit') < 0 ? 'neg' : ''}>{formatYen(sum('profit'))}</strong></div>
          <div className="tile"><span className="muted">{last.year}年の旅客</span><strong>{n0(sum('pax'))}人</strong></div>
          <div className="tile"><span className="muted">{last.year}年の貨物</span><strong>{n0(sum('cargoT'))}t</strong></div>
        </div>
        <div className="seg small-seg">
          {([['all', '全期間'], ['10y', '10年'], ['3y', '3年']] as [Range, string][]).map(([k, l]) => (
            <button key={k} className={range === k ? 'on' : ''} onClick={() => setRange(k)}>{l}</button>
          ))}
        </div>
      </div>
      <p className="muted small-text">{yearly ? '期間が長いので1年ごとにまとめています（売上・利益・旅客・貨物は年間合計、それ以外は年末の値）。' : '月ごとの値です。'}グラフをタップ（マウスを乗せる）と数値が出ます。</p>
      <div className="chart-grid">
        {METRICS.map((m) => {
          const data = series(points, m, yearly).filter((p) => Number.isFinite(p.v));
          return <Chart key={m.key} title={m.title} data={data} fmt={m.fmt} bars={m.bars} />;
        })}
      </div>
    </div>
  );
}

const W = 420, H = 170, PL = 8, PR = 8, PT = 10, PB = 22;

function Chart({ title, data, fmt, bars }: { title: string; data: Pt[]; fmt: (v: number) => string; bars?: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const geo = useMemo(() => {
    const vs = data.map((d) => d.v);
    let lo = Math.min(0, ...vs), hi = Math.max(0, ...vs);
    if (hi === lo) hi = lo + 1;
    const pad = (hi - lo) * 0.08;
    hi += pad; if (lo < 0) lo -= pad;
    const x = (i: number) => PL + (data.length <= 1 ? (W - PL - PR) / 2 : (i / (data.length - 1)) * (W - PL - PR));
    const y = (v: number) => PT + (1 - (v - lo) / (hi - lo)) * (H - PT - PB);
    return { x, y, lo, hi };
  }, [data]);
  if (data.length === 0) return <div className="chart card"><strong className="small-text">{title}</strong><p className="muted small-text">記録がありません</p></div>;
  const { x, y } = geo;
  const line = data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.v).toFixed(1)}`).join('');
  const bw = Math.max(1, Math.min(14, (W - PL - PR) / data.length - 2));
  const cur = hover ?? data.length - 1;
  const pick = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(((px - PL) / (W - PL - PR)) * (data.length - 1));
    setHover(Math.max(0, Math.min(data.length - 1, i)));
  };
  const ticks = [0, Math.floor((data.length - 1) / 2), data.length - 1].filter((v, i, a) => a.indexOf(v) === i);
  return (
    <div className="chart card">
      <div className="chart-head">
        <strong className="small-text">{title}</strong>
        <span className="chart-val">{fmt(data[cur].v)}</span>
        <span className="muted small-text">{data[cur].label}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" onPointerMove={pick} onPointerDown={pick} onPointerLeave={() => setHover(null)}>
        {[0.25, 0.5, 0.75].map((f) => <line key={f} x1={PL} x2={W - PR} y1={PT + f * (H - PT - PB)} y2={PT + f * (H - PT - PB)} className="grid" />)}
        <line x1={PL} x2={W - PR} y1={y(0)} y2={y(0)} className="zero" />
        {bars
          ? data.map((d, i) => {
              const top = Math.min(y(d.v), y(0)), h = Math.max(1, Math.abs(y(d.v) - y(0)));
              return <rect key={i} x={x(i) - bw / 2} y={top} width={bw} height={h} rx={Math.min(2, bw / 2)} className={d.v < 0 ? 'bar neg' : 'bar'} opacity={hover === null || hover === i ? 1 : 0.55} />;
            })
          : <path d={line} className="line" />}
        {hover !== null && <line x1={x(cur)} x2={x(cur)} y1={PT} y2={H - PB} className="cross" />}
        {!bars && <circle cx={x(cur)} cy={y(data[cur].v)} r={4} className="dot" />}
        <text x={PL + 2} y={PT + 10} className="tick">{fmt(geo.hi)}</text>
        {geo.lo < 0 && <text x={PL + 2} y={H - PB - 4} className="tick">{fmt(geo.lo)}</text>}
        {ticks.map((i) => (
          <text key={i} x={x(i)} y={H - 6} textAnchor={i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'} className="tick">{data[i].label.replace(/（年計）|末/, '')}</text>
        ))}
      </svg>
    </div>
  );
}
