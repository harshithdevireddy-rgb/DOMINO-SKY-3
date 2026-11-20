import { hourBucket } from './timeUtils';

/**
 * Capacity model: each airport can handle `capacity_per_hour` movements (departures + arrivals)
 * per clock-hour bucket [h:00, h+1:00). Flights are allocated slots first-come-first-served in order of
 * (earliest feasible departure, priority flag, scheduled departure, flight id) — fully deterministic.
 */
export class CapacityTracker {
  private occ = new Map<string, number>();
  constructor(private capacity: (airport: string) => number) {}
  private key(airport: string, t: number) { return `${airport}|${hourBucket(t)}`; }
  count(airport: string, t: number) { return this.occ.get(this.key(airport, t)) ?? 0; }
  hasRoom(airport: string, t: number) { return this.count(airport, t) < this.capacity(airport); }
  add(airport: string, t: number) { const k = this.key(airport, t); this.occ.set(k, (this.occ.get(k) ?? 0) + 1); }
  limit(airport: string) { return this.capacity(airport); }
}
