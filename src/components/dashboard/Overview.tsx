import { MousePointerClick } from 'lucide-react';
import { useStore } from '@/store/useStore';
import { useSim } from '@/utils/hooks';
import { COLORS, NETWORK_STATUS_STYLE } from '@/utils/colors';
import { Panel, Stat, Empty } from '@/components/ui/primitives';
import { MapFilters, NetworkMap } from '@/components/map/NetworkMap';
import { AirportPanel, RoutePanel } from '@/components/map/SidePanels';
import { nf } from '@/utils/format';
import { fmtTime } from '@/engine/timeUtils';

export function Overview() {
  const { result } = useSim();
  const m = result.metrics; const st = NETWORK_STATUS_STYLE[m.status];
  const selAirport = useStore((s) => s.selectedAirport); const selRoute = useStore((s) => s.selectedRoute);
  const closures = result.scenario.closures;
  const zero = (n: number, c: string) => (n === 0 ? undefined : c);
  return (
    <div className="space-y-4">
      <section aria-label="Network disruption status" className="relative overflow-hidden rounded-xl border p-4" style={{ borderColor: `${st.color}55`, background: `linear-gradient(100deg, ${st.color}1c, transparent 60%)` }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="label">Network disruption status</div>
            <div className="mt-1 text-2xl font-bold tracking-wide" style={{ color: st.color }}>{st.label}</div>
            <p className="mt-0.5 text-sm text-mute">{st.text} {closures.length > 0 ? `Cause: ${closures.map((c) => `${c.airport} closed ${fmtTime(c.start)}–${fmtTime(c.end)}`).join(', ')}.` : 'No airport closure is active.'}</p>
          </div>
          <div className="text-right text-xs text-mute">
            <div><span className="num text-base font-semibold text-ink">{m.delayed + m.cancelled}</span> of {m.totalFlights} flights affected</div>
            <div>longest delay <span className="num text-ink">{m.maxDelay} min</span> · {m.airportsAffected} airports touched</div>
          </div>
        </div>
      </section>

      <section aria-label="Key metrics" className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <Stat label="Total flights" value={m.totalFlights} sub={`${m.operated} operating`} />
        <Stat label="Operating normally" value={m.onTime} color={COLORS.ok} sub={`${Math.round((m.onTime / m.totalFlights) * 100)}% on schedule`} />
        <Stat label="Delayed" value={m.delayed} color={zero(m.delayed, COLORS.warn)} sub={`${m.severe} severe (≥60 min)`} />
        <Stat label="Cancelled" value={m.cancelled} color={zero(m.cancelled, COLORS.bad)} sub={m.cancelled ? 'via recovery actions' : 'none cancelled'} />
        <Stat label="Total delay" value={<>{nf(m.totalDelayMinutes)}<span className="ml-1 text-sm font-normal text-mute">min</span></>} color={zero(m.totalDelayMinutes, COLORS.warn)} sub="Σ arrival delay, operated flights" />
        <Stat label="Passengers impacted" value={nf(m.pax.impacted)} color={zero(m.pax.impacted, COLORS.warn)} sub={`of ${nf(m.pax.distinct)} distinct passengers`} hint="Distinct passengers: delayed + stranded. Connecting passengers are counted once." />
        <Stat label="Passengers stranded" value={nf(m.pax.stranded)} color={zero(m.pax.stranded, COLORS.bad)} sub="cancelled + missed connection" hint="No same-day re-accommodation is modelled." />
        <Stat label="Missed connections" value={m.brokenConnections} color={zero(m.brokenConnections, COLORS.bad)} sub={`${nf(m.missedConnectionPax)} pax missed · ${m.connectionsTotal} total`} />
        <Stat label="Crew violations" value={m.crewViolations} color={zero(m.crewViolations, COLORS.bad)} sub={m.crewViolations ? `${m.crewExcessMinutes} min over limit` : 'all within duty limits'} />
        <Stat label="Aircraft affected" value={m.aircraftAffected} color={zero(m.aircraftAffected, COLORS.warn)} sub="of 16 in the fleet" />
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Panel title="Network map" subtitle="Click an airport or a route. Colours reflect the simulated schedule." actions={undefined}>
          <div className="mb-3"><MapFilters /></div>
          <NetworkMap />
        </Panel>
        <div className="space-y-4">
          {selAirport ? <AirportPanel id={selAirport} /> : selRoute ? <RoutePanel routeId={selRoute} /> : (
            <Panel title="Details">
              <Empty icon={<MousePointerClick className="h-6 w-6" />} title="Select an airport or a route" hint="See capacity, traffic, affected flights, passengers and the cause of each delay." />
            </Panel>
          )}
          <PassengerModelNote />
        </div>
      </div>
    </div>
  );
}

function PassengerModelNote() {
  const { result } = useSim(); const p = result.metrics.pax;
  const row = (l: string, v: number, c?: string) => <div className="flex justify-between text-xs"><span className="text-mute">{l}</span><span className="num font-medium" style={c ? { color: c } : undefined}>{nf(v)}</span></div>;
  return (
    <Panel title="Passenger accounting" subtitle="Disjoint groups — nobody is counted twice">
      <div className="space-y-1">
        {row('On time', p.onTime, COLORS.ok)}{row('Delayed', p.delayed, COLORS.warn)}{row('Missed connection', p.missedConnection, COLORS.bad)}{row('Cancelled itinerary', p.cancelled, COLORS.bad)}
        <div className="my-1.5 border-t border-line/70" />
        {row('Distinct passengers', p.distinct)}
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-mute">Connecting passengers occupy seats on two flights. Distinct = Σ flight pax − Σ connection pax. Stranded = cancelled + missed (no re-booking modelled). Seat-count on delayed flights: <span className="num text-ink">{nf(p.seatsOnDelayedFlights)}</span>.</p>
    </Panel>
  );
}
