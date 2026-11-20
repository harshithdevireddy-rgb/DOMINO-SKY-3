import type { Network, FlightResult, ConnectionResult, ConnectionStatus } from '@/types';
import { fmtTime } from './timeUtils';

/** A connection is made iff actual dep(to) − actual arr(from) ≥ min_connect_minutes (dataset rule). */
export function evaluateConnections(net: Network, fr: Map<string, FlightResult>): ConnectionResult[] {
  return net.connections.map((c) => {
    const from = fr.get(c.from)!; const to = fr.get(c.to)!;
    const fd = net.flightById.get(c.from)!; const td = net.flightById.get(c.to)!;
    const scheduledTransfer = td.schedDep - fd.schedArr;
    let status: ConnectionStatus; let transfer: number | null = null;
    if (from.cancelled) status = 'from_cancelled';
    else if (to.cancelled) status = 'to_cancelled';
    else {
      transfer = to.actualDep! - from.actualArr!;
      status = transfer >= c.minConnect ? 'made' : 'missed';
    }
    return {
      id: c.id, airport: c.airport, from: c.from, to: c.to, pax: c.pax, minConnect: c.minConnect, scheduledTransfer,
      actualArr: from.actualArr, actualDep: to.actualDep, transfer, status,
      held: to.binding.kind === 'CONNECTION_HOLD' && to.binding.connectionId === c.id,
    };
  });
}

export const connectionText = (c: ConnectionResult): string => {
  switch (c.status) {
    case 'made': return `${c.id} made: ${c.from} arrived ${fmtTime(c.actualArr)}, ${c.to} departs ${fmtTime(c.actualDep)} (${c.transfer} min ≥ ${c.minConnect} min).`;
    case 'missed': return `${c.id} MISSED: only ${c.transfer} min between ${c.from} arrival (${fmtTime(c.actualArr)}) and ${c.to} departure (${fmtTime(c.actualDep)}); ${c.minConnect} min required.`;
    case 'from_cancelled': return `${c.id} broken: inbound ${c.from} cancelled.`;
    case 'to_cancelled': return `${c.id} broken: onward ${c.to} cancelled.`;
  }
};
