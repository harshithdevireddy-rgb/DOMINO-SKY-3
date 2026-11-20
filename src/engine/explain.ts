import type { Network, Closure, FlightResult, ConnectionResult, Cause, CauseKind, SimulationResult } from '@/types';
import { fmtTime } from './timeUtils';
import { requiredTurnaround } from './aircraftRotation';

const closureAt = (closures: Closure[], airport: string) => closures.find((c) => c.airport === airport);
const closureLabel = (c: Closure | undefined) => (c ? `${fmtTime(c.start)}–${fmtTime(c.end)}` : '');

/** Builds the explanation list for one flight from the already-computed schedule (never from assumptions). */
export function buildCauses(net: Network, closures: Closure[], fr: Map<string, FlightResult>, f: FlightResult): { causes: Cause[]; primary: CauseKind } {
  const causes: Cause[] = [];
  const def = net.flightById.get(f.id)!;
  if (f.cancelled) {
    causes.push({ kind: 'RECOVERY_CANCEL', minutes: 0, text: `${f.id} was cancelled by a recovery action.` });
    return { causes, primary: 'RECOVERY_CANCEL' };
  }
  const b = f.binding;
  if (f.depDelay > 0) {
    switch (b.kind) {
      case 'CLOSURE_DEPARTURE': {
        const c = closureAt(closures, b.airport!);
        causes.push({ kind: 'CLOSURE_DEPARTURE', minutes: f.depDelay, airport: b.airport, text: `Airport closure at ${b.airport} (${closureLabel(c)}) prevented departure; ${f.id} left at reopening (${fmtTime(f.actualDep)}), ${f.depDelay} min after schedule.` });
        break;
      }
      case 'CLOSURE_ARRIVAL_GROUND_HOLD': {
        const c = closureAt(closures, b.airport!);
        causes.push({ kind: 'CLOSURE_ARRIVAL_GROUND_HOLD', minutes: f.depDelay, airport: b.airport, text: `Destination ${b.airport} is closed ${closureLabel(c)}; departure was held on the ground so arrival falls after reopening (departed ${fmtTime(f.actualDep)}, ${f.depDelay} min late).` });
        break;
      }
      case 'ROTATION': {
        const p = fr.get(b.from!)!;
        const ready = p.actualArr! + requiredTurnaround(net, def);
        causes.push({ kind: 'ROTATION', minutes: f.depDelay, sourceFlight: b.from, text: `Aircraft ${f.tail} arrived late from ${b.from} (${fmtTime(p.actualArr)}, ${p.arrDelay} min late). With the required ${requiredTurnaround(net, def)} min turnaround it was ready at ${fmtTime(ready)} vs scheduled departure ${fmtTime(f.schedDep)} → ${f.depDelay} min delay propagated along the rotation.` });
        break;
      }
      case 'CAPACITY':
        causes.push({ kind: 'CAPACITY', minutes: f.depDelay, airport: b.airport, text: `${b.airport} hourly capacity (${net.airportById.get(b.airport!)!.capacityPerHour}/h unless overridden) was exhausted; the slot moved to a later hour (${f.depDelay} min).` });
        break;
      case 'CONNECTION_HOLD':
        causes.push({ kind: 'CONNECTION_HOLD', minutes: f.depDelay, sourceFlight: b.from, text: `Departure deliberately held to protect connection ${b.connectionId} from ${b.from} (recovery action).` });
        break;
      case 'SPARE_AVAILABILITY':
        causes.push({ kind: 'ROTATION', minutes: f.depDelay, text: `Spare aircraft ${f.tail} was not yet available.` });
        break;
      default: break;
    }
  }
  if (f.airborneHold > 0) {
    const dest = closures.find((c) => c.airport === def.dest);
    causes.push({ kind: 'CLOSURE_AIRBORNE_HOLD', minutes: f.airborneHold, airport: def.dest, text: `${f.id} was already airborne when ${def.dest} closed (${closureLabel(dest)}); it held and landed at reopening, adding ${f.airborneHold} min (diversions are not modelled).` });
  }
  const primary: CauseKind = causes.length ? causes[0].kind : 'NONE';
  return { causes, primary };
}

export interface ChainStep { kind: 'root' | 'flight' | 'absorbed' | 'effect' | 'connection'; text: string; flightId?: string; delay?: number }

