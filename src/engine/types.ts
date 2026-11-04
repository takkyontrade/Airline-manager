/** Months since year 0: year * 12 + (month - 1) */
export type YM = number;
export const ym = (year: number, month: number): YM => year * 12 + (month - 1);
export const ymYear = (t: YM) => Math.floor(t / 12);
export const ymMonth = (t: YM) => (t % 12) + 1;

export type LeaseKind = 'operating' | 'finance' | 'wet';

export interface Lease {
  kind: LeaseKind;
  monthlyYen: number;
  startYM: YM;
  endYM: YM; // last month paid
}

/** shop = out of service for repair after an incident, or for a freighter conversion */
export type PlaneStatus = 'onOrder' | 'active' | 'heavyCheck' | 'shop';

export interface Plane {
  id: string;
  typeId: string;
  regNo: string;
  builtYear: number;
  status: PlaneStatus;
  /** onOrder: month of delivery; heavyCheck: month it returns to service */
  readyYM: YM;
  /** owned planes: price paid. finance lease: price at signing */
  purchaseYen: number;
  /** remaining amount due on delivery (orders) */
  balanceDueYen: number;
  lease: Lease | null;
  acquiredYM: YM;
  /** airport where the plane starts and ends its daily rotation (overnight) */
  base: string;
  /** daily rotation, repeated on the days in each leg's mask */
  schedule: Leg[];
  /** long-haul planes fly a rotation spanning several days (legs' dep can exceed 24h; day masks ignored) */
  cycleDays?: number;
  /** when in the shop for a conversion: the freighter type it becomes */
  convertTo?: string;
  /** special or retro livery, shown until a month */
  specialLivery?: { kind: 'special' | 'retro'; name: string; untilYM: number };
  /** locked planes keep their schedule when the auto-scheduler runs */
  locked: boolean;
  /** the player chose this base: the auto-scheduler won't move the plane */
  baseFixed?: boolean;
  /** 0..100 */
  condition: number;
  totalHours: number;
  hoursSinceHeavy: number;
  heavyChecks: number;
}

/** One flight in a plane's daily rotation */
export interface Leg {
  routeId: string;
  /** 0 = route.from -> route.to, 1 = reverse */
  dir: 0 | 1;
  /** scheduled departure, minutes after midnight (local) */
  dep: number;
  /** bitmask of operating days, bit0 = Monday; 127 = daily */
  days: number;
}

export type SchedulePolicy = 'pack' | 'even' | 'peak' | 'bank';

export interface Route {
  id: string;
  from: string;
  to: string;
  /** target round trips per week (for the auto-scheduler) */
  targetWeekly: number;
  /** aircraft type the auto-scheduler should use (null = any suitable) */
  typeId: string | null;
  /** preferred aircraft types, best first (the auto-scheduler tries these before others) */
  typePriority?: string[];
  /** types the auto-scheduler must never use on this route */
  typeBan?: string[];
  policy: SchedulePolicy;
  fareYen: number;
  openedYear: number;
  openedMonth: number;
  /** cargo routes are flown by freighters only (default: passenger route, which also carries belly cargo) */
  kind?: 'pax' | 'cargo';
  /** cargo rate in yen per kg (cargo routes and belly cargo) — null/undefined = market rate */
  cargoRateYen?: number;
  /** cabin layout: economy only, two classes, or three classes */
  cabin?: CabinLayout;
  /** technical (refuelling) stop, e.g. Anchorage */
  via?: string;
  /** how the fare is set each month (undefined = the company default) */
  pricing?: PricingMode;
}

/** manual: fixed yen / track: keep the % of the market fare / match: follow rivals / revenue: maximise profit / share: undercut rivals */
export type PricingMode = 'manual' | 'track' | 'match' | 'revenue' | 'share';

export type RouteGroup = 'trunk' | 'local' | 'intl' | 'cargo';

export type CabinLayout = 'mono' | 'two' | 'three';

export interface Loan {
  id: string;
  principalYen: number;
  balanceYen: number;
  annualRate: number;
  monthlyPaymentYen: number;
  startYM: YM;
  endYM: YM;
}

export interface PilotPool {
  /** pilots rated on this type and available */
  rated: number;
  /** trainees: count and the month they become rated */
  training: { count: number; readyYM: YM }[];
}

export interface UsedListing {
  id: string;
  typeId: string;
  builtYear: number;
  condition: number;
  totalHours: number;
  priceYen: number;
  expiresYM: YM;
}

export type MaintLevel = 'low' | 'standard' | 'high';

