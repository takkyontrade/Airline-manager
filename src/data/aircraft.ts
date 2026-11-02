// Aircraft types. Real type names, approximate performance and prices for
// game balance. Prices are new-build list prices in USD of the intro year.
// TODO(stage 2/4): engine/variant options, delivery lead times, full 1960-2027
// catalogue, freighter conversions — verify figures against public sources.

export type Propulsion = 'piston' | 'turboprop' | 'jet';
export type Silhouette = 'twinProp' | 'quadProp' | 'narrowJet' | 'tJet' | 'triJet' | 'quadJet' | 'wideTwin' | 'wideTri' | 'jumbo' | 'regionalJet';

export interface AircraftType {
  id: string;
  name: string; // 表示名（実在の機種名）
  maker: string;
  propulsion: Propulsion;
  silhouette: Silhouette;
  introYear: number; // 新造機が買えるようになる年
  endYear: number; // 新造機の販売終了年
  seats: number; // 標準的な1クラス座席数
  rangeKm: number;
  speedKmh: number; // 巡航速度
  fuelKgH: number; // 1時間あたり燃料消費
  priceMUsd: number; // 新造価格（百万ドル, 発売年の価格）
  minRunwayM: number; // 必要滑走路長
  cockpitCrew: number;
  cabinCrew: number;
  maintUsdH: number; // 1時間あたり整備費（1960年のドル換算）
  comfort: number; // 快適さ 0.6〜1.2
}

