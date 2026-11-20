import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { useStore } from '@/store/useStore';
import { useSim } from '@/utils/hooks';
import { COLORS, STATUS_COLOR, STATUS_LABEL } from '@/utils/colors';
import { EMPTY_FILTER, flightDisplayStatus, matchesFilter, routeKey, type StatusFilter } from '@/utils/selectors';
import { MAP_H, MAP_W, OUTLINE_PATH, curve, pointOn, project } from './geo';
import { fmtTime } from '@/engine/timeUtils';

const RANK = { on_time: 0, recovered: 1, delayed: 2, severe: 3, cancelled: 4 } as const;
const STATUS_CHIPS: { id: StatusFilter; label: string }[] = [
  { id: 'all', label: 'All flights' }, { id: 'normal', label: 'Normal' }, { id: 'delayed', label: 'Delayed' }, { id: 'cancelled', label: 'Cancelled' }, { id: 'recovered', label: 'Recovery' },
];

export function MapFilters() {
  const { net, result } = useSim();
  const filter = useStore((s) => s.filter); const setFilter = useStore((s) => s.setFilter); const reset = useStore((s) => s.resetFilter);
  const used = [...new Set(result.flights.map((f) => f.tail))].sort();
  const sel = 'h-8 rounded-md border border-line bg-bg/70 px-2 text-xs text-ink hover:border-[#3a4c70] focus:border-rec';
  const active = filter.status !== 'all' || filter.tail !== 'all' || filter.airport !== 'all';
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Network filters">
      <div className="flex rounded-lg border border-line bg-bg/60 p-0.5">
        {STATUS_CHIPS.map((c) => (
          <button key={c.id} type="button" aria-pressed={filter.status === c.id} onClick={() => setFilter({ status: c.id })}
            className={clsx('rounded-md px-2.5 py-1 text-xs font-medium transition', filter.status === c.id ? 'bg-elevated text-ink ring-1 ring-line' : 'text-mute hover:text-ink')}>{c.label}</button>
        ))}
      </div>
      <select aria-label="Filter by aircraft" className={sel} value={filter.tail} onChange={(e) => setFilter({ tail: e.target.value })}>
        <option value="all">All aircraft</option>{used.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
      <select aria-label="Filter by airport" className={sel} value={filter.airport} onChange={(e) => setFilter({ airport: e.target.value })}>
        <option value="all">All airports</option>{net.airports.map((a) => <option key={a.id} value={a.id}>{a.id} — {a.city}</option>)}
      </select>
      {active && <button type="button" className="text-xs text-rec hover:underline" onClick={reset}>Clear filters</button>}
    </div>
  );
}

