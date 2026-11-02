import { openAirports, type Result } from '../engine/sim';
import { setPlaneBase } from '../engine/schedule';
import type { GameState, Plane } from '../engine/types';

/** Pick a plane's home base (or leave it to the auto-scheduler) */
export function BaseSelect({ s, p, apply }: { s: GameState; p: Plane; apply: (r: Result) => void }) {
  const domestic = openAirports(s.year).filter((a) => !a.foreign);
  const served = new Set(s.routes.flatMap((r) => [r.from, r.to]));
  const bases = domestic.filter((a) => s.crewBases.includes(a.code));
  const routes = domestic.filter((a) => !s.crewBases.includes(a.code) && served.has(a.code));
  const others = domestic.filter((a) => !s.crewBases.includes(a.code) && !served.has(a.code)).sort((a, b) => b.popM - a.popM);
  const value = p.baseFixed ? p.base : '';
  const change = (v: string) => {
    if (p.schedule.length > 0 && !confirm('拠点を変えると、この機体のダイヤは作り直されます。よろしいですか？')) return;
    apply(setPlaneBase(s, p.id, v || null));
  };
  const opt = (a: { code: string; name: string }) => <option key={a.code} value={a.code}>{a.name}</option>;
  return (
    <label className="inline small-text">拠点
      <select value={value} onChange={(e) => change(e.target.value)}>
        <option value="">自動（今は{domestic.find((a) => a.code === p.base)?.name ?? p.base}）</option>
        <optgroup label="乗員基地">{bases.map(opt)}</optgroup>
        {routes.length > 0 && <optgroup label="就航中の空港（ホテル代がかかります）">{routes.map(opt)}</optgroup>}
        {others.length > 0 && <optgroup label="その他の空港（ホテル代がかかります）">{others.map(opt)}</optgroup>}
      </select>
    </label>
  );
}
