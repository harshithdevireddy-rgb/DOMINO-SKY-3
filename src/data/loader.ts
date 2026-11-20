import raw from './flight_network.json';
import type { Network, RawDataset, FlightDef, CrewDef } from '@/types';
import { parseHHMM } from '@/engine/timeUtils';
import { validateDataset, type ValidationReport } from './validation';

export interface LoadResult { network: Network | null; report: ValidationReport; raw: RawDataset | null }

export function buildNetwork(d: RawDataset): Network {
  const airports = d.airports.map((a) => ({ id: a.id, name: a.name, city: a.city, lat: a.lat, lng: a.lng, tier: a.tier, capacityPerHour: a.capacity_per_hour }));
  const flights: FlightDef[] = d.flights.map((f) => ({
    id: f.flight_id, tail: f.tail_id, leg: f.leg_order, origin: f.origin, dest: f.destination,
    schedDep: parseHHMM(f.dep), schedArr: parseHHMM(f.arr), block: f.block_minutes, pax: f.pax, schedTurn: f.turnaround_before_min,
  }));
  const rotations = new Map<string, string[]>();
  for (const f of [...flights].sort((a, b) => a.tail.localeCompare(b.tail) || a.leg - b.leg)) {
    const l = rotations.get(f.tail) ?? []; l.push(f.id); rotations.set(f.tail, l);
  }
  const crews: CrewDef[] = d.crews.map((c) => ({ id: c.crew_id, tail: c.tail_id, base: c.base, dutyStart: parseHHMM(c.duty_start), maxDuty: c.max_duty_mins, flightIds: [...c.flight_ids] }));
  const flightById = new Map(flights.map((f) => [f.id, f]));
  // Dataset invariant (verified at startup): crew reports a constant lead time before its first departure.
  const leads = new Set(crews.map((c) => flightById.get(c.flightIds[0])!.schedDep - c.dutyStart));
  const crewReportLead = leads.size === 1 ? [...leads][0] : 45;
  return {
    name: d.meta.dataset,
    minTurnaround: d.meta.min_turnaround_minutes,
    seats: d.meta.seats_per_aircraft,
    airports, airportById: new Map(airports.map((a) => [a.id, a])),
    flights, flightById,
    tails: [...rotations.keys()],
    rotations,
    connections: d.connections.map((c) => ({ id: c.connection_id, airport: c.airport, from: c.from_flight, to: c.to_flight, pax: c.passengers, minConnect: c.min_connect_minutes })),
    crews,
    spares: d.spare_aircraft.map((s) => ({ tail: s.tail_id, base: s.base, availableFrom: parseHHMM(s.available_from), seats: s.seats })),
    crewReportLead,
  };
}

/** Load + validate. On failure returns a report (the UI shows a friendly error; no data is invented). */
export function loadDataset(source: unknown = raw): LoadResult {
  let report: ValidationReport;
  try { report = validateDataset(source); } catch (e) { report = { ok: false, errors: [`Dataset could not be validated: ${(e as Error).message}`], warnings: [], counts: {} }; }
  if (!report.ok) return { network: null, report, raw: null };
  return { network: buildNetwork(source as RawDataset), report, raw: source as RawDataset };
}
