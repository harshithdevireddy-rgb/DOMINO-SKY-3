import type {
  Network, Scenario, SimulationResult, FlightResult, Binding, SimEvent, Metrics, AirportImpact, NetworkStatus, RejectedAction, FlightStatus,
} from '@/types';
import { SimulationError } from '@/types';
import { CONFIG } from './config';
import { CapacityTracker } from './airportCapacity';
import { requiredTurnaround } from './aircraftRotation';
import { buildPlan, type Plan } from './recovery';
import { evaluateConnections } from './connections';
import { accountPassengers } from './passengerImpact';
import { crewIdForTail, evaluateCrews } from './crewDuty';
import { buildCauses } from './explain';
import { inWindow, nextBucketStart, fmtTime } from './timeUtils';

interface Resolved { dep: number; arr: number; binding: Binding; airborne: number }

/**
 * Deterministic disruption simulation. No randomness, no LLM, no wall-clock dependence.
 *
 * RULES (also in README):
 *  1. Aircraft rotation: dep ≥ pred.actualArr + required turnaround (30). Delay never negative (no early departures).
 *  2. Closure – departures: a departure inside a closure window at its origin waits until the window ends.
 *  3. Closure – arrivals: if the arrival would fall inside a closure window at the destination,
 *       (a) flight not yet departed when the closure began → ground-held at origin so it lands at reopening;
 *       (b) flight already airborne when the closure began → holds airborne and lands at reopening (no diversions).
 *  4. Capacity: ≤ capacity_per_hour movements per clock-hour per airport (dep + arr). Overflow moves to the next hour.
 *     Slot order: earliest feasible departure, then priority flag, then scheduled departure, then flight id.
 *  5. Recovery connection holds delay the onward flight until inbound arrival + min_connect (rejected above maxConnectionHold).
 *  6. Cancelled flights do not fly; aircraft continuity is enforced by the plan builder (recovery.ts).
 */