export function NetworkMap() {
  const { net, result, rec } = useSim();
  const filter = useStore((s) => s.filter);
  const selAirport = useStore((s) => s.selectedAirport); const selRoute = useStore((s) => s.selectedRoute);
  const selectAirport = useStore((s) => s.selectAirport); const selectRoute = useStore((s) => s.selectRoute);
  const replayTime = useStore((s) => s.replay.time);
  const [hover, setHover] = useState<string | null>(null);

  const pos = useMemo(() => new Map(net.airports.map((a) => [a.id, project(a.lat, a.lng)] as [string, [number, number]])), [net]);

  const routes = useMemo(() => {
    const m = new Map<string, { key: string; a: string; b: string; flights: string[]; pass: string[] }>();
    for (const f of net.flights) {
      const key = routeKey(f.origin, f.dest);
      const r = m.get(key) ?? { key, a: key.split('-')[0], b: key.split('-')[1], flights: [], pass: [] };
      r.flights.push(f.id);
      if (matchesFilter(net, result.flightById.get(f.id)!, filter, rec)) r.pass.push(f.id);
      m.set(key, r);
    }
    return [...m.values()].map((r) => {
      let worst: keyof typeof RANK = 'on_time';
      for (const id of r.pass) { const s = flightDisplayStatus(result.flightById.get(id)!, rec); if (RANK[s] > RANK[worst]) worst = s; }
      const allCancelled = r.pass.length > 0 && r.pass.every((id) => result.flightById.get(id)!.cancelled);
      return { ...r, worst, allCancelled };
    }).sort((x, y) => RANK[x.worst] - RANK[y.worst]);
  }, [net, result, filter, rec]);

  const airborne = useMemo(() => {
    if (replayTime === null) return [];
    return result.flights.filter((f) => !f.cancelled && f.actualDep! <= replayTime && replayTime < f.actualArr!).map((f) => {
      const d = net.flightById.get(f.id)!;
      const a = pos.get(d.origin)!; const b = pos.get(d.dest)!;
      const key = routeKey(d.origin, d.dest);
      const [k0] = key.split('-');
      // use the canonical (sorted) orientation so the dot rides the drawn curve
      const A = pos.get(k0)!; const B = pos.get(key.split('-')[1])!;
      const { c } = curve(A, B);
      const frac = (replayTime - f.actualDep!) / (f.actualArr! - f.actualDep!);
      const t = d.origin === k0 ? frac : 1 - frac;
      void a; void b;
      return { id: f.id, p: pointOn(A, c, B, Math.min(1, Math.max(0, t))), st: flightDisplayStatus(f, rec) };
    });
  }, [replayTime, result, net, pos, rec]);

  const closedNow = (id: string) => {
    const c = result.scenario.closures.find((x) => x.airport === id);
    if (!c) return false;
    return replayTime === null || (replayTime >= c.start && replayTime < c.end);
  };

  return (
    <div className="relative overflow-hidden rounded-xl border border-line bg-[#0a1120]">
      <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} className="block h-auto w-full" role="img" aria-label="Airline network map showing 16 airports and flight routes coloured by status">
        <defs>
          <pattern id="grid" width="49" height="49" patternUnits="userSpaceOnUse"><path d="M49 0H0V49" fill="none" stroke="#16223a" strokeWidth="1" /></pattern>
          <radialGradient id="glow"><stop offset="0" stopColor="#22d3ee" stopOpacity=".18" /><stop offset="1" stopColor="#22d3ee" stopOpacity="0" /></radialGradient>
        </defs>
        <rect width={MAP_W} height={MAP_H} fill="url(#grid)" />
        <path d={OUTLINE_PATH} fill="#0f1a30" stroke="#22314f" strokeWidth="1.5" strokeLinejoin="round" />
        {/* routes */}
        {routes.map((r) => {
          const a = pos.get(r.a)!; const b = pos.get(r.b)!;
          const { d } = curve(a, b);
          const active = r.pass.length > 0;
          const color = STATUS_COLOR[r.worst];
          const selected = selRoute === r.key; const hot = hover === r.key;
          const w = 1.2 + Math.min(r.flights.length, 8) * 0.45;
          return (
            <g key={r.key}>
              <path d={d} fill="none" stroke={active ? color : '#2a3956'} strokeWidth={selected || hot ? w + 1.5 : w} strokeOpacity={active ? (r.worst === 'on_time' ? 0.5 : 0.9) : 0.18}
                strokeDasharray={r.allCancelled ? '6 5' : undefined} strokeLinecap="round" className={clsx(r.worst === 'severe' && active && 'flow')} style={r.worst === 'severe' ? { strokeDasharray: '10 6' } : undefined} />
              <path d={d} fill="none" stroke="transparent" strokeWidth="16" tabIndex={0} role="button" className="cursor-pointer outline-none"
                aria-label={`Route ${r.a} to ${r.b}: ${r.flights.length} flights, worst status ${STATUS_LABEL[r.worst]}`}
                onMouseEnter={() => setHover(r.key)} onMouseLeave={() => setHover(null)} onClick={() => { selectRoute(r.key); selectAirport(null); }}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectRoute(r.key); selectAirport(null); } }} />
            </g>
          );
        })}
        {/* aircraft in replay */}
        {airborne.map((p) => (
          <g key={p.id} transform={`translate(${p.p[0]},${p.p[1]})`} pointerEvents="none">
            <circle r="9" fill={STATUS_COLOR[p.st]} opacity=".18" /><circle r="3.6" fill={STATUS_COLOR[p.st]} stroke="#04101a" strokeWidth="1" />
          </g>
        ))}
        {/* airports */}
        {net.airports.map((a) => {
          const [x, y] = pos.get(a.id)!;
          const imp = result.airports.find((i) => i.id === a.id)!;
          const closed = closedNow(a.id);
          const color = closed ? COLORS.bad : imp.status === 'affected' ? COLORS.warn : COLORS.ok;
          const r = 4.5 + a.capacityPerHour / 9;
          const selected = selAirport === a.id;
          const dim = filter.airport !== 'all' && filter.airport !== a.id;
          const labelLeft = ['BOM', 'GOI', 'COK', 'TRV', 'AMD', 'PNQ', 'MAA'].includes(a.id) && a.id !== 'MAA';
          return (
            <g key={a.id} transform={`translate(${x},${y})`} opacity={dim ? 0.45 : 1} tabIndex={0} role="button" className="cursor-pointer outline-none"
              aria-label={`Airport ${a.id} ${a.city}, ${closed ? 'closed' : imp.status}, ${imp.affectedFlights} affected flights`}
              onClick={() => { selectAirport(a.id); selectRoute(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectAirport(a.id); selectRoute(null); } }}>
              {closed && <circle r={r} fill="none" stroke={COLORS.bad} strokeWidth="2" className="pulse-ring" />}
              {imp.status === 'affected' && !closed && <circle r={r + 5} fill={color} opacity=".12" />}
              <circle r={r + (selected ? 4 : 0)} fill="#0a1120" stroke={color} strokeWidth={selected ? 3 : 2} />
              <circle r={Math.max(2, r - 3.5)} fill={color} opacity={closed ? 1 : 0.85} />
              <text x={labelLeft ? -r - 6 : r + 6} y="4" textAnchor={labelLeft ? 'end' : 'start'} className="num" fontSize="12.5" fontWeight="700" fill={selected ? '#fff' : '#cfd8ec'} style={{ paintOrder: 'stroke' }} stroke="#0a1120" strokeWidth="3">{a.id}</text>
              <title>{`${a.id} — ${a.name} (${a.city}) · ${a.capacityPerHour}/h`}</title>
            </g>
          );
        })}
      </svg>
      {/* legend */}
      <div className="pointer-events-none absolute bottom-3 left-3 rounded-lg border border-line bg-bg/85 px-3 py-2 text-[11px] backdrop-blur" aria-label="Legend">
        <div className="label mb-1.5 !text-[9.5px]">Legend</div>
        <ul className="space-y-1">
          {([['on_time', 'Normal'], ['delayed', 'Delayed'], ['severe', 'Severely delayed (≥60m)'], ['recovered', 'Recovered']] as const).map(([k, l]) => (
            <li key={k} className="flex items-center gap-2"><span className="h-0.5 w-5 rounded" style={{ background: STATUS_COLOR[k] }} />{l}</li>
          ))}
          <li className="flex items-center gap-2"><svg width="20" height="4"><line x1="0" y1="2" x2="20" y2="2" stroke={COLORS.bad} strokeWidth="2" strokeDasharray="5 3" /></svg>Cancelled</li>
          <li className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full border-2 border-bad" />Airport closed</li>
          <li className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full border-2 border-warn" />Airport affected</li>
        </ul>
      </div>
      {replayTime !== null && <div className="absolute right-3 top-3 rounded-md border border-rec/40 bg-bg/85 px-2.5 py-1 text-xs"><span className="text-mute">Replay clock </span><span className="num font-semibold text-rec">{fmtTime(replayTime)}</span></div>}
      {hover && (() => {
        const r = routes.find((x) => x.key === hover); if (!r) return null;
        return <div className="pointer-events-none absolute left-3 top-3 rounded-md border border-line bg-bg/90 px-2.5 py-1.5 text-xs">{r.a} ↔ {r.b}: <span className="num">{r.flights.length}</span> flights · {STATUS_LABEL[r.worst]}</div>;
      })()}
    </div>
  );
}

export { EMPTY_FILTER };
