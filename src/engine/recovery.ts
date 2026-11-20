import type { Network, RecoveryAction, FlightDef } from '@/types';
import { ActionError } from '@/types';

export interface HoldSpec { connectionId: string; fromFlight: string; minConnect: number }
export interface Plan {
  /** flight → tail that operates it */
  tailOf: Map<string, string>;
  /** tail → operated flights ordered by scheduled departure */
  sequences: Map<string, string[]>;
  cancelled: Set<string>;
  /** onward flight → connection holds protecting it */
  holds: Map<string, HoldSpec[]>;
  priority: Set<string>;
  usedSpares: Set<string>;
  /** action ids that cancelled each flight (for explanations) */
  cancelledBy: Map<string, string>;
}

function sequencesFrom(net: Network, tailOf: Map<string, string>, cancelled: Set<string>): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const f of net.flights) {
    if (cancelled.has(f.id)) continue;
    const t = tailOf.get(f.id)!;
    const l = m.get(t) ?? []; l.push(f.id); m.set(t, l);
  }
  for (const [t, l] of m) m.set(t, l.sort((a, b) => net.flightById.get(a)!.schedDep - net.flightById.get(b)!.schedDep));
  return m;
}

export function basePlan(net: Network): Plan {
  const tailOf = new Map(net.flights.map((f) => [f.id, f.tail]));
  const cancelled = new Set<string>();
  return { tailOf, sequences: sequencesFrom(net, tailOf, cancelled), cancelled, holds: new Map(), priority: new Set(), usedSpares: new Set(), cancelledBy: new Map() };
}

const clonePlan = (p: Plan): Plan => ({
  tailOf: new Map(p.tailOf), sequences: new Map(p.sequences), cancelled: new Set(p.cancelled),
  holds: new Map([...p.holds].map(([k, v]) => [k, [...v]])), priority: new Set(p.priority), usedSpares: new Set(p.usedSpares), cancelledBy: new Map(p.cancelledBy),
});

const need = (net: Network, id: string, actionId: string): FlightDef => {
  const f = net.flightById.get(id);
  if (!f) throw new ActionError(actionId, `Unknown flight ${id}.`);
  return f;
};

/** Validates aircraft continuity, scheduled turnaround, spare constraints and holds. Throws ActionError. */
export function checkPlan(net: Network, plan: Plan, actionId: string): void {
  // spare aircraft first: their base / availability errors are the most informative
  const ordered = [...plan.sequences].sort((a, b) => Number(net.spares.some((s) => s.tail === b[0])) - Number(net.spares.some((s) => s.tail === a[0])));
  for (const [tail, seq] of ordered) {
    const spare = net.spares.find((s) => s.tail === tail);
    for (let i = 0; i < seq.length; i++) {
      const cur = net.flightById.get(seq[i])!;
      if (cur.pax > (spare?.seats ?? net.seats)) throw new ActionError(actionId, `${cur.id} carries ${cur.pax} pax but ${tail} has only ${spare?.seats ?? net.seats} seats.`);
      if (i === 0) {
        if (!spare) {
          // A dataset aircraft starts its day where its original first leg departs; it cannot begin elsewhere.
          const start = net.flightById.get(net.rotations.get(tail)![0])!.origin;
          if (cur.origin !== start) throw new ActionError(actionId, `Impossible aircraft movement: ${tail} starts the day at ${start} but would have to begin with ${cur.id} from ${cur.origin}.`);
        }
        if (spare) {
          if (cur.origin !== spare.base) throw new ActionError(actionId, `${tail} is based at ${spare.base} and cannot operate ${cur.id} from ${cur.origin} (no positioning flight is modelled).`);
          if (cur.schedDep < spare.availableFrom) throw new ActionError(actionId, `${tail} is not available until ${spare.availableFrom} min; ${cur.id} departs earlier.`);
        }
        continue;
      }
      const prev = net.flightById.get(seq[i - 1])!;
      if (prev.dest !== cur.origin) {
        throw new ActionError(actionId, `Impossible aircraft movement: ${tail} would land at ${prev.dest} on ${prev.id} but ${cur.id} departs from ${cur.origin}.`);
      }
      if (cur.schedDep - prev.schedArr < net.minTurnaround) {
        throw new ActionError(actionId, `${tail}: only ${cur.schedDep - prev.schedArr} min scheduled between ${prev.id} and ${cur.id} (minimum turnaround ${net.minTurnaround}).`);
      }
    }
  }
  for (const [to, holds] of plan.holds) {
    for (const h of holds) {
      if (plan.cancelled.has(to) || plan.cancelled.has(h.fromFlight)) throw new ActionError(actionId, `Connection ${h.connectionId} cannot be protected because ${plan.cancelled.has(to) ? to : h.fromFlight} is cancelled.`);
    }
  }
}

