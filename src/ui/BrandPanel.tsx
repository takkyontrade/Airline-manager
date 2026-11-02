import { useState } from 'react';
import {
  aircraftTour, DEFAULT_COMPANY_LIVERY, farewellCandidates, farewellFlight, FAREWELL_COST, LIVERY_MONTHS, paintSpecial,
  RETRO_LIVERY_COST, setLivery, SPECIAL_LIVERY_COST, TOUR_COST,
} from '../engine/brand';
import { formatYen, planeType, type Result } from '../engine/sim';
import { nowYM, ymLabel } from '../engine/fleet';
import { AIRCRAFT_BY_ID } from '../data/aircraft';
import { econ, yearFrac } from '../data/economy';
import type { CompanyLivery, GameState, Plane } from '../engine/types';
import { PlaneSilhouette, type Livery } from './PlaneSilhouette';

type Apply = (r: Result) => void;

/** The livery a plane is painted in right now */
export function planeLivery(s: GameState, p?: Plane): Livery {
  const l = s.livery ?? DEFAULT_COMPANY_LIVERY;
  const sp = p?.specialLivery && p.specialLivery.untilYM >= nowYM(s) ? p.specialLivery.kind : undefined;
  return { ...l, special: sp };
}

export function BrandPanel({ s, apply }: { s: GameState; apply: Apply }) {
  const [draft, setDraft] = useState<CompanyLivery>(s.livery ?? DEFAULT_COMPANY_LIVERY);
  const [planeId, setPlaneId] = useState('');
  const [name, setName] = useState('');
  const cpi = econ.jpCpi(yearFrac(s.year, s.month));
  const planes = s.planes.filter((p) => p.status !== 'onOrder' && p.lease?.kind !== 'wet');
  const now = nowYM(s);
  const painted = s.planes.filter((p) => p.specialLivery && p.specialLivery.untilYM >= now);
  const farewell = farewellCandidates(s);
  const set = (k: keyof CompanyLivery, v: string) => setDraft({ ...draft, [k]: v });

  return (
    <div>
      <h3>塗装とロゴ</h3>
      <div className="livery-preview">
        {(['narrowJet', 'wideTwin', 'jumbo', 'twinProp'] as const).map((k) => (
          <PlaneSilhouette key={k} kind={k} width={150} livery={{ ...draft }} />
        ))}
      </div>
      <div className="grid2">
        <label>胴体<input type="color" value={draft.body} onChange={(e) => set('body', e.target.value)} /></label>
        <label>ライン<input type="color" value={draft.stripe} onChange={(e) => set('stripe', e.target.value)} /></label>
        <label>尾翼<input type="color" value={draft.tail} onChange={(e) => set('tail', e.target.value)} /></label>
        <label>ロゴの色<input type="color" value={draft.logoColor} onChange={(e) => set('logoColor', e.target.value)} /></label>
        <label>尾翼のロゴ（3文字まで）<input type="text" maxLength={3} value={draft.logo} onChange={(e) => set('logo', e.target.value)} placeholder="例：SKY、鶴" /></label>
      </div>
      <div className="row">
        <button onClick={() => apply(setLivery(s, draft))}>この塗装にする</button>
        <button className="secondary" onClick={() => setDraft(s.livery ?? DEFAULT_COMPANY_LIVERY)}>元に戻す</button>
      </div>

      <h3>ファンサービス</h3>
      <div className="card">
        <div className="card-head"><strong>機体見学会</strong><span className="muted small-text">{formatYen(TOUR_COST * cpi)}・評判＋1・半年に1回</span></div>
        <button className="small" onClick={() => apply(aircraftTour(s))}>見学会を開く</button>
        {s.fan?.lastTourYM !== undefined && <span className="small-text muted"> 前回：{ymLabel(s.fan.lastTourYM)}</span>}
      </div>
      <div className="card">
        <div className="card-head"><strong>特別塗装・復刻塗装</strong><span className="muted small-text">{LIVERY_MONTHS}か月。その機体が飛ぶ路線で少し選ばれやすくなります</span></div>
        <div className="row">
          <select value={planeId} onChange={(e) => setPlaneId(e.target.value)}>
            <option value="">機体を選ぶ</option>
            {planes.map((p) => <option key={p.id} value={p.id}>{planeType(p).name} {p.regNo}</option>)}
          </select>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="塗装の名前（例：沖縄キャンペーン）" />
        </div>
        <div className="row">
          <button className="small" disabled={!planeId} onClick={() => apply(paintSpecial(s, planeId, 'special', name))}>特別塗装（{formatYen(SPECIAL_LIVERY_COST * cpi)}・評判＋2）</button>
          <button className="small secondary" disabled={!planeId} onClick={() => apply(paintSpecial(s, planeId, 'retro', name))}>復刻塗装（{formatYen(RETRO_LIVERY_COST * cpi)}・評判＋3、創業20年から）</button>
        </div>
        {painted.length > 0 && (
          <div className="livery-preview">
            {painted.map((p) => (
              <div key={p.id} className="small-text muted">
                <PlaneSilhouette kind={planeType(p).silhouette} width={120} livery={planeLivery(s, p)} />
                <div>{p.specialLivery!.name}（{p.regNo}・〜{ymLabel(p.specialLivery!.untilYM)}）</div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="card">
        <div className="card-head"><strong>フェアウェルフライト</strong><span className="muted small-text">引退が近い機種の記念便。評判＋3、費用{formatYen(FAREWELL_COST * cpi)}（チケット収入で相殺）</span></div>
        {farewell.length === 0 && <p className="small-text muted">機齢20年以上の機体か、生産終了から10年以上たった機種があると開けます。</p>}
        <div className="row">
          {farewell.map((id) => <button key={id} className="small" onClick={() => apply(farewellFlight(s, id))}>{AIRCRAFT_BY_ID[id].name}</button>)}
        </div>
        {(s.fan?.farewells.length ?? 0) > 0 && <p className="small-text muted">これまで：{s.fan!.farewells.map((id) => AIRCRAFT_BY_ID[id].name).join('、')}</p>}
      </div>
    </div>
  );
}
