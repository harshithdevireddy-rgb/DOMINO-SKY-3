import { useMemo, useRef, useEffect } from 'react';
import { Pause, Play, RotateCcw, Radio } from 'lucide-react';
import clsx from 'clsx';
import { useStore } from '@/store/useStore';
import { useSim } from '@/utils/hooks';
import { Button, Panel } from '@/components/ui/primitives';
import { COLORS, STATUS_COLOR } from '@/utils/colors';
import { flightDisplayStatus } from '@/utils/selectors';
import { fmtTime } from '@/engine/timeUtils';

const W = 1500; const LEFT = 92; const ROW = 28; const TOP = 30;

export function TimelineView() {
  const { net, result, rec } = useSim();
  const replay = useStore((s) => s.replay); const setReplay = useStore((s) => s.setReplay); const startReplay = useStore((s) => s.startReplay);
  const select = useStore((s) => s.selectFlight); const selected = useStore((s) => s.selectedFlight);

  const { t0, t1, tails } = useMemo(() => {
    const times = result.flights.flatMap((f) => [f.schedDep, f.schedArr, ...(f.actualArr !== null ? [f.actualArr] : [])]);
    const lo = Math.floor((Math.min(...times) - 20) / 60) * 60; const hi = Math.ceil((Math.max(...times) + 20) / 60) * 60;
    const used = [...new Set([...net.tails, ...result.flights.map((f) => f.tail)])];
    return { t0: lo, t1: hi, tails: used };
  }, [result, net]);
  const x = (t: number) => LEFT + ((t - t0) / (t1 - t0)) * (W - LEFT - 16);
  const H = TOP + tails.length * ROW + 10;
  const rowOf = new Map(tails.map((t, i) => [t, i]));
  const end = Math.max(...result.events.map((e) => e.time)) + 20;
  const hours: number[] = []; for (let h = t0; h <= t1; h += 60) hours.push(h);
  const t = replay.time;
  const logRef = useRef<HTMLOListElement>(null);
  const visible = t === null ? result.events.length : result.events.filter((e) => e.time <= t).length;
  useEffect(() => { if (t !== null && logRef.current) { const el = logRef.current.children[Math.max(0, visible - 1)] as HTMLElement | undefined; el?.scrollIntoView({ block: 'nearest' }); } }, [visible, t]);

  return (
    <div className="space-y-4">
      <Panel title="Simulation timeline" subtitle="Every bar is a computed flight (solid = simulated, outline = scheduled). The replay clock steps through the real event sequence.">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {t !== null && replay.playing ? <Button onClick={() => setReplay({ playing: false })}><Pause className="h-3.5 w-3.5" />Pause</Button>
            : <Button variant="primary" onClick={() => (t !== null && t < end ? setReplay({ playing: true }) : startReplay())}><Play className="h-3.5 w-3.5" />{t !== null && t < end ? 'Resume' : 'Replay disruption'}</Button>}
          <Button onClick={() => startReplay()}><RotateCcw className="h-3.5 w-3.5" />Restart</Button>
          <Button onClick={() => setReplay({ time: null, playing: false })} disabled={t === null}><Radio className="h-3.5 w-3.5" />Show final state</Button>
          <label className="ml-2 flex items-center gap-2 text-xs text-mute">Speed
            <select aria-label="Replay speed" className="h-8 rounded-md border border-line bg-bg/70 px-2 text-xs text-ink" value={replay.speed} onChange={(e) => setReplay({ speed: Number(e.target.value) })}>
              <option value={0.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option>
            </select></label>
          <label className="flex min-w-[220px] flex-1 items-center gap-2 text-xs text-mute">Clock
            <input aria-label="Replay clock" type="range" className="flex-1 accent-cyan-400" min={t0} max={end} step={1} value={t ?? end} onChange={(e) => setReplay({ time: Number(e.target.value), playing: false })} />
            <span className="num w-16 text-right text-ink">{t === null ? 'final' : fmtTime(t)}</span></label>
        </div>
        <div className="overflow-x-auto rounded-lg border border-line bg-[#0a1120]">
          <svg viewBox={`0 0 ${W} ${H}`} style={{ minWidth: 1000 }} className="block w-full" role="img" aria-label="Gantt timeline of flights by aircraft with airport closure windows">
            {hours.map((h) => (<g key={h}><line x1={x(h)} x2={x(h)} y1={TOP - 6} y2={H - 4} stroke="#16223a" /><text x={x(h)} y={16} textAnchor="middle" fontSize="11" fill={COLORS.mute} className="num">{fmtTime(h, { dayMarker: false })}</text></g>))}
            {result.scenario.closures.map((c, i) => (
              <g key={i}><rect x={x(c.start)} y={TOP - 6} width={x(c.end) - x(c.start)} height={H - TOP + 2} fill={COLORS.bad} opacity=".11" /><rect x={x(c.start)} y={TOP - 6} width={x(c.end) - x(c.start)} height="3" fill={COLORS.bad} />
                <text x={x(c.start) + 4} y={TOP + 6} fontSize="10" fill="#fca5a5" fontWeight="700">{c.airport} CLOSED</text></g>
            ))}
            {tails.map((tail, i) => {
              const y = TOP + i * ROW; const isSpare = net.spares.some((s) => s.tail === tail);
              return (<g key={tail}>
                <text x={6} y={y + 17} fontSize="11" fill={isSpare ? COLORS.rec : '#b6c2dc'} className="num">{tail}</text>
                <line x1={LEFT} x2={W - 16} y1={y + ROW - 1} y2={y + ROW - 1} stroke="#121d33" />
              </g>);
            })}
            {result.flights.map((f) => {
              const y = TOP + rowOf.get(f.tail)! * ROW + 4;
              const st = flightDisplayStatus(f, rec); const col = STATUS_COLOR[st];
              const d = net.flightById.get(f.id)!;
              const sched = <rect x={x(f.schedDep)} y={y} width={Math.max(2, x(f.schedArr) - x(f.schedDep))} height={ROW - 9} rx="3" fill="none" stroke="#3a4c70" strokeDasharray="3 2" />;
              if (f.cancelled) {
                const oy = TOP + rowOf.get(f.scheduledTail)! * ROW + 4;
                return (<g key={f.id}><rect x={x(f.schedDep)} y={oy} width={Math.max(2, x(f.schedArr) - x(f.schedDep))} height={ROW - 9} rx="3" fill="none" stroke={COLORS.bad} strokeDasharray="4 3" /><text x={x(f.schedDep) + 4} y={oy + 12} fontSize="9.5" fill="#fca5a5">✕ {f.id}</text></g>);
              }
              const w = Math.max(3, x(f.actualArr!) - x(f.actualDep!));
              const dim = t !== null && f.actualDep! > t;
              return (
                <g key={f.id} opacity={dim ? 0.25 : 1} tabIndex={0} role="button" aria-label={`Flight ${f.id} ${d.origin} to ${d.dest}, ${f.arrDelay} minutes late`} className="cursor-pointer outline-none"
                  onClick={() => select(f.id)} onKeyDown={(e) => { if (e.key === 'Enter') select(f.id); }}>
                  {sched}
                  <rect x={x(f.actualDep!)} y={y} width={w} height={ROW - 9} rx="3" fill={col} opacity={f.arrDelay ? 0.9 : 0.55} stroke={selected === f.id ? '#fff' : 'none'} strokeWidth="1.5" />
                  {f.airborneHold > 0 && <rect x={x(f.actualArr! - f.airborneHold)} y={y} width={x(f.actualArr!) - x(f.actualArr! - f.airborneHold)} height={ROW - 9} rx="3" fill="url(#hold)" />}
                  {w > 54 && <text x={x(f.actualDep!) + 4} y={y + 12} fontSize="9.5" fill="#05101a" fontWeight="700" className="num">{f.id.slice(2)} {d.origin}-{d.dest}</text>}
                  <title>{`${f.id} ${d.origin}→${d.dest} · dep ${fmtTime(f.actualDep)} arr ${fmtTime(f.actualArr)} (+${f.arrDelay}m)`}</title>
                </g>
              );
            })}
            <defs><pattern id="hold" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="3" height="6" fill="#00000066" /></pattern></defs>
            {result.events.filter((e) => e.kind === 'recovery').map((e, i) => (<g key={i}><line x1={x(e.time)} x2={x(e.time)} y1={TOP - 6} y2={H - 4} stroke={COLORS.rec} strokeDasharray="2 3" /><path d={`M${x(e.time) - 5},${H - 4} l5,-9 l5,9 z`} fill={COLORS.rec}><title>{e.text}</title></path></g>))}
            {t !== null && <g><line x1={x(t)} x2={x(t)} y1={TOP - 8} y2={H} stroke={COLORS.rec} strokeWidth="2" /><text x={x(t) + 4} y={H - 4} fontSize="11" fill={COLORS.rec} className="num" fontWeight="700">{fmtTime(t)}</text></g>}
          </svg>
        </div>
        <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-mute">
          <span><i className="mr-1 inline-block h-2 w-4 rounded-sm" style={{ background: COLORS.ok }} />on time</span><span><i className="mr-1 inline-block h-2 w-4 rounded-sm" style={{ background: COLORS.warn }} />delayed</span><span><i className="mr-1 inline-block h-2 w-4 rounded-sm" style={{ background: COLORS.bad }} />severe</span><span><i className="mr-1 inline-block h-2 w-4 rounded-sm" style={{ background: COLORS.rec }} />recovered</span>
          <span><i className="mr-1 inline-block h-2 w-4 rounded-sm border border-dashed border-mute" />scheduled slot</span><span><i className="mr-1 inline-block h-2 w-4 rounded-sm bg-black/50" />airborne hold</span><span style={{ color: COLORS.rec }}>▲ recovery action</span>
        </div>
      </Panel>
      <Panel title="Event sequence" subtitle={`${result.events.length} computed events · ${visible} shown${t === null ? '' : ` up to ${fmtTime(t)}`}`}>
        <ol ref={logRef} className="max-h-72 overflow-y-auto rounded-lg border border-line bg-bg/40 text-[13px]">
          {result.events.map((e, i) => (
            <li key={i} className={clsx('flex gap-3 border-b border-line/40 px-3 py-1.5 last:border-0', t !== null && e.time > t && 'opacity-30')}>
              <span className="num w-14 shrink-0 text-mute">{fmtTime(e.time, { dayMarker: false })}</span>
              <span className={clsx('w-24 shrink-0 text-[11px] font-semibold uppercase tracking-wide', e.kind.startsWith('closure') || e.kind === 'cancellation' ? 'text-bad' : e.kind === 'recovery' ? 'text-rec' : e.delay ? 'text-warn' : 'text-mute')}>{e.kind.replace('_', ' ')}</span>
              {e.flightId ? <button type="button" className="text-left hover:text-rec" onClick={() => select(e.flightId!)}>{e.text}</button> : <span>{e.text}</span>}
            </li>
          ))}
        </ol>
      </Panel>
    </div>
  );
}
