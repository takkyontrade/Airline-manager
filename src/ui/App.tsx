import { useEffect, useRef, useState } from 'react';
import { AIRPORT_BY_CODE } from '../data/airports';
import { advanceMonth, formatYen, newGame, openAirports, openRoute, START_YEAR, type Result } from '../engine/sim';
import { clearAutosave, downloadSave, loadAutosave, loadSlot, parseSave, saveToSlot, SLOT_COUNT, slotInfo, writeAutosave } from '../engine/save';
import { routeDistance } from '../engine/model';
import type { GameState } from '../engine/types';
import { MapView } from './MapView';
import { FinancePanel, FleetPanel, MarketPanel, NewsPanel, RivalsPanel, RoutesPanel, StaffPanel } from './panels';
import { SchedulePanel } from './SchedulePanel';
import { BrandPanel } from './BrandPanel';
import { OpsRoom } from './OpsRoom';

type Tab = 'routes' | 'schedule' | 'fleet' | 'market' | 'staff' | 'finance' | 'rivals' | 'brand' | 'news';
const TABS: [Tab, string][] = [
  ['routes', '路線'], ['schedule', 'ダイヤ'], ['fleet', '機材'], ['market', '機材市場'], ['staff', '人員・整備'], ['finance', '財務'], ['rivals', 'ライバル・規制'], ['brand', 'ブランド'], ['news', 'ニュース'],
];

export function App() {
  const [state, setState] = useState<GameState | null>(() => loadAutosave());
  useEffect(() => {
    if (state) writeAutosave(state);
  }, [state]);
  if (!state) return <NewGame onStart={setState} />;
  return <Game state={state} setState={setState} />;
}

function NewGame({ onStart }: { onStart: (s: GameState) => void }) {
  const [name, setName] = useState('');
  const airports = openAirports(START_YEAR).sort((a, b) => b.popM - a.popM);
  const [base, setBase] = useState(airports[0].code);
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div className="newgame">
      <h1>航空会社運営ゲーム（仮）</h1>
      <p className="muted">1960年1月、日本。小さな航空会社を立ち上げ、空の歴史とともに育てていきましょう。</p>
      <label>
        会社名
        <input value={name} placeholder="新日本航空" onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        拠点空港
        <select value={base} onChange={(e) => setBase(e.target.value)}>
          {airports.map((a) => (
            <option key={a.code} value={a.code}>{a.name}（{a.city}）</option>
          ))}
        </select>
      </label>
      <p className="muted small-text">資本金は5億円です。DC-3の資格を持つパイロットが10人います。最初は中古のDC-3や、乗員付きのウェットリースから始めるのがおすすめです。</p>
      <div className="row">
        <button onClick={() => onStart(newGame(name || '新日本航空', base))}>会社を設立する</button>
        <button className="secondary" onClick={() => fileRef.current?.click()}>セーブファイルを読み込む</button>
        <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          const s = parseSave(await f.text());
          if (s) onStart(s); else alert('セーブファイルを読み込めませんでした');
        }} />
      </div>
    </div>
  );
}

