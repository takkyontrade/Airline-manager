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

export type PlaneStatus = 'onOrder' | 'active' | 'heavyCheck';

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
  routeId: string | null;
  /** 0..100 */
  condition: number;
  totalHours: number;
  hoursSinceHeavy: number;
  heavyChecks: number;
}

export interface Route {
  id: string;
  from: string;
  to: string;
  weeklyFreq: number;
  fareYen: number;
  openedYear: number;
  openedMonth: number;
}

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
  flights: number;
  seats: number;
  pax: number;
  demand: number;
  marketDemand: number;
  share: number;
  revenue: number;
  cost: number;
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
  lease: number;
  interest: number;
  overhead: number;
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
  routes: RouteResult[];
}

export interface NewsItem {
  year: number;
  month: number;
  text: string;
  kind: 'info' | 'good' | 'bad' | 'history';
}

export interface GameState {
  version: 2;
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
  usedMarket: UsedListing[];
  /** experienced pilots hired this month, per type (reset monthly) */
  hiresThisMonth?: Record<string, number>;
  /** costs already paid in cash during the current month (shown in the month's P&L) */
  monthExpenses?: { training?: number; heavyChecks?: number };
  history: MonthReport[];
  news: NewsItem[];
  negativeCashMonths: number;
  gameOver: boolean;
  nextId: number;
  seed: number;
}
