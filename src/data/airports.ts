// Japanese airports. Coordinates are real; open years, runway lengths and
// catchment populations are approximate values for game balance.
// TODO(stage 4): verify open years / runway history against public sources
// and add runway-extension events, Narita/Kansai/Chubu, airport relocations.

export interface Airport {
  code: string; // IATA
  name: string; // 空港名
  city: string; // 主な都市
  lat: number;
  lon: number;
  openYear: number; // 民間定期便が使えるようになる年（概算）
  runwayM: number; // 開港時（または1960年時点）の滑走路長（概算）
  popM: number; // 後背地人口（百万人, 1960年頃）
  tourism: number; // 観光係数 1 = 普通
  region: string;
}

export const AIRPORTS: Airport[] = [
  // 北海道
  { code: 'CTS', name: '千歳', city: '札幌', lat: 42.775, lon: 141.692, openYear: 1951, runwayM: 2700, popM: 1.6, tourism: 1.3, region: '北海道' },
  { code: 'HKD', name: '函館', city: '函館', lat: 41.770, lon: 140.822, openYear: 1961, runwayM: 1200, popM: 0.5, tourism: 1.4, region: '北海道' },
  { code: 'KUH', name: '釧路', city: '釧路', lat: 43.041, lon: 144.193, openYear: 1961, runwayM: 1200, popM: 0.4, tourism: 1.2, region: '北海道' },
  { code: 'OBO', name: '帯広', city: '帯広', lat: 42.733, lon: 143.217, openYear: 1964, runwayM: 1200, popM: 0.35, tourism: 1.1, region: '北海道' },
  { code: 'MMB', name: '女満別', city: '網走・北見', lat: 43.881, lon: 144.164, openYear: 1963, runwayM: 1200, popM: 0.35, tourism: 1.4, region: '北海道' },
  { code: 'WKJ', name: '稚内', city: '稚内', lat: 45.404, lon: 141.801, openYear: 1960, runwayM: 1200, popM: 0.1, tourism: 1.3, region: '北海道' },
  { code: 'AKJ', name: '旭川', city: '旭川', lat: 43.671, lon: 142.447, openYear: 1966, runwayM: 1200, popM: 0.5, tourism: 1.2, region: '北海道' },
  // 東北
  { code: 'AOJ', name: '青森', city: '青森', lat: 40.735, lon: 140.691, openYear: 1964, runwayM: 1200, popM: 0.6, tourism: 1.0, region: '東北' },
  { code: 'MSJ', name: '三沢', city: '三沢・八戸', lat: 40.703, lon: 141.368, openYear: 1975, runwayM: 3000, popM: 0.5, tourism: 0.9, region: '東北' },
  { code: 'HNA', name: '花巻', city: '盛岡', lat: 39.429, lon: 141.135, openYear: 1964, runwayM: 1200, popM: 0.7, tourism: 1.0, region: '東北' },
  { code: 'AXT', name: '秋田', city: '秋田', lat: 39.616, lon: 140.219, openYear: 1961, runwayM: 1200, popM: 0.7, tourism: 1.0, region: '東北' },
  { code: 'GAJ', name: '山形', city: '山形', lat: 38.412, lon: 140.371, openYear: 1964, runwayM: 1200, popM: 0.7, tourism: 1.0, region: '東北' },
  { code: 'SDJ', name: '仙台', city: '仙台', lat: 38.140, lon: 140.917, openYear: 1957, runwayM: 1200, popM: 1.4, tourism: 1.0, region: '東北' },
  // 関東・甲信越
  { code: 'HND', name: '羽田', city: '東京', lat: 35.553, lon: 139.781, openYear: 1931, runwayM: 2550, popM: 17.0, tourism: 1.1, region: '関東' },
  { code: 'OIM', name: '大島', city: '伊豆大島', lat: 34.782, lon: 139.360, openYear: 1964, runwayM: 1200, popM: 0.02, tourism: 3.0, region: '関東' },
  { code: 'HAC', name: '八丈島', city: '八丈島', lat: 33.115, lon: 139.786, openYear: 1955, runwayM: 1200, popM: 0.02, tourism: 3.0, region: '関東' },
  { code: 'KIJ', name: '新潟', city: '新潟', lat: 37.956, lon: 139.121, openYear: 1958, runwayM: 1300, popM: 1.3, tourism: 1.0, region: '中部' },
  // 中部・北陸
  { code: 'NGO', name: '名古屋（小牧）', city: '名古屋', lat: 35.255, lon: 136.924, openYear: 1952, runwayM: 2740, popM: 5.0, tourism: 0.9, region: '中部' },
  { code: 'KMQ', name: '小松', city: '金沢', lat: 36.394, lon: 136.408, openYear: 1958, runwayM: 2700, popM: 1.0, tourism: 1.1, region: '中部' },
  { code: 'TOY', name: '富山', city: '富山', lat: 36.648, lon: 137.188, openYear: 1963, runwayM: 1200, popM: 0.9, tourism: 0.9, region: '中部' },
  // 近畿
  { code: 'ITM', name: '伊丹', city: '大阪', lat: 34.785, lon: 135.438, openYear: 1959, runwayM: 1830, popM: 10.0, tourism: 1.1, region: '近畿' },
  { code: 'SHM', name: '南紀白浜', city: '白浜', lat: 33.662, lon: 135.364, openYear: 1968, runwayM: 1200, popM: 0.2, tourism: 2.5, region: '近畿' },
  // 中国・四国
  { code: 'OKJ', name: '岡山', city: '岡山', lat: 34.757, lon: 133.855, openYear: 1962, runwayM: 1200, popM: 1.2, tourism: 0.9, region: '中国' },
  { code: 'HIJ', name: '広島', city: '広島', lat: 34.396, lon: 132.475, openYear: 1961, runwayM: 1200, popM: 1.6, tourism: 1.0, region: '中国' },
  { code: 'YGJ', name: '米子', city: '米子・松江', lat: 35.492, lon: 133.236, openYear: 1958, runwayM: 1500, popM: 0.6, tourism: 1.1, region: '中国' },
  { code: 'IZO', name: '出雲', city: '出雲', lat: 35.414, lon: 132.890, openYear: 1966, runwayM: 1200, popM: 0.3, tourism: 1.4, region: '中国' },
  { code: 'UBJ', name: '山口宇部', city: '宇部・山口', lat: 33.930, lon: 131.279, openYear: 1966, runwayM: 1200, popM: 0.7, tourism: 0.9, region: '中国' },
  { code: 'TAK', name: '高松', city: '高松', lat: 34.214, lon: 134.016, openYear: 1958, runwayM: 1200, popM: 0.9, tourism: 1.0, region: '四国' },
  { code: 'TKS', name: '徳島', city: '徳島', lat: 34.133, lon: 134.607, openYear: 1962, runwayM: 1500, popM: 0.8, tourism: 1.0, region: '四国' },
  { code: 'MYJ', name: '松山', city: '松山', lat: 33.827, lon: 132.700, openYear: 1956, runwayM: 1200, popM: 1.0, tourism: 1.2, region: '四国' },
  { code: 'KCZ', name: '高知', city: '高知', lat: 33.546, lon: 133.669, openYear: 1954, runwayM: 1200, popM: 0.8, tourism: 1.2, region: '四国' },
  // 九州
  { code: 'FUK', name: '福岡（板付）', city: '福岡', lat: 33.585, lon: 130.451, openYear: 1951, runwayM: 2800, popM: 3.0, tourism: 1.0, region: '九州' },
  { code: 'KKJ', name: '北九州', city: '北九州', lat: 33.846, lon: 131.035, openYear: 1959, runwayM: 1600, popM: 1.2, tourism: 0.8, region: '九州' },
  { code: 'NGS', name: '長崎（大村）', city: '長崎', lat: 32.917, lon: 129.914, openYear: 1955, runwayM: 1200, popM: 1.2, tourism: 1.5, region: '九州' },
  { code: 'KMJ', name: '熊本', city: '熊本', lat: 32.837, lon: 130.855, openYear: 1960, runwayM: 1200, popM: 1.1, tourism: 1.1, region: '九州' },
  { code: 'OIT', name: '大分', city: '大分・別府', lat: 33.479, lon: 131.737, openYear: 1957, runwayM: 1100, popM: 0.8, tourism: 1.6, region: '九州' },
  { code: 'KMI', name: '宮崎', city: '宮崎', lat: 31.877, lon: 131.449, openYear: 1954, runwayM: 1200, popM: 0.7, tourism: 1.8, region: '九州' },
  { code: 'KOJ', name: '鹿児島', city: '鹿児島', lat: 31.803, lon: 130.719, openYear: 1957, runwayM: 1100, popM: 1.2, tourism: 1.3, region: '九州' },
  { code: 'ASJ', name: '奄美', city: '奄美大島', lat: 28.431, lon: 129.713, openYear: 1964, runwayM: 1200, popM: 0.15, tourism: 2.0, region: '九州' },
  // 沖縄（1972年の本土復帰で国内線化）
  { code: 'OKA', name: '那覇', city: '那覇', lat: 26.196, lon: 127.646, openYear: 1972, runwayM: 3000, popM: 1.0, tourism: 2.2, region: '沖縄' },
  { code: 'ISG', name: '石垣', city: '石垣', lat: 24.345, lon: 124.187, openYear: 1972, runwayM: 1500, popM: 0.05, tourism: 2.8, region: '沖縄' },
  { code: 'MMY', name: '宮古', city: '宮古島', lat: 24.783, lon: 125.295, openYear: 1972, runwayM: 1800, popM: 0.06, tourism: 2.5, region: '沖縄' },
];

export const AIRPORT_BY_CODE: Record<string, Airport> = Object.fromEntries(
  AIRPORTS.map((a) => [a.code, a]),
);

export const isAirportOpen = (a: Airport, year: number) => year >= a.openYear;
