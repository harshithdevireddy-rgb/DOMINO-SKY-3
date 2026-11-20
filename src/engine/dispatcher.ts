import type { Network, Scenario, RecoveryAction, SimulationResult, Metrics } from '@/types';
import { simulate } from './simulation';
import { cancellationSets, validateActions, describeAction } from './recovery';
import { CONFIG } from './config';
import { fmtTime } from './timeUtils';

export type OptionNo = 1 | 2 | 3 | 4 | 5 | 6;
export const OPTION_LABELS: Record<OptionNo, string> = {
  1: 'Cancel a flight', 2: 'Deploy spare aircraft', 3: 'Aircraft swap', 4: 'Prioritise a flight', 5: 'Protect passenger connections', 6: 'Alternative: restore crew compliance',
};

export interface MetricDelta {
  delayMinutes: number; delayedFlights: number; cancelledFlights: number; paxImpacted: number; stranded: number;
  missedConnectionPax: number; crewViolations: number; cost: number;
}
export interface Recommendation {
  id: string; option: OptionNo; optionLabel: string; actions: RecoveryAction[]; title: string;
  rationale: string[]; tradeoffs: string[];
  before: Metrics; after: Metrics;
  /** positive = improvement (before − after) */
  delta: MetricDelta;
}
export interface Bottleneck { kind: 'root_cause' | 'aircraft' | 'connection' | 'crew' | 'airport'; text: string; flightId?: string; tail?: string; delayMinutes?: number; downstreamFlights?: number }
export interface DispatcherReport {
  current: Metrics; bottlenecks: Bottleneck[];
  recommendations: Recommendation[];   // each evaluated independently against the current scenario, best first
  plan: Recommendation[];              // greedy compatible sequence; each step evaluated after the previous ones
  planAfter: Metrics | null;
  evaluated: number;
}

export const deltaOf = (b: Metrics, a: Metrics): MetricDelta => ({
  delayMinutes: b.totalDelayMinutes - a.totalDelayMinutes, delayedFlights: b.delayed - a.delayed, cancelledFlights: b.cancelled - a.cancelled,
  paxImpacted: b.pax.impacted - a.pax.impacted, stranded: b.pax.stranded - a.pax.stranded, missedConnectionPax: b.missedConnectionPax - a.missedConnectionPax,
  crewViolations: b.crewViolations - a.crewViolations, cost: b.cost - a.cost,
});

let counter = 0;
const nextId = (p: string) => `${p}-${++counter}`;

/** Root-cause attribution: follow rotation/hold bindings back to the flight where the delay originated. */
export function analyseBottlenecks(net: Network, res: SimulationResult): Bottleneck[] {
  const out: Bottleneck[] = [];
  const rootOf = (id: string): string => {
    let cur = res.flightById.get(id)!; const seen = new Set<string>();
    while ((cur.binding.kind === 'ROTATION' || cur.binding.kind === 'CONNECTION_HOLD') && cur.binding.from && !seen.has(cur.id)) { seen.add(cur.id); cur = res.flightById.get(cur.binding.from)!; }
    return cur.id;
  };
  const groups = new Map<string, string[]>();
  for (const f of res.flights) if (!f.cancelled && f.arrDelay >= CONFIG.delayThreshold) { const r = rootOf(f.id); groups.set(r, [...(groups.get(r) ?? []), f.id]); }
  for (const [root, members] of [...groups].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))) {
    const rf = res.flightById.get(root)!;
    const total = members.reduce((a, id) => a + res.flightById.get(id)!.arrDelay, 0);
    out.push({
      kind: 'root_cause', flightId: root, tail: rf.tail, delayMinutes: total, downstreamFlights: members.length - 1,
      text: `${root} (${rf.causes[0]?.kind.replace(/_/g, ' ').toLowerCase() ?? 'origin'}, +${rf.arrDelay} min) is the origin of ${members.length} delayed flight${members.length > 1 ? 's' : ''} (${total} delay minutes in total).`,
    });
  }
  const byTail = new Map<string, number>();
  for (const f of res.flights) if (!f.cancelled) byTail.set(f.scheduledTail, (byTail.get(f.scheduledTail) ?? 0) + f.arrDelay);
  const worst = [...byTail].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  if (worst && worst[1] > 0) out.push({ kind: 'aircraft', tail: worst[0], delayMinutes: worst[1], text: `${worst[0]} accumulates the most delay (${worst[1]} min across its rotation).` });
  for (const c of res.connections.filter((x) => x.status !== 'made')) out.push({ kind: 'connection', text: `${c.id} at ${c.airport}: ${c.pax} passengers ${c.status === 'missed' ? `have ${c.transfer} min against ${c.minConnect} min required` : 'lose their journey (cancelled flight)'}.` });
  for (const c of res.crews.filter((x) => x.violation)) out.push({ kind: 'crew', text: `${c.crewId} (${c.tail}) will be on duty ${c.dutyMinutes} min vs ${c.maxDuty} min limit — ${c.excess} min over (last arrival ${fmtTime(c.lastArr)}).` });
  const ap = [...res.airports].filter((a) => a.affectedFlights > 0).sort((a, b) => b.affectedFlights - a.affectedFlights || a.id.localeCompare(b.id))[0];
  if (ap) out.push({ kind: 'airport', text: `${ap.id} touches the most affected flights (${ap.affectedFlights}, ${ap.affectedPax} seat-passengers).` });
  void net;
  return out;
}

