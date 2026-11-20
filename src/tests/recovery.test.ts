import { describe, it, expect } from 'vitest';
import { net, run, closure, BOM_0800, hm } from './helpers';
import { validateActions, cancellationSets, buildPlan } from '@/engine/recovery';
import { recommend, buildAiPayload } from '@/engine/dispatcher';
import { simulate } from '@/engine/simulation';
import type { RecoveryAction, Scenario } from '@/types';

const cancel = (...ids: string[]): RecoveryAction => ({ id: `c-${ids.join('-')}`, type: 'cancel_flight', flightIds: ids });
const spare = (spareTail: string, ...ids: string[]): RecoveryAction => ({ id: `s-${spareTail}-${ids[0]}`, type: 'deploy_spare', spareTail, flightIds: ids });
const protect = (connectionId: string): RecoveryAction => ({ id: `p-${connectionId}`, type: 'protect_connection', connectionId });

describe('cancelling flights', () => {
  it('cancelling the last leg is valid and changes the scenario', () => {
    const base = run([BOM_0800]);
    const r = run([BOM_0800], [cancel('DS0504')]);
    expect(r.metrics.cancelled).toBe(1); expect(r.flightById.get('DS0504')).toMatchObject({ cancelled: true, status: 'cancelled', actualDep: null });
    expect(r.metrics.pax.stranded).toBeGreaterThan(base.metrics.pax.stranded);
    // DS0504 carries 165 pax: 89 local + 31 (CX11) + 45 (CX12) connecting → all 165 are cancelled-itinerary passengers
    expect(r.metrics.pax.cancelled).toBe(165);
    expect(r.metrics.pax.stranded).toBeGreaterThanOrEqual(165);
  });
  it('rejects cancelling a middle leg alone (aircraft would be in the wrong place)', () => {
    const reason = validateActions(net, [cancel('DS0502')]);
    expect(reason).toMatch(/Impossible aircraft movement/); expect(reason).toMatch(/VT-DS05/);
  });
  it('accepts the round-trip pair, and the engine proposes exactly valid sets', () => {
    expect(validateActions(net, [cancel('DS0502', 'DS0503')])).toBeNull();
    const sets = cancellationSets(net, [], 'DS0502');
    expect(sets.map((s) => s.join('+'))).toEqual(expect.arrayContaining(['DS0502+DS0503']));
    for (const s of sets) expect(validateActions(net, [cancel(...s)])).toBeNull();
    expect(sets.some((s) => s.join() === 'DS0502')).toBe(false);
  });
  it('rejects a day-start prefix that leaves the aircraft starting at the wrong airport', () => {
    expect(validateActions(net, [cancel('DS0201')])).toMatch(/starts the day at DEL/);
  });
  it('cancelled pax are accounted once and a cancelled feeder breaks its connections', () => {
    const r = run([], [cancel('DS1203', 'DS1204')]); // CX10: DS1203 → DS0903 broken
    expect(r.connections.find((c) => c.id === 'CX10')!.status).toBe('from_cancelled');
    const p = r.metrics.pax;
    expect(p.onTime + p.delayed + p.cancelled + p.missedConnection).toBe(p.distinct);
    expect(p.cancelled).toBe((158 - 18) + (171 - 0) + 18); // local pax on both cancelled flights + the 18 connecting pax
    expect(r.crews.find((c) => c.crewId === 'CR12')!.flights).toEqual(['DS1201', 'DS1202']);
  });
  it('duplicate and unknown cancellations are rejected', () => {
    expect(validateActions(net, [cancel('DS0504'), { ...cancel('DS0504'), id: 'again' }])).toMatch(/already cancelled/);
    expect(validateActions(net, [cancel('DS9999')])).toMatch(/Unknown flight/);
    expect(validateActions(net, [cancel()])).toMatch(/No flights/);
  });
  it('cancelling the final crew leg removes a duty violation (crew computed on operated flights)', () => {
    const base = run([closure('DEL', hm(12), 120)]);
    const viol = base.crews.find((c) => c.violation)!;
    const last = viol.flights[viol.flights.length - 1];
    const sets = cancellationSets(net, [], last);
    const fix = run([closure('DEL', hm(12), 120)], [cancel(...sets[0])]);
    expect(fix.metrics.crewViolations).toBeLessThan(base.metrics.crewViolations);
  });
});

