import type { Network, SimulationResult } from '@/types';
import { fmtTime } from '@/engine/timeUtils';

export function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const esc = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export function resultToCsv(net: Network, r: SimulationResult): string {
  const head = ['flight_id', 'aircraft', 'origin', 'destination', 'sched_dep', 'actual_dep', 'sched_arr', 'actual_arr', 'dep_delay_min', 'arr_delay_min', 'pax', 'status', 'cause'];
  const rows = r.flights.map((f) => {
    const d = net.flightById.get(f.id)!;
    return [f.id, f.tail, d.origin, d.dest, fmtTime(f.schedDep), fmtTime(f.actualDep), fmtTime(f.schedArr), fmtTime(f.actualArr), f.depDelay, f.arrDelay, d.pax, f.status, f.causes[0]?.text ?? ''];
  });
  return [head, ...rows].map((r) => r.map(esc).join(',')).join('\n');
}

export function resultToJson(name: string, r: SimulationResult): string {
  return JSON.stringify({
    name, exportedAt: new Date().toISOString(), scenario: r.scenario, metrics: r.metrics,
    flights: r.flights, connections: r.connections, crews: r.crews, rejectedActions: r.rejectedActions,
  }, null, 2);
}
