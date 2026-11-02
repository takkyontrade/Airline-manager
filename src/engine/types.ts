export type Ownership = 'owned' | 'leased';

export interface Plane {
  id: string;
  typeId: string;
  regNo: string; // 機体記号 (JA....)
  builtYear: number;
  ownership: Ownership;
  /** Monthly lease payment in yen (leased only, fixed at signing) */
  leaseMonthlyYen: number;
  /** Purchase price in yen (owned only) */
  purchaseYen: number;
  acquiredYear: number;
  routeId: string | null;
}

export interface Route {
  id: string;
  from: string; // airport code
  to: string;
  /** Round trips per week chosen by player */
  weeklyFreq: number;
  /** One-way fare in yen */
  fareYen: number;
  openedYear: number;
  openedMonth: number;
}

export interface RouteResult {
  routeId: string;
  flights: number; // one-way departures this month
  seats: number; // one-way seats offered (both directions summed)
  pax: number; // passengers carried (both directions)
  demand: number; // passengers wanting to fly with us (both directions)
  marketDemand: number; // total market (both directions)
  share: number; // our share of attractiveness
  revenue: number;
  cost: number;
}

export interface MonthReport {
  year: number;
  month: number;
  revenue: number;
  costs: {
    fuel: number;
    maintenance: number;
    crew: number;
    airport: number;
    ground: number;
    sales: number;
    lease: number;
    overhead: number;
  };
  profit: number;
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
  version: 1;
  companyName: string;
  baseAirport: string;
  year: number;
  month: number; // 1..12, the month about to be played
  cash: number; // yen
  reputation: number; // 0..100
  planes: Plane[];
  routes: Route[];
  history: MonthReport[];
  news: NewsItem[];
  negativeCashMonths: number;
  gameOver: boolean;
  nextId: number;
  seed: number;
}
