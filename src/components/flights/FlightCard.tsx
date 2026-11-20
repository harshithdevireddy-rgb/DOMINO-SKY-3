import { ArrowRight } from 'lucide-react';
import { useStore } from '@/store/useStore';
import { useSim } from '@/utils/hooks';
import { Badge, Button } from '@/components/ui/primitives';
import { STATUS_COLOR, STATUS_LABEL } from '@/utils/colors';
import { flightDisplayStatus } from '@/utils/selectors';
import { causeShort, rotationImpact } from '@/utils/format';
import { fmtTime } from '@/engine/timeUtils';

export function StatusBadge({ id }: { id: string }) {
  const { result, rec } = useSim();
  const s = flightDisplayStatus(result.flightById.get(id)!, rec);
  return <Badge color={STATUS_COLOR[s]}>{STATUS_LABEL[s]}</Badge>;
}

/** Compact card exposing all route-click fields from the spec. */
export function FlightCard({ id }: { id: string }) {
  const { net, result } = useSim();
  const select = useStore((s) => s.selectFlight);
  const f = result.flightById.get(id)!; const d = net.flightById.get(id)!;
  const cx = result.connections.filter((c) => c.from === id || c.to === id);
  const row = (k: string, v: React.ReactNode) => <div className="flex justify-between gap-3 py-0.5 text-xs"><dt className="text-mute">{k}</dt><dd className="num text-right">{v}</dd></div>;
  return (
    <article className="rounded-lg border border-line bg-bg/50 p-3" aria-label={`Flight ${id}`}>
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2"><span className="num text-sm font-semibold">{id}</span><span className="text-xs text-mute">{d.origin} <ArrowRight className="inline h-3 w-3" /> {d.dest}</span></div>
        <StatusBadge id={id} />
      </header>
      <dl className="mt-2">
        {row('Aircraft', f.reassigned ? <>{f.tail} <span className="text-rec">(was {f.scheduledTail})</span></> : f.tail)}
        {row('Scheduled departure', fmtTime(f.schedDep))}
        {row('Simulated departure', f.cancelled ? '—' : <span className={f.depDelay ? 'text-warn' : ''}>{fmtTime(f.actualDep)}{f.depDelay ? ` (+${f.depDelay}m)` : ''}</span>)}
        {row('Scheduled arrival', fmtTime(f.schedArr))}
        {row('Simulated arrival', f.cancelled ? '—' : <span className={f.arrDelay ? 'text-warn' : ''}>{fmtTime(f.actualArr)}{f.arrDelay ? ` (+${f.arrDelay}m)` : ''}</span>)}
        {row('Delay', f.cancelled ? 'Cancelled' : `${f.arrDelay} min`)}
        {row('Passengers', d.pax)}
      </dl>
      <div className="mt-1.5 space-y-1 border-t border-line/60 pt-2 text-xs">
        <p><span className="text-mute">Cause: </span>{causeShort(f)}</p>
        <p><span className="text-mute">Rotation: </span>{rotationImpact(net, result, id)}</p>
        <p><span className="text-mute">Connections: </span>{cx.length === 0 ? 'none' : cx.map((c) => `${c.id} ${c.status === 'made' ? 'made' : 'BROKEN'} (${c.pax})`).join(', ')}</p>
      </div>
      <Button size="sm" className="mt-2.5 w-full" onClick={() => select(id)}>Open disruption chain</Button>
    </article>
  );
}
