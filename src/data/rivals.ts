// Fictional rival airlines. Each is loosely modelled on a type of real carrier
// (flag carrier, domestic major, local carrier, new entrant, LCC) but names,
// details and behaviour are invented for the game.

export type RivalRole = 'flag' | 'major' | 'local' | 'okinawa' | 'entrant' | 'lcc' | 'foreign';

export interface Rival {
  id: string;
  name: string;
  short: string;
  color: string;
  role: RivalRole;
  from: number; // year it starts flying
  until?: number; // year it disappears (merger etc.)
  fareMul: number; // fares relative to the market reference
  comfortMul: number;
  /** foreign airlines: home country (matches Airport.country) */
  country?: string;
  /** entrants and LCCs only fly these pairs, each from a given year */
  routes?: [string, string, number][];
}

export const RIVALS: Rival[] = [
  { id: 'JIA', name: '日本国際航空', short: 'JIA', color: '#e05252', role: 'flag', from: 1951, fareMul: 1.0, comfortMul: 1.05 },
  { id: 'YMT', name: '大和航空', short: 'YMT', color: '#3f7fe0', role: 'major', from: 1952, fareMul: 1.0, comfortMul: 1.0 },
  { id: 'JRA', name: '日本列島航空', short: 'JRA', color: '#2fb380', role: 'local', from: 1960, until: 2004, fareMul: 0.97, comfortMul: 0.95 },
  { id: 'NSA', name: '南星航空', short: 'NSA', color: '#f0a030', role: 'okinawa', from: 1972, fareMul: 1.0, comfortMul: 0.95 },
  {
    id: 'SKF', name: 'スカイフロント', short: 'SKF', color: '#9b6be0', role: 'entrant', from: 1998, fareMul: 0.72, comfortMul: 0.95,
    routes: [['HND', 'FUK', 1998], ['HND', 'KOJ', 2005], ['HND', 'CTS', 2006], ['HND', 'OKA', 2006], ['HND', 'KMJ', 2009], ['KIX', 'CTS', 2011], ['UKB', 'HND', 2006], ['UKB', 'OKA', 2006]],
  },
  {
    id: 'KTW', name: '北の翼エア', short: 'KTW', color: '#4fc3e8', role: 'entrant', from: 1998, fareMul: 0.82, comfortMul: 1.0,
    routes: [['HND', 'CTS', 1998], ['HND', 'AKJ', 2003], ['HND', 'HKD', 2005], ['HND', 'KUH', 2007], ['HND', 'OBO', 2007], ['HND', 'MMB', 2007]],
  },
  {
    id: 'SLK', name: 'ソラリンク九州', short: 'SLK', color: '#7cc576', role: 'entrant', from: 2002, fareMul: 0.82, comfortMul: 1.0,
    routes: [['HND', 'KMI', 2002], ['HND', 'KMJ', 2003], ['HND', 'NGS', 2004], ['HND', 'OIT', 2007], ['HND', 'KOJ', 2011], ['NGO', 'OKA', 2011], ['OKA', 'KOJ', 2014]],
  },
  {
    id: 'BSA', name: 'ブラックスター航空', short: 'BSA', color: '#555c66', role: 'entrant', from: 2006, fareMul: 0.88, comfortMul: 1.15,
    routes: [['HND', 'KKJ', 2006], ['ITM', 'KKJ', 2006], ['HND', 'FUK', 2011], ['HND', 'UBJ', 2014], ['NGO', 'FUK', 2015]],
  },
  {
    id: 'HRK', name: 'ハルカゼ', short: 'HRK', color: '#e872b0', role: 'lcc', from: 2012, fareMul: 0.55, comfortMul: 0.85,
    routes: [['KIX', 'CTS', 2012], ['KIX', 'FUK', 2012], ['KIX', 'NGS', 2012], ['KIX', 'KOJ', 2012], ['KIX', 'OKA', 2012], ['KIX', 'ISG', 2014], ['NRT', 'CTS', 2017], ['NRT', 'FUK', 2017], ['NRT', 'OKA', 2018], ['KIX', 'SDJ', 2013], ['KIX', 'KMI', 2016]],
  },
  {
    id: 'TBM', name: 'ツバメエア', short: 'TBM', color: '#ff9a3c', role: 'lcc', from: 2012, fareMul: 0.58, comfortMul: 0.85,
    routes: [['NRT', 'CTS', 2012], ['NRT', 'FUK', 2012], ['NRT', 'OKA', 2012], ['NRT', 'KIX', 2012], ['NRT', 'KMJ', 2014], ['NRT', 'KOJ', 2014], ['NRT', 'MYJ', 2014], ['NRT', 'TAK', 2014], ['NGO', 'CTS', 2012], ['NGO', 'FUK', 2012], ['KIX', 'CTS', 2013], ['KIX', 'OKA', 2013], ['NRT', 'SYO', 2022]],
  },
  // 海外の航空会社（日本との路線を飛ぶ）
  { id: 'HBK', name: 'ハンビッ航空', short: 'HBK', color: '#5aa0d0', role: 'foreign', country: '韓国', from: 1962, fareMul: 0.92, comfortMul: 1.0 },
  { id: 'FMS', name: 'フォルモサ・スカイ', short: 'FMS', color: '#c06090', role: 'foreign', country: '台湾', from: 1960, fareMul: 0.92, comfortMul: 1.0 },
  { id: 'HKX', name: '香江エアウェイズ', short: 'HKX', color: '#3fae9a', role: 'foreign', country: '香港', from: 1960, fareMul: 1.0, comfortMul: 1.1 },
  { id: 'TQA', name: '天穹航空', short: 'TQA', color: '#d0503a', role: 'foreign', country: '中国', from: 1974, fareMul: 0.9, comfortMul: 0.95 },
  { id: 'LZN', name: 'ルソン航空', short: 'LZN', color: '#3a60c0', role: 'foreign', country: 'フィリピン', from: 1960, fareMul: 0.9, comfortMul: 0.95 },
  { id: 'SLT', name: 'シャム・ロータス航空', short: 'SLT', color: '#a060d0', role: 'foreign', country: 'タイ', from: 1960, fareMul: 0.95, comfortMul: 1.05 },
  { id: 'MLN', name: 'マーライオン航空', short: 'MLN', color: '#e0a040', role: 'foreign', country: 'シンガポール', from: 1960, fareMul: 1.0, comfortMul: 1.15 },
  { id: 'MLK', name: 'マラッカ航空', short: 'MLK', color: '#5070b0', role: 'foreign', country: 'マレーシア', from: 1965, fareMul: 0.92, comfortMul: 1.0 },
  { id: 'IDN', name: 'ヌサンタラ航空', short: 'IDN', color: '#4a9a8a', role: 'foreign', country: 'インドネシア', from: 1962, fareMul: 0.92, comfortMul: 1.0 },
  { id: 'MKG', name: 'メコン航空', short: 'MKG', color: '#40a0b0', role: 'foreign', country: 'ベトナム', from: 1994, fareMul: 0.9, comfortMul: 1.0 },
  { id: 'LBP', name: 'リバティ・パシフィック航空', short: 'LBP', color: '#3050a0', role: 'foreign', country: 'アメリカ', from: 1960, fareMul: 1.0, comfortMul: 1.0 },
  { id: 'MPL', name: 'メープル・エア', short: 'MPL', color: '#d04040', role: 'foreign', country: 'カナダ', from: 1960, fareMul: 0.98, comfortMul: 1.0 },
  { id: 'SCX', name: 'サザンクロス航空', short: 'SCX', color: '#e05030', role: 'foreign', country: 'オーストラリア', from: 1960, fareMul: 1.0, comfortMul: 1.05 },
  { id: 'BRC', name: 'ブリタニア・クラウン航空', short: 'BRC', color: '#304080', role: 'foreign', country: 'イギリス', from: 1960, fareMul: 1.05, comfortMul: 1.05 },
  { id: 'LUM', name: 'エール・リュミエール', short: 'LUM', color: '#2040a0', role: 'foreign', country: 'フランス', from: 1960, fareMul: 1.05, comfortMul: 1.05 },
  { id: 'NST', name: 'ノルトシュテルン航空', short: 'NST', color: '#e0b020', role: 'foreign', country: 'ドイツ', from: 1960, fareMul: 1.05, comfortMul: 1.05 },
  { id: 'DWG', name: 'ダッチ・ウイング', short: 'DWG', color: '#30a0e0', role: 'foreign', country: 'オランダ', from: 1960, fareMul: 1.0, comfortMul: 1.0 },
  { id: 'TVR', name: 'テヴェレ航空', short: 'TVR', color: '#30a050', role: 'foreign', country: 'イタリア', from: 1961, fareMul: 1.0, comfortMul: 1.0 },
  { id: 'VST', name: 'アエロ・ボストーク', short: 'VST', color: '#b03030', role: 'foreign', country: 'ソ連・ロシア', from: 1967, fareMul: 0.8, comfortMul: 0.85 },
];

export const RIVAL_BY_ID: Record<string, Rival> = Object.fromEntries(RIVALS.map((r) => [r.id, r]));

/** Company-level events for rivals */
export const RIVAL_EVENTS: { year: number; month: number; rival: string; text: string; capacityMul?: [number, number] }[] = [
  { year: 1971, month: 5, rival: 'JRA', text: '日本列島航空がローカル線の2社合併で発足し、地方路線を拡大しています。' },
  { year: 1985, month: 8, rival: 'JIA', text: '日本国際航空で大きな事故が起き、利用者離れが起きています。', capacityMul: [1985, 1986] },
  { year: 2002, month: 10, rival: 'JRA', text: '日本列島航空が日本国際航空と経営統合しました。路線は2004年までに統合されます。' },
  { year: 2010, month: 1, rival: 'JIA', text: '日本国際航空が経営破綻しました。不採算路線から撤退し、羽田の発着枠が再配分されます。', capacityMul: [2010, 2013] },
  { year: 2015, month: 1, rival: 'SKF', text: 'スカイフロントが経営破綻しましたが、再建して運航は続けています。' },
];