export function simulate(net: Network, scenario: Scenario): SimulationResult {
  const plan = buildPlan(net, scenario.actions);
  for (const c of scenario.closures) {
    if (!net.airportById.has(c.airport)) throw new SimulationError(`Unknown closure airport ${c.airport}`);
    if (!(c.end > c.start)) throw new SimulationError(`Closure at ${c.airport} must end after it starts`);
  }
  const closures = scenario.closures;
  const closuresAt = (a: string) => closures.filter((c) => c.airport === a);
  const cap = new CapacityTracker((a) => Math.max(1, scenario.capacityOverrides?.[a] ?? net.airportById.get(a)!.capacityPerHour));

  const pred = new Map<string, string | null>();
  for (const seq of plan.sequences.values()) seq.forEach((id, i) => pred.set(id, i === 0 ? null : seq[i - 1]));

  const resolved = new Map<string, Resolved>();
  const rejected: RejectedAction[] = [];
  const holdAction = (cid: string) => scenario.actions.find((a) => a.type === 'protect_connection' && a.connectionId === cid)?.id ?? cid;
  const unresolved = new Set([...pred.keys()]);

  while (unresolved.size) {
    let best: { id: string; t: number; binding: Binding; key: [number, number, number, string] } | null = null;
    for (const id of unresolved) {
      const p = pred.get(id) ?? null;
      const holds = plan.holds.get(id) ?? [];
      if ((p && !resolved.has(p)) || holds.some((h) => !resolved.has(h.fromFlight))) continue;
      const f = net.flightById.get(id)!;
      let t = f.schedDep; let binding: Binding = { kind: 'SCHEDULE' };
      if (p) {
        const ready = resolved.get(p)!.arr + requiredTurnaround(net, f);
        if (ready > t) { t = ready; binding = { kind: 'ROTATION', from: p }; }
      } else {
        const spare = net.spares.find((s) => s.tail === plan.tailOf.get(id));
        if (spare && spare.availableFrom > t) { t = spare.availableFrom; binding = { kind: 'SPARE_AVAILABILITY' }; }
      }
      for (const h of holds) {
        const need = resolved.get(h.fromFlight)!.arr + h.minConnect;
        if (need > t) {
          if (need - t > CONFIG.maxConnectionHold) {
            if (!rejected.some((r) => r.actionId === holdAction(h.connectionId))) rejected.push({ actionId: holdAction(h.connectionId), reason: `Protecting ${h.connectionId} needs a ${need - t} min hold of ${id}, above the ${CONFIG.maxConnectionHold} min limit.` });
          } else { t = need; binding = { kind: 'CONNECTION_HOLD', from: h.fromFlight, connectionId: h.connectionId }; }
        }
      }
      const key: [number, number, number, string] = [t, plan.priority.has(id) ? 0 : 1, f.schedDep, id];
      if (!best || cmp(key, best.key) < 0) best = { id, t, binding, key };
    }
    if (!best) throw new SimulationError('Circular dependency between flights — the recovery actions create a deadlock.');

    const f = net.flightById.get(best.id)!;
    let t = best.t; let binding = best.binding;
    let arrival: number;
    // arrival lower bound caused by airborne holds (closure reopening / capacity); only valid for the departure time it was derived for
    let arrFloor = 0; let floorT = t;
    const destClosures = closuresAt(f.dest); const origClosures = closuresAt(f.origin);
    for (let iter = 0; ; iter++) {
      if (iter > CONFIG.maxFixedPointIterations) throw new SimulationError(`Departure for ${f.id} did not converge.`);
      let changed = false;
      for (const c of origClosures) if (inWindow(t, c.start, c.end)) { t = c.end; binding = { kind: 'CLOSURE_DEPARTURE', airport: f.origin }; changed = true; }
      if (t !== floorT) { arrFloor = 0; floorT = t; }
      arrival = Math.max(t + f.block, arrFloor);
      let again = true;
      while (again) {
        again = false;
        for (const c of destClosures) {
          if (!inWindow(arrival, c.start, c.end)) continue;
          if (t < c.start) { arrFloor = Math.max(arrFloor, c.end); arrival = Math.max(arrival, c.end); } // already airborne when closure began → hold
          else { t = c.end - f.block; floorT = t; arrFloor = 0; arrival = c.end; binding = { kind: 'CLOSURE_ARRIVAL_GROUND_HOLD', airport: f.dest }; changed = true; }
          again = true;
        }
      }
      if (!cap.hasRoom(f.origin, t)) { t = nextBucketStart(t); binding = { kind: 'CAPACITY', airport: f.origin }; continue; }
      if (!cap.hasRoom(f.dest, arrival)) {
        if (arrival > t + f.block) arrFloor = nextBucketStart(arrival); // airborne: hold until the next hour's slot
        else { t = nextBucketStart(arrival) - f.block; binding = { kind: 'CAPACITY', airport: f.dest }; }
        continue;
      }
      if (!changed) break;
    }
    cap.add(f.origin, t); cap.add(f.dest, arrival);
    resolved.set(f.id, { dep: t, arr: arrival, binding, airborne: arrival - (t + f.block) });
    unresolved.delete(f.id);
  }

  // ───── flight results ─────
  const fr = new Map<string, FlightResult>();
  for (const f of net.flights) {
    const cancelled = plan.cancelled.has(f.id);
    const r = resolved.get(f.id);
    const tail = plan.tailOf.get(f.id)!;
    const depDelay = r ? r.dep - f.schedDep : 0;
    const arrDelay = r ? r.arr - f.schedArr : 0;
    const p = pred.get(f.id) ?? null;
    let absorbed = 0;
    if (r && p) {
      const pr = fr.get(p) ?? null;
      const pArrDelay = pr ? pr.arrDelay : resolved.get(p)!.arr - net.flightById.get(p)!.schedArr;
      const rotDelay = Math.max(0, resolved.get(p)!.arr + requiredTurnaround(net, f) - f.schedDep);
      absorbed = Math.max(0, Math.min(pArrDelay, pArrDelay - rotDelay));
    }
    let status: FlightStatus = 'on_time';
    if (cancelled) status = 'cancelled';
    else if (arrDelay >= CONFIG.severeThreshold) status = 'severe';
    else if (arrDelay >= CONFIG.delayThreshold) status = 'delayed';
    fr.set(f.id, {
      id: f.id, tail, scheduledTail: f.tail, cancelled, schedDep: f.schedDep, schedArr: f.schedArr,
      actualDep: r ? r.dep : null, actualArr: r ? r.arr : null, depDelay, arrDelay,
      airborneHold: r ? r.airborne : 0,
      status, binding: r ? r.binding : { kind: 'SCHEDULE' }, predecessor: p, reassigned: tail !== f.tail,
      crewId: cancelled ? null : crewIdForTail(net, tail), causes: [], primaryCause: 'NONE', absorbed,
    });
  }
  for (const r of fr.values()) {
    const { causes, primary } = buildCauses(net, closures, fr, r);
    r.causes = causes; r.primaryCause = primary;
  }

  const connections = evaluateConnections(net, fr);
  const crews = evaluateCrews(net, plan, fr);
  const pax = accountPassengers(net, fr, connections);
  const flights = net.flights.map((f) => fr.get(f.id)!);
  const airports = airportImpacts(net, flights, closures);
  const metrics = computeMetrics(flights, connections, crews, pax, airports);
  const events = buildEvents(net, scenario, plan, flights, connections);

  return { scenario, flights, flightById: fr, connections, crews, airports, metrics, events, sequences: plan.sequences, rejectedActions: rejected };
}

