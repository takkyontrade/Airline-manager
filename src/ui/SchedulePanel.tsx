import { useState } from 'react';
import { BaseSelect } from './BaseSelect';
import { nextSlotEvent, slotCap, slotHolding, slotScore, slotShare } from '../engine/slots';
import { AIRPORT_BY_CODE } from '../data/airports';
import { flyablePlanes, formatYen, openAirports, planeType, setOps, toggleCrewBase, type Result } from '../engine/sim';
import {
  airportHours, autoSchedule, DAILY, DAY_NAMES, dayCount, dayTag, hhmm, legViews, OPS_LEVELS,
  setPlaneLock, setPlaneSchedule, slotAirports, slotUsage, validateRotation, BASE_COST_MONTHLY,
} from '../engine/schedule';
import type { GameState, Leg, Plane } from '../engine/types';
import { ok } from '../engine/util';

type Apply = (r: Result) => void;
const aptName = (c: string) => AIRPORT_BY_CODE[c]?.name ?? c;
const START = 300; // timeline from 05:00
const END = 1440;
const pctX = (m: number, end = END) => `${((m - START) / (end - START)) * 100}%`;

const COLORS = ['#4f9bff', '#46c98b', '#e6c35c', '#ff8a65', '#b388ff', '#4dd0e1', '#f06292', '#aed581'];

