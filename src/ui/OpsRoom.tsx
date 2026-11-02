// Operations-room view: a dark control-room board with today's departures,
// fleet status and the key numbers, as an alternative to the map.
import { AIRPORT_BY_CODE } from '../data/airports';
import { flyablePlanes, planeType } from '../engine/sim';
import { dayTag, hhmm, legViews } from '../engine/schedule';
import { heavyCheckOverdue, ymLabel } from '../engine/fleet';
import type { GameState } from '../engine/types';
import { PlaneSilhouette } from './PlaneSilhouette';
import { planeLivery } from './BrandPanel';

const short = (c: string) => AIRPORT_BY_CODE[c]?.name ?? c;

export function OpsRoom({ s }: { s: GameState }) {
  const fly = flyablePlanes(s);
  const last = s.history[s.history.length - 1];
  const prefix = (s.livery?.logo || s.companyName.slice(0, 2)).toUpperCase();
  // Monday's departures (bit 0) for everyday planes; long-haul rotations always show
  const legs = s.planes
    .filter((p) => fly.has(p.id))
    .flatMap((p) => legViews(s, p).filter((v) => p.cycleDays !== undefined || v.leg.days & 1).map((v) => ({ p, v })))
    .sort((a, b) => (a.v.dep % 1440) - (b.v.dep % 1440));
  const otp = (routeId: string) => last?.routes.find((r) => r.routeId === routeId)?.onTime ?? 1;
  const active = s.planes.filter((p) => p.status === 'active').length;
  const maint = s.planes.filter((p) => p.status === 'heavyCheck' || p.status === 'shop').length;
  const lf = last ? last.routes.reduce((n, r) => n + r.pax, 0) / Math.max(1, last.routes.reduce((n, r) => n + r.seats, 0)) : 0;

  return (
    <div className="ops">
      <div className="ops-kpis">
        <Kpi label="本日の出発便" value={`${legs.length}`} />
        <Kpi label="先月の定時率" value={last ? `${Math.round(last.onTime * 100)}%` : '-'} />
        <Kpi label="先月の搭乗率" value={last ? `${Math.round(lf * 100)}%` : '-'} />
        <Kpi label="稼働機 / 整備中" value={`${active} / ${maint}`} />
        <Kpi label="先月の旅客" value={last ? `${Math.round(last.pax).toLocaleString()}人` : '-'} />
      </div>
      <div className="ops-board">
        <div className="ops-title">DEPARTURES 出発（月曜日・日本時間）</div>
        <table>
          <thead><tr><th>時刻</th><th>便名</th><th>出発</th><th>行き先</th><th>機材</th><th>状況</th></tr></thead>
          <tbody>
            {legs.slice(0, 60).map(({ p, v }, i) => {
              const o = otp(v.route.id);
              return (
                <tr key={i}>
                  <td className="mono">{dayTag(v.dep)}{hhmm(v.dep)}</td>
                  <td className="mono">{prefix}{String(100 + i * 2 + (v.leg.dir ? 1 : 0)).padStart(3, '0')}</td>
                  <td>{short(v.from)}</td>
                  <td>{short(v.to)}</td>
                  <td>{planeType(p).name.replace('ボーイング', 'B').replace('エアバス', '')}</td>
                  <td className={o < 0.75 ? 'warn' : 'ok'}>{o < 0.75 ? '遅れがち' : '定刻'}</td>
                </tr>
              );
            })}
            {legs.length === 0 && <tr><td colSpan={6} className="muted">本日の出発便はありません</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="ops-fleet">
        {s.planes.filter((p) => p.status !== 'onOrder').map((p) => {
          const st = p.status === 'heavyCheck' ? `重整備〜${ymLabel(p.readyYM)}` : p.status === 'shop' ? `改修・修理〜${ymLabel(p.readyYM)}` : heavyCheckOverdue(p) ? '整備期限切れ' : fly.has(p.id) ? '運航中' : '待機';
          return (
            <div key={p.id} className={`ops-plane ${fly.has(p.id) ? 'on' : 'off'}`}>
              <PlaneSilhouette kind={planeType(p).silhouette} width={80} livery={planeLivery(s, p)} />
              <div className="mono">{p.regNo}</div>
              <div className="small-text">{st}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return <div className="kpi"><div className="kpi-v">{value}</div><div className="kpi-l">{label}</div></div>;
}
