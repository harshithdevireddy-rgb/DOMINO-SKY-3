import type { Metrics, Network, Scenario } from '@/types';
import { simulate } from './simulation';
import { validateActions } from './recovery';

export interface CompareRow {
  key: string; label: string; before: number; after: number;
  /** before − after (positive = improvement; all compared metrics are "lower is better") */
  improvement: number;
  /** percentage improvement; null when before = 0 (never divides by zero) */
  pct: number | null;
  direction: 'better' | 'worse' | 'same';
}

const ROWS: { key: string; label: string; get: (m: Metrics) => number }[] = [
  { key: 'delayed', label: 'Delayed flights', get: (m) => m.delayed },
  { key: 'delayMinutes', label: 'Total delay minutes', get: (m) => m.totalDelayMinutes },
  { key: 'impacted', label: 'Passengers affected', get: (m) => m.pax.impacted },
  { key: 'stranded', label: 'Passengers stranded', get: (m) => m.pax.stranded },
  { key: 'missed', label: 'Missed-connection pax', get: (m) => m.missedConnectionPax },
  { key: 'crew', label: 'Crew violations', get: (m) => m.crewViolations },
  { key: 'cancelled', label: 'Cancelled flights', get: (m) => m.cancelled },
];

export function compareMetrics(before: Metrics, after: Metrics): CompareRow[] {
  return ROWS.map((r) => {
    const b = r.get(before); const a = r.get(after);
    const improvement = b - a;
    return { key: r.key, label: r.label, before: b, after: a, improvement, pct: b > 0 ? (improvement / b) * 100 : null, direction: improvement > 0 ? 'better' : improvement < 0 ? 'worse' : 'same' };
  });
}


export interface ActionContribution {
  actionId: string;
  /** cost saved by this action given all the others (null when other actions depend on it) */
  marginal: number | null;
  /** cost saved by this action alone against the un-recovered disruption (null if infeasible alone) */
  standalone: number | null;
}

/** Real re-simulations: leave-one-out and stand-alone, against the objective in config.ts. */
export function actionContributions(net: Network, sc: Scenario): ActionContribution[] {
  if (sc.actions.length === 0) return [];
  const full = simulate(net, sc).metrics.cost;
  const none = simulate(net, { ...sc, actions: [] }).metrics.cost;
  return sc.actions.map((a) => {
    const without = sc.actions.filter((x) => x.id !== a.id);
    const marginal = validateActions(net, without) === null ? simulate(net, { ...sc, actions: without }).metrics.cost - full : null;
    const alone = validateActions(net, [a]) === null ? none - simulate(net, { ...sc, actions: [a] }).metrics.cost : null;
    return { actionId: a.id, marginal, standalone: alone };
  });
}
