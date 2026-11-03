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
import { hhmm, scheduledWeekly } from '../engine/schedule';
import { airborneAt, liveLegs, weekClock, WEEK_MIN } from '../engine/live';
import { planeType } from '../engine/fleet';
import { flightNumbers } from './RoutesScreen';
import type { Route } from '../engine/types';

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

const APT = (c: string) => AIRPORTS.find((x) => x.code === c)!;
const pt = (c: string) => { const a = APT(c); return projection([a.lon, a.lat]) ?? [0, 0]; };

/** Point and heading (radians, screen space) at `u` (0..1) along a route as drawn, from route.from */
function alongRoute(r: Route, u: number): [number, number, number] {
  const [x1, y1] = pt(r.from), [x2, y2] = pt(r.to);
  if (r.via) {
    const [vx, vy] = pt(r.via);
    const d1 = Math.hypot(vx - x1, vy - y1), d2 = Math.hypot(x2 - vx, y2 - vy);
    const k = u * (d1 + d2);
    if (k <= d1) { const f = d1 ? k / d1 : 0; return [x1 + (vx - x1) * f, y1 + (vy - y1) * f, Math.atan2(vy - y1, vx - x1)]; }
    const f = d2 ? (k - d1) / d2 : 0;
    return [vx + (x2 - vx) * f, vy + (y2 - vy) * f, Math.atan2(y2 - vy, x2 - vx)];
  }
  const mx = (x1 + x2) / 2 - (y2 - y1) * 0.12, my = (y1 + y2) / 2 + (x2 - x1) * 0.12;
  const a = (1 - u) * (1 - u), b = 2 * (1 - u) * u, c = u * u;
  const dx = 2 * (1 - u) * (mx - x1) + 2 * u * (x2 - mx), dy = 2 * (1 - u) * (my - y1) + 2 * u * (y2 - my);
  return [a * x1 + b * mx + c * x2, a * y1 + b * my + c * y2, Math.atan2(dy, dx)];
}

/** top-view airliner pointing right (+x), about 20 units long */
const PLANE_D = 'M10,0 L6,-1.3 L1,-1.3 L-3,-9 L-5,-9 L-2,-1.3 L-7,-1.3 L-9,-4 L-10.5,-4 L-9.5,0 L-10.5,4 L-9,4 L-7,1.3 L-2,1.3 L-5,9 L-3,9 L1,1.3 L6,1.3 Z';

const SPEEDS: [number, string][] = [[1, '1秒で1分'], [5, '1秒で5分'], [15, '1秒で15分'], [60, '1秒で1時間']];
const load = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const save = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

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
  const [live, setLive] = useState(() => load('airline-live', '') === '1');
  const [playing, setPlaying] = useState(true);
  const [clock, setClock] = useState(7 * 60);
  const [speed, setSpeed] = useState(() => Number(load('airline-live-speed', '5')) || 5);
  const [selPlane, setSelPlane] = useState<string | null>(null);
  const legs = useMemo(() => (live ? liveLegs(state) : []), [live, state]);

  useEffect(() => {
    if (!live || !playing) return;
    let raf = 0, last = performance.now(), acc = 0;
    const tick = (now: number) => {
      acc += ((now - last) / 1000) * speed;
      last = now;
      // redraw about 20 times a second
      if (acc >= speed / 20 || acc >= 1) { const a = acc; acc = 0; setClock((c) => (c + a) % WEEK_MIN); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [live, playing, speed]);

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

  const airborne = live ? airborneAt(legs, clock) : [];
  const selA = selPlane ? airborne.find((a) => a.plane.id === selPlane) : undefined;
  const selInfo = selA ? { p: selA.plane, v: selA.view, fno: flightNumbers(state, selA.view.route)[selA.view.leg.dir] } : null;

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
      <button className={`small ${live ? '' : 'secondary'}`} onClick={() => { setLive(!live); save('airline-live', live ? '' : '1'); }}>✈ ライブ運航</button>
    </div>
    <svg ref={svgRef} className={`map ${live ? 'live' : ''}`} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
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
        {live && airborne.map(({ plane, view, progress }) => {
          const u = view.leg.dir === 0 ? progress : 1 - progress;
          const [x, y, h] = alongRoute(view.route, u);
          const ang = (h * 180) / Math.PI + (view.leg.dir === 0 ? 0 : 180);
          const on = plane.id === selPlane;
          const s = (on ? 1.4 : 1.05) / f;
          return (
            <g key={plane.id + view.dep} className={`live-plane ${on ? 'on' : ''} ${planeType(plane).freighter ? 'cargo' : ''}`} transform={`translate(${x},${y})`}
              onClick={(e) => { e.stopPropagation(); setSelPlane(on ? null : plane.id); }}>
              <circle r={14 / f} className="hit" />
              <path d={PLANE_D} transform={`rotate(${ang}) scale(${s})`} />
              {(on || k > 2.2) && <text x={9 / f} y={-7 / f} fontSize={10 / f}>{flightNumbers(state, view.route)[view.leg.dir]}</text>}
            </g>
          );
        })}
      </g>
    </svg>
    {live && (
      <div className="live-bar">
        <button className="small" onClick={() => setPlaying(!playing)}>{playing ? '❚❚' : '▶'}</button>
        <span className="live-clock">{weekClock(clock)}</span>
        <input type="range" min={0} max={WEEK_MIN - 1} value={Math.floor(clock)} onChange={(e) => setClock(Number(e.target.value))} />
        <select value={speed} onChange={(e) => { setSpeed(Number(e.target.value)); save('airline-live-speed', e.target.value); }}>
          {SPEEDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <span className="muted">飛行中 {airborne.length}機</span>
        {selInfo && (
          <div className="live-info">
            <strong>{selInfo.fno}</strong> {APT(selInfo.v.from).name} → {APT(selInfo.v.to).name}
            <span className="muted"> {hhmm(selInfo.v.dep % 1440)}発 {hhmm(selInfo.v.arr % 1440)}着 ／ {planeType(selInfo.p).name} {selInfo.p.regNo}</span>
          </div>
        )}
      </div>
    )}
    </>
  );
}
