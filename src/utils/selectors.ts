import type { Network, SimulationResult, FlightResult } from '@/types';

export type StatusFilter = 'all' | 'normal' | 'delayed' | 'cancelled' | 'recovered';
export interface FlightFilter { status: StatusFilter; tail: string; airport: string }
export const EMPTY_FILTER: FlightFilter = { status: 'all', tail: 'all', airport: 'all' };

/** Flights that are better than in the un-recovered disruption, or that now fly on a different aircraft. */
export function recoveredSet(result: SimulationResult | null, base: SimulationResult | null): Set<string> {
  const out = new Set<string>();
  if (!result || !base || result === base || result.scenario.actions.length === 0) return out;
  for (const f of result.flights) {
    const b = base.flightById.get(f.id)!;
    if (!f.cancelled && (f.arrDelay < b.arrDelay || (f.reassigned && b.arrDelay > 0))) out.add(f.id);
  }
  return out;
}

export function matchesFilter(net: Network, f: FlightResult, flt: FlightFilter, rec: Set<string>): boolean {
  const d = net.flightById.get(f.id)!;
  if (flt.tail !== 'all' && f.tail !== flt.tail && f.scheduledTail !== flt.tail) return false;
  if (flt.airport !== 'all' && d.origin !== flt.airport && d.dest !== flt.airport) return false;
  switch (flt.status) {
    case 'all': return true;
    case 'normal': return !f.cancelled && f.arrDelay === 0;
    case 'delayed': return !f.cancelled && f.arrDelay > 0;
    case 'cancelled': return f.cancelled;
    case 'recovered': return rec.has(f.id);
  }
}

export const routeKey = (a: string, b: string) => (a < b ? `${a}-${b}` : `${b}-${a}`);

export function flightDisplayStatus(f: FlightResult, rec: Set<string>): 'on_time' | 'delayed' | 'severe' | 'cancelled' | 'recovered' {
  if (f.cancelled) return 'cancelled';
  if (rec.has(f.id) && f.arrDelay === 0) return 'recovered';
  return f.status;
}
