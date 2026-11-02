// Historical events that shape the game world. Years and effects are
// approximate and simplified for game balance.

/** High-speed rail lines: when a line opens, air demand between airports in its
 * corridor drops. `pairs` lists airport pairs and the remaining air demand share. */
export interface RailOpening {
  year: number;
  month: number;
  name: string;
  pairs: [string, string, number][];
}

export const RAIL_OPENINGS: RailOpening[] = [
  { year: 1964, month: 10, name: '東海道新幹線（東京〜新大阪）', pairs: [['HND', 'ITM', 0.55], ['HND', 'NKM', 0.3], ['NKM', 'ITM', 0.3]] },
  { year: 1972, month: 3, name: '山陽新幹線（新大阪〜岡山）', pairs: [['HND', 'OKJ', 0.75], ['ITM', 'OKJ', 0.3]] },
  { year: 1975, month: 3, name: '山陽新幹線（岡山〜博多）', pairs: [['HND', 'HIJ', 0.7], ['HND', 'FUK', 0.92], ['ITM', 'FUK', 0.6], ['ITM', 'HIJ', 0.3], ['ITM', 'KKJ', 0.5]] },
  { year: 1982, month: 6, name: '東北新幹線（大宮〜盛岡）', pairs: [['HND', 'SDJ', 0.2], ['HND', 'HNA', 0.4], ['HND', 'GAJ', 0.6]] },
  { year: 1982, month: 11, name: '上越新幹線（大宮〜新潟）', pairs: [['HND', 'KIJ', 0.25]] },
  { year: 1992, month: 7, name: '山形新幹線', pairs: [['HND', 'GAJ', 0.6]] },
  { year: 1997, month: 3, name: '秋田新幹線', pairs: [['HND', 'AXT', 0.75]] },
  { year: 2002, month: 12, name: '東北新幹線（盛岡〜八戸）', pairs: [['HND', 'MSJ', 0.6], ['HND', 'AOJ', 0.85]] },
  { year: 2004, month: 3, name: '九州新幹線（新八代〜鹿児島中央）', pairs: [['FUK', 'KOJ', 0.5]] },
  { year: 2010, month: 12, name: '東北新幹線（八戸〜新青森）', pairs: [['HND', 'AOJ', 0.75], ['HND', 'MSJ', 0.8]] },
  { year: 2011, month: 3, name: '九州新幹線（博多〜新八代）', pairs: [['FUK', 'KOJ', 0.4], ['FUK', 'KMJ', 0.3], ['ITM', 'KOJ', 0.85], ['ITM', 'KMJ', 0.8]] },
  { year: 2015, month: 3, name: '北陸新幹線（長野〜金沢）', pairs: [['HND', 'KMQ', 0.55], ['HND', 'TOY', 0.35], ['HND', 'NTQ', 0.9]] },
  { year: 2016, month: 3, name: '北海道新幹線（新青森〜新函館北斗）', pairs: [['HND', 'HKD', 0.92]] },
  { year: 2022, month: 9, name: '西九州新幹線', pairs: [['FUK', 'NGS', 0.8]] },
];

/** Temporary demand shocks or booms. airports: null = nationwide */
export interface DemandEvent {
  from: [number, number];
  to: [number, number];
  airports: string[] | null;
  multiplier: number;
  title: string;
}