interface Candidate { option: OptionNo; actions: RecoveryAction[]; title: string }

function candidates(net: Network, sc: Scenario, cur: SimulationResult): Candidate[] {
  const out: Candidate[] = [];
  const base = sc.actions;
  const delayedIds = new Set(cur.flights.filter((f) => !f.cancelled && f.arrDelay >= CONFIG.delayThreshold).map((f) => f.id));

  // Option 5 — protect broken connections
  for (const c of cur.connections.filter((x) => x.status === 'missed')) {
    const a: RecoveryAction = { id: nextId('act'), type: 'protect_connection', connectionId: c.id };
    out.push({ option: 5, actions: [a], title: describeAction(net, a) });
  }
  // Option 1 / 6 — cancellations (severe delays, crew-limit breaches)
  const cancelTargets = new Set<string>();
  for (const f of cur.flights) if (!f.cancelled && f.status === 'severe') cancelTargets.add(f.id);
  for (const c of cur.crews.filter((x) => x.violation)) { const last = c.flights[c.flights.length - 1]; if (last) cancelTargets.add(last); for (const id of c.flightsBeyondLimit) cancelTargets.add(id); }
  for (const id of cancelTargets) {
    for (const ids of cancellationSets(net, base, id).slice(0, 3)) {
      const a: RecoveryAction = { id: nextId('act'), type: 'cancel_flight', flightIds: ids };
      out.push({ option: 1, actions: [a], title: describeAction(net, a) });
    }
  }
  // Option 2 — spare aircraft takes over a contiguous run that closes a loop (or ends the day)
  for (const s of net.spares) {
    if (base.some((a) => a.type === 'deploy_spare' && a.spareTail === s.tail)) continue;
    for (const [tail, seq] of cur.sequences) {
      if (net.spares.some((x) => x.tail === tail)) continue;
      for (let i = 0; i < seq.length; i++) {
        const first = net.flightById.get(seq[i])!;
        if (first.origin !== s.base || first.schedDep < s.availableFrom) continue;
        for (let j = i; j < seq.length; j++) {
          const run = seq.slice(i, j + 1);
          if (!run.some((id) => delayedIds.has(id))) continue;
          const a: RecoveryAction = { id: nextId('act'), type: 'deploy_spare', spareTail: s.tail, flightIds: run };
          out.push({ option: 2, actions: [a], title: describeAction(net, a) });
        }
      }
    }
  }
  // Option 3 — suffix swap between two aircraft at the same airport
  const seqs = [...cur.sequences];
  for (const [ta, sa] of seqs) {
    if (net.spares.some((s) => s.tail === ta)) continue;
    for (let i = 0; i < sa.length; i++) {
      if (!sa.slice(i).some((id) => delayedIds.has(id))) continue;
      const fa = net.flightById.get(sa[i])!;
      for (const [tb, sb] of seqs) {
        if (tb === ta || net.spares.some((s) => s.tail === tb)) continue;
        for (let j = 0; j < sb.length; j++) {
          const fb = net.flightById.get(sb[j])!;
          if (fb.origin !== fa.origin) continue;
          const a: RecoveryAction = { id: nextId('act'), type: 'swap_aircraft', tailA: ta, flightA: fa.id, tailB: tb, flightB: fb.id };
          out.push({ option: 3, actions: [a], title: describeAction(net, a) });
        }
      }
    }
  }
  // Option 4 — slot priority only matters where capacity is the binding constraint
  for (const f of cur.flights) if (!f.cancelled && f.binding.kind === 'CAPACITY') {
    const a: RecoveryAction = { id: nextId('act'), type: 'prioritize_flight', flightId: f.id };
    out.push({ option: 4, actions: [a], title: describeAction(net, a) });
  }
  // de-duplicate identical actions generated from different triggers
  const seen = new Set<string>();
  return out.filter((c) => { const { id: _id, ...rest } = c.actions[0] as RecoveryAction & { id: string }; void _id; const k = JSON.stringify(rest); if (seen.has(k)) return false; seen.add(k); return true; });
}

