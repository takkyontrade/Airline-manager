import { useState } from 'react';
import { AIRPORT_BY_CODE } from '../data/airports';
import { AIRCRAFT_BY_ID } from '../data/aircraft';
import {
  closeRoute, flyablePlanes, formatYen, planeAge, planeType, planesOnRoute,
  routeMarket, setMaintLevel, setRoute, type Result,
} from '../engine/sim';
import { OPS_LEVELS, POLICY_LABEL, POLICY_LEVEL, scheduledWeekly, validateRotation } from '../engine/schedule';
import {
  acquireUsed, disposalTerms, disposePlane, financeLeaseMonthly, heavyCheckDue, heavyCheckOverdue,
  leadMonths, newTypesOnSale, nextCheckIsD, nowYM, OPERATING_TERMS, operatingLeaseRate,
  ORDER_DEPOSIT, orderNew, startHeavyCheck, wetLeaseMonthly, ymLabel, type OrderMode,
} from '../engine/fleet';
import { creditLimit, currentLoanRate, debt, fleetValue, LOAN_TERMS, monthlyPayment, repayLoan, takeLoan } from '../engine/finance';
import { hirePilots, pilotsRequired, pool, relevantTypes, traineeCount, trainPilots } from '../engine/staff';
import {
  canFly, HEAVY_CHECK_HOURS, heavyCheckCost, HIRE_LIMIT_PER_MONTH, hireCost, MAINT_LEVELS,
  newPriceYen, pilotWage, routeDistance, TRAINING_MONTHS, trainingCost,
} from '../engine/model';
import type { GameState, MaintLevel, MonthReport, Plane, SchedulePolicy } from '../engine/types';
import { PlaneSilhouette } from './PlaneSilhouette';
import { fareBand, routeLicensing } from '../data/history';
import { rivalOverview } from '../engine/rivals';

type Apply = (r: Result) => void;

const pct = (v: number) => `${Math.round(v * 100)}%`;
const num = (v: number) => Math.round(v).toLocaleString('ja-JP');
const aptName = (c: string) => AIRPORT_BY_CODE[c]?.name ?? c;
const lastReport = (s: GameState): MonthReport | undefined => s.history[s.history.length - 1];

// ---- routes --------------------------------------------------------------

