// Historical economic indices (approximate, for game balance).
// Values are anchor points; years in between are linearly interpolated.
// TODO(stage 4): verify against public statistics and refine.

type Anchors = [year: number, value: number][];

function interp(anchors: Anchors, t: number): number {
  if (t <= anchors[0][0]) return anchors[0][1];
  const last = anchors[anchors.length - 1];
  if (t >= last[0]) return last[1];
  for (let i = 1; i < anchors.length; i++) {
    const [y1, v1] = anchors[i];
    if (t <= y1) {
      const [y0, v0] = anchors[i - 1];
      return v0 + ((v1 - v0) * (t - y0)) / (y1 - y0);
    }
  }
  return last[1];
}

/** Fractional year, e.g. 1960 + (month-1)/12 */
export const yearFrac = (year: number, month: number) => year + (month - 1) / 12;

// Japan consumer price index, 1960 = 1
const JP_CPI: Anchors = [
  [1960, 1], [1965, 1.3], [1970, 1.7], [1973, 2.1], [1975, 2.9], [1980, 3.9],
  [1985, 4.4], [1990, 4.7], [1995, 5.0], [2000, 5.1], [2010, 4.9], [2014, 5.0],
  [2020, 5.1], [2023, 5.4], [2027, 5.7],
];

// Japan wage index, 1960 = 1 (nominal)
const JP_WAGE: Anchors = [
  [1960, 1], [1965, 1.6], [1970, 2.8], [1975, 5.5], [1980, 7.8], [1985, 9.3],
  [1990, 11], [1997, 12.6], [2005, 12.2], [2015, 12.0], [2020, 12.3], [2027, 13.4],
];

// US consumer price index, 1960 = 1 (aircraft prices, maintenance in USD)
const US_CPI: Anchors = [
  [1960, 1], [1965, 1.06], [1970, 1.31], [1975, 1.81], [1980, 2.79], [1985, 3.6],
  [1990, 4.38], [1995, 5.1], [2000, 5.79], [2005, 6.5], [2010, 7.3], [2015, 8.0],
  [2020, 8.7], [2022, 9.8], [2027, 11.0],
];

// JPY per USD
const JPY_USD: Anchors = [
  [1960, 360], [1971.6, 360], [1972, 308], [1973.2, 270], [1975, 297], [1978, 210],
  [1980, 227], [1985.6, 240], [1986, 170], [1988, 128], [1990, 145], [1995, 94],
  [1998, 131], [2000, 108], [2007, 118], [2011, 80], [2013, 98], [2015, 121],
  [2020, 107], [2022, 131], [2024, 151], [2027, 148],
];

// Jet fuel / kerosene price, USD per US gallon
const FUEL_USD_GAL: Anchors = [
  [1960, 0.11], [1970, 0.11], [1973.8, 0.12], [1974.2, 0.30], [1979, 0.45],
  [1980, 0.85], [1985, 0.80], [1986.3, 0.45], [1990, 0.60], [1990.8, 1.10],
  [1991.3, 0.60], [1998, 0.45], [2000, 0.85], [2005, 1.70], [2008.5, 3.80],
  [2009, 1.60], [2011, 3.00], [2014.5, 2.90], [2015.5, 1.60], [2019, 1.95],
  [2020.3, 0.85], [2021, 1.60], [2022.4, 3.80], [2023, 2.70], [2027, 2.40],
];

// Domestic air-travel propensity, 1960 = 1. Captures income growth and
// the shift from rail/sea to air (Japan domestic pax ~1M in 1960 -> ~100M in 2019).
const AIR_PROPENSITY: Anchors = [
  [1960, 1], [1965, 3.2], [1970, 9], [1975, 15], [1980, 22], [1985, 24],
  [1990, 34], [1995, 40], [2000, 46], [2005, 46], [2010, 40], [2015, 46],
  [2019, 50], [2020.2, 50], [2020.4, 15], [2021, 22], [2022, 38], [2023, 47],
  [2027, 51],
];

export const econ = {
  jpCpi: (t: number) => interp(JP_CPI, t),
  jpWage: (t: number) => interp(JP_WAGE, t),
  usCpi: (t: number) => interp(US_CPI, t),
  jpyPerUsd: (t: number) => interp(JPY_USD, t),
  fuelUsdPerGal: (t: number) => interp(FUEL_USD_GAL, t),
  airPropensity: (t: number) => interp(AIR_PROPENSITY, t),
};

// Monthly seasonality of Japanese domestic travel (Jan..Dec)
export const SEASONALITY = [0.9, 0.82, 1.02, 0.98, 1.0, 0.9, 1.05, 1.3, 1.0, 1.0, 0.98, 1.05];