function explain(net: Network, c: Candidate, before: SimulationResult, after: SimulationResult, d: MetricDelta): { rationale: string[]; tradeoffs: string[]; option: OptionNo } {
  const rationale: string[] = []; const tradeoffs: string[] = [];
  const b = before.metrics; const a = after.metrics;
  let option = c.option;
  if (d.delayMinutes !== 0) rationale.push(`Total delay ${b.totalDelayMinutes} → ${a.totalDelayMinutes} min (${d.delayMinutes > 0 ? '−' : '+'}${Math.abs(d.delayMinutes)}).`);
  if (d.delayedFlights !== 0) rationale.push(`Delayed flights ${b.delayed} → ${a.delayed}.`);
  if (d.paxImpacted !== 0) rationale.push(`Impacted passengers ${b.pax.impacted} → ${a.pax.impacted}.`);
  if (d.missedConnectionPax !== 0) rationale.push(`Missed-connection passengers ${b.missedConnectionPax} → ${a.missedConnectionPax}.`);
  if (d.crewViolations !== 0) rationale.push(`Crew duty violations ${b.crewViolations} → ${a.crewViolations}.`);
  const act = c.actions[0];
  if (act.type === 'protect_connection') {
    const cx = after.connections.find((x) => x.id === act.connectionId)!;
    const held = after.flightById.get(cx.to)!;
    rationale.unshift(`Holding ${cx.to} for ${held.depDelay - (before.flightById.get(cx.to)!.depDelay)} extra min protects ${cx.pax} connecting passengers (${cx.id}, ${cx.transfer ?? '—'} min transfer ≥ ${cx.minConnect} min).`);
  }
  if (act.type === 'cancel_flight') {
    const stranded = act.flightIds.reduce((s, id) => s + net.flightById.get(id)!.pax, 0);
    rationale.unshift(`Cancels ${act.flightIds.join(' + ')} (${stranded} seat-passengers on the cancelled flights; aircraft continuity preserved).`);
    if (d.crewViolations > 0) option = 6;
  }
  if (act.type === 'deploy_spare') {
    const sp = net.spares.find((s) => s.tail === act.spareTail)!;
    rationale.unshift(`${act.spareTail} is based at ${sp.base}, available from ${fmtTime(sp.availableFrom)}, ${sp.seats} seats; it departs ${act.flightIds[0]} on schedule from ${net.flightById.get(act.flightIds[0])!.origin}. A standby crew operates the flights.`);
  }
  if (act.type === 'swap_aircraft') rationale.unshift(`Both aircraft are at ${net.flightById.get(act.flightA)!.origin}; exchanging rotations from ${act.flightA} / ${act.flightB} lets the on-time aircraft carry the delayed rotation.`);
  if (act.type === 'prioritize_flight') rationale.unshift(`${act.flightId} is waiting for an airport slot; giving it priority is the only lever when capacity binds.`);
  if (d.stranded < 0) tradeoffs.push(`Strands ${-d.stranded} more passengers (stranded ${b.pax.stranded} → ${a.pax.stranded}).`);
  if (d.cancelledFlights < 0) tradeoffs.push(`${-d.cancelledFlights} additional cancelled flight${-d.cancelledFlights > 1 ? 's' : ''}.`);
  if (d.delayMinutes < 0) tradeoffs.push(`Adds ${-d.delayMinutes} delay minutes elsewhere.`);
  if (d.delayedFlights < 0) tradeoffs.push(`${-d.delayedFlights} more flight${-d.delayedFlights > 1 ? 's' : ''} delayed.`);
  if (d.crewViolations < 0) tradeoffs.push(`Creates ${-d.crewViolations} crew duty violation${-d.crewViolations > 1 ? 's' : ''}.`);
  if (d.paxImpacted < 0) tradeoffs.push(`${-d.paxImpacted} more passengers impacted.`);
  if (act.type === 'deploy_spare') tradeoffs.push('Consumes the spare aircraft and a standby crew (no further spare use at this slot).');
  if (act.type === 'swap_aircraft') tradeoffs.push('Crews follow their aircraft, so duty hours move between the two crews.');
  return { rationale, tradeoffs, option };
}