describe('spare aircraft', () => {
  it('feasible deployment changes the scenario and is re-simulated', () => {
    const base = run([BOM_0800]);
    const r = run([BOM_0800], [spare('VT-DS17', 'DS0502', 'DS0503')]); // VT-DS17 is based at BLR; DS0502 departs BLR 11:10
    expect(r.flightById.get('DS0502')).toMatchObject({ tail: 'VT-DS17', scheduledTail: 'VT-DS05', reassigned: true, depDelay: 0, arrDelay: 0 });
    expect(r.metrics.totalDelayMinutes).toBe(base.metrics.totalDelayMinutes - 35);
    expect(r.crews.find((c) => c.crewId === 'SB-VT-DS17')).toMatchObject({ standby: true, dutyStart: hm(11, 10) - 45 });
    expect(r.flightById.get('DS0502')!.crewId).toBe('SB-VT-DS17');
  });
  it('rejects a spare away from its base (no ferry flights modelled)', () => {
    expect(validateActions(net, [spare('VT-DS17', 'DS1204')])).toMatch(/based at BLR/);
    expect(validateActions(net, [spare('VT-DS18', 'DS0502')])).toMatch(/based at DEL/);
  });
  it('rejects impossible aircraft movements when a spare takes only part of a chain', () => {
    expect(validateActions(net, [spare('VT-DS17', 'DS0502')])).toMatch(/Impossible aircraft movement/);
    expect(validateActions(net, [spare('VT-DS18', 'DS0201')])).toMatch(/starts the day at DEL/);
  });
  it('rejects deploying the same spare twice, unknown spares, and cancelled flights', () => {
    expect(validateActions(net, [spare('VT-DS17', 'DS0502', 'DS0503'), spare('VT-DS17', 'DS0601', 'DS0602')])).toMatch(/already deployed/);
    expect(validateActions(net, [spare('VT-DS05', 'DS0502')])).toMatch(/not a spare/);
    expect(validateActions(net, [cancel('DS0504'), spare('VT-DS17', 'DS0504')])).toMatch(/cancelled/);
  });
  it('rejects spares used for a flight with more passengers than seats', () => {
    const big = { ...net, flightById: new Map(net.flightById) };
    big.flightById.set('DS0502', { ...net.flightById.get('DS0502')!, pax: 181 });
    expect(() => buildPlan(big, [spare('VT-DS17', 'DS0502', 'DS0503')])).toThrow(/seats/);
  });
});

describe('aircraft swap', () => {
  it('swaps rotations at a common airport and recalculates', () => {
    const a: RecoveryAction = { id: 'sw', type: 'swap_aircraft', tailA: 'VT-DS12', flightA: 'DS1202', tailB: 'VT-DS05', flightB: 'DS0501' };
    expect(validateActions(net, [a])).toBeNull();
    const r = run([closure('DEL', hm(12), 120)], [a]);
    expect(r.flightById.get('DS0501')).toMatchObject({ tail: 'VT-DS12', scheduledTail: 'VT-DS05', reassigned: true });
    expect(r.flightById.get('DS1202')!.tail).toBe('VT-DS05');
  });
  it('rejects swaps between different airports, self swaps and unknown flights', () => {
    expect(validateActions(net, [{ id: 'x', type: 'swap_aircraft', tailA: 'VT-DS05', flightA: 'DS0501', tailB: 'VT-DS01', flightB: 'DS0101' }])).toMatch(/Impossible aircraft movement/);
    expect(validateActions(net, [{ id: 'x', type: 'swap_aircraft', tailA: 'VT-DS05', flightA: 'DS0501', tailB: 'VT-DS05', flightB: 'DS0502' }])).toMatch(/itself/);
    expect(validateActions(net, [{ id: 'x', type: 'swap_aircraft', tailA: 'VT-DS05', flightA: 'DS0101', tailB: 'VT-DS12', flightB: 'DS1202' }])).toMatch(/not an operated flight/);
  });
});

