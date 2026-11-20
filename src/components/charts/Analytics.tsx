import { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useSim } from '@/utils/hooks';
import { useStore } from '@/store/useStore';
import { Empty, Panel } from '@/components/ui/primitives';
import { COLORS } from '@/utils/colors';
import { actionContributions } from '@/engine/compare';
import { describeAction } from '@/engine/recovery';
import { AXIS, TOOLTIP } from './chartStyle';
import { nf } from '@/utils/format';

const BUCKETS: { label: string; test: (d: number) => boolean; color: string }[] = [
  { label: '0 min', test: (d) => d === 0, color: COLORS.ok }, { label: '1–30', test: (d) => d >= 1 && d <= 30, color: '#a3e635' },
  { label: '31–60', test: (d) => d >= 31 && d <= 60, color: COLORS.warn }, { label: '61–120', test: (d) => d >= 61 && d <= 120, color: '#f97316' }, { label: '120+', test: (d) => d > 120, color: COLORS.bad },
];

export function Analytics() {
  const { net, result } = useSim();
  const scenario = useStore((s) => s.scenario); const select = useStore((s) => s.selectFlight);
  const operated = result.flights.filter((f) => !f.cancelled);
  const dist = BUCKETS.map((b) => ({ name: b.label, flights: operated.filter((f) => b.test(f.arrDelay)).length, color: b.color }));
  const airports = [...result.airports].filter((a) => a.affectedFlights > 0).sort((a, b) => b.affectedFlights - a.affectedFlights || b.delayMinutes - a.delayMinutes).slice(0, 10).map((a) => ({ name: a.id, affected: a.affectedFlights, delay: a.delayMinutes }));
  const p = result.metrics.pax;
  const pax = [
    { name: 'On time', value: p.onTime, color: COLORS.ok }, { name: 'Delayed', value: p.delayed, color: COLORS.warn },
    { name: 'Missed connection', value: p.missedConnection, color: '#f97316' }, { name: 'Cancelled itinerary', value: p.cancelled, color: COLORS.bad },
  ].filter((x) => x.value > 0);
  const contrib = useMemo(() => actionContributions(net, scenario), [net, scenario]);
  const contribData = scenario.actions.map((a, i) => ({ name: `${i + 1}. ${describeAction(net, a).slice(0, 34)}`, saved: contrib.find((c) => c.actionId === a.id)?.standalone ?? 0 }));
  const maxLeg = Math.max(...[...net.rotations.values()].map((l) => l.length));
  const heat = (d: number, cancelled: boolean) => cancelled ? { bg: '#3b1d24', fg: '#fca5a5' } : d === 0 ? { bg: '#0f2a2c', fg: '#5eead4' } : d <= 30 ? { bg: '#3a3010', fg: '#fcd34d' } : d <= 60 ? { bg: '#4a2e0a', fg: '#fdba74' } : { bg: '#4a1417', fg: '#fca5a5' };

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Panel title="Delay distribution" subtitle="Operated flights by arrival delay">
        <div className="h-64"><ResponsiveContainer width="100%" height="100%"><BarChart data={dist} margin={{ left: -14, right: 6 }}><CartesianGrid stroke={AXIS.grid} vertical={false} /><XAxis dataKey="name" stroke={AXIS.stroke} fontSize={11} /><YAxis allowDecimals={false} stroke={AXIS.stroke} fontSize={11} /><Tooltip {...TOOLTIP} /><Bar dataKey="flights" name="Flights" radius={[4, 4, 0, 0]}>{dist.map((d) => <Cell key={d.name} fill={d.color} />)}</Bar></BarChart></ResponsiveContainer></div>
      </Panel>
      <Panel title="Passenger impact" subtitle={`${nf(p.distinct)} distinct passengers, disjoint groups`}>
        <div className="grid h-64 grid-cols-[1fr_auto] items-center gap-2">
          <ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={pax} dataKey="value" nameKey="name" innerRadius={52} outerRadius={86} paddingAngle={2} stroke="#0f172a">{pax.map((x) => <Cell key={x.name} fill={x.color} />)}</Pie><Tooltip {...TOOLTIP} /></PieChart></ResponsiveContainer>
          <ul className="space-y-1.5 pr-2 text-xs">{pax.map((x) => <li key={x.name} className="flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-sm" style={{ background: x.color }} /><span className="w-32 text-mute">{x.name}</span><span className="num font-semibold">{nf(x.value)}</span></li>)}</ul>
        </div>
      </Panel>
      <Panel title="Delay propagation by aircraft" subtitle="Arrival delay (minutes) at each leg of the rotation — click a cell for the chain" className="xl:col-span-2">
        <div className="overflow-x-auto"><table className="w-full min-w-[560px] border-separate border-spacing-1 text-xs">
          <thead><tr><th className="label px-2 text-left">Aircraft</th>{Array.from({ length: maxLeg }, (_, i) => <th key={i} className="label px-2">Leg {i + 1}</th>)}<th className="label px-2 text-right">Total</th></tr></thead>
          <tbody>{net.tails.map((t) => { const ids = net.rotations.get(t)!; const total = ids.reduce((a, id) => a + (result.flightById.get(id)!.cancelled ? 0 : result.flightById.get(id)!.arrDelay), 0);
            return (<tr key={t}><th scope="row" className="num px-2 text-left font-medium text-ink/90">{t}</th>
              {Array.from({ length: maxLeg }, (_, i) => { const id = ids[i]; if (!id) return <td key={i} />; const f = result.flightById.get(id)!; const c = heat(f.arrDelay, f.cancelled);
                return <td key={i}><button type="button" onClick={() => select(id)} title={`${id} ${net.flightById.get(id)!.origin}→${net.flightById.get(id)!.dest}`} className="num w-full rounded-md px-1.5 py-1.5 text-center font-semibold hover:ring-1 hover:ring-rec" style={{ background: c.bg, color: c.fg }}>{f.cancelled ? '✕' : f.arrDelay === 0 ? '0' : `+${f.arrDelay}`}</button></td>; })}
              <td className="num px-2 text-right font-semibold" style={{ color: total ? COLORS.warn : COLORS.mute }}>{total}</td></tr>); })}</tbody></table></div>
      </Panel>
      <Panel title="Airport impact" subtitle="Airports touching the most delayed / cancelled flights">
        {airports.length === 0 ? <Empty title="No airport is affected" /> : <div className="h-72"><ResponsiveContainer width="100%" height="100%"><BarChart data={airports} layout="vertical" margin={{ left: 0, right: 12 }}><CartesianGrid stroke={AXIS.grid} horizontal={false} /><XAxis type="number" stroke={AXIS.stroke} fontSize={11} allowDecimals={false} /><YAxis type="category" dataKey="name" stroke={AXIS.stroke} fontSize={11} width={38} /><Tooltip {...TOOLTIP} /><Legend wrapperStyle={{ fontSize: 12 }} /><Bar dataKey="affected" name="Affected flights" fill={COLORS.warn} radius={[0, 3, 3, 0]} /></BarChart></ResponsiveContainer></div>}
      </Panel>
      <Panel title="Recovery performance" subtitle="Cost saved by each applied action, applied alone (re-simulated)">
        {contribData.length === 0 ? <Empty title="No recovery actions applied" hint="Apply a recommendation to see which action helps most." /> : <div className="h-72"><ResponsiveContainer width="100%" height="100%"><BarChart data={contribData} layout="vertical" margin={{ left: 0, right: 12 }}><CartesianGrid stroke={AXIS.grid} horizontal={false} /><XAxis type="number" stroke={AXIS.stroke} fontSize={11} /><YAxis type="category" dataKey="name" stroke={AXIS.stroke} fontSize={10} width={190} /><Tooltip {...TOOLTIP} /><Bar dataKey="saved" name="Cost saved" fill={COLORS.rec} radius={[0, 3, 3, 0]} /></BarChart></ResponsiveContainer></div>}
      </Panel>
    </div>
  );
}