export interface RouteResult {
  routeId: string;
  /** share of flights arriving within 15 minutes */
  onTime: number;
  cancelled: number;
  flights: number;
  seats: number;
  pax: number;
  demand: number;
  marketDemand: number;
  share: number;
  revenue: number;
  cost: number;
  /** tonnes carried (both directions) and cargo revenue (included in revenue) */
  cargoT?: number;
  cargoRevenue?: number;
  cargoMarketT?: number;
  premiumPax?: number;
}

export interface MonthCosts {
  fuel: number;
  maintenance: number;
  heavyChecks: number;
  crew: number;
  training: number;
  airport: number;
  ground: number;
  sales: number;
  delays: number;
  bases: number;
  lease: number;
  interest: number;
  overhead: number;
  /** cargo handling */
  cargo?: number;
  insurance?: number;
  /** incident repairs, accident compensation and investigations */
  safety?: number;
  /** fan service: special liveries, events */
  marketing?: number;
}

export interface MonthReport {
  year: number;
  month: number;
  revenue: number;
  costs: MonthCosts;
  profit: number;
  /** cash flows outside the P&L */
  principalRepaid: number;
  deliveriesPaid: number;
  cashEnd: number;
  pax: number;
  onTime: number;
  routes: RouteResult[];
}

export interface NewsItem {
  year: number;
  month: number;
  text: string;
  kind: 'info' | 'good' | 'bad' | 'history';
}

export interface GameState {
  version: 3;
  companyName: string;
  baseAirport: string;
  year: number;
  month: number;
  cash: number;
  reputation: number;
  planes: Plane[];
  routes: Route[];
  loans: Loan[];
  pilots: Record<string, PilotPool>;
  maintLevel: MaintLevel;
  /** airports where crews are based (no hotel cost for night stops) */
  crewBases: string[];
  /** extra turnaround buffer in minutes used by the auto-scheduler */
  bufferMin: number;
  /** operations planning department level 0..3 */
  opsLevel: number;
  /** daily movements (departures + arrivals) we may use at slot-controlled airports */
  slots: Record<string, number>;
  /** company-wide fare policy for routes that don't set their own (default: track) */
  pricingDefault?: PricingMode;
  /** how hard rivals are fighting back on each airport pair (0..1) */
  aiPressure?: Record<string, number>;
  usedMarket: UsedListing[];
  /** experienced pilots hired this month, per type (reset monthly) */
  hiresThisMonth?: Record<string, number>;
  /** costs already paid in cash during the current month (shown in the month's P&L) */
  monthExpenses?: { training?: number; heavyChecks?: number; marketing?: number };
  history: MonthReport[];
  news: NewsItem[];
  negativeCashMonths: number;
  /** alliance the player belongs to */
  alliance?: string | null;
  /** foreign airlines with an individual codeshare agreement */
  codeshares?: string[];
  /** safety record */
  safety?: SafetyRecord;
  difficulty?: 'easy' | 'normal' | 'hard';
  /** multi-stop rotations (e.g. triangle routes) scheduled automatically */
  circuits?: Circuit[];
  /** compact monthly record kept for the whole game (for the statistics tab) */
  stats?: StatPoint[];
  /** two-letter code used in flight numbers */
  flightCode?: string;
  /** year the company was founded (for retro liveries) */
  foundedYear?: number;
  /** company livery */
  livery?: CompanyLivery;
  /** when each premium cabin layout was first offered (acceptance grows from then) */
  cabinSince?: Partial<Record<CabinLayout, number>>;
  /** fan service history */
  fan?: { lastTourYM?: number; farewells: string[] };
  gameOver: boolean;
  nextId: number;
  seed: number;
}

export interface SafetyRecord {
  incidents: number;
  serious: number;
  accidents: number;
  /** passengers stay away until this month after an accident */
  scareUntilYM?: number;
  lastAccidentYM?: number;
}

export interface CompanyLivery {
  body: string;
  stripe: string;
  tail: string;
  /** short text painted on the tail (2-3 characters) */
  logo: string;
  logoColor: string;
}

/** A rotation through several airports that returns to the first, e.g. HND→ITM→FUK→HND */
export interface Circuit {
  id: string;
  stops: string[];
  /** times per week the whole circuit is flown */
  targetWeekly: number;
  typeId: string | null;
  /** cargo circuits use cargo routes and freighters (default: passenger) */
  kind?: 'pax' | 'cargo';
}

/** One month in the long-term statistics */
export interface StatPoint {
  year: number;
  month: number;
  cash: number;
  /** cash + fleet value - debt */
  netWorth: number;
  revenue: number;
  profit: number;
  pax: number;
  cargoT: number;
  fleet: number;
  routes: number;
  reputation: number;
  onTime: number;
}