/** Evaluates every feasible candidate with the real simulation engine; nothing here is estimated. */
export function recommend(net: Network, sc: Scenario, opts: { maxPlanSteps?: number } = {}): DispatcherReport {
  counter = 0;
  const cur = simulate(net, sc);
  const bottlenecks = analyseBottlenecks(net, cur);
  let evaluated = 0;
  const evaluate = (scn: Scenario, curRes: SimulationResult): Recommendation[] => {
    const recs: Recommendation[] = [];
    for (const c of candidates(net, scn, curRes)) {
      const next: Scenario = { ...scn, actions: [...scn.actions, ...c.actions] };
      if (validateActions(net, next.actions) !== null) continue;
      let after: SimulationResult;
      try { after = simulate(net, next); } catch { continue; }
      evaluated++;
      if (after.rejectedActions.length) continue;
      const d = deltaOf(curRes.metrics, after.metrics);
      if (d.cost <= 0) continue;
      const ex = explain(net, c, curRes, after, d);
      recs.push({ id: c.actions[0].id, option: ex.option, optionLabel: OPTION_LABELS[ex.option], actions: c.actions, title: c.title, rationale: ex.rationale, tradeoffs: ex.tradeoffs, before: curRes.metrics, after: after.metrics, delta: d });
    }
    // best first; fewer cancellations and then id for deterministic ties
    const footprint = (r: Recommendation) => r.actions.reduce((n, a) => n + (a.type === 'cancel_flight' || a.type === 'deploy_spare' ? a.flightIds.length : 1), 0);
    return recs.sort((x, y) => y.delta.cost - x.delta.cost || x.after.cancelled - y.after.cancelled || footprint(x) - footprint(y) || x.title.localeCompare(y.title));
  };
  const recommendations = evaluate(sc, cur);
  // Greedy plan of compatible actions
  const plan: Recommendation[] = [];
  let scn = sc; let res = cur;
  for (let step = 0; step < (opts.maxPlanSteps ?? 5); step++) {
    const recs = step === 0 ? recommendations : evaluate(scn, res);
    const best = recs[0];
    if (!best) break;
    plan.push(best);
    scn = { ...scn, actions: [...scn.actions, ...best.actions] };
    res = simulate(net, scn);
  }
  return { current: cur.metrics, bottlenecks, recommendations: recommendations.slice(0, 12), plan, planAfter: plan.length ? res.metrics : null, evaluated };
}

/** Structured, numbers-only payload for the optional LLM narrator. */
export function buildAiPayload(net: Network, sc: Scenario, report: DispatcherReport) {
  const m = report.current;
  return {
    scenario: { closures: sc.closures.map((c) => ({ airport: c.airport, start: fmtTime(c.start), end: fmtTime(c.end) })), appliedActions: sc.actions.map((a) => describeAction(net, a)) },
    metrics: { status: m.status, totalFlights: m.totalFlights, delayedFlights: m.delayed, severeFlights: m.severe, cancelledFlights: m.cancelled, totalDelayMinutes: m.totalDelayMinutes, passengersImpacted: m.pax.impacted, passengersStranded: m.pax.stranded, missedConnectionPassengers: m.missedConnectionPax, crewViolations: m.crewViolations },
    bottlenecks: report.bottlenecks.map((b) => b.text),
    candidates: report.recommendations.slice(0, 8).map((r) => ({
      id: r.id, option: r.optionLabel, title: r.title,
      delayMinutesSaved: r.delta.delayMinutes, delayedFlightsAvoided: r.delta.delayedFlights, passengersImpactedChange: r.delta.paxImpacted, strandedChange: r.delta.stranded,
      missedConnectionPaxChange: r.delta.missedConnectionPax, crewViolationsChange: r.delta.crewViolations, tradeoffs: r.tradeoffs,
    })),
    recommendedSequence: report.plan.map((r) => r.id),
  };
}