export const DEMAND_EVENTS: DemandEvent[] = [
  { from: [1964, 9], to: [1964, 10], airports: ['HND'], multiplier: 1.25, title: '東京オリンピック開催' },
  { from: [1970, 3], to: [1970, 9], airports: ['ITM'], multiplier: 1.35, title: '大阪万博（日本万国博覧会）開催' },
  { from: [1972, 1], to: [1972, 2], airports: ['CTS'], multiplier: 1.3, title: '札幌オリンピック開催' },
  { from: [1974, 1], to: [1974, 12], airports: null, multiplier: 0.9, title: '第一次オイルショックの影響で旅行需要が落ち込む' },
  { from: [1975, 7], to: [1976, 1], airports: ['OKA', 'MMY', 'ISG'], multiplier: 1.4, title: '沖縄国際海洋博覧会開催' },
  { from: [1980, 1], to: [1980, 12], airports: null, multiplier: 0.95, title: '第二次オイルショックの影響' },
  { from: [1985, 9], to: [1986, 6], airports: null, multiplier: 0.93, title: '大きな航空事故の影響で空の旅が敬遠される' },
  { from: [1991, 1], to: [1991, 4], airports: null, multiplier: 0.9, title: '湾岸戦争' },
  { from: [1995, 1], to: [1995, 4], airports: ['ITM', 'KIX'], multiplier: 0.85, title: '阪神・淡路大震災' },
  { from: [1998, 2], to: [1998, 2], airports: ['HND'], multiplier: 1.1, title: '長野オリンピック開催' },
  { from: [2001, 10], to: [2002, 3], airports: null, multiplier: 0.94, title: 'アメリカ同時多発テロの影響' },
  { from: [2003, 4], to: [2003, 7], airports: null, multiplier: 0.95, title: 'SARSの流行' },
  { from: [2008, 10], to: [2009, 12], airports: null, multiplier: 0.9, title: 'リーマン・ショックによる景気後退' },
  { from: [2011, 3], to: [2011, 9], airports: null, multiplier: 0.85, title: '東日本大震災' },
  { from: [2011, 3], to: [2011, 7], airports: ['SDJ'], multiplier: 0.05, title: '震災で仙台空港が被災し閉鎖' },
  { from: [2016, 4], to: [2016, 7], airports: ['KMJ'], multiplier: 0.6, title: '熊本地震' },
  { from: [2018, 9], to: [2018, 10], airports: ['KIX'], multiplier: 0.4, title: '台風で関西空港が浸水' },
  { from: [2018, 9], to: [2018, 10], airports: ['CTS'], multiplier: 0.7, title: '北海道胆振東部地震' },
  { from: [2021, 7], to: [2021, 8], airports: ['HND'], multiplier: 0.9, title: '無観客での東京オリンピック' },
  { from: [2025, 4], to: [2025, 10], airports: ['KIX', 'ITM', 'UKB'], multiplier: 1.15, title: '大阪・関西万博開催' },
];

/** Aircraft types grounded by the authorities */
export interface Grounding { typeId: string; from: [number, number]; to: [number, number]; title: string }
export const GROUNDINGS: Grounding[] = [
  { typeId: 'dc10', from: [1979, 6], to: [1979, 7], title: 'DC-10の耐空証明が一時停止され、全機が運航停止' },
  { typeId: 'b787-8', from: [2013, 1], to: [2013, 5], title: 'バッテリー問題でボーイング787が運航停止' },
  { typeId: 'b787-9', from: [2013, 1], to: [2013, 5], title: 'バッテリー問題でボーイング787が運航停止' },
];

/** Fare regulation: how far fares may deviate from the reference fare */
export function fareBand(year: number): [number, number] | null {
  if (year < 1996) return [0.9, 1.1]; // 認可運賃
  if (year < 2000) return [0.75, 1.25]; // 幅運賃制度
  return null; // 届出制・自由化
}

/** Whether opening a route needs government approval, and the bar */
export function routeLicensing(year: number): { required: boolean; label: string } {
  if (year < 1972) return { required: true, label: '路線の開設には運輸省の免許が必要です（実績と評判で判断）' };
  if (year < 1986) return { required: true, label: '「45・47体制」で幹線への新規参入が制限されています' };
  if (year < 2000) return { required: true, label: 'ダブル・トリプルトラック化で参入が緩和されつつあります' };
  return { required: false, label: '路線の開設は自由です（届出制）' };
}

/** Plain news items with no game effect, for flavour */
export const HISTORY_NEWS: { year: number; month: number; text: string }[] = [
  { year: 1964, month: 4, text: '海外旅行が自由化されました。' },
  { year: 1966, month: 2, text: '羽田沖で旅客機の事故が相次ぎ、航空安全への関心が高まっています。' },
  { year: 1970, month: 3, text: '「ジャンボジェット」ボーイング747が日本の空に登場しました。' },
  { year: 1971, month: 5, text: 'ローカル線の2社が合併し、新しい国内航空会社が生まれました。' },
  { year: 1972, month: 5, text: '沖縄が本土に復帰し、那覇などへの路線が国内線になりました。' },
  { year: 1978, month: 5, text: '新東京国際空港（成田）が開港しました。' },
  { year: 1986, month: 6, text: '航空憲法（45・47体制）が廃止され、国内線の競争が始まります。' },
  { year: 1994, month: 9, text: '24時間空港の関西国際空港が開港しました。' },
  { year: 1998, month: 9, text: '35年ぶりの新規航空会社が羽田〜福岡線に参入しました。' },
  { year: 2000, month: 2, text: '改正航空法が施行され、運賃と路線の設定が自由化されました。' },
  { year: 2005, month: 2, text: '中部国際空港が開港し、名古屋の空の玄関が移りました。' },
  { year: 2010, month: 10, text: '羽田空港の4本目の滑走路が完成し、発着枠が大きく増えました。' },
  { year: 2012, month: 3, text: '日本初の本格的な格安航空会社（LCC）が就航しました。' },
  { year: 2020, month: 4, text: '新型コロナウイルスの流行で、旅客需要が激減しています。' },
];