export function RoutesPanel({ s, apply, onHover }: { s: GameState; apply: Apply; onHover: (id: string | null) => void }) {
  const rep = lastReport(s);
  const fly = flyablePlanes(s);
  if (s.routes.length === 0)
    return <p className="hint">まだ路線がありません。地図で空港を2つ順にクリックすると路線を開設できます。</p>;
  const ownedTypes = [...new Set(s.planes.map((p) => p.typeId))];
  return (
    <div className="list">
      {s.routes.map((r) => {
        const km = routeDistance(r.from, r.to);
        const f = routeMarket(s, r, fly);
        const res = rep?.routes.find((x) => x.routeId === r.id);
        const sched = scheduledWeekly(s, r.id);
        const flyers = planesOnRoute(s, r.id);
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
                <span className="muted">相場 {num(f.refFare)}円{fareBand(s.year) && `（認可運賃：相場の${Math.round(fareBand(s.year)![0] * 100)}〜${Math.round(fareBand(s.year)![1] * 100)}%）`}</span>
              </label>
              <label>
                目標：週の往復便数
                <input type="number" min={0} value={r.targetWeekly} onChange={(e) => apply(setRoute(s, r.id, { targetWeekly: Number(e.target.value) }))} />
                <span className={sched < r.targetWeekly ? 'neg' : 'muted'}>
                  ダイヤに入ったのは週{sched}往復{sched < r.targetWeekly && '（機材・時間・発着枠が足りません）'}
                </span>
              </label>
              <label>
                使う機種
                <select value={r.typeId ?? ''} onChange={(e) => apply(setRoute(s, r.id, { typeId: e.target.value || null }))}>
                  <option value="">おまかせ</option>
                  {ownedTypes.map((id) => <option key={id} value={id} disabled={!canFly(AIRCRAFT_BY_ID[id], r.from, r.to, s.year).ok}>{AIRCRAFT_BY_ID[id].name}</option>)}
                </select>
              </label>
              <label>
                ダイヤの方針
                <select value={r.policy} onChange={(e) => apply(setRoute(s, r.id, { policy: e.target.value as SchedulePolicy }))}>
                  {(Object.keys(POLICY_LABEL) as SchedulePolicy[]).map((k) => (
                    <option key={k} value={k} disabled={POLICY_LEVEL[k] > s.opsLevel}>
                      {POLICY_LABEL[k]}{POLICY_LEVEL[k] > s.opsLevel ? `（運航計画部門「${OPS_LEVELS[POLICY_LEVEL[k]].label}」以上）` : ''}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="muted small-text">
              市場：月{num(f.marketOneWay * 2)}人 ／ 予想シェア {pct(f.share)} ／ 他社：
              {f.rivals.length === 0 ? 'なし（独占）' : f.rivals.map((c) => (
                <span key={c.rival.id} className="rival-chip" style={{ borderColor: c.rival.color }}>{c.rival.name} 週{c.weeklyFreq}往復・{num(f.refFare * c.fareMul)}円</span>
              ))}
            </div>
            {res && (
              <div className="small-text">
                先月：旅客 {num(res.pax)}人 ／ 搭乗率 {res.seats ? pct(res.pax / res.seats) : '-'} ／ 定時率 {pct(res.onTime)}
                {res.cancelled >= 0.5 && <span className="neg"> ／ 欠航 {Math.round(res.cancelled)}便</span>} ／ 収入 {formatYen(res.revenue)} ／ 運航費 {formatYen(res.cost)}
              </div>
            )}
            {flyers.length > 0 && (
              <div className="assigned">
                {flyers.map((p) => (
                  <span key={p.id} className={`chip ${fly.has(p.id) ? '' : 'warn'}`} title={fly.has(p.id) ? '' : planeIssue(s, p)}>
                    {planeType(p).name} {p.regNo}{p.locked && ' 🔒'}{!fly.has(p.id) && ' ⚠'}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function planeIssue(_s: GameState, p: Plane): string {
  if (p.status === 'onOrder') return `納入待ち（${ymLabel(p.readyYM)}）`;
  if (p.status === 'heavyCheck') return `重整備中（${ymLabel(p.readyYM)}まで）`;
  if (heavyCheckOverdue(p)) return '重整備の期限切れで飛行停止';
  if (validateRotation(_s, p).length) return 'ダイヤに問題あり';
  return 'パイロット不足';
}

// ---- fleet ---------------------------------------------------------------

function statusLabel(s: GameState, p: Plane, flying: boolean) {
  if (p.status === 'onOrder') return <span className="tag">納入 {ymLabel(p.readyYM)}</span>;
  if (p.status === 'heavyCheck') return <span className="tag warn">重整備 〜{ymLabel(p.readyYM)}</span>;
  if (!flying) return <span className="tag bad">{planeIssue(s, p)}</span>;
  return <span className="tag new">稼働中</span>;
}

function contractLabel(p: Plane) {
  if (!p.lease) return '自社保有';
  const end = ymLabel(p.lease.endYM);
  if (p.lease.kind === 'operating') return `リース 月${formatYen(p.lease.monthlyYen)}（〜${end}）`;
  if (p.lease.kind === 'finance') return `ファイナンスリース 月${formatYen(p.lease.monthlyYen)}（〜${end}）`;
  return `ウェットリース 月${formatYen(p.lease.monthlyYen)}（〜${end}）`;
}

export function FleetPanel({ s, apply }: { s: GameState; apply: Apply }) {
  const fly = flyablePlanes(s);
  if (s.planes.length === 0) return <p className="hint">機体がありません。「機材市場」で発注するか、中古機を購入・リースしましょう。</p>;
  return (
    <div className="list">
      {s.planes.map((p) => {
        const t = planeType(p);
        const terms = disposalTerms(s, p);
        const isD = nextCheckIsD(p);
        const wet = p.lease?.kind === 'wet';
        return (
          <div key={p.id} className="card">
            <div className="card-head">
              <PlaneSilhouette kind={t.silhouette} width={64} />
              <strong>{t.name}</strong>
              <span className="muted">{p.regNo}</span>
              {statusLabel(s, p, fly.has(p.id))}
            </div>
            <div className="small-text muted">
              {p.status === 'onOrder' ? `${p.builtYear}年製（予定）` : `機齢${planeAge(p, s.year)}年`} ／ {contractLabel(p)}
            </div>
            {p.status !== 'onOrder' && !wet && (
              <div className="small-text">
                状態 <Meter v={p.condition} /> {Math.round(p.condition)} ／ 総飛行 {num(p.totalHours)}h ／
                次の{isD ? 'Dチェック' : 'Cチェック'}まで <span className={heavyCheckDue(p) ? 'neg' : ''}>{num(Math.max(0, HEAVY_CHECK_HOURS - p.hoursSinceHeavy))}h</span>
              </div>
            )}
            <div className="row">
              {p.status !== 'onOrder' && (
                <span className="small-text muted">拠点 {aptName(p.base)} ／ 1日{p.schedule.length}便{p.locked ? '（手動・固定）' : ''}</span>
              )}
              {p.status === 'active' && !wet && (
                <button className="secondary small" onClick={() => {
                  const cost = heavyCheckCost(t, isD, s.year, s.month);
                  if (confirm(`今月から${isD ? 'Dチェック（2か月）' : 'Cチェック（1か月）'}に入れますか？ 費用 ${formatYen(cost)}`)) apply(startHeavyCheck(s, p.id));
                }}>重整備に入れる</button>
              )}
              {p.status !== 'heavyCheck' && (
                <button className="danger small" onClick={() => {
                  const msg = p.status === 'onOrder'
                    ? '発注をキャンセルしますか？（手付金は戻りません）'
                    : terms.cash >= 0 ? `${terms.label}しますか？（${formatYen(terms.cash)}が入ります）` : `${terms.label}しますか？（費用 ${formatYen(-terms.cash)}）`;
                  if (confirm(msg)) apply(disposePlane(s, p.id));
                }}>{terms.label}</button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Meter({ v }: { v: number }) {
  const color = v >= 75 ? 'var(--good)' : v >= 50 ? '#e6c35c' : 'var(--bad)';
  return <span className="meter"><span style={{ width: `${v}%`, background: color }} /></span>;
}

// ---- market --------------------------------------------------------------

export function MarketPanel({ s, apply }: { s: GameState; apply: Apply }) {
  const [view, setView] = useState<'new' | 'used'>('new');
  return (
    <div>
      <div className="seg">
        <button className={view === 'new' ? 'on' : ''} onClick={() => setView('new')}>新造機の発注</button>
        <button className={view === 'used' ? 'on' : ''} onClick={() => setView('used')}>中古機（{s.usedMarket.length}）</button>
      </div>
      {view === 'new' ? <NewOrders s={s} apply={apply} /> : <UsedMarket s={s} apply={apply} />}
    </div>
  );
}

function Specs({ typeId }: { typeId: string }) {
  const t = AIRCRAFT_BY_ID[typeId];
  return (
    <div className="small-text muted">
      {t.seats}席 ／ 航続{num(t.rangeKm)}km ／ 巡航{t.speedKmh}km/h ／ 必要滑走路{num(t.minRunwayM)}m ／ パイロット{t.cockpitCrew}名・客室{t.cabinCrew}名
    </div>
  );
}

function NewOrders({ s, apply }: { s: GameState; apply: Apply }) {
  const [years, setYears] = useState<number>(8);
  const types = newTypesOnSale(s.year);
  return (
    <div className="list">
      <div className="small-text muted">
        購入は手付金{pct(ORDER_DEPOSIT)}・残りは納入時。リースは保証金2か月分で、納入月から支払い開始。
        オペレーティングリース期間：
        <select value={years} onChange={(e) => setYears(Number(e.target.value))}>
          {OPERATING_TERMS.map((y) => <option key={y} value={y}>{y}年</option>)}
        </select>
      </div>
      {types.map((t) => {
        const price = newPriceYen(t, s.year, s.month);
        const lead = leadMonths(t, s.year);
        const order = (mode: OrderMode) => apply(orderNew(s, t.id, mode, years));
        return (
          <div key={t.id} className="card market">
            <PlaneSilhouette kind={t.silhouette} width={110} />
            <div className="grow">
              <div className="card-head">
                <strong>{t.name}</strong>
                <span className="muted">{t.maker}</span>
                <span className="tag">納期 約{lead}か月</span>
              </div>
              <Specs typeId={t.id} />
              <div className="row">
                <button onClick={() => order('buy')}>購入 {formatYen(price)}</button>
                <button className="secondary" onClick={() => order('operating')}>リース 月{formatYen(price * operatingLeaseRate(years, false))}</button>
                <button className="secondary" title="10年払い終えると自社のものになります" onClick={() => order('finance')}>
                  ファイナンスリース 月{formatYen(financeLeaseMonthly(price, s.year, s.month))}
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function UsedMarket({ s, apply }: { s: GameState; apply: Apply }) {
  const [years, setYears] = useState<number>(3);
  const [wetMonths, setWetMonths] = useState<number>(6);
  if (s.usedMarket.length === 0) return <p className="hint">今月の中古機の出物はありません。</p>;
  return (
    <div className="list">
      <div className="small-text muted">
        中古機はすぐに使えます。リース期間：
        <select value={years} onChange={(e) => setYears(Number(e.target.value))}>
          {OPERATING_TERMS.map((y) => <option key={y} value={y}>{y}年</option>)}
        </select>
        ／ ウェットリース（乗員・整備込み）：
        <select value={wetMonths} onChange={(e) => setWetMonths(Number(e.target.value))}>
          {[1, 3, 6, 12].map((m) => <option key={m} value={m}>{m}か月</option>)}
        </select>
      </div>
      {s.usedMarket.map((l) => {
        const t = AIRCRAFT_BY_ID[l.typeId];
        return (
          <div key={l.id} className="card market">
            <PlaneSilhouette kind={t.silhouette} width={110} />
            <div className="grow">
              <div className="card-head">
                <strong>{t.name}</strong>
                <span className="tag">{l.builtYear}年製</span>
                <span className="muted small-text">状態 <Meter v={l.condition} /> {l.condition} ／ {num(l.totalHours)}h ／ 掲載〜{ymLabel(l.expiresYM)}</span>
              </div>
              <Specs typeId={t.id} />
              <div className="row">
                <button onClick={() => apply(acquireUsed(s, l.id, 'buy'))}>購入 {formatYen(l.priceYen)}</button>
                <button className="secondary" onClick={() => apply(acquireUsed(s, l.id, 'operating', years))}>リース 月{formatYen(l.priceYen * operatingLeaseRate(years, true))}</button>
                <button className="secondary" title="パイロットも整備も付いてくるので、資格がなくてもすぐ飛ばせます" onClick={() => apply(acquireUsed(s, l.id, 'wet', wetMonths))}>
                  ウェット 月{formatYen(wetLeaseMonthly(l.priceYen, t, s.year, s.month))}
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---- staff & maintenance -------------------------------------------------

export function StaffPanel({ s, apply }: { s: GameState; apply: Apply }) {
  const types = relevantTypes(s);
  const [count, setCount] = useState<Record<string, number>>({});
  const [from, setFrom] = useState<Record<string, string>>({});
  return (
    <div>
      <h3>整備の方針</h3>
      <div className="seg">
        {(Object.keys(MAINT_LEVELS) as MaintLevel[]).map((k) => (
          <button key={k} className={s.maintLevel === k ? 'on' : ''} onClick={() => apply(setMaintLevel(s, k))}>
            {MAINT_LEVELS[k].label}（費用×{MAINT_LEVELS[k].costMul}）
          </button>
        ))}
      </div>
      <p className="small-text muted">
        手厚いほど機体の状態が良く保たれ、燃費・快適さ・評判が良くなります（第6段階で事故・インシデントの起きやすさにも影響）。
        飛行{num(HEAVY_CHECK_HOURS)}時間ごとに重整備（3回に1回は長いDチェック）に自動で入ります。期限を15%過ぎると飛行停止です。
      </p>
      <h3>パイロット（月給 {formatYen(pilotWage(s.year, s.month))}／人）</h3>
      {types.length === 0 && <p className="hint">機体を導入すると、機種ごとのパイロットがここに表示されます。</p>}
      <div className="list">
        {types.map((id) => {
          const t = AIRCRAFT_BY_ID[id];
          const p = pool(s, id);
          const need = pilotsRequired(s, id);
          const orders = s.planes.filter((x) => x.typeId === id && x.status === 'onOrder').length;
          const n = count[id] ?? Math.max(1, need - p.rated);
          const hiredNow = s.hiresThisMonth?.[id] ?? 0;
          const others = types.filter((x) => x !== id && pool(s, x).rated > 0);
          return (
            <div key={id} className="card">
              <div className="card-head">
                <strong>{t.name}</strong>
                <span className={p.rated < need ? 'neg' : 'pos'}>資格者 {p.rated}人 ／ 必要 {need}人</span>
                {traineeCount(p) > 0 && <span className="muted">訓練中 {p.training.map((x) => `${x.count}人（${ymLabel(x.readyYM)}）`).join('、')}</span>}
                {orders > 0 && <span className="muted">発注中 {orders}機（1機あたり{t.cockpitCrew * 5}人必要）</span>}
              </div>
              <div className="row">
                <input type="number" min={1} value={n} style={{ width: 70 }} onChange={(e) => setCount({ ...count, [id]: Math.max(1, Number(e.target.value)) })} />人を
                <button className="small" disabled={hiredNow >= HIRE_LIMIT_PER_MONTH} onClick={() => apply(hirePilots(s, id, n))}>
                  経験者採用（{formatYen(hireCost(s.year, s.month) * n)}、今月あと{HIRE_LIMIT_PER_MONTH - hiredNow}人）
                </button>
                <button className="small secondary" onClick={() => apply(trainPilots(s, id, n, from[id] || undefined))}>
                  {from[id] ? '移行訓練' : '新人訓練'}（{TRAINING_MONTHS}か月、{formatYen(trainingCost(t, s.year, s.month) * n)}）
                </button>
                {others.length > 0 && (
                  <select value={from[id] ?? ''} onChange={(e) => setFrom({ ...from, [id]: e.target.value })}>
                    <option value="">新人を訓練</option>
                    {others.map((o) => <option key={o} value={o}>{AIRCRAFT_BY_ID[o].name}から移行</option>)}
                  </select>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---- finance -------------------------------------------------------------

const COST_LABELS: Record<keyof MonthReport['costs'], string> = {
  fuel: '燃料費', maintenance: '整備費', heavyChecks: '重整備', crew: '人件費（乗員）', training: '訓練費',
  airport: '空港使用料', ground: '地上・旅客サービス', sales: '販売手数料', delays: '遅延・欠航対応', bases: '基地・運航計画', lease: 'リース料', interest: '支払利息', overhead: '本社経費',
};

export function FinancePanel({ s, apply }: { s: GameState; apply: Apply }) {
  const rep = lastReport(s);
  const hist = s.history.slice(-36);
  const [amount, setAmount] = useState(100_000_000);
  const [years, setYears] = useState<number>(10);
  const rate = currentLoanRate(s);
  const limit = creditLimit(s);
  const pending = s.planes.filter((p) => p.status === 'onOrder').reduce((n, p) => n + p.balanceDueYen, 0);
  return (
    <div>
      <h3>会社の状況</h3>
      <table className="tbl">
        <tbody>
          <tr><td>現金</td><td className="r">{formatYen(s.cash)}</td></tr>
          <tr><td>保有機材の価値</td><td className="r">{formatYen(fleetValue(s))}</td></tr>
          <tr><td>借入金</td><td className="r">-{formatYen(debt(s))}</td></tr>
          {pending > 0 && <tr><td className="muted">発注機の残金（納入時に支払い）</td><td className="r muted">{formatYen(pending)}</td></tr>}
          <tr className="total"><td>純資産</td><td className="r">{formatYen(s.cash + fleetValue(s) - debt(s))}</td></tr>
        </tbody>
      </table>

      <h3>銀行借入（年利 {(rate * 100).toFixed(1)}%、借入可能額 {formatYen(limit)}）</h3>
      <div className="row">
        <input type="number" step={10_000_000} value={amount} style={{ width: 150 }} onChange={(e) => setAmount(Number(e.target.value))} />
        <select value={years} onChange={(e) => setYears(Number(e.target.value))}>
          {LOAN_TERMS.map((y) => <option key={y} value={y}>{y}年返済</option>)}
        </select>
        <button className="small" onClick={() => apply(takeLoan(s, amount, years))}>借りる（毎月 {formatYen(monthlyPayment(amount, rate, years))}）</button>
      </div>
      {s.loans.length > 0 && (
        <table className="tbl">
          <thead><tr><th>残高</th><th>年利</th><th>毎月</th><th>完済</th><th></th></tr></thead>
          <tbody>
            {s.loans.map((l) => (
              <tr key={l.id}>
                <td>{formatYen(l.balanceYen)}</td><td>{(l.annualRate * 100).toFixed(1)}%</td><td>{formatYen(l.monthlyPaymentYen)}</td><td>{ymLabel(l.endYM)}</td>
                <td><button className="small secondary" onClick={() => apply(repayLoan(s, l.id))}>一括返済</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {rep ? (
        <>
          <h3>{rep.year}年{rep.month}月の収支</h3>
          <table className="tbl">
            <tbody>
              <tr><td>旅客収入</td><td className="r">{formatYen(rep.revenue)}</td></tr>
              {Object.entries(rep.costs).filter(([, v]) => v > 0).map(([k, v]) => (
                <tr key={k}><td className="muted">{COST_LABELS[k as keyof MonthReport['costs']]}</td><td className="r">-{formatYen(v)}</td></tr>
              ))}
              <tr className="total"><td>損益</td><td className={`r ${rep.profit < 0 ? 'neg' : 'pos'}`}>{formatYen(rep.profit)}</td></tr>
              {rep.principalRepaid > 0 && <tr><td className="muted">借入金の返済（元本）</td><td className="r">-{formatYen(rep.principalRepaid)}</td></tr>}
              {rep.deliveriesPaid > 0 && <tr><td className="muted">納入機の残金</td><td className="r">-{formatYen(rep.deliveriesPaid)}</td></tr>}
              <tr><td>旅客数</td><td className="r">{num(rep.pax)}人</td></tr>
            </tbody>
          </table>
          <h3>資金の推移</h3>
          <CashChart hist={hist} />
        </>
      ) : <p className="hint">「1か月進める」を押すと、月ごとの収支がここに出ます。</p>}
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

export { nowYM };

const ROLE_LABEL: Record<string, string> = { flag: 'ナショナルフラッグ', major: '大手', local: 'ローカル線', okinawa: '沖縄', entrant: '新規参入', lcc: 'LCC' };

export function RivalsPanel({ s }: { s: GameState }) {
  const list = rivalOverview(s);
  const band = fareBand(s.year);
  return (
    <div>
      <h3>いまの時代のルール</h3>
      <p className="small-text">{routeLicensing(s.year).label}</p>
      <p className="small-text">{band ? `運賃は認可制で、相場の${Math.round(band[0] * 100)}〜${Math.round(band[1] * 100)}%の範囲でしか決められません。` : '運賃は自由に決められます。'}</p>
      <p className="small-text muted">免許が必要な時代でも、ローカル線や他社が飛んでいない路線は開設できます。幹線に入るには実績（評判と機材）が必要です。</p>
      <h3>ライバル会社</h3>
      <div className="list">
        {list.map((o) => (
          <div key={o.rival.id} className="card" style={{ borderLeft: `4px solid ${o.rival.color}` }}>
            <div className="card-head">
              <strong>{o.rival.name}</strong>
              <span className="muted small-text">{ROLE_LABEL[o.rival.role]}</span>
              <span className="small-text">{o.routes}路線・週{num(o.weekly)}往復</span>
            </div>
            <div className="small-text muted">主な路線：{o.top.join('、')}</div>
            <div className="small-text muted">運賃 相場の{Math.round(o.rival.fareMul * 100)}%・快適さ {o.rival.comfortMul >= 1.05 ? '高め' : o.rival.comfortMul <= 0.9 ? '控えめ' : '普通'}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
