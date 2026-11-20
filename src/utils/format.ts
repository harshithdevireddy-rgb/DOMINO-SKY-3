import type { FlightResult, Network, SimulationResult, CauseKind } from '@/types';

export const CAUSE_SHORT: Record<CauseKind, string> = {
  NONE: '—', CLOSURE_DEPARTURE: 'Airport closure', CLOSURE_ARRIVAL_GROUND_HOLD: 'Destination closed (ground hold)', CLOSURE_AIRBORNE_HOLD: 'Destination closed (airborne hold)',
  ROTATION: 'Late inbound aircraft', CAPACITY: 'Airport capacity', CONNECTION_HOLD: 'Held for connection', RECOVERY_CANCEL: 'Cancelled by recovery',
};

export function causeShort(f: FlightResult): string {
  const c = f.causes[0];
  if (!c) return '—';
  if (c.kind === 'ROTATION' && c.sourceFlight) return `Late inbound aircraft (${c.sourceFlight})`;
  if (c.airport && c.kind !== 'ROTATION') return `${CAUSE_SHORT[c.kind]} · ${c.airport}`;
  return CAUSE_SHORT[c.kind];
}

export function rotationImpact(net: Network, res: SimulationResult, id: string): string {
  const f = res.flightById.get(id)!;
  if (f.cancelled) return 'Cancelled — aircraft skips this leg.';
  const seq = res.sequences.get(f.tail) ?? [];
  const next = seq[seq.indexOf(id) + 1];
  if (!next) return `Last leg of ${f.tail} today.`;
  const n = res.flightById.get(next)!;
  if (f.arrDelay === 0) return `No delay to pass on to ${next}.`;
  if (n.binding.kind === 'ROTATION' && n.binding.from === id && n.depDelay > 0) return `Passes +${n.depDelay}m on to ${next} (${net.flightById.get(next)!.origin}→${net.flightById.get(next)!.dest}).`;
  return `Delay absorbed by the turnaround buffer before ${next}.`;
}

export const pct = (n: number | null) => (n === null ? '—' : `${n >= 0 ? '' : '−'}${Math.abs(n).toFixed(n % 1 === 0 ? 0 : 1)}%`);
export const nf = (n: number) => n.toLocaleString('en-IN');
