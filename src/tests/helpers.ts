import { loadDataset } from '@/data/loader';
import type { Network, Scenario, Closure, RecoveryAction } from '@/types';
import { simulate } from '@/engine/simulation';

export const net: Network = (() => { const r = loadDataset(); if (!r.network) throw new Error('dataset failed'); return r.network; })();
export const closure = (airport: string, start: number, dur: number): Closure => ({ airport, start, end: start + dur });
export const scenario = (cs: Closure[] = [], actions: RecoveryAction[] = [], capacityOverrides?: Record<string, number>): Scenario => ({ closures: cs, actions, capacityOverrides });
export const run = (cs: Closure[] = [], actions: RecoveryAction[] = [], cap?: Record<string, number>) => simulate(net, scenario(cs, actions, cap));
export const BOM_0800 = closure('BOM', 480, 90);
export const hm = (h: number, m = 0) => h * 60 + m;
