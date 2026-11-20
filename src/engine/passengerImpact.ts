import type { Network, FlightResult, ConnectionResult, PaxAccounting } from '@/types';
import { CONFIG } from './config';

/**
 * Passenger accounting model (aggregate, deterministic — the dataset has no passenger-level identities).
 *
 * A connecting passenger occupies a seat on two flights, so summing flight pax double-counts them.
 * We therefore split every flight's pax into disjoint *groups*:
 *   • connection group  : `passengers` of a connection (travel on from_flight AND to_flight)
 *   • local group       : pax − Σ connection pax on that flight (as inbound or onward leg)
 * distinct passengers = Σ groups = Σ flight pax − Σ connection pax.
 *
 * Each group falls in exactly one outcome (priority order):
 *   CANCELLED  – any flight of the itinerary is cancelled
 *   MISSED     – both flights operate but the transfer is shorter than min_connect_minutes
 *   DELAYED    – final-segment arrival delay ≥ threshold
 *   ON_TIME    – otherwise
 * stranded = cancelled + missed (no same-day re-accommodation is modelled); impacted = delayed + stranded.
 * Passengers whose inbound flight is late but who still make their onward flight are only "delayed" if the onward flight is.
 */
export function accountPassengers(net: Network, fr: Map<string, FlightResult>, cx: ConnectionResult[]): PaxAccounting {
  const acc: PaxAccounting = { distinct: 0, onTime: 0, delayed: 0, cancelled: 0, missedConnection: 0, stranded: 0, impacted: 0, seatsOnDelayedFlights: 0, seatsOnCancelledFlights: 0, paxDelayMinutes: 0 };
  const connPax = new Map<string, number>();
  for (const c of cx) {
    connPax.set(c.from, (connPax.get(c.from) ?? 0) + c.pax);
    connPax.set(c.to, (connPax.get(c.to) ?? 0) + c.pax);
  }
  for (const f of net.flights) {
    const r = fr.get(f.id)!;
    if (r.cancelled) acc.seatsOnCancelledFlights += f.pax;
    else if (r.arrDelay >= CONFIG.delayThreshold) acc.seatsOnDelayedFlights += f.pax;
    const local = Math.max(0, f.pax - (connPax.get(f.id) ?? 0));
    acc.distinct += local;
    if (r.cancelled) acc.cancelled += local;
    else if (r.arrDelay >= CONFIG.delayThreshold) { acc.delayed += local; acc.paxDelayMinutes += local * r.arrDelay; }
    else acc.onTime += local;
  }
  for (const c of cx) {
    acc.distinct += c.pax;
    if (c.status === 'from_cancelled' || c.status === 'to_cancelled') acc.cancelled += c.pax;
    else if (c.status === 'missed') acc.missedConnection += c.pax;
    else {
      const to = fr.get(c.to)!;
      if (to.arrDelay >= CONFIG.delayThreshold) { acc.delayed += c.pax; acc.paxDelayMinutes += c.pax * to.arrDelay; }
      else acc.onTime += c.pax;
    }
  }
  acc.stranded = acc.cancelled + acc.missedConnection;
  acc.impacted = acc.delayed + acc.stranded;
  return acc;
}
