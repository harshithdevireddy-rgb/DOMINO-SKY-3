import type { Network, FlightResult, CrewResult } from '@/types';
import type { Plan } from './recovery';

/**
 * Crew duty (computed independently of flight delay status):
 *   duty = (simulated arrival of the crew's last operated flight) − duty_start  vs  max_duty_mins.
 * Crews fly with their aircraft: a flight is crewed by the crew assigned to the tail that finally operates it.
 * A deployed spare is staffed by a standby crew (id `SB-<tail>`) reporting `crewReportLead` minutes (45 – verified
 * constant across all 16 dataset crews) before its first departure, with the tightest dataset duty limit.
 */
export function evaluateCrews(net: Network, plan: Plan, fr: Map<string, FlightResult>): CrewResult[] {
  const out: CrewResult[] = [];
  const build = (crewId: string, tail: string, base: string, dutyStart: number | null, maxDuty: number, standby: boolean): CrewResult => {
    const ids = (plan.sequences.get(tail) ?? []);
    const flights = ids.filter((id) => !fr.get(id)!.cancelled);
    const first = flights.length ? net.flightById.get(flights[0])! : null;
    const start = dutyStart ?? (first ? first.schedDep - net.crewReportLead : 0);
    const lastArr = flights.length ? Math.max(...flights.map((id) => fr.get(id)!.actualArr!)) : null;
    const duty = lastArr === null ? 0 : lastArr - start;
    const limitTime = start + maxDuty;
    return {
      crewId, tail, base, standby, dutyStart: start, lastArr, dutyMinutes: duty, maxDuty,
      excess: Math.max(0, duty - maxDuty), violation: duty > maxDuty,
      flights,
      flightsAffected: flights.filter((id) => fr.get(id)!.arrDelay > 0),
      flightsBeyondLimit: flights.filter((id) => fr.get(id)!.actualArr! > limitTime),
    };
  };
  for (const c of net.crews) out.push(build(c.id, c.tail, c.base, c.dutyStart, c.maxDuty, false));
  const standbyMax = Math.min(...net.crews.map((c) => c.maxDuty));
  for (const s of net.spares) {
    if (plan.usedSpares.has(s.tail)) out.push(build(`SB-${s.tail}`, s.tail, s.base, null, standbyMax, true));
  }
  return out;
}

/** crew id operating a flight on a given tail */
export function crewIdForTail(net: Network, tail: string): string {
  return net.crews.find((c) => c.tail === tail)?.id ?? `SB-${tail}`;
}
