import { useEffect, useMemo, useRef, useState } from 'react';
import type { ZoomBehavior } from 'd3-zoom';
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

// rotated so the Pacific is in the middle and Japan's routes to America and Europe don't wrap
const projection = geoMercator()
  .rotate([-150, 0])
  .center([136.5 - 150, 35.2])
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
  const zRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);

  useEffect(() => {
    if (!svgRef.current) return;
    const z = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.03, 8])
      .on('zoom', (e) => setTf(e.transform));
    zRef.current = z;
    select(svgRef.current).call(z);
    return () => {
      select(svgRef.current!).on('.zoom', null);
    };
  }, []);

  const landPath = useMemo(() => pathGen(landGeo) ?? '', []);
  const pos = (lon: number, lat: number) => projection([lon, lat]) ?? [0, 0];
  const k = tf.k;
  // keep markers a constant size when zoomed out, grow slowly when zoomed in
  const f = k < 1 ? k : Math.sqrt(k);

  const routeLines = state.routes.map((r) => {
    const a = AIRPORTS.find((x) => x.code === r.from)!;
    const b = AIRPORTS.find((x) => x.code === r.to)!;
    const [x1, y1] = pos(a.lon, a.lat);
    const [x2, y2] = pos(b.lon, b.lat);
    // gentle curve for readability
    const mx = (x1 + x2) / 2 - (y2 - y1) * 0.12;
    const my = (y1 + y2) / 2 + (x2 - x1) * 0.12;
    const weekly = scheduledWeekly(state, r.id);
    const v = r.via ? AIRPORTS.find((x) => x.code === r.via) : undefined;
    const via = v ? pos(v.lon, v.lat) : null;
    const active = weekly > 0;
    const hl = r.id === highlightRoute;
    return (
      <path
        key={r.id}
        d={via ? `M${x1},${y1} L${via[0]},${via[1]} L${x2},${y2}` : `M${x1},${y1} Q${mx},${my} ${x2},${y2}`}
        className={`route ${active ? 'active' : 'idle'} ${hl ? 'hl' : ''}`}
        strokeWidth={(hl ? 3 : 1.6 + Math.min(3, weekly / 15)) / k}
      />
    );
  });

  const jump = (k: number) => {
    if (!svgRef.current || !zRef.current) return;
    // keep Japan in view: scale around its centre
    const [cx, cy] = pos(136.5, 35.2);
    const t = zoomIdentity.translate(W / 2 - cx * k, H / 2 - 40 - cy * k).scale(k);
    select(svgRef.current).call(zRef.current.transform, t);
  };

  return (
    <>
    <div className="map-buttons">
      <button className="small secondary" onClick={() => jump(1)}>日本</button>
      <button className="small secondary" onClick={() => jump(0.25)}>アジア</button>
      <button className="small secondary" onClick={() => jump(0.07)}>世界</button>
    </div>
    <svg ref={svgRef} className="map" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
      <g transform={tf.toString()}>
        <path d={landPath} className="land" strokeWidth={0.6 / k} />
        {routeLines}
        {AIRPORTS.map((a) => {
          const open = isAirportOpen(a, state.year);
          const [x, y] = pos(a.lon, a.lat);
          const isBase = a.code === state.baseAirport;
          const isSel = a.code === selected;
          if (a.foreign && !open) return null;
          const r = (isBase ? 5 : open ? 3.6 : 2.4) / f;
          return (
            <g
              key={a.code}
              data-code={a.code}
              className={`apt ${a.foreign ? 'foreign' : ''} ${open ? 'open' : 'closed'} ${isSel ? 'sel' : ''} ${isBase ? 'base' : ''}`}
              transform={`translate(${x},${y})`}
              onClick={() => open && onAirportClick(a.code)}
            >
              <circle r={r * 2.4} className="hit" />
              <circle r={r} />
              {(isBase || isSel || (a.foreign ? k < 0.6 || k > 1.4 : k > 1.4 || (a.popM >= 1.4 && k >= 0.6))) && (
                <text x={6 / f} y={3 / f} fontSize={11 / f}>
                  {a.name}
                </text>
              )}
            </g>
          );
        })}
      </g>
    </svg>
    </>
  );
}