export function SchedulePanel({ s, apply }: { s: GameState; apply: Apply }) {
  const [editing, setEditing] = useState<string | null>(null);
  const fly = flyablePlanes(s);
  const use = slotUsage(s);
  const routeColor = (id: string) => COLORS[s.routes.findIndex((r) => r.id === id) % COLORS.length];
  const planes = s.planes.filter((p) => p.status !== 'onOrder');
  const lastOtp = s.history[s.history.length - 1]?.onTime;

  return (
    <div>
      <h3>運航の方針</h3>
      <label>
        折り返しの余裕：最低時間 ＋ {s.bufferMin}分
        <input type="range" min={0} max={60} step={5} value={s.bufferMin} onChange={(e) => apply(setOps(s, { bufferMin: Number(e.target.value) }))} />
        <span className="small-text muted">余裕を削ると1機でたくさん飛べますが、遅れが後の便に連鎖しやすくなります。{lastOtp !== undefined && `先月の定時率 ${Math.round(lastOtp * 100)}%`}</span>
      </label>
      <div className="small-text" style={{ marginTop: 8 }}>運航計画部門</div>
      <div className="seg">
        {OPS_LEVELS.map((o, i) => (
          <button key={i} className={s.opsLevel === i ? 'on' : ''} title={o.note} onClick={() => apply(setOps(s, { opsLevel: i }))}>
            {o.label}{o.monthly ? `（月${formatYen(o.monthly)}〜）` : ''}
          </button>
        ))}
      </div>
      <p className="small-text muted">{OPS_LEVELS[s.opsLevel].note}</p>

      <h3>乗員基地</h3>
      <p className="small-text muted">機体は毎晩「拠点」の空港に戻ります。拠点が乗員基地でないとホテル代がかかります。基地は1か所増えるごとに月{formatYen(BASE_COST_MONTHLY)}〜。</p>
      <div className="assigned">
        {s.crewBases.map((c) => (
          <span key={c} className="chip">{aptName(c)}{c !== s.baseAirport && <button className="link" onClick={() => apply(toggleCrewBase(s, c))}>閉鎖</button>}</span>
        ))}
        <select value="" onChange={(e) => e.target.value && apply(toggleCrewBase(s, e.target.value))}>
          <option value="">＋ 基地を開設</option>
          {(() => {
            const planeBases = new Set(s.planes.map((p) => p.base));
            const served = new Set(s.routes.flatMap((r) => [r.from, r.to]));
            const cands = openAirports(s.year).filter((a) => !a.foreign && !s.crewBases.includes(a.code));
            const group = (label: string, list: typeof cands, note: (c: string) => string) => list.length > 0 && (
              <optgroup label={label}>
                {list.map((a) => <option key={a.code} value={a.code}>{a.name}{note(a.code)}</option>)}
              </optgroup>
            );
            return <>
              {group('就航中の空港', cands.filter((a) => served.has(a.code) || planeBases.has(a.code)), (c) => (planeBases.has(c) ? '（機体の拠点）' : ''))}
              {group('その他の空港', cands.filter((a) => !served.has(a.code) && !planeBases.has(a.code)).sort((a, b) => b.popM - a.popM), () => '')}
            </>;
          })()}
        </select>
      </div>

      {slotAirports(s.year).length > 0 && (
        <>
          <h3>発着枠（1日あたり）</h3>
          <div className="slot-list small-text">
            {slotAirports(s.year).map((c) => {
              const sc = slotScore(s, c);
              const next = nextSlotEvent(s, c);
              return (
                <div key={c} className="slot-box">
                  <div><strong>{aptName(c)}</strong> 使用 {use[c] ?? 0} / {s.slots[c] ?? 0} 回 <span className="muted">（いちばん多い曜日）</span></div>
                  <div className="muted">
                    国の評価 {Math.round(sc.total * 100)}点（{sc.parts.map((p) => `${p.label}${Math.round(p.value * 100)}`).join('・')}）
                    → 次の増枠で全体の{Math.round(slotShare(sc.total, s, c) * 100)}%を配分（上限{Math.round(slotCap(s, c) * 100)}%・空港全体の枠の{Math.round(slotHolding(s, c) * 100)}%を保有。他社はこの分だけ便数を減らします）
                  </div>
                  <div className="muted">{next ? `次の増枠：${next.year}年${next.month}月 ${next.label}（全体で1日${next.pool}回）` : '予定されている増枠はありません'}</div>
                </div>
              );
            })}
            <p className="muted">枠は1日あたりの上限で、曜日ごとに数えます（週3便と週4便の路線で1往復分を分け合えます）。枠は新しい滑走路ができたときにまとめて増え、国の評価で各社に配られます。当社の取り分の上限は20%から始まり、空港全体の枠を多く持つほど最大40%まで上がります。毎年4月にも、評価40点以上で1往復、60点以上で2往復、80点以上で3往復分増えます。2005年からは5年ごとに使っていない枠が回収されます。</p>
            <details className="muted">
              <summary>評価の内訳について</summary>
              <ul>
                <li>評判（45%）：会社の評判。30で0点、90で満点</li>
                <li>地方路線網（25%）：その空港から出ている自社の国内線のうち、幹線でない路線の本数。5本で満点。幹線は両端とも大都市の空港（千歳・仙台・羽田・成田・名古屋・中部・静岡・伊丹・関西・神戸・広島・福岡）どうしの路線</li>
                <li>安全性（15%）：直近5年に事故があると0点、重大インシデントの記録があると70点</li>
                <li>今の枠の使用率（15%）：持っている枠をどれだけ使っているか</li>
              </ul>
            </details>
          </div>
        </>
      )}

      <div className="card-head" style={{ marginTop: 14 }}>
        <h3 style={{ margin: 0 }}>機体ごとのダイヤ</h3>
        <button className="small secondary" onClick={() => apply(ok(autoSchedule(s)))}>自動で組み直す</button>
      </div>
      <div className="timeline-axis">
        {[6, 9, 12, 15, 18, 21].map((h) => <span key={h} style={{ left: pctX(h * 60) }}>{h}時</span>)}
      </div>
      {planes.length === 0 && <p className="hint">機体が届くとここにダイヤが表示されます。</p>}
      {planes.map((p) => {
        const views = legViews(s, p);
        const errs = validateRotation(s, p);
        const multi = p.cycleDays !== undefined;
        const end = multi ? Math.max(END, ...views.map((v) => v.arr + 60)) : END;
        return (
          <div key={p.id} className="tl-row">
            <div className="tl-label">
              <button className="link" onClick={() => setEditing(editing === p.id ? null : p.id)}>
                {planeType(p).name} {p.regNo}
              </button>
              <span className="muted small-text"> {aptName(p.base)}{p.locked ? ' 🔒' : ''}{!fly.has(p.id) ? ' ⚠運休' : ''}{multi && `（日付をまたぐ長距離ダイヤ・${p.cycleDays}日で1往復）`}</span>
            </div>
            <div className="tl-bar">
              {views.map((v, i) => (
                <div key={i} className="tl-leg" title={`${aptName(v.from)} ${dayTag(v.dep)}${hhmm(v.dep)} → ${aptName(v.to)} ${dayTag(v.arr)}${hhmm(v.arr)}（日本時間）`}
                  style={{ left: pctX(v.dep, end), width: `calc(${pctX(v.arr, end)} - ${pctX(v.dep, end)})`, background: routeColor(v.route.id), opacity: v.leg.days === DAILY ? 1 : 0.6 }}>
                  {v.to}
                </div>
              ))}
            </div>
            {errs.length > 0 && <div className="small-text neg">{errs[0]}</div>}
            {editing === p.id && (multi ? <LongHaulEditor s={s} p={p} apply={apply} /> : <LegEditor s={s} p={p} apply={apply} />)}
          </div>
        );
      })}
    </div>
  );
}