export const AIRCRAFT_TYPES: AircraftType[] = [
  { id: 'dc3', name: 'DC-3', maker: 'ダグラス', propulsion: 'piston', silhouette: 'twinProp', introYear: 1936, endYear: 1946, seats: 30, rangeKm: 2000, speedKmh: 280, fuelKgH: 300, priceMUsd: 0.35, minRunwayM: 1000, cockpitCrew: 2, cabinCrew: 1, maintUsdH: 38, comfort: 0.6 },
  { id: 'cv440', name: 'コンベア440', maker: 'コンベア', propulsion: 'piston', silhouette: 'twinProp', introYear: 1956, endYear: 1962, seats: 44, rangeKm: 2000, speedKmh: 450, fuelKgH: 650, priceMUsd: 0.6, minRunwayM: 1300, cockpitCrew: 2, cabinCrew: 2, maintUsdH: 72, comfort: 0.75 },
  { id: 'dc6b', name: 'DC-6B', maker: 'ダグラス', propulsion: 'piston', silhouette: 'quadProp', introYear: 1951, endYear: 1962, seats: 80, rangeKm: 4800, speedKmh: 500, fuelKgH: 1100, priceMUsd: 1.1, minRunwayM: 1600, cockpitCrew: 3, cabinCrew: 3, maintUsdH: 127, comfort: 0.8 },
  { id: 'dc7c', name: 'DC-7C', maker: 'ダグラス', propulsion: 'piston', silhouette: 'quadProp', introYear: 1956, endYear: 1962, seats: 90, rangeKm: 7400, speedKmh: 550, fuelKgH: 1400, priceMUsd: 1.9, minRunwayM: 1800, cockpitCrew: 3, cabinCrew: 3, maintUsdH: 165, comfort: 0.85 },
  { id: 'v828', name: 'バイカウント800', maker: 'ヴィッカース', propulsion: 'turboprop', silhouette: 'quadProp', introYear: 1957, endYear: 1964, seats: 60, rangeKm: 2200, speedKmh: 520, fuelKgH: 750, priceMUsd: 1.0, minRunwayM: 1500, cockpitCrew: 2, cabinCrew: 2, maintUsdH: 110, comfort: 0.9 },
  { id: 'f27', name: 'F27フレンドシップ', maker: 'フォッカー', propulsion: 'turboprop', silhouette: 'twinProp', introYear: 1958, endYear: 1987, seats: 44, rangeKm: 1900, speedKmh: 460, fuelKgH: 500, priceMUsd: 0.75, minRunwayM: 1100, cockpitCrew: 2, cabinCrew: 1, maintUsdH: 77, comfort: 0.85 },
  { id: 'l188', name: 'L-188エレクトラ', maker: 'ロッキード', propulsion: 'turboprop', silhouette: 'quadProp', introYear: 1959, endYear: 1961, seats: 90, rangeKm: 3500, speedKmh: 600, fuelKgH: 1500, priceMUsd: 2.3, minRunwayM: 1500, cockpitCrew: 3, cabinCrew: 3, maintUsdH: 165, comfort: 0.9 },
  { id: 'ys11', name: 'YS-11', maker: '日本航空機製造', propulsion: 'turboprop', silhouette: 'twinProp', introYear: 1965, endYear: 1974, seats: 60, rangeKm: 1600, speedKmh: 470, fuelKgH: 650, priceMUsd: 1.0, minRunwayM: 1200, cockpitCrew: 2, cabinCrew: 2, maintUsdH: 88, comfort: 0.9 },
  { id: 'cv880', name: 'コンベア880', maker: 'コンベア', propulsion: 'jet', silhouette: 'quadJet', introYear: 1960, endYear: 1962, seats: 110, rangeKm: 4500, speedKmh: 880, fuelKgH: 6000, priceMUsd: 4.5, minRunwayM: 2400, cockpitCrew: 3, cabinCrew: 4, maintUsdH: 330, comfort: 1.0 },
  { id: 'dc8', name: 'DC-8', maker: 'ダグラス', propulsion: 'jet', silhouette: 'quadJet', introYear: 1959, endYear: 1972, seats: 140, rangeKm: 7500, speedKmh: 870, fuelKgH: 6500, priceMUsd: 5.5, minRunwayM: 2600, cockpitCrew: 3, cabinCrew: 5, maintUsdH: 358, comfort: 1.0 },
  { id: 'b707', name: 'ボーイング707-320', maker: 'ボーイング', propulsion: 'jet', silhouette: 'quadJet', introYear: 1959, endYear: 1979, seats: 150, rangeKm: 8000, speedKmh: 880, fuelKgH: 6800, priceMUsd: 5.5, minRunwayM: 2700, cockpitCrew: 3, cabinCrew: 5, maintUsdH: 358, comfort: 1.0 },
  { id: 'b727', name: 'ボーイング727-100', maker: 'ボーイング', propulsion: 'jet', silhouette: 'triJet', introYear: 1964, endYear: 1972, seats: 120, rangeKm: 3500, speedKmh: 870, fuelKgH: 4200, priceMUsd: 4.5, minRunwayM: 1800, cockpitCrew: 3, cabinCrew: 4, maintUsdH: 264, comfort: 1.0 },
  { id: 'b727-200', name: 'ボーイング727-200', maker: 'ボーイング', propulsion: 'jet', silhouette: 'triJet', introYear: 1967, endYear: 1984, seats: 145, rangeKm: 3700, speedKmh: 870, fuelKgH: 4600, priceMUsd: 5.0, minRunwayM: 2000, cockpitCrew: 3, cabinCrew: 4, maintUsdH: 275, comfort: 1.0 },
  { id: 'dc9', name: 'DC-9-30', maker: 'ダグラス', propulsion: 'jet', silhouette: 'tJet', introYear: 1967, endYear: 1982, seats: 105, rangeKm: 2500, speedKmh: 820, fuelKgH: 3000, priceMUsd: 3.5, minRunwayM: 1800, cockpitCrew: 2, cabinCrew: 3, maintUsdH: 209, comfort: 1.0 },
  { id: 'b737-200', name: 'ボーイング737-200', maker: 'ボーイング', propulsion: 'jet', silhouette: 'narrowJet', introYear: 1968, endYear: 1988, seats: 115, rangeKm: 3500, speedKmh: 780, fuelKgH: 2800, priceMUsd: 3.7, minRunwayM: 1800, cockpitCrew: 2, cabinCrew: 3, maintUsdH: 198, comfort: 1.0 },
  { id: 'b747-100', name: 'ボーイング747-100', maker: 'ボーイング', propulsion: 'jet', silhouette: 'jumbo', introYear: 1970, endYear: 1986, seats: 380, rangeKm: 9000, speedKmh: 900, fuelKgH: 13000, priceMUsd: 21, minRunwayM: 3000, cockpitCrew: 3, cabinCrew: 12, maintUsdH: 825, comfort: 1.1 },
  { id: 'b747sr', name: 'ボーイング747SR', maker: 'ボーイング', propulsion: 'jet', silhouette: 'jumbo', introYear: 1973, endYear: 1986, seats: 498, rangeKm: 3700, speedKmh: 900, fuelKgH: 12500, priceMUsd: 22, minRunwayM: 2500, cockpitCrew: 3, cabinCrew: 14, maintUsdH: 825, comfort: 1.05 },
  { id: 'dc10', name: 'DC-10-40', maker: 'マクドネル・ダグラス', propulsion: 'jet', silhouette: 'wideTri', introYear: 1972, endYear: 1988, seats: 270, rangeKm: 9000, speedKmh: 900, fuelKgH: 8500, priceMUsd: 18, minRunwayM: 2800, cockpitCrew: 3, cabinCrew: 9, maintUsdH: 605, comfort: 1.1 },
  { id: 'l1011', name: 'L-1011トライスター', maker: 'ロッキード', propulsion: 'jet', silhouette: 'wideTri', introYear: 1972, endYear: 1984, seats: 300, rangeKm: 5000, speedKmh: 900, fuelKgH: 8000, priceMUsd: 17, minRunwayM: 2500, cockpitCrew: 3, cabinCrew: 10, maintUsdH: 605, comfort: 1.1 },
  { id: 'a300', name: 'エアバスA300B4', maker: 'エアバス', propulsion: 'jet', silhouette: 'wideTwin', introYear: 1974, endYear: 1984, seats: 250, rangeKm: 4500, speedKmh: 850, fuelKgH: 6000, priceMUsd: 16, minRunwayM: 2300, cockpitCrew: 3, cabinCrew: 8, maintUsdH: 495, comfort: 1.1 },
  { id: 'md81', name: 'MD-81', maker: 'マクドネル・ダグラス', propulsion: 'jet', silhouette: 'tJet', introYear: 1980, endYear: 1999, seats: 150, rangeKm: 3000, speedKmh: 810, fuelKgH: 2900, priceMUsd: 20, minRunwayM: 2100, cockpitCrew: 2, cabinCrew: 4, maintUsdH: 209, comfort: 1.05 },
  { id: 'b767-200', name: 'ボーイング767-200', maker: 'ボーイング', propulsion: 'jet', silhouette: 'wideTwin', introYear: 1982, endYear: 1994, seats: 234, rangeKm: 7000, speedKmh: 850, fuelKgH: 4800, priceMUsd: 40, minRunwayM: 2000, cockpitCrew: 2, cabinCrew: 7, maintUsdH: 385, comfort: 1.1 },
  { id: 'b737-300', name: 'ボーイング737-300', maker: 'ボーイング', propulsion: 'jet', silhouette: 'narrowJet', introYear: 1984, endYear: 1999, seats: 140, rangeKm: 4200, speedKmh: 790, fuelKgH: 2600, priceMUsd: 25, minRunwayM: 1900, cockpitCrew: 2, cabinCrew: 4, maintUsdH: 182, comfort: 1.05 },
  { id: 'b767-300', name: 'ボーイング767-300', maker: 'ボーイング', propulsion: 'jet', silhouette: 'wideTwin', introYear: 1986, endYear: 2027, seats: 270, rangeKm: 7200, speedKmh: 850, fuelKgH: 5000, priceMUsd: 50, minRunwayM: 2300, cockpitCrew: 2, cabinCrew: 8, maintUsdH: 396, comfort: 1.1 },
  { id: 'a320', name: 'エアバスA320', maker: 'エアバス', propulsion: 'jet', silhouette: 'narrowJet', introYear: 1988, endYear: 2027, seats: 166, rangeKm: 5500, speedKmh: 830, fuelKgH: 2500, priceMUsd: 32, minRunwayM: 2000, cockpitCrew: 2, cabinCrew: 4, maintUsdH: 182, comfort: 1.1 },
  { id: 'b747-400d', name: 'ボーイング747-400D', maker: 'ボーイング', propulsion: 'jet', silhouette: 'jumbo', introYear: 1992, endYear: 1995, seats: 568, rangeKm: 3500, speedKmh: 910, fuelKgH: 11000, priceMUsd: 140, minRunwayM: 2500, cockpitCrew: 2, cabinCrew: 15, maintUsdH: 770, comfort: 1.1 },
  { id: 'b777-200', name: 'ボーイング777-200', maker: 'ボーイング', propulsion: 'jet', silhouette: 'wideTwin', introYear: 1995, endYear: 2007, seats: 380, rangeKm: 9700, speedKmh: 900, fuelKgH: 6800, priceMUsd: 120, minRunwayM: 2500, cockpitCrew: 2, cabinCrew: 10, maintUsdH: 330, comfort: 1.15 },
  { id: 'dhc8-400', name: 'DHC-8-400', maker: 'ボンバルディア', propulsion: 'turboprop', silhouette: 'twinProp', introYear: 2000, endYear: 2027, seats: 74, rangeKm: 2000, speedKmh: 660, fuelKgH: 800, priceMUsd: 17, minRunwayM: 1300, cockpitCrew: 2, cabinCrew: 2, maintUsdH: 99, comfort: 1.0 },
  { id: 'b737-800', name: 'ボーイング737-800', maker: 'ボーイング', propulsion: 'jet', silhouette: 'narrowJet', introYear: 1998, endYear: 2020, seats: 170, rangeKm: 5400, speedKmh: 840, fuelKgH: 2500, priceMUsd: 52, minRunwayM: 2000, cockpitCrew: 2, cabinCrew: 4, maintUsdH: 176, comfort: 1.1 },
  { id: 'e170', name: 'エンブラエル170', maker: 'エンブラエル', propulsion: 'jet', silhouette: 'regionalJet', introYear: 2004, endYear: 2027, seats: 76, rangeKm: 3700, speedKmh: 830, fuelKgH: 1700, priceMUsd: 28, minRunwayM: 1700, cockpitCrew: 2, cabinCrew: 2, maintUsdH: 138, comfort: 1.1 },
  { id: 'b787-8', name: 'ボーイング787-8', maker: 'ボーイング', propulsion: 'jet', silhouette: 'wideTwin', introYear: 2011, endYear: 2027, seats: 300, rangeKm: 13000, speedKmh: 900, fuelKgH: 4900, priceMUsd: 120, minRunwayM: 2500, cockpitCrew: 2, cabinCrew: 8, maintUsdH: 210, comfort: 1.2 },
  { id: 'a320neo', name: 'エアバスA320neo', maker: 'エアバス', propulsion: 'jet', silhouette: 'narrowJet', introYear: 2016, endYear: 2027, seats: 166, rangeKm: 6300, speedKmh: 830, fuelKgH: 2100, priceMUsd: 52, minRunwayM: 2000, cockpitCrew: 2, cabinCrew: 4, maintUsdH: 176, comfort: 1.15 },
  { id: 'a350-900', name: 'エアバスA350-900', maker: 'エアバス', propulsion: 'jet', silhouette: 'wideTwin', introYear: 2015, endYear: 2027, seats: 369, rangeKm: 15000, speedKmh: 900, fuelKgH: 5800, priceMUsd: 155, minRunwayM: 2600, cockpitCrew: 2, cabinCrew: 10, maintUsdH: 250, comfort: 1.2 },
  { id: 'bn2', name: 'BN-2アイランダー', maker: 'ブリテン・ノーマン', propulsion: 'piston', silhouette: 'twinProp', introYear: 1967, endYear: 2027, seats: 9, rangeKm: 1100, speedKmh: 250, fuelKgH: 110, priceMUsd: 0.12, minRunwayM: 500, cockpitCrew: 1, cabinCrew: 0, maintUsdH: 12, comfort: 0.6 },
  { id: 'do228', name: 'Do 228', maker: 'ドルニエ', propulsion: 'turboprop', silhouette: 'twinProp', introYear: 1982, endYear: 2027, seats: 19, rangeKm: 1100, speedKmh: 400, fuelKgH: 300, priceMUsd: 2.5, minRunwayM: 800, cockpitCrew: 2, cabinCrew: 0, maintUsdH: 30, comfort: 0.75 },
  { id: 'b747-200b', name: 'ボーイング747-200B', maker: 'ボーイング', propulsion: 'jet', silhouette: 'jumbo', introYear: 1971, endYear: 1990, seats: 400, rangeKm: 12000, speedKmh: 910, fuelKgH: 13500, priceMUsd: 30, minRunwayM: 3100, cockpitCrew: 3, cabinCrew: 13, maintUsdH: 840, comfort: 1.1 },
  { id: 'b747-300', name: 'ボーイング747-300', maker: 'ボーイング', propulsion: 'jet', silhouette: 'jumbo', introYear: 1983, endYear: 1990, seats: 420, rangeKm: 11000, speedKmh: 920, fuelKgH: 13300, priceMUsd: 85, minRunwayM: 3100, cockpitCrew: 3, cabinCrew: 13, maintUsdH: 830, comfort: 1.12 },
  { id: 'b737-500', name: 'ボーイング737-500', maker: 'ボーイング', propulsion: 'jet', silhouette: 'narrowJet', introYear: 1990, endYear: 1999, seats: 126, rangeKm: 4400, speedKmh: 790, fuelKgH: 2400, priceMUsd: 30, minRunwayM: 1800, cockpitCrew: 2, cabinCrew: 3, maintUsdH: 176, comfort: 1.05 },
  { id: 'saab340', name: 'サーブ340', maker: 'サーブ', propulsion: 'turboprop', silhouette: 'twinProp', introYear: 1984, endYear: 1998, seats: 36, rangeKm: 1700, speedKmh: 500, fuelKgH: 450, priceMUsd: 8, minRunwayM: 1300, cockpitCrew: 2, cabinCrew: 1, maintUsdH: 66, comfort: 0.95 },
  { id: 'md87', name: 'MD-87', maker: 'マクドネル・ダグラス', propulsion: 'jet', silhouette: 'tJet', introYear: 1987, endYear: 1999, seats: 130, rangeKm: 4400, speedKmh: 810, fuelKgH: 2700, priceMUsd: 25, minRunwayM: 1900, cockpitCrew: 2, cabinCrew: 3, maintUsdH: 198, comfort: 1.05 },
  { id: 'a300-600r', name: 'エアバスA300-600R', maker: 'エアバス', propulsion: 'jet', silhouette: 'wideTwin', introYear: 1984, endYear: 2002, seats: 290, rangeKm: 7500, speedKmh: 860, fuelKgH: 6200, priceMUsd: 60, minRunwayM: 2400, cockpitCrew: 2, cabinCrew: 9, maintUsdH: 500, comfort: 1.1 },
  { id: 'b767-300er', name: 'ボーイング767-300ER', maker: 'ボーイング', propulsion: 'jet', silhouette: 'wideTwin', introYear: 1988, endYear: 2027, seats: 250, rangeKm: 11000, speedKmh: 860, fuelKgH: 5300, priceMUsd: 60, minRunwayM: 2600, cockpitCrew: 2, cabinCrew: 8, maintUsdH: 300, comfort: 1.12 },
  { id: 'f100', name: 'フォッカー100', maker: 'フォッカー', propulsion: 'jet', silhouette: 'tJet', introYear: 1988, endYear: 1997, seats: 107, rangeKm: 3100, speedKmh: 780, fuelKgH: 2300, priceMUsd: 24, minRunwayM: 1700, cockpitCrew: 2, cabinCrew: 3, maintUsdH: 165, comfort: 1.05 },
  { id: 'dhc8-300', name: 'DHC-8-300', maker: 'デ・ハビランド・カナダ', propulsion: 'turboprop', silhouette: 'twinProp', introYear: 1989, endYear: 2005, seats: 56, rangeKm: 1700, speedKmh: 500, fuelKgH: 650, priceMUsd: 12, minRunwayM: 1200, cockpitCrew: 2, cabinCrew: 2, maintUsdH: 88, comfort: 0.95 },
  { id: 'atr72', name: 'ATR 72', maker: 'ATR', propulsion: 'turboprop', silhouette: 'twinProp', introYear: 1989, endYear: 2027, seats: 70, rangeKm: 1500, speedKmh: 510, fuelKgH: 700, priceMUsd: 14, minRunwayM: 1300, cockpitCrew: 2, cabinCrew: 2, maintUsdH: 90, comfort: 0.95 },
  { id: 'b747-400', name: 'ボーイング747-400', maker: 'ボーイング', propulsion: 'jet', silhouette: 'jumbo', introYear: 1989, endYear: 2009, seats: 416, rangeKm: 13400, speedKmh: 910, fuelKgH: 11500, priceMUsd: 150, minRunwayM: 3000, cockpitCrew: 2, cabinCrew: 14, maintUsdH: 770, comfort: 1.15 },
  { id: 'crj200', name: 'CRJ200', maker: 'ボンバルディア', propulsion: 'jet', silhouette: 'regionalJet', introYear: 1992, endYear: 2006, seats: 50, rangeKm: 3000, speedKmh: 810, fuelKgH: 1400, priceMUsd: 22, minRunwayM: 1800, cockpitCrew: 2, cabinCrew: 1, maintUsdH: 130, comfort: 1.0 },
  { id: 'a321', name: 'エアバスA321', maker: 'エアバス', propulsion: 'jet', silhouette: 'narrowJet', introYear: 1994, endYear: 2020, seats: 194, rangeKm: 5500, speedKmh: 830, fuelKgH: 2900, priceMUsd: 48, minRunwayM: 2200, cockpitCrew: 2, cabinCrew: 5, maintUsdH: 198, comfort: 1.1 },
  { id: 'a330-300', name: 'エアバスA330-300', maker: 'エアバス', propulsion: 'jet', silhouette: 'wideTwin', introYear: 1994, endYear: 2027, seats: 300, rangeKm: 10500, speedKmh: 870, fuelKgH: 5900, priceMUsd: 90, minRunwayM: 2500, cockpitCrew: 2, cabinCrew: 9, maintUsdH: 300, comfort: 1.15 },
  { id: 'md90', name: 'MD-90', maker: 'マクドネル・ダグラス', propulsion: 'jet', silhouette: 'tJet', introYear: 1995, endYear: 2000, seats: 163, rangeKm: 3800, speedKmh: 810, fuelKgH: 2700, priceMUsd: 40, minRunwayM: 2100, cockpitCrew: 2, cabinCrew: 4, maintUsdH: 190, comfort: 1.08 },
  { id: 'b777-200er', name: 'ボーイング777-200ER', maker: 'ボーイング', propulsion: 'jet', silhouette: 'wideTwin', introYear: 1997, endYear: 2013, seats: 312, rangeKm: 14300, speedKmh: 900, fuelKgH: 7200, priceMUsd: 120, minRunwayM: 2900, cockpitCrew: 2, cabinCrew: 10, maintUsdH: 300, comfort: 1.18 },
  { id: 'b777-300', name: 'ボーイング777-300', maker: 'ボーイング', propulsion: 'jet', silhouette: 'wideTwin', introYear: 1998, endYear: 2006, seats: 500, rangeKm: 11000, speedKmh: 900, fuelKgH: 7600, priceMUsd: 130, minRunwayM: 3000, cockpitCrew: 2, cabinCrew: 13, maintUsdH: 340, comfort: 1.15 },
  { id: 'b737-700', name: 'ボーイング737-700', maker: 'ボーイング', propulsion: 'jet', silhouette: 'narrowJet', introYear: 1998, endYear: 2020, seats: 140, rangeKm: 6200, speedKmh: 840, fuelKgH: 2300, priceMUsd: 45, minRunwayM: 1900, cockpitCrew: 2, cabinCrew: 3, maintUsdH: 170, comfort: 1.1 },
  { id: 'b777-300er', name: 'ボーイング777-300ER', maker: 'ボーイング', propulsion: 'jet', silhouette: 'wideTwin', introYear: 2004, endYear: 2027, seats: 330, rangeKm: 14500, speedKmh: 900, fuelKgH: 8000, priceMUsd: 160, minRunwayM: 3100, cockpitCrew: 2, cabinCrew: 11, maintUsdH: 330, comfort: 1.2 },
  { id: 'e190', name: 'エンブラエル190', maker: 'エンブラエル', propulsion: 'jet', silhouette: 'regionalJet', introYear: 2005, endYear: 2027, seats: 95, rangeKm: 4200, speedKmh: 830, fuelKgH: 2000, priceMUsd: 35, minRunwayM: 1700, cockpitCrew: 2, cabinCrew: 3, maintUsdH: 150, comfort: 1.1 },
  { id: 'atr42-600', name: 'ATR 42-600', maker: 'ATR', propulsion: 'turboprop', silhouette: 'twinProp', introYear: 2012, endYear: 2027, seats: 48, rangeKm: 1300, speedKmh: 520, fuelKgH: 550, priceMUsd: 18, minRunwayM: 1100, cockpitCrew: 2, cabinCrew: 1, maintUsdH: 77, comfort: 1.0 },
  { id: 'b787-9', name: 'ボーイング787-9', maker: 'ボーイング', propulsion: 'jet', silhouette: 'wideTwin', introYear: 2014, endYear: 2027, seats: 330, rangeKm: 14000, speedKmh: 900, fuelKgH: 5400, priceMUsd: 145, minRunwayM: 2700, cockpitCrew: 2, cabinCrew: 9, maintUsdH: 230, comfort: 1.2 },
  { id: 'a321neo', name: 'エアバスA321neo', maker: 'エアバス', propulsion: 'jet', silhouette: 'narrowJet', introYear: 2017, endYear: 2027, seats: 194, rangeKm: 7000, speedKmh: 830, fuelKgH: 2500, priceMUsd: 60, minRunwayM: 2200, cockpitCrew: 2, cabinCrew: 5, maintUsdH: 190, comfort: 1.15 },
  { id: 'b737-8', name: 'ボーイング737 MAX 8', maker: 'ボーイング', propulsion: 'jet', silhouette: 'narrowJet', introYear: 2017, endYear: 2027, seats: 170, rangeKm: 6500, speedKmh: 840, fuelKgH: 2100, priceMUsd: 52, minRunwayM: 2100, cockpitCrew: 2, cabinCrew: 4, maintUsdH: 170, comfort: 1.12 },
  { id: 'b787-10', name: 'ボーイング787-10', maker: 'ボーイング', propulsion: 'jet', silhouette: 'wideTwin', introYear: 2019, endYear: 2027, seats: 400, rangeKm: 11900, speedKmh: 900, fuelKgH: 6000, priceMUsd: 160, minRunwayM: 2900, cockpitCrew: 2, cabinCrew: 11, maintUsdH: 250, comfort: 1.2 },
  { id: 'a350-1000', name: 'エアバスA350-1000', maker: 'エアバス', propulsion: 'jet', silhouette: 'wideTwin', introYear: 2018, endYear: 2027, seats: 400, rangeKm: 16000, speedKmh: 900, fuelKgH: 6600, priceMUsd: 180, minRunwayM: 2800, cockpitCrew: 2, cabinCrew: 11, maintUsdH: 270, comfort: 1.22 },
];

export const AIRCRAFT_BY_ID: Record<string, AircraftType> = Object.fromEntries(
  AIRCRAFT_TYPES.map((t) => [t.id, t]),
);