const cmp = (a: [number, number, number, string], b: [number, number, number, string]) =>
  a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || (a[3] < b[3] ? -1 : a[3] > b[3] ? 1 : 0);

function airportImpacts(net: Network, flights: FlightResult[], closures: { airport: string }[]): AirportImpact[] {
  return net.airports.map((a) => {
    let incoming = 0; let outgoing = 0; let affectedFlights = 0; let affectedPax = 0; let delayMinutes = 0;
    for (const f of flights) {
      const d = net.flightById.get(f.id)!;
      const touches = d.origin === a.id || d.dest === a.id;
      if (!touches) continue;
      if (d.dest === a.id) incoming++;
      if (d.origin === a.id) outgoing++;
      if (f.cancelled || f.arrDelay >= CONFIG.delayThreshold) { affectedFlights++; affectedPax += d.pax; }
      if (d.origin === a.id && !f.cancelled) delayMinutes += f.depDelay;
    }
    const closed = closures.some((c) => c.airport === a.id);
    return { id: a.id, incoming, outgoing, affectedFlights, affectedPax, delayMinutes, closed, status: closed ? 'closed' : affectedFlights > 0 ? 'affected' : 'normal' } as AirportImpact;
  });
}

export function networkStatus(m: { affectedShare: number; stranded: number; crewViolations: number; affected: number; severe: number }): NetworkStatus {
  if (m.affected === 0 && m.crewViolations === 0) return 'NORMAL';
  if (m.affectedShare >= CONFIG.status.majorMax || m.crewViolations >= CONFIG.status.criticalCrewViolations) return 'CRITICAL';
  if (m.affectedShare >= CONFIG.status.minorMax || m.stranded > 0 || m.crewViolations > 0 || m.severe >= CONFIG.status.majorSevere) return 'MAJOR';
  return 'MINOR';
}

