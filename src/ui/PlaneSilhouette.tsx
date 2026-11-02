import type { Silhouette } from '../data/aircraft';

export interface Livery {
  body: string;
  stripe: string;
  tail: string;
  logo?: string;
  logoColor?: string;
  /** special paint schemes for fan service */
  special?: 'special' | 'retro';
}

export const DEFAULT_LIVERY: Livery = { body: '#e9eef5', stripe: '#2f6fd6', tail: '#2f6fd6' };

/** Simple side-view silhouette. Shapes differ by family so types are recognisable. */
export function PlaneSilhouette({ kind, width = 120, livery = DEFAULT_LIVERY }: { kind: Silhouette; width?: number; livery?: Livery }) {
  const wide = kind === 'wideTwin' || kind === 'wideTri' || kind === 'jumbo';
  const len = wide ? 200 : kind === 'regionalJet' || kind === 'twinProp' ? 150 : 180;
  const hgt = wide ? 22 : 16;
  const x0 = (210 - len) / 2;
  const yc = 40;
  const top = yc - hgt / 2;
  const bot = yc + hgt / 2;
  const nose = x0 + len;
  const tTail = kind === 'tJet' || kind === 'triJet';
  const rearEngines = kind === 'tJet' || kind === 'triJet';

  const fuselage = `M${x0 + 8},${top + 3} L${nose - 18},${top} Q${nose},${top + 2} ${nose + 2},${yc + 3} Q${nose - 2},${bot} ${nose - 18},${bot} L${x0 + 20},${bot} Q${x0 + 6},${bot - 2} ${x0},${top + 2} Z`;
  const tailFin = tTail
    ? `M${x0 + 4},${top + 2} L${x0 - 6},${top - 26} L${x0 + 14},${top - 26} L${x0 + 30},${top + 1} Z`
    : `M${x0 + 2},${top + 3} L${x0 - 4},${top - 24} L${x0 + 12},${top - 24} L${x0 + 34},${top + 1} Z`;
  const hump = kind === 'jumbo' ? `M${nose - 70},${top + 1} Q${nose - 40},${top - 12} ${nose - 14},${top + 2} Z` : '';

  const wingX = x0 + len * 0.45;
  const engines: { x: number; y: number; w: number; h: number; prop?: boolean }[] = [];
  if (kind === 'twinProp') engines.push({ x: wingX + 10, y: yc + 1, w: 18, h: 7, prop: true });
  if (kind === 'quadProp') engines.push({ x: wingX + 4, y: yc + 1, w: 16, h: 6, prop: true }, { x: wingX + 22, y: yc + 1, w: 14, h: 6, prop: true });
  if (kind === 'narrowJet' || kind === 'regionalJet' || kind === 'wideTwin' || kind === 'wideTri') engines.push({ x: wingX + 6, y: bot - 1, w: wide ? 28 : 22, h: wide ? 11 : 8 });
  if (kind === 'quadJet' || kind === 'jumbo') engines.push({ x: wingX + 2, y: bot - 2, w: 20, h: 8 }, { x: wingX + 24, y: bot - 3, w: 20, h: 8 });
  if (rearEngines) engines.push({ x: x0 + 26, y: top - 1, w: 22, h: 8 });

  return (
    <svg viewBox="0 0 220 70" width={width} height={(width * 70) / 220} className="plane-svg" aria-hidden>
      <path d={tailFin} fill={livery.tail} />
      {kind === 'triJet' && <rect x={x0 - 2} y={top - 6} width={20} height={8} rx={3} fill="#9aa6b5" />}
      {kind === 'wideTri' && <rect x={x0 + 4} y={top - 18} width={22} height={9} rx={4} fill="#9aa6b5" />}
      {livery.logo && (
        <text x={x0 + (tTail ? 4 : 6)} y={top - 9} fontSize={9} fontWeight={700} fill={livery.logoColor ?? '#fff'} fontFamily="sans-serif">{livery.logo}</text>
      )}
      <path d={fuselage} fill={livery.body} />
      {hump && <path d={hump} fill={livery.body} />}
      {livery.special === 'special' ? (
        // a colourful wrap from nose to tail
        <>
          <rect x={x0 + 14} y={top + 2} width={(len - 30) / 3} height={hgt - 4} fill="#ff6b8b" opacity={0.85} />
          <rect x={x0 + 14 + (len - 30) / 3} y={top + 2} width={(len - 30) / 3} height={hgt - 4} fill="#ffd36b" opacity={0.85} />
          <rect x={x0 + 14 + (2 * (len - 30)) / 3} y={top + 2} width={(len - 30) / 3} height={hgt - 4} fill="#5fd3a0" opacity={0.85} />
        </>
      ) : livery.special === 'retro' ? (
        // a classic double cheatline through the windows
        <>
          <rect x={x0 + 10} y={yc - 4} width={len - 18} height={3} fill={livery.stripe} />
          <rect x={x0 + 10} y={yc + 1} width={len - 18} height={2} fill={livery.tail} />
        </>
      ) : (
        <rect x={x0 + 12} y={yc - 1} width={len - 26} height={3.5} fill={livery.stripe} />
      )}
      <path d={`M${wingX},${yc + 2} L${wingX + 40},${yc + 4} L${wingX + 8},${yc + 18} L${wingX - 6},${yc + 18} Z`} fill="#b9c3cf" opacity={0.9} />
      {engines.map((e, i) => (
        <g key={i}>
          <rect x={e.x} y={e.y} width={e.w} height={e.h} rx={e.h / 2} fill="#8d99a8" />
          {e.prop && <line x1={e.x + e.w + 1} x2={e.x + e.w + 1} y1={e.y - 7} y2={e.y + e.h + 7} stroke="#5d6876" strokeWidth={1.5} />}
        </g>
      ))}
      <path d={`M${nose - 16},${top + 3} L${nose - 8},${top + 3} L${nose - 6},${top + 7} L${nose - 16},${top + 7} Z`} fill="#33414f" />
    </svg>
  );
}
