import type { Network, FlightDef } from '@/types';

/**
 * Turnaround interpretation (documented):
 *  - `meta.min_turnaround_minutes` (30) is the REQUIRED minimum ground time between an aircraft's arrival and its next departure.
 *  - `turnaround_before_min` in the dataset is the SCHEDULED ground time (verified equal to next.dep − prev.arr for all legs).
 *    The scheduled buffer is therefore `turnaround_before_min − required`; it absorbs inbound delay.
 *  - Required turnaround is never shorter than the dataset minimum. Delays are never negative (no early departures).
 */
export const requiredTurnaround = (net: Network, _next: FlightDef): number => net.minTurnaround;

export const scheduledBuffer = (net: Network, f: FlightDef): number | null =>
  f.schedTurn === null ? null : Math.max(0, f.schedTurn - requiredTurnaround(net, f));
