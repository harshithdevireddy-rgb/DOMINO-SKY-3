import { Play, RotateCcw, Radio, AlertTriangle, Pause } from 'lucide-react';
import { useStore, PRESETS } from '@/store/useStore';
import { Button, Field, Panel, inputCls } from '@/components/ui/primitives';
import { fmtTime } from '@/engine/timeUtils';

const DURATIONS = [30, 60, 90, 120, 180];

export function ControlPanel() {
  const net = useStore((s) => s.network)!;
  const draft = useStore((s) => s.draft); const setDraft = useStore((s) => s.setDraft);
  const run = useStore((s) => s.runSimulation); const reset = useStore((s) => s.resetScenario);
  const scenario = useStore((s) => s.scenario); const loadPreset = useStore((s) => s.loadPreset);
  const draftClosure = useStore((s) => s.draftClosure);
  const replay = useStore((s) => s.replay); const startReplay = useStore((s) => s.startReplay); const setReplay = useStore((s) => s.setReplay);
  const { closure, error } = draftClosure();
  const cur = scenario.closures[0];
  const dirty = !!closure && (!cur || cur.airport !== closure.airport || cur.start !== closure.start || cur.end !== closure.end);
  const ap = net.airportById.get(draft.airport);

  return (
    <Panel title="Disruption control" subtitle="Close an airport and let the deterministic engine propagate the effects.">
      <form className="space-y-3.5" onSubmit={(e) => { e.preventDefault(); run(); }} aria-label="Disruption controls">
        <Field label="Scenario preset" htmlFor="preset">
          <select id="preset" className={inputCls} value="" onChange={(e) => e.target.value && loadPreset(e.target.value)} aria-label="Scenario preset">
            <option value="">Load a preset…</option>
            {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </Field>
        <Field label="Airport" htmlFor="airport">
          <select id="airport" className={inputCls} value={draft.airport} onChange={(e) => setDraft({ airport: e.target.value })}>
            {net.airports.map((a) => <option key={a.id} value={a.id}>{a.id} — {a.city} ({a.capacityPerHour}/h)</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Closure begins" htmlFor="start">
            <input id="start" type="time" className={inputCls} value={draft.start} onChange={(e) => setDraft({ start: e.target.value })} />
          </Field>
          <Field label="Duration" htmlFor="duration">
            <select id="duration" className={inputCls} value={String(draft.duration)} onChange={(e) => setDraft({ duration: e.target.value === 'custom' ? 'custom' : Number(e.target.value) })}>
              {DURATIONS.map((d) => <option key={d} value={d}>{d} minutes</option>)}
              <option value="custom">Custom…</option>
            </select>
          </Field>
        </div>
        {draft.duration === 'custom' && (
          <Field label="Custom duration (minutes)" htmlFor="custom">
            <input id="custom" type="number" min={1} max={720} className={inputCls} value={draft.custom} onChange={(e) => setDraft({ custom: e.target.value })} />
          </Field>
        )}
        <details className="rounded-lg border border-line/70 bg-bg/40 px-3 py-2 text-xs">
          <summary className="cursor-pointer select-none text-mute hover:text-ink">Advanced: capacity limit</summary>
          <div className="mt-2.5">
            <Field label={`Movements/hour at ${draft.airport}`} htmlFor="cap" hint={`Dataset capacity is ${ap?.capacityPerHour}/h. Lower it to model a congested reopening; leave blank to use the dataset value.`}>
              <input id="cap" type="number" min={1} max={200} placeholder={String(ap?.capacityPerHour ?? '')} className={inputCls} value={draft.capacity} onChange={(e) => setDraft({ capacity: e.target.value })} />
            </Field>
          </div>
        </details>
        {error && <p role="alert" className="flex items-start gap-1.5 text-xs text-bad"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{error}</p>}
        <div className="rounded-lg border border-line/70 bg-bg/50 px-3 py-2 text-xs text-mute">
          <span className="text-ink">{draft.airport} — {ap?.name}</span><br />
          {closure ? <>Closed <span className="num text-ink">{fmtTime(closure.start)}</span> → <span className="num text-ink">{fmtTime(closure.end)}</span> ({closure.end - closure.start} min)</> : 'Set a valid time and duration.'}
        </div>
        <Button type="submit" variant="primary" className="h-11 w-full tracking-wide" disabled={!closure}>
          <Play className="h-4 w-4" /> SIMULATE DISRUPTION
        </Button>
        {dirty && cur && <p className="text-center text-[11px] text-warn">Parameters changed — simulate to update results.</p>}
        <div className="grid grid-cols-2 gap-2">
          <Button onClick={reset}><RotateCcw className="h-3.5 w-3.5" /> Reset</Button>
          {replay.time !== null && replay.playing ? (
            <Button onClick={() => setReplay({ playing: false })} aria-label="Pause simulation animation"><Pause className="h-3.5 w-3.5" /> Pause</Button>
          ) : (
            <Button onClick={() => (replay.time !== null ? setReplay({ playing: true }) : startReplay())} aria-label="Replay disruption propagation"><Radio className="h-3.5 w-3.5" /> {replay.time !== null ? 'Resume' : 'Replay'}</Button>
          )}
        </div>
      </form>
    </Panel>
  );
}