/** Causal chain for a flight: upstream root cause → … → this flight → downstream effects (from the computed schedule). */
export function buildChain(net: Network, res: SimulationResult, flightId: string): ChainStep[] {
  const steps: ChainStep[] = [];
  const get = (id: string) => res.flightById.get(id)!;
  const f0 = get(flightId);
  if (f0.cancelled) return [{ kind: 'root', text: `${flightId} cancelled by recovery action`, flightId }, ...downstream(net, res, flightId, [])];
  // upstream
  const path: string[] = [flightId];
  let cur = f0; const seen = new Set<string>([flightId]);
  while ((cur.binding.kind === 'ROTATION' || cur.binding.kind === 'CONNECTION_HOLD') && cur.binding.from && !seen.has(cur.binding.from)) {
    cur = get(cur.binding.from); path.unshift(cur.id); seen.add(cur.id);
  }
  const root = get(path[0]);
  const rc = root.causes[0];
  if (rc && rc.kind !== 'ROTATION') {
    steps.push({ kind: 'root', text: rc.kind.startsWith('CLOSURE') ? `${rc.airport} airport closure (${closureLabelFor(res, rc.airport!)})` : rc.text, flightId: root.id });
  } else if (root.airborneHold > 0 && root.causes.some((c) => c.kind === 'CLOSURE_AIRBORNE_HOLD')) {
    const ac = root.causes.find((c) => c.kind === 'CLOSURE_AIRBORNE_HOLD')!;
    steps.push({ kind: 'root', text: `${ac.airport} airport closure (${closureLabelFor(res, ac.airport!)})`, flightId: root.id });
  } else if (root.arrDelay === 0 && root.depDelay === 0) {
    steps.push({ kind: 'root', text: 'No disruption reaches this flight — it operates as scheduled.', flightId });
    return [...steps, ...downstream(net, res, flightId, [])];
  }
  for (const id of path) {
    const r = get(id);
    const hold = r.airborneHold > 0 ? ` (incl. ${r.airborneHold} min airborne hold)` : '';
    steps.push({ kind: 'flight', flightId: id, delay: r.arrDelay, text: `${id} ${net.flightById.get(id)!.origin}→${net.flightById.get(id)!.dest} — departs ${fmtTime(r.actualDep)} (+${r.depDelay}m), arrives ${fmtTime(r.actualArr)} (+${r.arrDelay}m)${hold}` });
  }
  return [...steps, ...downstream(net, res, flightId, path)];
}

const closureLabelFor = (res: SimulationResult, airport: string) => {
  const c = res.scenario.closures.find((x) => x.airport === airport);
  return c ? closureLabel(c) : '';
};

function downstream(net: Network, res: SimulationResult, flightId: string, path: string[]): ChainStep[] {
  const out: ChainStep[] = [];
  let cur = flightId; const seen = new Set(path);
  const seq = (tail: string) => res.sequences.get(tail) ?? [];
  for (;;) {
    const cf = res.flightById.get(cur)!;
    const s = seq(cf.tail); const i = s.indexOf(cur);
    const next = i >= 0 ? s[i + 1] : undefined;
    if (!next || seen.has(next)) break;
    seen.add(next);
    const nf = res.flightById.get(next)!;
    if (nf.binding.kind === 'ROTATION' && nf.binding.from === cur && nf.depDelay > 0) {
      out.push({ kind: 'flight', flightId: next, delay: nf.arrDelay, text: `${next} inherits the delay — departs ${fmtTime(nf.actualDep)} (+${nf.depDelay}m), arrives ${fmtTime(nf.actualArr)} (+${nf.arrDelay}m)` });
      cur = next;
    } else {
      const buf = net.flightById.get(next)!.schedTurn;
      out.push({ kind: 'absorbed', flightId: next, text: `${next} absorbs the delay: scheduled turnaround ${buf ?? '—'} min vs ${net.minTurnaround} min required` + (nf.absorbed > 0 ? ` (absorbed ${nf.absorbed} min)` : '') });
      break;
    }
  }
  // flights on other aircraft held because of this flight (connection holds)
  for (const f of res.flights) {
    if (f.binding.kind === 'CONNECTION_HOLD' && f.binding.from === flightId && f.depDelay > 0) out.push({ kind: 'effect', flightId: f.id, text: `${f.id} held ${f.depDelay} min to protect connection ${f.binding.connectionId}` });
  }
  const chain = [flightId, ...out.filter((o) => o.kind === 'flight').map((o) => o.flightId!)];
  const broken = res.connections.filter((c) => c.status !== 'made' && (chain.includes(c.from) || chain.includes(c.to)));
  const pax = broken.reduce((a, c) => a + c.pax, 0);
  for (const c of broken) out.push({ kind: 'connection', text: `${c.id}: ${c.pax} connecting pax ${c.status === 'missed' ? `miss ${c.to} (${c.transfer} min < ${c.minConnect} min)` : c.status === 'from_cancelled' ? `lose inbound ${c.from}` : `lose onward ${c.to}`}`, flightId: c.to });
  if (broken.length) out.push({ kind: 'effect', text: `${pax} connecting passengers impacted across ${broken.length} broken connection${broken.length > 1 ? 's' : ''}` });
  return out;
}

export const connectionImpactSummary = (cx: ConnectionResult[]) => cx.filter((c) => c.status !== 'made');
