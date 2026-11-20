import { X } from 'lucide-react';
import { useStore } from '@/store/useStore';
import { useSim } from '@/utils/hooks';
import { Badge, Empty, Panel } from '@/components/ui/primitives';
import { COLORS } from '@/utils/colors';
import { routeKey } from '@/utils/selectors';
import { FlightCard } from '@/components/flights/FlightCard';
import { fmtTime } from '@/engine/timeUtils';

export function AirportPanel({ id }: { id: string }) {
  const { net, result } = useSim();
  const select = useStore((s) => s.selectAirport); const setFilter = useStore((s) => s.setFilter); const setTab = useStore((s) => s.setTab);
  const a = net.airportById.get(id)!; const imp = result.airports.find((x) => x.id === id)!;
  const closure = result.scenario.closures.find((c) => c.airport === id);
  const color = imp.status === 'closed' ? COLORS.bad : imp.status === 'affected' ? COLORS.warn : COLORS.ok;
  const k = (l: string, v: React.ReactNode) => <div className="rounded-lg border border-line/70 bg-bg/50 p-2.5"><div className="label !text-[9.5px]">{l}</div><div className="num mt-0.5 text-lg font-semibold">{v}</div></div>;
  return (
    <Panel title="Airport" actions={<button aria-label="Close airport panel" className="text-mute hover:text-ink" onClick={() => select(null)}><X className="h-4 w-4" /></button>}>
      <div className="flex items-center gap-2"><span className="num text-2xl font-semibold">{a.id}</span><Badge color={color}>{imp.status === 'closed' ? 'CLOSED' : imp.status === 'affected' ? 'AFFECTED' : 'NORMAL'}</Badge></div>
      <p className="mt-0.5 text-sm text-ink/90">{a.name}</p><p className="text-xs text-mute">{a.city} · {a.tier.replace('_', ' ')}</p>
      {closure && <p className="mt-2 rounded-md border border-bad/40 bg-bad/10 px-2.5 py-1.5 text-xs text-red-200">Closed {fmtTime(closure.start)} → {fmtTime(closure.end)} ({closure.end - closure.start} min)</p>}
      <div className="mt-3 grid grid-cols-2 gap-2">
        {k('Capacity', `${result.scenario.capacityOverrides?.[id] ?? a.capacityPerHour}/h`)}
        {k('Incoming', imp.incoming)}{k('Outgoing', imp.outgoing)}
        {k('Affected flights', imp.affectedFlights)}
        {k('Passengers affected', imp.affectedPax)}{k('Departure delay', `${imp.delayMinutes}m`)}
      </div>
      <p className="mt-2 text-[11px] text-mute">Passengers affected counts seats on delayed/cancelled flights touching this airport (connecting passengers appear on both of their flights).</p>
      <button type="button" className="mt-3 text-xs text-rec hover:underline" onClick={() => { setFilter({ airport: id }); setTab('flights'); }}>View flights at {a.id} →</button>
    </Panel>
  );
}

export function RoutePanel({ routeId }: { routeId: string }) {
  const { net, result } = useSim();
  const select = useStore((s) => s.selectRoute);
  const [a, b] = routeId.split('-');
  const flights = net.flights.filter((f) => routeKey(f.origin, f.dest) === routeId);
  return (
    <Panel title={`Route ${a} ↔ ${b}`} subtitle={`${flights.length} flight${flights.length > 1 ? 's' : ''} on this route`} actions={<button aria-label="Close route panel" className="text-mute hover:text-ink" onClick={() => select(null)}><X className="h-4 w-4" /></button>}>
      <div className="max-h-[560px] space-y-2.5 overflow-y-auto pr-1">{flights.map((f) => <FlightCard key={f.id} id={f.id} />)}</div>
      {flights.length === 0 && <Empty title="No flights" />}
      <p className="sr-only">{result.flights.length} flights simulated</p>
    </Panel>
  );
}