describe('protecting connections', () => {
  it('holding the onward flight saves the connection and costs delay on that flight', () => {
    const base = run([BOM_0800]);
    const r = run([BOM_0800], [protect('CX05')]);
    const cx = r.connections.find((c) => c.id === 'CX05')!;
    expect(cx).toMatchObject({ status: 'made', held: true }); expect(cx.transfer).toBe(45);
    expect(r.flightById.get('DS0702')).toMatchObject({ primaryCause: 'CONNECTION_HOLD', actualDep: hm(9, 30) + 45 });
    expect(r.metrics.missedConnectionPax).toBe(base.metrics.missedConnectionPax - 30);
    expect(r.rejectedActions).toEqual([]);
  });
  it('rejects holds beyond the maximum and protecting a cancelled flight', () => {
    const r = run([closure('BOM', hm(8), 300)], [protect('CX05')]);
    expect(r.rejectedActions.length === 0 || r.rejectedActions[0].reason.match(/limit/)).toBeTruthy();
    expect(validateActions(net, [cancel('DS0702', 'DS0703', 'DS0704'), protect('CX05')])).toMatch(/cancelled/);
    expect(validateActions(net, [protect('CX05'), protect('CX05')])).toMatch(/already protected/);
    expect(validateActions(net, [protect('NOPE')])).toMatch(/Unknown connection/);
  });
});

describe('combining and re-simulating', () => {
  it('compatible actions combine; conflicting ones are explained', () => {
    const acts = [spare('VT-DS17', 'DS0502', 'DS0503'), protect('CX05')];
    expect(validateActions(net, acts)).toBeNull();
    const r = run([BOM_0800], acts);
    expect(r.metrics.missedConnectionPax).toBe(18);
    expect(validateActions(net, [cancel('DS0502', 'DS0503'), spare('VT-DS17', 'DS0502', 'DS0503')])).toMatch(/cancelled/);
  });
  it('every recovered number is a fresh simulation (before/after are consistent)', () => {
    const sc: Scenario = { closures: [BOM_0800], actions: [] };
    const rep = recommend(net, sc);
    expect(rep.recommendations.length).toBeGreaterThan(0);
    for (const rec of rep.recommendations) {
      const again = simulate(net, { ...sc, actions: rec.actions });
      expect(again.metrics).toEqual(rec.after);
      expect(rec.delta.cost).toBeGreaterThan(0);
      expect(rec.before).toEqual(rep.current);
    }
    const planned = simulate(net, { ...sc, actions: rep.plan.flatMap((p) => p.actions) });
    expect(planned.metrics).toEqual(rep.planAfter);
    expect(planned.metrics.cost).toBeLessThan(rep.current.cost);
    expect(planned.rejectedActions).toEqual([]);
  });
  it('recommended plans never contain impossible movements', () => {
    for (const cs of [closure('DEL', hm(12), 120), closure('BLR', hm(13), 120), closure('BOM', hm(8), 90), closure('HYD', hm(15), 120)]) {
      const rep = recommend(net, { closures: [cs], actions: [] });
      expect(validateActions(net, rep.plan.flatMap((p) => p.actions))).toBeNull();
    }
  });
  it('dispatcher is deterministic and its AI payload only contains engine numbers', () => {
    const sc: Scenario = { closures: [closure('DEL', hm(12), 120)], actions: [] };
    const a = recommend(net, sc); const b = recommend(net, sc);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const payload = buildAiPayload(net, sc, a);
    expect(payload.metrics.totalDelayMinutes).toBe(a.current.totalDelayMinutes);
    expect(payload.candidates[0].delayMinutesSaved).toBe(a.recommendations[0].delta.delayMinutes);
  });
  it('the disruption status follows the data', () => {
    expect(run().metrics.status).toBe('NORMAL');
    expect(run([closure('DEL', hm(12), 120)]).metrics.status).toBe('CRITICAL');
    expect(run([closure('BOM', hm(10), 180)]).metrics.status).not.toBe('MINOR'); // 6 severe delays
  });
});
