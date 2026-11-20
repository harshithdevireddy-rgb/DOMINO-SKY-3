import clsx from 'clsx';
import { useStore } from '@/store/useStore';
import { useSim } from '@/utils/hooks';
import { Badge, Panel } from '@/components/ui/primitives';
import { COLORS } from '@/utils/colors';
import { fmtTime, fmtDuration } from '@/engine/timeUtils';
import { connectionText } from '@/engine/connections';

export function CrewConnections() {
  const { result } = useSim();
  const select = useStore((s) => s.selectFlight);
  const crews = [...result.crews].sort((a, b) => Number(b.violation) - Number(a.violation) || b.dutyMinutes / b.maxDuty - a.dutyMinutes / a.maxDuty);
  return (
    <div className="space-y-4">
      <Panel title="Crew duty" subtitle="Duty = simulated arrival of the crew’s last operated flight − duty start, versus the maximum permitted. Independent of flight delay status." pad={false}>
        <div className="overflow-x-auto"><table className="w-full min-w-[980px] text-[13px]">
          <thead><tr className="label border-b border-line text-left">{['Crew', 'Aircraft', 'Duty start', 'Last arrival', 'Duty', 'Max', 'Excess', 'Utilisation', 'Flights affected'].map((h) => <th key={h} scope="col" className="px-3 py-2">{h}</th>)}</tr></thead>
          <tbody>{crews.map((c) => {
            const u = c.maxDuty ? c.dutyMinutes / c.maxDuty : 0;
            const col = c.violation ? COLORS.bad : u > 0.95 ? COLORS.warn : COLORS.ok;
            return (<tr key={c.crewId} className={clsx('border-b border-line/50', c.violation && 'bg-bad/[0.07]')}>
              <td className="num px-3 py-2 font-semibold">{c.crewId}{c.standby && <span className="ml-1.5 text-[10px] text-rec">STANDBY</span>}</td>
              <td className="num px-3 py-2">{c.tail}</td><td className="num px-3 py-2">{fmtTime(c.dutyStart)}</td><td className="num px-3 py-2">{fmtTime(c.lastArr)}</td>
              <td className="num px-3 py-2 font-semibold">{fmtDuration(c.dutyMinutes)}</td><td className="num px-3 py-2 text-mute">{fmtDuration(c.maxDuty)}</td>
              <td className="num px-3 py-2 font-semibold" style={{ color: c.violation ? COLORS.bad : COLORS.mute }}>{c.excess ? `+${c.excess} min` : '—'}</td>
              <td className="w-40 px-3 py-2"><div className="h-2 rounded-full bg-bg" role="img" aria-label={`${Math.round(u * 100)}% of duty limit`}><div className="h-2 rounded-full" style={{ width: `${Math.min(100, u * 100)}%`, background: col }} /></div><div className="num mt-0.5 text-[10px] text-mute">{Math.round(u * 100)}%{c.violation && <Badge color={COLORS.bad} className="ml-1.5">VIOLATION</Badge>}</div></td>
              <td className="px-3 py-2 text-xs">{c.flightsAffected.length === 0 ? <span className="text-mute">none</span> : c.flightsAffected.map((id) => (<button key={id} type="button" className={clsx('num mr-1.5 hover:text-rec', c.flightsBeyondLimit.includes(id) ? 'font-semibold text-bad' : 'text-warn')} title={c.flightsBeyondLimit.includes(id) ? 'ends after the duty limit' : 'delayed'} onClick={() => select(id)}>{id}</button>))}</td>
            </tr>);
          })}</tbody></table></div>
      </Panel>
      <Panel title="Passenger connections" subtitle="A connection is made if the onward flight departs at least min_connect_minutes after the inbound flight arrives." pad={false}>
        <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-[13px]">
          <thead><tr className="label border-b border-line text-left">{['ID', 'Airport', 'Inbound → onward', 'Pax', 'Scheduled', 'Actual transfer', 'Required', 'Status'].map((h) => <th key={h} scope="col" className="px-3 py-2">{h}</th>)}</tr></thead>
          <tbody>{[...result.connections].sort((a, b) => Number(a.status === 'made') - Number(b.status === 'made') || a.id.localeCompare(b.id)).map((c) => (
            <tr key={c.id} className={clsx('border-b border-line/50', c.status !== 'made' && 'bg-bad/[0.07]')} title={connectionText(c)}>
              <td className="num px-3 py-2 font-semibold">{c.id}</td><td className="px-3 py-2">{c.airport}</td>
              <td className="px-3 py-2"><button className="num hover:text-rec" onClick={() => select(c.from)}>{c.from}</button> → <button className="num hover:text-rec" onClick={() => select(c.to)}>{c.to}</button></td>
              <td className="num px-3 py-2">{c.pax}</td><td className="num px-3 py-2 text-mute">{c.scheduledTransfer} min</td>
              <td className="num px-3 py-2 font-semibold" style={{ color: c.status === 'made' ? undefined : COLORS.bad }}>{c.transfer === null ? '—' : `${c.transfer} min`}</td><td className="num px-3 py-2 text-mute">{c.minConnect} min</td>
              <td className="px-3 py-2"><Badge color={c.status === 'made' ? COLORS.ok : COLORS.bad}>{c.status === 'made' ? (c.held ? 'PROTECTED' : 'MADE') : c.status === 'missed' ? 'MISSED' : c.status === 'from_cancelled' ? 'INBOUND CANCELLED' : 'ONWARD CANCELLED'}</Badge></td>
            </tr>))}</tbody></table></div>
      </Panel>
    </div>
  );
}