function LegEditor({ s, p, apply }: { s: GameState; p: Plane; apply: Apply }) {
  const views = legViews(s, p);
  const [routeKey, setRouteKey] = useState('');
  const [dep, setDep] = useState('08:00');
  const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };
  const lastTo = views.length ? views[views.length - 1].to : p.base;
  const options = s.routes.flatMap((r) => [
    { key: `${r.id}:0`, label: `${aptName(r.from)} → ${aptName(r.to)}`, from: r.from },
    { key: `${r.id}:1`, label: `${aptName(r.to)} → ${aptName(r.from)}`, from: r.to },
  ]);
  const legsOf = (vs: typeof views) => vs.map((v) => v.leg);
  const update = (legs: Leg[]) => apply(setPlaneSchedule(s, p.id, legs));
  const [open, close] = airportHours(lastTo, s.year);

  return (
    <div className="card editor">
      <div className="row">
        <BaseSelect s={s} p={p} apply={apply} />
        <label className="inline">
          <input type="checkbox" checked={p.locked} onChange={(e) => apply(setPlaneLock(s, p.id, e.target.checked))} />
          固定（自動で組み直しても変えない）
        </label>
      </div>
      <table className="tbl">
        <thead><tr><th>出発</th><th>区間</th><th>到着</th><th>曜日</th><th></th></tr></thead>
        <tbody>
          {views.map((v, i) => (
            <tr key={i}>
              <td>
                <input type="time" value={hhmm(v.dep)} step={300} onChange={(e) => {
                  const legs = legsOf(views).map((l, j) => (j === i ? { ...l, dep: toMin(e.target.value) } : l));
                  update(legs);
                }} />
              </td>
              <td>{aptName(v.from)} → {aptName(v.to)}</td>
              <td>{hhmm(v.arr)}</td>
              <td className="days">
                {DAY_NAMES.map((d, k) => (
                  <button key={k} className={`day ${v.leg.days & (1 << k) ? 'on' : ''}`} onClick={() => {
                    const legs = legsOf(views).map((l, j) => (j === i ? { ...l, days: l.days ^ (1 << k) || l.days } : l));
                    update(legs);
                  }}>{d}</button>
                ))}
                <span className="muted"> 週{dayCount(v.leg.days)}</span>
              </td>
              <td><button className="link" onClick={() => update(legsOf(views).filter((_, j) => j !== i))}>削除</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row">
        <select value={routeKey} onChange={(e) => setRouteKey(e.target.value)}>
          <option value="">＋ 便を追加（{aptName(lastTo)}発）</option>
          {options.filter((o) => o.from === lastTo).map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
        <input type="time" value={dep} step={300} onChange={(e) => setDep(e.target.value)} />
        <button className="small" disabled={!routeKey} onClick={() => {
          const [routeId, dir] = routeKey.split(':');
          update([...legsOf(views), { routeId, dir: Number(dir) as 0 | 1, dep: toMin(dep), days: DAILY }]);
          setRouteKey('');
        }}>追加</button>
        <span className="small-text muted">{aptName(lastTo)}の運用時間 {hhmm(open)}〜{hhmm(close)}</span>
      </div>
      <p className="small-text muted">手で編集した機体は自動的に「固定」になります。最後の便は拠点に戻るように組んでください。</p>
    </div>
  );
}

/** Editor for multi-day long-haul rotations: each leg has a day offset and a time (Japan time) */
function LongHaulEditor({ s, p, apply }: { s: GameState; p: Plane; apply: Apply }) {
  const views = legViews(s, p);
  const cycle = p.cycleDays ?? 1;
  const errs = validateRotation(s, p);
  const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };
  const update = (legs: Leg[], days = cycle) => apply(setPlaneSchedule(s, p.id, legs, undefined, days));
  return (
    <div className="card editor">
      <div className="row">
        <label className="inline">サイクル
          <select value={cycle} onChange={(e) => update(views.map((v) => v.leg), Number(e.target.value))}>
            {[1, 2, 3, 4].map((d) => <option key={d} value={d}>{d}日で1往復（週{(7 / d).toFixed(1)}往復）</option>)}
          </select>
        </label>
        <label className="inline">
          <input type="checkbox" checked={p.locked} onChange={(e) => apply(setPlaneLock(s, p.id, e.target.checked))} />
          固定（自動で組み直しても変えない）
        </label>
      </div>
      <table className="tbl">
        <thead><tr><th>出発（日本時間）</th><th>区間</th><th>到着</th></tr></thead>
        <tbody>
          {views.map((v, i) => (
            <tr key={i}>
              <td>
                <select value={Math.floor(v.dep / 1440)} onChange={(e) => update(views.map((x, j) => (j === i ? { ...x.leg, dep: Number(e.target.value) * 1440 + (x.dep % 1440) } : x.leg)))}>
                  {Array.from({ length: cycle + 1 }, (_, d) => <option key={d} value={d}>{d === 0 ? '1日目' : `${d + 1}日目`}</option>)}
                </select>
                <input type="time" step={300} value={hhmm(v.dep)} onChange={(e) => update(views.map((x, j) => (j === i ? { ...x.leg, dep: Math.floor(x.dep / 1440) * 1440 + toMin(e.target.value) } : x.leg)))} />
              </td>
              <td>{aptName(v.from)} → {aptName(v.to)}</td>
              <td>{dayTag(v.arr)}{hhmm(v.arr)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {errs.length > 0 && <p className="small-text neg">{errs[0]}</p>}
      <p className="small-text muted">時刻はすべて日本時間です。海外の空港は24時間使えます。手で編集すると「固定」になります。</p>
    </div>
  );
}