export function applyAction(net: Network, plan: Plan, a: RecoveryAction): Plan {
  const p = clonePlan(plan);
  switch (a.type) {
    case 'cancel_flight': {
      if (a.flightIds.length === 0) throw new ActionError(a.id, 'No flights selected to cancel.');
      for (const id of a.flightIds) {
        need(net, id, a.id);
        if (p.cancelled.has(id)) throw new ActionError(a.id, `${id} is already cancelled.`);
        p.cancelled.add(id); p.cancelledBy.set(id, a.id);
      }
      break;
    }
    case 'deploy_spare': {
      const spare = net.spares.find((s) => s.tail === a.spareTail);
      if (!spare) throw new ActionError(a.id, `${a.spareTail} is not a spare aircraft in the dataset.`);
      if (p.usedSpares.has(spare.tail)) throw new ActionError(a.id, `${spare.tail} is already deployed by another action.`);
      if (a.flightIds.length === 0) throw new ActionError(a.id, 'No flights selected for the spare aircraft.');
      for (const id of a.flightIds) {
        need(net, id, a.id);
        if (p.cancelled.has(id)) throw new ActionError(a.id, `${id} is cancelled and cannot be flown by ${spare.tail}.`);
        p.tailOf.set(id, spare.tail);
      }
      p.usedSpares.add(spare.tail);
      break;
    }
    case 'swap_aircraft': {
      if (a.tailA === a.tailB) throw new ActionError(a.id, 'Cannot swap an aircraft with itself.');
      const seqA = p.sequences.get(a.tailA) ?? []; const seqB = p.sequences.get(a.tailB) ?? [];
      const ia = seqA.indexOf(a.flightA); const ib = seqB.indexOf(a.flightB);
      if (ia < 0) throw new ActionError(a.id, `${a.flightA} is not an operated flight of ${a.tailA}.`);
      if (ib < 0) throw new ActionError(a.id, `${a.flightB} is not an operated flight of ${a.tailB}.`);
      for (const id of seqA.slice(ia)) p.tailOf.set(id, a.tailB);
      for (const id of seqB.slice(ib)) p.tailOf.set(id, a.tailA);
      break;
    }
    case 'prioritize_flight': {
      need(net, a.flightId, a.id);
      if (p.cancelled.has(a.flightId)) throw new ActionError(a.id, `${a.flightId} is cancelled.`);
      p.priority.add(a.flightId);
      break;
    }
    case 'protect_connection': {
      const c = net.connections.find((x) => x.id === a.connectionId);
      if (!c) throw new ActionError(a.id, `Unknown connection ${a.connectionId}.`);
      const list = p.holds.get(c.to) ?? [];
      if (list.some((h) => h.connectionId === c.id)) throw new ActionError(a.id, `Connection ${c.id} is already protected.`);
      list.push({ connectionId: c.id, fromFlight: c.from, minConnect: c.minConnect });
      p.holds.set(c.to, list);
      break;
    }
  }
  p.sequences = sequencesFrom(net, p.tailOf, p.cancelled);
  checkPlan(net, p, a.id);
  return p;
}

/** Applies actions in order. Throws ActionError naming the first infeasible / conflicting action. */
export function buildPlan(net: Network, actions: RecoveryAction[]): Plan {
  let p = basePlan(net);
  for (const a of actions) p = applyAction(net, p, a);
  return p;
}

/** Returns null if the action list is valid, otherwise the human-readable reason. */
export function validateActions(net: Network, actions: RecoveryAction[]): string | null {
  try { buildPlan(net, actions); return null; } catch (e) { if (e instanceof ActionError) return e.message; throw e; }
}

/** Every minimal-first set of consecutive flights containing `flightId` whose cancellation keeps the aircraft's movements possible. */
export function cancellationSets(net: Network, actions: RecoveryAction[], flightId: string): string[][] {
  const plan = buildPlan(net, actions);
  const tail = plan.tailOf.get(flightId);
  if (!tail || plan.cancelled.has(flightId)) return [];
  const seq = plan.sequences.get(tail) ?? [];
  const i = seq.indexOf(flightId);
  const out: string[][] = [];
  // every contiguous window of the aircraft's remaining rotation that contains the flight
  for (let a = 0; a <= i; a++) {
    for (let b = i; b < seq.length; b++) {
      const ids = seq.slice(a, b + 1);
      const probe: RecoveryAction = { id: '__probe', type: 'cancel_flight', flightIds: ids };
      if (validateActions(net, [...actions, probe]) === null) out.push(ids);
    }
  }
  return out.sort((x, y) => x.length - y.length || x[0].localeCompare(y[0]));
}

export function describeAction(net: Network, a: RecoveryAction): string {
  switch (a.type) {
    case 'cancel_flight': return `Cancel ${a.flightIds.join(' + ')}`;
    case 'deploy_spare': return `Deploy ${a.spareTail} on ${a.flightIds.length > 1 ? `${a.flightIds[0]}…${a.flightIds[a.flightIds.length - 1]}` : a.flightIds[0]}`;
    case 'swap_aircraft': return `Swap ${a.tailA} (from ${a.flightA}) ↔ ${a.tailB} (from ${a.flightB})`;
    case 'prioritize_flight': return `Prioritise ${a.flightId} for airport slots`;
    case 'protect_connection': {
      const c = net.connections.find((x) => x.id === a.connectionId);
      return c ? `Protect ${c.id}: hold ${c.to} for ${c.from} transfers (${c.pax} pax)` : `Protect ${a.connectionId}`;
    }
  }
}
