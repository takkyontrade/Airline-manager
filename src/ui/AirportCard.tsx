import { AIRPORT_BY_CODE, runwayAt } from '../data/airports';
import { AIRCRAFT_BY_ID } from '../data/aircraft';
import { intlGatewayShare } from '../engine/model';
import { airportHours, hhmm, slotAirports, slotUsage } from '../engine/schedule';
import type { GameState } from '../engine/types';

/** Facts about the selected airport: runway, hours, slots, which of our types fit */
export function AirportCard({ s, code, onClose }: { s: GameState; code: string; onClose: () => void }) {
  const a = AIRPORT_BY_CODE[code];
  const rw = runwayAt(a, s.year);
  const future = a.runways.filter(([y]) => y > s.year);
  const [open, close] = airportHours(code, s.year);
  const slots = slotAirports(s.year).includes(code) ? { used: slotUsage(s)[code] ?? 0, total: s.slots[code] ?? 0 } : null;
  const myRoutes = s.routes.filter((r) => r.from === code || r.to === code).length;
  const based = s.planes.filter((p) => p.base === code && p.status !== 'onOrder').length;
  const types = [...new Set(s.planes.map((p) => p.typeId))].map((id) => AIRCRAFT_BY_ID[id]);
  const intl = !a.foreign && intlGatewayShare(code, s.year) > 0;
  return (
    <div className="airport-card">
      <div className="card-head">
        <strong>{a.name}</strong><span className="muted">{a.code}・{a.foreign ? a.country : a.region}</span>
        <span className="spacer" />
        <button className="small secondary" onClick={onClose}>×</button>
      </div>
      <table className="kv small-text">
        <tbody>
          <tr><th>滑走路</th><td><strong>{rw.toLocaleString()}m</strong>{future.length > 0 && <span className="muted">（{future.map(([y, m]) => `${y}年に${m.toLocaleString()}m`).join('、')}）</span>}</td></tr>
          <tr><th>運用時間</th><td>{close - open >= 1440 ? '24時間' : `${hhmm(open)}〜${hhmm(close)}`}</td></tr>
          {slots && <tr><th>発着枠</th><td>自社 {slots.used} / {slots.total} 回・日</td></tr>}
          {!a.foreign && <tr><th>後背地人口</th><td>約{Math.round(a.popM * 100).toLocaleString()}万人（1960年頃）</td></tr>}
          <tr><th>観光</th><td>{a.tourism >= 1.6 ? '◎ 観光地' : a.tourism >= 1.2 ? '○ やや多い' : a.tourism >= 0.9 ? '普通' : '少ない'}</td></tr>
          {!a.foreign && <tr><th>国際線</th><td>{!intl ? `${s.year}年は国内線専用` : s.year < 1986 ? '国際線の空港（自社の参入は1986年から）' : '開設できる'}</td></tr>}
          {a.island && <tr><th>離島</th><td>鉄道と競合しません</td></tr>}
          {a.etops ? <tr><th>洋上飛行</th><td>双発機はETOPS {a.etops}分が必要</td></tr> : null}
          {!a.foreign && <tr><th>自社</th><td>{s.crewBases.includes(code) ? '乗員基地・' : ''}路線{myRoutes}本・拠点の機体{based}機</td></tr>}
        </tbody>
      </table>
      {types.length > 0 && (
        <div className="small-text">
          <span className="muted">自社の機材：</span>
          {types.map((t) => (
            <span key={t.id} className={`chip ${rw >= t.minRunwayM ? '' : 'neg'}`}>{rw >= t.minRunwayM ? '✓' : '✗'} {t.name}（{t.minRunwayM.toLocaleString()}m）</span>
          ))}
        </div>
      )}
    </div>
  );
}
