import type { PricingMode } from '../engine/types';

export const PRICING_HELP: Record<PricingMode, string> = {
  manual: '入力した金額のまま変えません。物価が上がると割安になっていきます。',
  track: '相場に対する割合（％）を保ち、物価や為替に合わせて毎月動かします。',
  match: '他社の平均運賃に毎月少しずつ寄せます。',
  revenue: '席数と需要を見て、利益がいちばん大きくなる運賃に毎月少しずつ寄せます。',
  share: 'いちばん安い他社より5%安くします（相場の60%が下限）。',
};
