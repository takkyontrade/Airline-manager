import { useEffect, useMemo, useRef, useState } from 'react';
import { geoMercator, geoPath } from 'd3-geo';
import { zoom, zoomIdentity, type ZoomTransform } from 'd3-zoom';
import { select } from 'd3-selection';
import { feature } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import type { FeatureCollection } from 'geojson';
import land50 from 'world-atlas/land-50m.json';
import { AIRPORTS, isAirportOpen } from '../data/airports';
import type { GameState } from '../engine/types';
import { scheduledWeekly } from '../engine/schedule';

const W = 800;
const H = 900;

const topo = land50 as unknown as Topology<{ land: GeometryCollection }>;
const landGeo = feature(topo, topo.objects.land) as unknown as FeatureCollection;

const projection = geoMercator()
  .center([136.5, 35.2])
  .scale(2300)
  .translate([W / 2, H / 2 - 40]);
const pathGen = geoPath(projection);

interface Props {
  state: GameState;
  selected: string | null;
  onAirportClick: (code: string) => void;
  highlightRoute: string | null;
}

export function MapView({ state, selected, onAirportClick, highlightRoute }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [tf, setTf] = useState<ZoomTransform>(zoomIdentity);

  useEffect(() => {
    if (!svgRef.current) return;
    const z = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.6, 8])
      .on('zoom', (e) => setTf(e.transform));
    select(svgRef.current).call(z);
    return () => {
      select(svgRef.current!).on('.zoom', null);
    };
  }, []);

  const landPath = useMemo(() => pathGen(landGeo) ?? '', []);
  const pos = (lon: number, lat: number) => projection([lon, lat]) ?? [0, 0];
  const k = tf.k;

  const routeLines = state.routes.map((r) => {
    const a = AIRPORTS.find((x) => x.code === r.from)!;
    const b = AIRPORTS.find((x) => x.code === r.to)!;
    const [x1, y1] = pos(a.lon, a.lat);
    const [x2, y2] = pos(b.lon, b.lat);
    // gentle curve for readability
    const mx = (x1 + x2) / 2 - (y2 - y1) * 0.12;
    const my = (y1 + y2) / 2 + (x2 - x1) * 0.12;
    const weekly = scheduledWeekly(state, r.id);
    const active = weekly > 0;
    const hl = r.id === highlightRoute;
    return (
      <path
        key={r.id}
        d={`M${x1},${y1} Q${mx},${my} ${x2},${y2}`}
        className={`route ${active ? 'active' : 'idle'} ${hl ? 'hl' : ''}`}
        strokeWidth={(hl ? 3 : 1.6 + Math.min(3, weekly / 15)) / k}
      />
    );
  });

  return (
    <svg ref={svgRef} className="map" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
      <g transform={tf.toString()}>
        <path d={landPath} className="land" strokeWidth={0.6 / k} />
        {routeLines}
        {AIRPORTS.map((a) => {
          const open = isAirportOpen(a, state.year);
          const [x, y] = pos(a.lon, a.lat);
          const isBase = a.code === state.baseAirport;
          const isSel = a.code === selected;
          const r = (isBase ? 5 : open ? 3.6 : 2.4) / Math.sqrt(k);
          return (
            <g
              key={a.code}
              data-code={a.code}
              className={`apt ${open ? 'open' : 'closed'} ${isSel ? 'sel' : ''} ${isBase ? 'base' : ''}`}
              transform={`translate(${x},${y})`}
              onClick={() => open && onAirportClick(a.code)}
            >
              <circle r={r * 2.4} className="hit" />
              <circle r={r} />
              {(k > 1.4 || isBase || isSel || a.popM >= 1.4) && (
                <text x={6 / Math.sqrt(k)} y={3 / Math.sqrt(k)} fontSize={11 / Math.sqrt(k)}>
                  {a.name}
                </text>
              )}
            </g>
          );
        })}
      </g>
    </svg>
  );
}
