import { useEffect, useRef } from 'react';
import { X, ArrowDown, Users, UserRound, PlaneTakeoff, Link2 } from 'lucide-react';
import clsx from 'clsx';
import { useStore } from '@/store/useStore';
import { useSim } from '@/utils/hooks';
import { Badge, Button } from '@/components/ui/primitives';
import { StatusBadge } from './FlightCard';
import { buildChain } from '@/engine/explain';
import { connectionText } from '@/engine/connections';
import { fmtTime, fmtDuration } from '@/engine/timeUtils';
import { COLORS, STATUS_COLOR } from '@/utils/colors';
import { flightDisplayStatus } from '@/utils/selectors';

export function FlightDrawer() {
  const { net, result, rec } = useSim();
  const id = useStore((s) => s.selectedFlight)!; const select = useStore((s) => s.selectFlight);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') select(null); };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [id, select]);
  const f = result.flightById.get(id); const d = net.flightById.get(id);
  if (!f || !d) return null;
  const chain = buildChain(net, result, id);
  const cx = result.connections.filter((c) => c.from === id || c.to === id);
  const crew = f.crewId ? result.crews.find((c) => c.crewId === f.crewId) : undefined;
  const seq = result.sequences.get(f.tail) ?? [];
  const section = (t: string, icon: React.ReactNode, children: React.ReactNode) => (
    <section className="border-t border-line px-5 py-4"><h3 className="label mb-2.5 flex items-center gap-1.5">{icon}{t}</h3>{children}</section>
  );
  const cell = (l: string, scheduled: string, actual: string, delay: number) => (
    <div className="rounded-lg border border-line bg-bg/50 p-2.5"><div className="label !text-[9.5px]">{l}</div>
      <div className="mt-1 flex items-baseline gap-2"><span className="num text-lg font-semibold" style={{ color: delay > 0 ? COLORS.warn : undefined }}>{actual}</span>{delay > 0 && <span className="num text-xs text-warn">+{delay}m</span>}</div>
      <div className="num text-[11px] text-mute">scheduled {scheduled}</div></div>
  );
  return (
    <div className="fixed inset-0 z-[60]" role="presentation">
      <div className="absolute inset-0 bg-black/50" onClick={() => select(null)} />
      <aside role="dialog" aria-modal="true" aria-label={`Flight ${id} details`} className="anim-slide absolute right-0 top-0 h-full w-full max-w-[520px] overflow-y-auto border-l border-line bg-surface shadow-2xl">
        <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-line bg-surface/95 px-5 py-4 backdrop-blur">
          <div>
            <div className="flex items-center gap-2.5"><span className="num text-xl font-semibold">{id}</span><StatusBadge id={id} />{f.reassigned && <Badge color={COLORS.rec}>↻ {f.tail}</Badge>}</div>
            <p className="mt-0.5 text-sm text-mute">{net.airportById.get(d.origin)!.city} ({d.origin}) → {net.airportById.get(d.dest)!.city} ({d.dest}) · {f.tail} · {d.pax} pax · block {fmtDuration(d.block)}</p>
          </div>
          <button ref={closeRef} aria-label="Close flight details" className="rounded-md p-1 text-mute hover:bg-elevated hover:text-ink" onClick={() => select(null)}><X className="h-5 w-5" /></button>
        </header>

        <section className="grid grid-cols-2 gap-2.5 px-5 py-4">
          {f.cancelled ? <div className="col-span-2 rounded-lg border border-bad/40 bg-bad/10 p-3 text-sm text-red-200">This flight is cancelled; no simulated times.</div> : <>
            {cell('Departure', fmtTime(f.schedDep), fmtTime(f.actualDep), f.depDelay)}
            {cell('Arrival', fmtTime(f.schedArr), fmtTime(f.actualArr), f.arrDelay)}
          </>}
        </section>

        {section('Why this flight is affected', <PlaneTakeoff className="h-3.5 w-3.5" />, f.causes.length === 0 ? (
          <p className="text-sm text-mute">{f.cancelled ? 'Cancelled.' : 'No delay: this flight operates as scheduled.'}{f.absorbed > 0 && <> An inbound delay of <span className="num text-ink">{f.absorbed} min</span> was absorbed by the scheduled turnaround buffer.</>}</p>
        ) : (
          <ul className="space-y-2">{f.causes.map((c, i) => <li key={i} className="rounded-lg border border-line bg-bg/50 p-2.5 text-sm leading-snug"><span className="num mr-2 rounded bg-warn/15 px-1.5 py-0.5 text-[11px] font-semibold text-warn">{c.minutes ? `+${c.minutes}m` : '—'}</span>{c.text}</li>)}</ul>
        ))}

        {section('Disruption chain', <ArrowDown className="h-3.5 w-3.5" />, (
          <ol className="relative space-y-0" aria-label="Disruption chain">
            {chain.map((s, i) => {
              const color = s.kind === 'root' ? COLORS.bad : s.kind === 'absorbed' ? COLORS.ok : s.kind === 'connection' || s.kind === 'effect' ? COLORS.warn : s.flightId === id ? COLORS.rec : COLORS.mute;
              return (
                <li key={i} className="relative pl-6">
                  {i < chain.length - 1 && <span className="absolute left-[7px] top-5 h-[calc(100%-8px)] w-px bg-line" />}
                  <span className="absolute left-0 top-1.5 h-[15px] w-[15px] rounded-full border-2 bg-surface" style={{ borderColor: color }} />
                  <div className={clsx('pb-3 text-sm leading-snug', s.flightId === id && 'font-medium')}>
                    {s.kind === 'flight' || (s.kind === 'absorbed' && s.flightId) ? (
                      <button type="button" className="text-left hover:text-rec" onClick={() => select(s.flightId!)}>{s.text}</button>
                    ) : <span style={{ color: s.kind === 'root' ? '#fca5a5' : undefined }}>{s.text}</span>}
                  </div>
                </li>
              );
            })}
          </ol>
        ))}

        {section('Aircraft rotation', <PlaneTakeoff className="h-3.5 w-3.5" />, (
          <ul className="flex flex-wrap gap-1.5">
            {seq.map((sid) => { const r = result.flightById.get(sid)!; const st = flightDisplayStatus(r, rec); const dd = net.flightById.get(sid)!;
              return <li key={sid}><button type="button" onClick={() => select(sid)} className={clsx('rounded-md border px-2 py-1 text-xs num hover:bg-elevated', sid === id ? 'border-rec' : 'border-line')} style={{ color: STATUS_COLOR[st] }}>{sid} {dd.origin}→{dd.dest}{r.arrDelay > 0 ? ` +${r.arrDelay}` : ''}</button></li>; })}
          </ul>
        ))}

        {section(`Connections (${cx.length})`, <Link2 className="h-3.5 w-3.5" />, cx.length === 0 ? <p className="text-sm text-mute">No dataset connections involve this flight.</p> : (
          <ul className="space-y-2">{cx.map((c) => (
            <li key={c.id} className="rounded-lg border bg-bg/50 p-2.5 text-xs leading-snug" style={{ borderColor: c.status === 'made' ? COLORS.line : `${COLORS.bad}66` }}>
              <div className="mb-1 flex items-center justify-between"><span className="font-semibold">{c.id} · {c.airport} · {c.pax} pax · {c.from === id ? 'onward ' + c.to : 'inbound ' + c.from}</span><Badge color={c.status === 'made' ? COLORS.ok : COLORS.bad}>{c.status === 'made' ? (c.held ? 'PROTECTED' : 'MADE') : 'BROKEN'}</Badge></div>
              {connectionText(c)}
            </li>))}</ul>
        ))}

        {section('Crew', <UserRound className="h-3.5 w-3.5" />, !crew ? <p className="text-sm text-mute">No crew (flight cancelled).</p> : (
          <div className="text-sm">
            <div className="flex items-center justify-between"><span className="num font-semibold">{crew.crewId}{crew.standby && ' (standby)'}</span><Badge color={crew.violation ? COLORS.bad : COLORS.ok}>{crew.violation ? `${crew.excess} MIN OVER LIMIT` : 'WITHIN LIMIT'}</Badge></div>
            <p className="mt-1.5 text-xs text-mute">Duty {fmtTime(crew.dutyStart)} → {fmtTime(crew.lastArr)} = <span className="num text-ink">{fmtDuration(crew.dutyMinutes)}</span> of {fmtDuration(crew.maxDuty)} permitted.</p>
            {crew.flightsBeyondLimit.includes(id) && <p className="mt-2 rounded-md border border-bad/40 bg-bad/10 p-2 text-xs text-red-200">This flight ends after the crew’s duty limit — it cannot legally operate as simulated.</p>}
          </div>
        ))}

        {section('Passengers', <Users className="h-3.5 w-3.5" />, (
          <p className="text-sm text-mute"><span className="num text-ink">{d.pax}</span> on board, including <span className="num text-ink">{cx.reduce((a, c) => a + c.pax, 0)}</span> connecting passengers on dataset connections.</p>
        ))}
        <div className="border-t border-line px-5 py-4"><Button onClick={() => select(null)} className="w-full">Close</Button></div>
      </aside>
    </div>
  );
}
