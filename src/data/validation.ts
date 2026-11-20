import type { RawDataset } from '@/types';
import { parseHHMM } from '@/engine/timeUtils';

export interface ValidationReport { ok: boolean; errors: string[]; warnings: string[]; counts: Record<string, number> }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** Structural + referential validation of the raw dataset. Never fabricates data. */
export function validateDataset(input: unknown): ValidationReport {
  const errors: string[] = []; const warnings: string[] = [];
  const counts: Record<string, number> = {};
  if (!isObj(input)) return { ok: false, errors: ['Dataset is not a JSON object.'], warnings, counts };
  const d = input as Partial<RawDataset>;
  for (const k of ['meta', 'airports', 'flights', 'connections', 'crews', 'spare_aircraft'] as const) {
    if (d[k] === undefined || d[k] === null) errors.push(`Missing section "${k}".`);
  }
  if (errors.length) return { ok: false, errors, warnings, counts };
  if (!Array.isArray(d.airports) || !Array.isArray(d.flights) || !Array.isArray(d.connections) || !Array.isArray(d.crews) || !Array.isArray(d.spare_aircraft)) {
    return { ok: false, errors: ['airports, flights, connections, crews and spare_aircraft must be arrays.'], warnings, counts };
  }
  const meta = d.meta!;
  if (typeof meta.min_turnaround_minutes !== 'number') errors.push('meta.min_turnaround_minutes missing.');
  counts.airports = d.airports.length; counts.flights = d.flights.length; counts.connections = d.connections.length;
  counts.crews = d.crews.length; counts.spares = d.spare_aircraft.length;

  const airportIds = new Set<string>();
  for (const a of d.airports) {
    if (!a.id || typeof a.lat !== 'number' || typeof a.lng !== 'number' || typeof a.capacity_per_hour !== 'number') errors.push(`Airport ${a.id ?? '?'} is malformed.`);
    if (airportIds.has(a.id)) errors.push(`Duplicate airport ${a.id}.`);
    airportIds.add(a.id);
  }
  const flightIds = new Set<string>();
  const byTail = new Map<string, typeof d.flights>();
  const safeTime = (s: string, what: string) => { try { return parseHHMM(s); } catch { errors.push(`${what}: invalid time "${s}".`); return NaN; } };
  for (const f of d.flights) {
    if (flightIds.has(f.flight_id)) errors.push(`Duplicate flight ${f.flight_id}.`);
    flightIds.add(f.flight_id);
    if (!airportIds.has(f.origin)) errors.push(`Flight ${f.flight_id}: unknown origin ${f.origin}.`);
    if (!airportIds.has(f.destination)) errors.push(`Flight ${f.flight_id}: unknown destination ${f.destination}.`);
    if (f.origin === f.destination) errors.push(`Flight ${f.flight_id}: origin equals destination.`);
    const dep = safeTime(f.dep, `Flight ${f.flight_id} dep`); const arr = safeTime(f.arr, `Flight ${f.flight_id} arr`);
    if (!Number.isNaN(dep) && !Number.isNaN(arr) && arr - dep !== f.block_minutes) errors.push(`Flight ${f.flight_id}: block_minutes (${f.block_minutes}) ≠ arr − dep (${arr - dep}).`);
    if (typeof f.pax !== 'number' || f.pax < 0) errors.push(`Flight ${f.flight_id}: invalid pax.`);
    const arrList = byTail.get(f.tail_id) ?? []; arrList.push(f); byTail.set(f.tail_id, arrList);
  }
  counts.aircraft = byTail.size;
  const seats = meta.seats_per_aircraft ?? 180;
  for (const [tail, list] of byTail) {
    const sorted = [...list].sort((a, b) => a.leg_order - b.leg_order);
    sorted.forEach((f, i) => { if (f.leg_order !== i + 1) errors.push(`Aircraft ${tail}: leg_order gap/duplicate at ${f.flight_id} (expected ${i + 1}, got ${f.leg_order}).`); });
    for (let i = 1; i < sorted.length; i++) {
      const a = sorted[i - 1]; const b = sorted[i];
      if (a.destination !== b.origin) errors.push(`Aircraft ${tail}: ${a.flight_id} lands at ${a.destination} but ${b.flight_id} departs ${b.origin}.`);
      const gap = parseHHMM(b.dep) - parseHHMM(a.arr);
      if (gap < (meta.min_turnaround_minutes ?? 0)) errors.push(`Aircraft ${tail}: scheduled turnaround before ${b.flight_id} is ${gap} min (< minimum).`);
      if (b.turnaround_before_min !== null && b.turnaround_before_min !== gap) warnings.push(`${b.flight_id}: turnaround_before_min (${b.turnaround_before_min}) differs from scheduled gap (${gap}).`);
    }
    for (const f of sorted) if (f.pax > seats) warnings.push(`${f.flight_id}: pax ${f.pax} exceeds ${seats} seats.`);
  }
  const paxOut = new Map<string, number>(); const paxIn = new Map<string, number>();
  const cxIds = new Set<string>();
  for (const c of d.connections) {
    if (cxIds.has(c.connection_id)) errors.push(`Duplicate connection ${c.connection_id}.`);
    cxIds.add(c.connection_id);
    const from = d.flights.find((f) => f.flight_id === c.from_flight); const to = d.flights.find((f) => f.flight_id === c.to_flight);
    if (!from) errors.push(`${c.connection_id}: unknown from_flight ${c.from_flight}.`);
    if (!to) errors.push(`${c.connection_id}: unknown to_flight ${c.to_flight}.`);
    if (!airportIds.has(c.airport)) errors.push(`${c.connection_id}: unknown airport ${c.airport}.`);
    if (from && from.destination !== c.airport) errors.push(`${c.connection_id}: from_flight does not land at ${c.airport}.`);
    if (to && to.origin !== c.airport) errors.push(`${c.connection_id}: to_flight does not depart ${c.airport}.`);
    if (from && to && parseHHMM(to.dep) - parseHHMM(from.arr) < c.min_connect_minutes) errors.push(`${c.connection_id}: connection is already infeasible in the schedule.`);
    paxOut.set(c.from_flight, (paxOut.get(c.from_flight) ?? 0) + c.passengers);
    paxIn.set(c.to_flight, (paxIn.get(c.to_flight) ?? 0) + c.passengers);
  }
  for (const f of d.flights) {
    const used = (paxOut.get(f.flight_id) ?? 0) + (paxIn.get(f.flight_id) ?? 0);
    if (used > f.pax) errors.push(`Flight ${f.flight_id}: connecting pax (${used}) exceed total pax (${f.pax}).`);
  }
  const crewIds = new Set<string>(); const crewFlights = new Map<string, string>();
  for (const c of d.crews) {
    if (crewIds.has(c.crew_id)) errors.push(`Duplicate crew ${c.crew_id}.`);
    crewIds.add(c.crew_id);
    if (!byTail.has(c.tail_id)) errors.push(`${c.crew_id}: unknown aircraft ${c.tail_id}.`);
    if (!airportIds.has(c.base)) errors.push(`${c.crew_id}: unknown base ${c.base}.`);
    safeTime(c.duty_start, `${c.crew_id} duty_start`);
    for (const id of c.flight_ids) {
      if (!flightIds.has(id)) errors.push(`${c.crew_id}: unknown flight ${id}.`);
      if (crewFlights.has(id)) errors.push(`Flight ${id} assigned to two crews (${crewFlights.get(id)}, ${c.crew_id}).`);
      crewFlights.set(id, c.crew_id);
    }
  }
  for (const id of flightIds) if (!crewFlights.has(id)) errors.push(`Flight ${id} has no crew.`);
  for (const s of d.spare_aircraft) {
    if (!airportIds.has(s.base)) errors.push(`Spare ${s.tail_id}: unknown base ${s.base}.`);
    if (byTail.has(s.tail_id)) errors.push(`Spare ${s.tail_id} also appears in the flight schedule.`);
    safeTime(s.available_from, `Spare ${s.tail_id} available_from`);
  }
  return { ok: errors.length === 0, errors, warnings, counts };
}
