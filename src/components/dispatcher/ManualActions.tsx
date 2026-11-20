import { useMemo, useState } from 'react';
import { useStore, newActionId } from '@/store/useStore';
import { useSim } from '@/utils/hooks';
import { Button, Field, Panel, inputCls } from '@/components/ui/primitives';
import { cancellationSets } from '@/engine/recovery';
import type { RecoveryAction } from '@/types';

type Kind = 'cancel' | 'spare' | 'swap' | 'protect' | 'prioritize';

/** Lets the user build any recovery action by hand — validation is the same engine check used for AI/rule-based suggestions. */
export function ManualActions() {
  const { net, result, base } = useSim();
  const scenario = useStore((s) => s.scenario); const addAction = useStore((s) => s.addAction);
  const [kind, setKind] = useState<Kind>('cancel');
  const tails = [...result.sequences.keys()].filter((t) => !net.spares.some((s) => s.tail === t)).sort();
  const operated = result.flights.filter((f) => !f.cancelled).map((f) => f.id);

  const [cFlight, setCFlight] = useState('DS0504'); const [cSet, setCSet] = useState(0);
  const sets = useMemo(() => { try { return cancellationSets(net, scenario.actions, cFlight); } catch { return []; } }, [net, scenario.actions, cFlight]);

  const [spare, setSpare] = useState(net.spares[0].tail); const [sTail, setSTail] = useState('VT-DS05'); const [sFrom, setSFrom] = useState(''); const [sTo, setSTo] = useState('');
  const sSeq = result.sequences.get(sTail) ?? [];
  const sf = sFrom && sSeq.includes(sFrom) ? sFrom : sSeq[0]; const st = sTo && sSeq.includes(sTo) ? sTo : sSeq[sSeq.length - 1];

  const [tA, setTA] = useState('VT-DS12'); const [tB, setTB] = useState('VT-DS05'); const [fA, setFA] = useState(''); const [fB, setFB] = useState('');
  const seqA = result.sequences.get(tA) ?? []; const seqB = result.sequences.get(tB) ?? [];
  const fa = fA && seqA.includes(fA) ? fA : seqA[0]; const fb = fB && seqB.includes(fB) ? fB : seqB[0];

  const [cx, setCx] = useState(net.connections[0].id); const [pf, setPf] = useState(operated[0]);

  const apply = () => {
    let a: RecoveryAction | null = null;
    const id = newActionId('man');
    if (kind === 'cancel') { const ids = sets[cSet] ?? [cFlight]; a = { id, type: 'cancel_flight', flightIds: ids }; }
    if (kind === 'spare') { const i = sSeq.indexOf(sf); const j = sSeq.indexOf(st); if (i >= 0 && j >= i) a = { id, type: 'deploy_spare', spareTail: spare, flightIds: sSeq.slice(i, j + 1) }; }
    if (kind === 'swap') a = { id, type: 'swap_aircraft', tailA: tA, flightA: fa, tailB: tB, flightB: fb };
    if (kind === 'protect') a = { id, type: 'protect_connection', connectionId: cx };
    if (kind === 'prioritize') a = { id, type: 'prioritize_flight', flightId: pf };
    if (!a) { useStore.getState().toast('error', 'Choose a valid flight range.'); return; }
    addAction(a);
  };
  const sel = (v: string, set: (v: string) => void, opts: string[], label: string, id: string) => (
    <Field label={label} htmlFor={id}><select id={id} className={inputCls} value={v} onChange={(e) => set(e.target.value)}>{opts.map((o) => <option key={o}>{o}</option>)}</select></Field>
  );
  void base;
  return (
    <Panel title="Manual recovery action" subtitle="Build your own action. The engine rejects impossible aircraft movements and explains why.">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Field label="Action type" htmlFor="man-kind">
          <select id="man-kind" className={inputCls} value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
            <option value="cancel">Cancel flight(s)</option><option value="spare">Deploy spare aircraft</option><option value="swap">Swap aircraft</option><option value="protect">Protect connection</option><option value="prioritize">Prioritise flight (slots)</option>
          </select>
        </Field>
        {kind === 'cancel' && <>
          {sel(cFlight, (v) => { setCFlight(v); setCSet(0); }, operated, 'Flight to cancel', 'man-cf')}
          <Field label="Cancellation set (keeps aircraft position valid)" htmlFor="man-set">
            {sets.length === 0 ? <p className="text-xs text-bad">No valid set — this flight cannot be cancelled without stranding the aircraft.</p> :
              <select id="man-set" className={inputCls} value={cSet} onChange={(e) => setCSet(Number(e.target.value))}>{sets.map((s, i) => <option key={i} value={i}>{s.join(' + ')}</option>)}</select>}
          </Field>
        </>}
        {kind === 'spare' && <>
          {sel(spare, setSpare, net.spares.map((s) => s.tail), 'Spare aircraft', 'man-sp')}
          {sel(sTail, setSTail, tails, 'Take over flights of', 'man-st')}
          {sel(sf, setSFrom, sSeq, 'From flight', 'man-sf')}
          {sel(st, setSTo, sSeq, 'Through flight', 'man-sto')}
        </>}
        {kind === 'swap' && <>
          {sel(tA, (v) => { setTA(v); setFA(''); }, tails, 'Aircraft A', 'man-ta')}{sel(fa, setFA, seqA, 'A hands over from', 'man-fa')}
          {sel(tB, (v) => { setTB(v); setFB(''); }, tails, 'Aircraft B', 'man-tb')}{sel(fb, setFB, seqB, 'B hands over from', 'man-fb')}
        </>}
        {kind === 'protect' && <Field label="Connection to protect" htmlFor="man-cx"><select id="man-cx" className={inputCls} value={cx} onChange={(e) => setCx(e.target.value)}>
          {net.connections.map((c) => { const r = result.connections.find((x) => x.id === c.id)!; return <option key={c.id} value={c.id}>{c.id} {c.from}→{c.to} ({c.pax} pax){r.status !== 'made' ? ' — BROKEN' : ''}</option>; })}</select></Field>}
        {kind === 'prioritize' && sel(pf, setPf, operated, 'Flight', 'man-pf')}
      </div>
      <div className="mt-3"><Button variant="recovery" onClick={apply}>Apply &amp; re-simulate</Button></div>
    </Panel>
  );
}
