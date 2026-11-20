import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Search, FilterX } from 'lucide-react';
import clsx from 'clsx';
import { useStore } from '@/store/useStore';
import { useSim } from '@/utils/hooks';
import { Empty, Panel } from '@/components/ui/primitives';
import { StatusBadge } from './FlightCard';
import { matchesFilter, type StatusFilter } from '@/utils/selectors';
import { causeShort } from '@/utils/format';
import { fmtTime } from '@/engine/timeUtils';

type SortKey = 'id' | 'tail' | 'origin' | 'dest' | 'schedDep' | 'actualDep' | 'schedArr' | 'actualArr' | 'delay' | 'pax' | 'status';
const STATUS_ORDER = { cancelled: 0, severe: 1, delayed: 2, on_time: 3 } as const;

export function FlightTable() {
  const { net, result, rec } = useSim();
  const filter = useStore((s) => s.filter); const setFilter = useStore((s) => s.setFilter); const reset = useStore((s) => s.resetFilter);
  const select = useStore((s) => s.selectFlight); const selected = useStore((s) => s.selectedFlight);
  const [q, setQ] = useState(''); const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'schedDep', dir: 1 });

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = result.flights.filter((f) => {
      if (!matchesFilter(net, f, filter, rec)) return false;
      if (!needle) return true;
      const d = net.flightById.get(f.id)!;
      return [f.id, f.tail, d.origin, d.dest, causeShort(f), net.airportById.get(d.origin)!.city, net.airportById.get(d.dest)!.city].join(' ').toLowerCase().includes(needle);
    });
    const val = (f: (typeof list)[number]): string | number => {
      const d = net.flightById.get(f.id)!;
      switch (sort.key) {
        case 'id': return f.id; case 'tail': return f.tail; case 'origin': return d.origin; case 'dest': return d.dest;
        case 'schedDep': return f.schedDep; case 'actualDep': return f.actualDep ?? 99999; case 'schedArr': return f.schedArr; case 'actualArr': return f.actualArr ?? 99999;
        case 'delay': return f.cancelled ? 99999 : f.arrDelay; case 'pax': return d.pax; case 'status': return STATUS_ORDER[f.status];
      }
    };
    return [...list].sort((a, b) => { const x = val(a); const y = val(b); return (x < y ? -1 : x > y ? 1 : a.id.localeCompare(b.id)) * sort.dir; });
  }, [result, net, filter, rec, q, sort]);

  const head = (key: SortKey, label: string, cls = '') => (
    <th scope="col" className={clsx('sticky top-0 z-10 bg-surface px-3 py-2 text-left', cls)} aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className="label inline-flex items-center gap-1 hover:text-ink" onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : 1 }))}>
        {label}{sort.key === key && (sort.dir === 1 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
      </button>
    </th>
  );
  const sel = 'h-8 rounded-md border border-line bg-bg/70 px-2 text-xs hover:border-[#3a4c70] focus:border-rec';
  const filtered = filter.status !== 'all' || filter.tail !== 'all' || filter.airport !== 'all' || q;

  return (
    <Panel title="Flight details" subtitle={`${rows.length} of ${result.flights.length} flights · click a row for the disruption chain`} pad={false}>
      <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-mute" />
          <input aria-label="Search flights" placeholder="Search flight, aircraft, airport, cause…" value={q} onChange={(e) => setQ(e.target.value)} className="h-8 w-72 max-w-full rounded-md border border-line bg-bg/70 pl-8 pr-2 text-sm placeholder:text-mute/60 focus:border-rec" />
        </div>
        <select aria-label="Filter by status" className={sel} value={filter.status} onChange={(e) => setFilter({ status: e.target.value as StatusFilter })}>
          <option value="all">All statuses</option><option value="normal">On time</option><option value="delayed">Delayed</option><option value="cancelled">Cancelled</option><option value="recovered">Recovered</option>
        </select>
        <select aria-label="Filter by airport" className={sel} value={filter.airport} onChange={(e) => setFilter({ airport: e.target.value })}>
          <option value="all">All airports</option>{net.airports.map((a) => <option key={a.id} value={a.id}>{a.id}</option>)}
        </select>
        <select aria-label="Filter by aircraft" className={sel} value={filter.tail} onChange={(e) => setFilter({ tail: e.target.value })}>
          <option value="all">All aircraft</option>{[...new Set(result.flights.map((f) => f.tail))].sort().map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        {filtered && <button type="button" className="inline-flex items-center gap-1 text-xs text-rec hover:underline" onClick={() => { reset(); setQ(''); }}><FilterX className="h-3.5 w-3.5" />Clear</button>}
      </div>
      <div className="max-h-[calc(100vh-290px)] min-h-[320px] overflow-auto border-t border-line">
        <table className="w-full min-w-[1100px] border-collapse text-[13px]">
          <thead><tr>{head('id', 'Flight')}{head('tail', 'Aircraft')}{head('origin', 'From')}{head('dest', 'To')}{head('schedDep', 'Sched dep')}{head('actualDep', 'Actual dep')}{head('schedArr', 'Sched arr')}{head('actualArr', 'Actual arr')}{head('delay', 'Delay')}{head('pax', 'Pax')}{head('status', 'Status')}<th scope="col" className="label sticky top-0 z-10 bg-surface px-3 py-2 text-left">Delay cause</th></tr></thead>
          <tbody>
            {rows.map((f) => {
              const d = net.flightById.get(f.id)!;
              const hot = f.cancelled || f.arrDelay > 0;
              return (
                <tr key={f.id} tabIndex={0} aria-label={`Flight ${f.id}`} onClick={() => select(f.id)} onKeyDown={(e) => { if (e.key === 'Enter') select(f.id); }}
                  className={clsx('cursor-pointer border-t border-line/50 transition hover:bg-elevated/70', hot && 'bg-warn/[0.04]', f.status === 'severe' && 'bg-bad/[0.06]', f.cancelled && 'bg-bad/[0.08] text-mute', selected === f.id && 'outline outline-1 -outline-offset-1 outline-rec')}>
                  <td className="num px-3 py-2 font-semibold">{f.id}</td>
                  <td className="num px-3 py-2">{f.tail}{f.reassigned && <span className="ml-1 text-[10px] text-rec" title={`scheduled on ${f.scheduledTail}`}>↻</span>}</td>
                  <td className="px-3 py-2">{d.origin}</td><td className="px-3 py-2">{d.dest}</td>
                  <td className="num px-3 py-2 text-mute">{fmtTime(f.schedDep)}</td>
                  <td className={clsx('num px-3 py-2', f.depDelay > 0 && 'text-warn')}>{fmtTime(f.actualDep)}</td>
                  <td className="num px-3 py-2 text-mute">{fmtTime(f.schedArr)}</td>
                  <td className={clsx('num px-3 py-2', f.arrDelay > 0 && 'text-warn')}>{fmtTime(f.actualArr)}</td>
                  <td className={clsx('num px-3 py-2 font-semibold', f.status === 'severe' ? 'text-bad' : f.arrDelay > 0 ? 'text-warn' : 'text-mute')}>{f.cancelled ? '—' : f.arrDelay > 0 ? `+${f.arrDelay}m` : '0'}</td>
                  <td className="num px-3 py-2">{d.pax}</td>
                  <td className="px-3 py-2"><StatusBadge id={f.id} /></td>
                  <td className="max-w-[260px] truncate px-3 py-2 text-xs text-mute" title={f.causes[0]?.text}>{causeShort(f)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && <Empty title="No flights match these filters" hint="Clear the filters or search to see all 70 flights." />}
      </div>
    </Panel>
  );
}