function Game({ state, setState }: { state: GameState; setState: (s: GameState | null) => void }) {
  const [tab, setTab] = useState<Tab>('routes');
  const [sel, setSel] = useState<string | null>(null);
  const [routeKind, setRouteKind] = useState<'pax' | 'cargo'>('pax');
  const [view, setView] = useState<'map' | 'ops'>('map');
  const [slotsOpen, setSlotsOpen] = useState(false);
  const [hoverRoute, setHoverRoute] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const apply = (r: Result) => {
    if (r.ok) setState(r.state);
    else flash(r.error);
  };
  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 3500);
  };

  const onAirportClick = (code: string) => {
    if (!sel) return setSel(code);
    if (sel === code) return setSel(null);
    const a = AIRPORT_BY_CODE[sel], b = AIRPORT_BY_CODE[code];
    const km = Math.round(routeDistance(sel, code));
    if (confirm(`${a.name}〜${b.name}${routeKind === 'cargo' ? '貨物線' : '線'}（${km}km）を開設しますか？`)) {
      const r = openRoute(state, sel, code, { kind: routeKind });
      apply(r);
      if (r.ok) setTab('routes');
    }
    setSel(null);
  };

  const last = state.history[state.history.length - 1];

  return (
    <div className="app">
      <header>
        <div className="brand">{state.companyName}</div>
        <div className="date">{state.year}年{state.month}月</div>
        <div className={`cash ${state.cash < 0 ? 'neg' : ''}`}>資金 {formatYen(state.cash)}</div>
        {last && <div className={`muted ${last.profit < 0 ? 'neg' : 'pos'}`}>先月 {formatYen(last.profit)}</div>}
        <div className="muted">評判 {Math.round(state.reputation)}</div>
        <div className="spacer" />
        <div className="seg small-seg">
          <button className={view === 'map' ? 'on' : ''} onClick={() => setView('map')}>地図</button>
          <button className={view === 'ops' ? 'on' : ''} onClick={() => setView('ops')}>オペレーションルーム</button>
        </div>
        <div className="slots-wrap">
          <button className="secondary small" onClick={() => setSlotsOpen(!slotsOpen)}>セーブ枠</button>
          {slotsOpen && (
            <div className="slots-menu">
              {Array.from({ length: SLOT_COUNT }, (_, i) => slotInfo(i + 1)).map((info) => (
                <div key={info.slot} className="slot-row">
                  <span className="small-text">枠{info.slot}：{info.label ?? '（空き）'}</span>
                  <button className="small" onClick={() => {
                    if (info.label && !confirm(`枠${info.slot}に上書きしますか？`)) return;
                    flash(saveToSlot(info.slot, state) ? `枠${info.slot}に保存しました` : '保存できませんでした');
                    setSlotsOpen(false);
                  }}>保存</button>
                  <button className="small secondary" disabled={!info.label} onClick={() => {
                    const loaded = loadSlot(info.slot);
                    if (loaded && confirm(`枠${info.slot}（${info.label}）を読み込みますか？ 今のゲームは自動保存から消えます。`)) { setState(loaded); setSlotsOpen(false); }
                  }}>読込</button>
                </div>
              ))}
            </div>
          )}
        </div>
        <button className="secondary small" onClick={() => downloadSave(state)}>書き出し</button>
        <button className="secondary small" onClick={() => fileRef.current?.click()}>読み込み</button>
        <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          const s = parseSave(await f.text());
          if (s) setState(s); else flash('セーブファイルを読み込めませんでした');
        }} />
        <button className="secondary small" onClick={() => {
          if (confirm('今のゲームを終了して、最初からやり直しますか？（書き出していないデータは消えます）')) { clearAutosave(); setState(null); }
        }}>新しいゲーム</button>
        <button className="primary" disabled={state.gameOver} onClick={() => setState(advanceMonth(state))}>1か月進める ▶</button>
      </header>
      {state.gameOver && <div className="banner bad">倒産しました。「新しいゲーム」から再挑戦できます。</div>}
      <main>
        <section className="map-wrap">
          {view === 'ops' ? <OpsRoom s={state} /> : <>
          <MapView state={state} selected={sel} onAirportClick={onAirportClick} highlightRoute={hoverRoute} />
          <div className="map-kind seg">
            <button className={routeKind === 'pax' ? 'on' : ''} onClick={() => setRouteKind('pax')}>旅客路線を開設</button>
            <button className={routeKind === 'cargo' ? 'on' : ''} onClick={() => setRouteKind('cargo')}>貨物路線を開設</button>
          </div>
          <div className="map-hint">
            {sel ? `${AIRPORT_BY_CODE[sel].name}を選択中：結びたい空港をクリック（もう一度クリックで解除）` : '空港を2つ順にクリックして路線を開設 ／ ホイールで拡大、ドラッグで移動'}
          </div>
          </>}
        </section>
        <aside>
          <nav className="tabs">
            {TABS.map(([k, label]) => (
              <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>
            ))}
          </nav>
          <div className="panel">
            {tab === 'routes' && <RoutesPanel s={state} apply={apply} onHover={setHoverRoute} />}
            {tab === 'schedule' && <SchedulePanel s={state} apply={apply} />}
            {tab === 'fleet' && <FleetPanel s={state} apply={apply} />}
            {tab === 'market' && <MarketPanel s={state} apply={apply} />}
            {tab === 'staff' && <StaffPanel s={state} apply={apply} />}
            {tab === 'finance' && <FinancePanel s={state} apply={apply} />}
            {tab === 'rivals' && <RivalsPanel s={state} apply={apply} />}
            {tab === 'brand' && <BrandPanel s={state} apply={apply} />}
            {tab === 'news' && <NewsPanel s={state} />}
          </div>
        </aside>
      </main>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
