// Cabin classes, fan service and the company's look.
import { econ, yearFrac } from '../data/economy';
import { nowYM, planeAge, planeType } from './fleet';
import { isIntlRoute } from './model';
import type { CabinLayout, CompanyLivery, GameState, Route } from './types';
import { fail, formatYen, ok, spend, withNews, type Result } from './util';

// ---- cabin classes -----------------------------------------------------------

export const CABIN_LABEL: Record<CabinLayout, string> = {
  mono: 'エコノミーのみ',
  two: '2クラス（上級席＋エコノミー）',
  three: '3クラス（ファースト＋ビジネス＋エコノミー）',
};

/** Share of the cabin floor given to premium seats */
const PREMIUM_FLOOR: Record<CabinLayout, number> = { mono: 0, two: 0.12, three: 0.22 };
/** A premium seat takes the space of this many economy seats */
const PREMIUM_SPACE = 2.5;

/** Economy and premium seats of a plane with this layout */
export function cabinSeats(seats: number, cabin: CabinLayout = 'mono'): { econ: number; premium: number } {
  const f = PREMIUM_FLOOR[cabin];
  return { econ: seats * (1 - f), premium: (seats * f) / PREMIUM_SPACE };
}

/** Premium fare as a multiple of the economy fare */
export function premiumFareMul(route: Route): number {
  const intl = isIntlRoute(route.from, route.to);
  if (route.cabin === 'three') return intl ? 4 : 1.9;
  return intl ? 3 : 1.6;
}

/**
 * How well the market has accepted our premium cabin. New products take years
 * to catch on, faster with a good reputation; before business class became
 * common (around 1979) acceptance stays limited.
 */
export function cabinAcceptance(s: GameState, cabin: CabinLayout = 'mono'): number {
  if (cabin === 'mono') return 0;
  const since = s.cabinSince?.[cabin];
  if (since === undefined) return 0;
  const months = nowYM(s) - since;
  const era = s.year < 1979 ? 0.6 : 1;
  const rep = Math.min(1.2, Math.sqrt(s.reputation / 60));
  return Math.max(0, Math.min(1, (months / 36) * rep) * era);
}

/** Share of travellers who want a premium seat */
export const premiumDemandShare = (route: Route) => (isIntlRoute(route.from, route.to) ? 0.15 : 0.06);

/** Record the first month a layout is offered */
export function noteCabin(s: GameState, cabin: CabinLayout): GameState {
  if (cabin === 'mono' || s.cabinSince?.[cabin] !== undefined) return s;
  return withNews({ ...s, cabinSince: { ...(s.cabinSince ?? {}), [cabin]: nowYM(s) } },
    `${CABIN_LABEL[cabin]}を導入しました。お客さんに知られて定着するまで数年かかります。`);
}

// ---- fan service -------------------------------------------------------------

const cpiNow = (s: GameState) => econ.jpCpi(yearFrac(s.year, s.month));

export const SPECIAL_LIVERY_COST = 30_000_000;
export const RETRO_LIVERY_COST = 15_000_000;
export const LIVERY_MONTHS = 24;
export const TOUR_COST = 3_000_000;
export const FAREWELL_COST = 5_000_000;

export function paintSpecial(s: GameState, planeId: string, kind: 'special' | 'retro', name: string): Result {
  const p = s.planes.find((x) => x.id === planeId);
  if (!p || p.status === 'onOrder') return fail('機体が見つかりません');
  if (p.lease?.kind === 'wet') return fail('ウェットリース機は塗り替えられません');
  if (p.specialLivery && p.specialLivery.untilYM >= nowYM(s)) return fail('この機体はすでに特別塗装です');
  const founded = s.foundedYear ?? 1960;
  if (kind === 'retro' && s.year - founded < 20) return fail('復刻塗装は創業20年を過ぎてから（懐かしむ歴史が必要です）');
  const cost = (kind === 'special' ? SPECIAL_LIVERY_COST : RETRO_LIVERY_COST) * cpiNow(s);
  if (s.cash < cost) return fail(`資金が足りません（${formatYen(cost)}）`);
  const label = name.trim() || (kind === 'special' ? '特別塗装' : '復刻塗装');
  const planes = s.planes.map((x) => (x.id === planeId ? { ...x, specialLivery: { kind, name: label, untilYM: nowYM(s) + LIVERY_MONTHS } } : x));
  return ok(withNews({ ...spend({ ...s, planes }, 'marketing', cost), reputation: s.reputation + (kind === 'retro' ? 3 : 2) },
    `${planeType(p).name}（${p.regNo}）が「${label}」になりました。各地の空港にファンが集まっています。`, 'good'));
}

export function aircraftTour(s: GameState): Result {
  if (!s.planes.some((p) => p.status !== 'onOrder')) return fail('見学できる機体がありません');
  const last = s.fan?.lastTourYM;
  if (last !== undefined && nowYM(s) - last < 6) return fail('機体見学会は半年に1回までです');
  const cost = TOUR_COST * cpiNow(s);
  return ok(withNews({ ...spend(s, 'marketing', cost), reputation: s.reputation + 1, fan: { farewells: [], ...(s.fan ?? {}), lastTourYM: nowYM(s) } },
    '格納庫で機体見学会を開きました。抽選に外れた人も多い人気ぶりでした。', 'good'));
}

/** Types eligible for a farewell flight: old planes (20+ years) or production ended 10+ years ago */
export function farewellCandidates(s: GameState): string[] {
  const done = new Set(s.fan?.farewells ?? []);
  const ids = new Set<string>();
  for (const p of s.planes) {
    if (p.status === 'onOrder' || done.has(p.typeId)) continue;
    const t = planeType(p);
    if (planeAge(p, s.year) >= 20 || s.year - t.endYear >= 10) ids.add(p.typeId);
  }
  return [...ids];
}

export function farewellFlight(s: GameState, typeId: string): Result {
  if (!farewellCandidates(s).includes(typeId)) return fail('引退が近い機種だけフェアウェルフライトができます');
  const cost = FAREWELL_COST * cpiNow(s);
  const p = s.planes.find((x) => x.typeId === typeId)!;
  // the special flight sells out at premium prices
  const tickets = planeType(p).seats * 30000 * cpiNow(s);
  return ok(withNews({ ...spend(s, 'marketing', cost - tickets > 0 ? cost - tickets : 0), reputation: s.reputation + 3, fan: { farewells: [...(s.fan?.farewells ?? []), typeId], ...(s.fan?.lastTourYM !== undefined ? { lastTourYM: s.fan.lastTourYM } : {}) } },
    `${planeType(p).name}のフェアウェルフライトを運航しました。航空ファンで満席になり、別れを惜しむ声が多く寄せられました。`, 'good'));
}

/** Small attractiveness bonus for routes flown by specially painted planes */
export function liveryBonus(s: GameState, planeIds: string[]): number {
  const now = nowYM(s);
  return planeIds.some((id) => { const p = s.planes.find((x) => x.id === id); return p?.specialLivery && p.specialLivery.untilYM >= now; }) ? 1.05 : 1;
}

// ---- company look --------------------------------------------------------------

export const DEFAULT_COMPANY_LIVERY: CompanyLivery = { body: '#e9eef5', stripe: '#2f6fd6', tail: '#2f6fd6', logo: '', logoColor: '#ffffff' };

export function setLivery(s: GameState, livery: CompanyLivery): Result {
  const logo = livery.logo.slice(0, 3);
  return ok({ ...s, livery: { ...livery, logo } });
}