function computeMetrics(flights: FlightResult[], connections: SimulationResult['connections'], crews: SimulationResult['crews'], pax: SimulationResult['metrics']['pax'], airports: AirportImpact[]): Metrics {
  const operated = flights.filter((f) => !f.cancelled);
  const delayed = operated.filter((f) => f.arrDelay >= CONFIG.delayThreshold);
  const cancelled = flights.length - operated.length;
  const severe = delayed.filter((f) => f.arrDelay >= CONFIG.severeThreshold).length;
  const tailsAffected = new Set<string>();
  for (const f of flights) if (f.cancelled || f.arrDelay >= CONFIG.delayThreshold || f.reassigned) tailsAffected.add(f.scheduledTail);
  const broken = connections.filter((c) => c.status !== 'made');
  const crewViolations = crews.filter((c) => c.violation);
  const excess = crewViolations.reduce((a, c) => a + c.excess, 0);
  const affected = delayed.length + cancelled;
  const cost = pax.paxDelayMinutes * CONFIG.cost.paxDelayMinute + pax.stranded * CONFIG.cost.strandedPax
    + crewViolations.length * CONFIG.cost.crewViolation + excess * CONFIG.cost.crewExcessMinute;
  const status = networkStatus({ affectedShare: affected / flights.length, stranded: pax.stranded, crewViolations: crewViolations.length, affected, severe });
  return {
    totalFlights: flights.length, operated: operated.length, onTime: operated.length - delayed.length, delayed: delayed.length, severe, cancelled,
    totalDelayMinutes: delayed.reduce((a, f) => a + f.arrDelay, 0), totalDepDelayMinutes: operated.reduce((a, f) => a + f.depDelay, 0),
    maxDelay: operated.reduce((a, f) => Math.max(a, f.arrDelay), 0),
    aircraftAffected: tailsAffected.size, airportsAffected: airports.filter((a) => a.status !== 'normal').length,
    pax, brokenConnections: broken.length, connectionsTotal: connections.length,
    missedConnectionPax: pax.missedConnection, crewViolations: crewViolations.length, crewExcessMinutes: excess, cost, status,
  };
}

function buildEvents(net: Network, sc: Scenario, plan: Plan, flights: FlightResult[], connections: SimulationResult['connections']): SimEvent[] {
  const ev: SimEvent[] = [];
  for (const c of sc.closures) {
    ev.push({ time: c.start, kind: 'closure_start', airport: c.airport, text: `${c.airport} closes (until ${fmtTime(c.end)})` });
    ev.push({ time: c.end, kind: 'closure_end', airport: c.airport, text: `${c.airport} reopens` });
  }
  for (const f of flights) {
    const d = net.flightById.get(f.id)!;
    if (f.cancelled) { ev.push({ time: f.schedDep, kind: 'cancellation', flightId: f.id, tail: f.scheduledTail, text: `${f.id} ${d.origin}→${d.dest} cancelled` }); continue; }
    ev.push({ time: f.actualDep!, kind: 'departure', flightId: f.id, tail: f.tail, airport: d.origin, delay: f.depDelay, text: `${f.id} departs ${d.origin}${f.depDelay ? ` (+${f.depDelay}m)` : ''}` });
    ev.push({ time: f.actualArr!, kind: 'arrival', flightId: f.id, tail: f.tail, airport: d.dest, delay: f.arrDelay, text: `${f.id} arrives ${d.dest}${f.arrDelay ? ` (+${f.arrDelay}m)` : ''}` });
  }
  for (const a of sc.actions) {
    let time = 0; let text = '';
    switch (a.type) {
      case 'cancel_flight': time = Math.min(...a.flightIds.map((id) => net.flightById.get(id)!.schedDep)); text = `Recovery: cancel ${a.flightIds.join(', ')}`; break;
      case 'deploy_spare': time = Math.min(...a.flightIds.map((id) => net.flightById.get(id)!.schedDep)); text = `Recovery: ${a.spareTail} takes over ${a.flightIds.join(', ')}`; break;
      case 'swap_aircraft': time = Math.min(net.flightById.get(a.flightA)!.schedDep, net.flightById.get(a.flightB)!.schedDep); text = `Recovery: swap ${a.tailA} ↔ ${a.tailB} from ${a.flightA}/${a.flightB}`; break;
      case 'prioritize_flight': time = net.flightById.get(a.flightId)!.schedDep; text = `Recovery: ${a.flightId} gets slot priority`; break;
      case 'protect_connection': { const c = connections.find((x) => x.id === a.connectionId); time = c?.actualDep ?? 0; text = `Recovery: hold ${c?.to} to protect ${a.connectionId}`; break; }
    }
    ev.push({ time, kind: 'recovery', text });
  }
  void plan;
  const order: Record<string, number> = { closure_start: 0, closure_end: 1, recovery: 2, cancellation: 3, arrival: 4, departure: 5 };
  return ev.sort((a, b) => a.time - b.time || order[a.kind] - order[b.kind] || (a.flightId ?? '').localeCompare(b.flightId ?? ''));
}
