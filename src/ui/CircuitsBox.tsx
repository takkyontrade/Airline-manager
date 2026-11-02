import { useState } from 'react';
import { NumInput } from './NumInput';
import { AIRPORT_BY_CODE } from '../data/airports';
import { AIRCRAFT_BY_ID } from '../data/aircraft';
import { addCircuit, openAirports, removeCircuit, setCircuit, type Result } from '../engine/sim';
import { circuitScheduled, circuitSegments } from '../engine/schedule';
import type { GameState } from '../engine/types';

const name = (c: string) => AIRPORT_BY_CODE[c]?.name ?? c;

/** Triangle / multi-stop rotations: A→B→C→A flown by one plane in a day */
export function CircuitsBox({ s, apply }: { s: GameState; apply: (r: Result) => void }) {
  const [open, setOpen] = useState(false);
  const [stops, setStops] = useState<string[]>([s.baseAirport, '', '', '']);
  const airports = openAirports(s.year).filter((a) => !a.foreign).sort((a, b) => b.popM - a.popM);
  const types = [...new Set(s.planes.filter((p) => !AIRCRAFT_BY_ID[p.typeId].freighter).map((p) => p.typeId))];
  const circuits = s.circuits ?? [];
  return (
    <div className="card circuits">
      <div className="card-head">
        <strong>周回ルート（三角運航など）</strong>
        <button className="small secondary" onClick={() => setOpen(!open)}>{open ? '閉じる' : '＋ 新しく作る'}</button>
      </div>
      <p className="muted small-text">1機が A→B→C→A のように回って拠点に戻る運航を、自動ダイヤで組みます。足りない区間の路線は自動で開設されます。</p>
      {open && (
        <div className="circuit-form">
          {stops.map((v, i) => (
            <label key={i}>
              {i === 0 ? '出発・帰着' : `${i}番目`}{i === 3 && '（任意）'}
              <select value={v} onChange={(e) => setStops(stops.map((x, k) => (k === i ? e.target.value : x)))}>
                <option value="">—</option>
                {airports.map((a) => <option key={a.code} value={a.code}>{a.name}</option>)}
              </select>
            </label>
          ))}
          <button onClick={() => {
            const r = addCircuit(s, stops, 7);
            apply(r);
            if (r.ok) { setOpen(false); setStops([s.baseAirport, '', '', '']); }
          }}>この周回で開設（毎日）</button>
        </div>
      )}
      {circuits.map((c) => {
        const segs = circuitSegments(s, c);
        const got = circuitScheduled(s, c);
        return (
          <div key={c.id} className="circuit-row">
            <div><strong>{[...c.stops, c.stops[0]].map(name).join(' → ')}</strong></div>
            <div className="row">
              <label className="inline">
                週
                <NumInput min={0} max={70} value={c.targetWeekly} onCommit={(v) => apply(setCircuit(s, c.id, { targetWeekly: v }))} />
                回
              </label>
              <select value={c.typeId ?? ''} onChange={(e) => apply(setCircuit(s, c.id, { typeId: e.target.value || null }))}>
                <option value="">機材おまかせ</option>
                {types.map((t) => <option key={t} value={t}>{AIRCRAFT_BY_ID[t].name}</option>)}
              </select>
              <button className="danger small" onClick={() => confirm('この周回ルートをやめますか？（各区間の路線は残ります）') && apply(removeCircuit(s, c.id))}>やめる</button>
            </div>
            <div className={`small-text ${!segs || got < c.targetWeekly ? 'warn' : 'muted'}`}>
              {!segs ? '区間の路線が廃止されたため運航できません' : got >= c.targetWeekly ? `週${got}回ダイヤに組み込み済み` : `ダイヤに入ったのは週${got}回（機材・営業時間・発着枠が不足）`}
            </div>
          </div>
        );
      })}
    </div>
  );
}
