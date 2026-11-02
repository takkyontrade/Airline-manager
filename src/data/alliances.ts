// Fictional airline alliances. Each takes at most one Japanese airline: if the
// player joins first, the Japanese rival that would have joined stays out.

export interface Alliance {
  id: string;
  name: string;
  color: string;
  from: number; // founded
  /** [rival id, year joined] */
  members: [string, number][];
  /** Japanese rival that joins in that year unless the player is already a member */
  japanese?: [string, number];
}

export const ALLIANCES: Alliance[] = [
  {
    id: 'ARC', name: 'スカイアーチ', color: '#e0b020', from: 1997,
    members: [['NST', 1997], ['MPL', 1997], ['SLT', 1997], ['MLN', 2000], ['SCX', 2003], ['TQA', 2007]],
    japanese: ['YMT', 1999],
  },
  {
    id: 'AUR', name: 'オーロラ・アライアンス', color: '#4fc3e8', from: 1999,
    members: [['LBP', 1999], ['BRC', 1999], ['HKX', 1999], ['LZN', 2005], ['MLK', 2013]],
    japanese: ['JIA', 2007],
  },
  {
    id: 'SKT', name: 'スカイリンク・チーム', color: '#9b6be0', from: 2000,
    members: [['LUM', 2000], ['DWG', 2004], ['HBK', 2000], ['TVR', 2001], ['FMS', 2011], ['MKG', 2010], ['IDN', 2014], ['VST', 2006]],
  },
];

export const ALLIANCE_BY_ID: Record<string, Alliance> = Object.fromEntries(ALLIANCES.map((a) => [a.id, a]));
