import { describe, it, expect } from 'vitest';
import { net, run, closure, BOM_0800, hm } from './helpers';
import { simulate } from '@/engine/simulation';
import { buildChain } from '@/engine/explain';
import { compareMetrics } from '@/engine/compare';

describe('normal operations (no disruption)', () => {
  const r = run();
  it('reproduces the scheduled timetable exactly', () => {
    for (const f of r.flights) { expect(f.actualDep).toBe(f.schedDep); expect(f.actualArr).toBe(f.schedArr); expect(f.depDelay).toBe(0); expect(f.arrDelay).toBe(0); expect(f.status).toBe('on_time'); }
  });
  it('has all-zero disruption metrics and NORMAL status', () => {
    expect(r.metrics).toMatchObject({ totalFlights: 70, onTime: 70, delayed: 0, cancelled: 0, totalDelayMinutes: 0, aircraftAffected: 0, brokenConnections: 0, crewViolations: 0, status: 'NORMAL' });
    expect(r.metrics.pax).toMatchObject({ delayed: 0, cancelled: 0, missedConnection: 0, stranded: 0, impacted: 0 });
  });
  it('flights stay ordered by leg and satisfy the turnaround', () => {
    for (const ids of net.rotations.values()) for (let i = 1; i < ids.length; i++) {
      expect(r.flightById.get(ids[i])!.actualDep!).toBeGreaterThanOrEqual(r.flightById.get(ids[i - 1])!.actualArr! + net.minTurnaround);
    }
  });
  it('all connections valid, crews inside limits (CR03 has only 10 min spare)', () => {
    expect(r.connections.every((c) => c.status === 'made')).toBe(true);
    const cr03 = r.crews.find((c) => c.crewId === 'CR03')!;
    expect(cr03.dutyMinutes).toBe(590); expect(cr03.violation).toBe(false);
    expect(r.crews.find((c) => c.crewId === 'CR01')!.dutyMinutes).toBe(530);
  });
  it('baseline schedule never exceeds airport capacity (so capacity does not bind by itself)', () => {
    const occ = new Map<string, number>();
    for (const f of r.flights) { const d = net.flightById.get(f.id)!; for (const [a, t] of [[d.origin, f.actualDep!], [d.dest, f.actualArr!]] as const) { const k = `${a}|${Math.floor(t / 60)}`; occ.set(k, (occ.get(k) ?? 0) + 1); } }
    for (const [k, v] of occ) expect(v).toBeLessThanOrEqual(net.airportById.get(k.split('|')[0])!.capacityPerHour);
  });
});

describe('airport closure', () => {
  const r = run([BOM_0800]);
  it('departures inside the window wait for reopening', () => {
    const f = (id: string) => r.flightById.get(id)!;
    expect(f('DS0501')).toMatchObject({ actualDep: hm(9, 30), depDelay: 75, arrDelay: 75, primaryCause: 'CLOSURE_DEPARTURE' });
    expect(f('DS1202')).toMatchObject({ actualDep: hm(9, 30), depDelay: 80 });
    expect(f('DS1502').actualDep).toBe(hm(9, 30));
    expect(f('DS0702')).toMatchObject({ actualDep: hm(9, 30), depDelay: 20 });
  });
  it('no flight departs from or lands at BOM inside the closure', () => {
    for (const f of r.flights) {
      const d = net.flightById.get(f.id)!;
      if (d.origin === 'BOM') expect(f.actualDep! >= 480 && f.actualDep! < 570).toBe(false);
      if (d.dest === 'BOM') expect(f.actualArr! >= 480 && f.actualArr! < 570).toBe(false);
    }
  });
  it('flights already airborne when BOM closes hold and land at reopening (arrival policy)', () => {
    const f = r.flightById.get('DS0201')!;
    expect(f).toMatchObject({ actualDep: hm(6), depDelay: 0, actualArr: hm(9, 30), arrDelay: 80, airborneHold: 80, primaryCause: 'CLOSURE_AIRBORNE_HOLD', status: 'severe' });
  });
  it('flights not yet departed whose arrival would be inside the window are ground-held at origin', () => {
    // DEL→BOM DS0201-like flight departing after closure start: closure 07:00–09:30, DS0201 (06:00 dep) is airborne, but DS1201-type flights…
    const r2 = run([closure('BOM', hm(6, 30), 120)]); // closes 06:30–08:30
    const f = r2.flightById.get('DS1501')!; // PNQ→BOM scheduled 07:00 dep / 07:40 arr: not yet departed at 06:30 → ground hold
    expect(f.binding.kind).toBe('CLOSURE_ARRIVAL_GROUND_HOLD');
    expect(f.actualArr).toBe(hm(8, 30)); expect(f.actualDep).toBe(hm(8, 30) - 40);
    expect(f.airborneHold).toBe(0);
  });
  it('flights at unrelated airports are untouched', () => {
    for (const id of ['DS0101', 'DS0103', 'DS0601', 'DS0604', 'DS1301', 'DS1401', 'DS1001', 'DS1101', 'DS0901']) expect(r.flightById.get(id)!.arrDelay, id).toBe(0);
  });
  it('outside the window nothing changes unless propagation reaches it', () => {
    const late = run([closure('BOM', hm(21), 60)]);
    expect(late.metrics.delayed).toBe(0);
    const early = run([closure('BOM', hm(3), 60)]);
    expect(early.metrics.delayed).toBe(0);
  });
  it('the delayed set is exactly what rotation + closure explain', () => {
    expect(r.metrics.delayed).toBe(9);
    expect(r.flights.filter((f) => f.arrDelay > 0).map((f) => f.id).sort()).toEqual(['DS0201', 'DS0202', 'DS0501', 'DS0502', 'DS0702', 'DS1202', 'DS1203', 'DS1204', 'DS1502']);
  });
  it('an airport with no traffic in the window produces no delay (and a longer one affects more)', () => {
    expect(run([closure('GAU', hm(6), 60)]).metrics.delayed).toBe(0);
    expect(run([closure('BOM', 480, 180)]).metrics.totalDelayMinutes).toBeGreaterThan(r.metrics.totalDelayMinutes);
  });
  it('rejects a zero-length closure', () => { expect(() => run([{ airport: 'BOM', start: 600, end: 600 }])).toThrow(); });
});

describe('aircraft rotation propagation', () => {
  const r = run([BOM_0800]);
  it('DS05 chain: delay propagates then is absorbed by the scheduled buffer', () => {
    const f = (id: string) => r.flightById.get(id)!;
    // DS0501 arrives BLR 11:15 (+75); +30 turn → DS0502 ready 11:45 vs 11:10 sched
    expect(f('DS0502')).toMatchObject({ actualDep: hm(11, 45), depDelay: 35, arrDelay: 35, primaryCause: 'ROTATION' });
    expect(f('DS0502').binding).toMatchObject({ kind: 'ROTATION', from: 'DS0501' });
    // DS0502 arrives COK 12:45; +30 → 13:15 = scheduled → no delay (65 min buffer − 30 = 35 absorbs 35)
    expect(f('DS0503')).toMatchObject({ depDelay: 0, arrDelay: 0, absorbed: 35 });
    expect(f('DS0504').arrDelay).toBe(0);
  });
  it('DS12 chain follows turnaround arithmetic (35, then 30)', () => {
    expect(r.flightById.get('DS1203')).toMatchObject({ depDelay: 35 });
    expect(r.flightById.get('DS1204')).toMatchObject({ depDelay: 30 });
  });
  it('turnaround respected, never early, never negative — across a grid of closures', () => {
    for (const a of net.airports) for (const s of [hm(6), hm(8, 30), hm(11), hm(14), hm(17)]) for (const d of [30, 90, 180]) {
      const res = run([closure(a.id, s, d)]);
      for (const ids of res.sequences.values()) for (let i = 0; i < ids.length; i++) {
        const cur = res.flightById.get(ids[i])!;
        expect(cur.depDelay).toBeGreaterThanOrEqual(0); expect(cur.arrDelay).toBeGreaterThanOrEqual(0);
        expect(cur.actualDep!).toBeGreaterThanOrEqual(cur.schedDep);
        if (i > 0) expect(cur.actualDep!).toBeGreaterThanOrEqual(res.flightById.get(ids[i - 1])!.actualArr! + 30);
      }
    }
  });
  it('explanations come from the computed schedule', () => {
    const chain = buildChain(net, r, 'DS0502');
    expect(chain[0]).toMatchObject({ kind: 'root' }); expect(chain[0].text).toMatch(/BOM airport closure/);
    expect(chain.map((c) => c.flightId)).toEqual(expect.arrayContaining(['DS0501', 'DS0502', 'DS0503']));
    expect(chain.find((c) => c.kind === 'absorbed')!.text).toMatch(/DS0503 absorbs/);
    for (const f of r.flights.filter((x) => x.arrDelay > 0)) expect(f.causes.length, f.id).toBeGreaterThan(0);
  });
});

describe('connections and passengers', () => {
  const r = run([BOM_0800]);
  it('identifies the broken connections with actual transfer times', () => {
    const cx = (id: string) => r.connections.find((c) => c.id === id)!;
    expect(cx('CX05')).toMatchObject({ status: 'missed', transfer: 0, pax: 30 }); // DS0201 lands 09:30, DS0702 leaves 09:30
    expect(cx('CX10')).toMatchObject({ status: 'missed', transfer: 40, pax: 18 }); // DS1203 lands 12:45, DS0903 leaves 13:25 (needs 45)
    expect(r.connections.filter((c) => c.status === 'made')).toHaveLength(19);
    expect(r.metrics.missedConnectionPax).toBe(48); expect(r.metrics.brokenConnections).toBe(2);
  });
  it('valid connections stay valid when both flights slip together', () => {
    expect(r.connections.find((c) => c.id === 'CX03')!.status).toBe('made');
  });
  it('passenger groups are disjoint and add up to distinct passengers', () => {
    const sumFlights = net.flights.reduce((a, f) => a + f.pax, 0); const sumCx = net.connections.reduce((a, c) => a + c.pax, 0);
    for (const res of [run(), r, run([closure('DEL', hm(12), 120)]), run([closure('BLR', hm(13), 180)])]) {
      const p = res.metrics.pax;
      expect(p.distinct).toBe(sumFlights - sumCx);
      expect(p.onTime + p.delayed + p.cancelled + p.missedConnection).toBe(p.distinct);
      expect(p.stranded).toBe(p.cancelled + p.missedConnection);
      expect(p.impacted).toBe(p.delayed + p.stranded);
    }
  });
  it('does not simply add passenger counts of every affected flight (no double counting)', () => {
    const seatSum = r.metrics.pax.seatsOnDelayedFlights;
    expect(r.metrics.pax.impacted).toBeLessThanOrEqual(r.metrics.pax.distinct);
    expect(seatSum).toBeGreaterThan(0);
  });
  it('matches hand calculation for the BOM scenario', () => {
    // delayed flights pax: DS0201 153 DS0202 142 DS0501 159 DS0502 168 DS0702 161 DS1202 154 DS1203 158 DS1204 171 DS1502 159
    expect(r.metrics.pax.seatsOnDelayedFlights).toBe(153 + 142 + 159 + 168 + 161 + 154 + 158 + 171 + 159);
  });
});

describe('crew duty', () => {
  it('uses simulated arrivals, independent of whether flights are merely delayed', () => {
    const r = run([BOM_0800]);
    expect(r.metrics.delayed).toBeGreaterThan(0);
    expect(r.metrics.crewViolations).toBe(0); // delays exist but nobody is over their limit
    const cr12 = r.crews.find((c) => c.crewId === 'CR12')!; // DS1204 now arrives 13:15+95 = 14:50; start 05:45
    expect(cr12.lastArr).toBe(hm(14, 50)); expect(cr12.dutyMinutes).toBe(545);
  });
  it('detects violations, excess minutes and the flights beyond the limit', () => {
    const r = run([closure('DEL', hm(12), 120)]);
    const v = r.crews.filter((c) => c.violation);
    expect(v.length).toBe(2); expect(r.metrics.crewViolations).toBe(2);
    for (const c of v) { expect(c.excess).toBe(c.dutyMinutes - c.maxDuty); expect(c.dutyMinutes).toBe(c.lastArr! - c.dutyStart); expect(c.flightsBeyondLimit.length).toBeGreaterThan(0); }
    const cr03 = r.crews.find((c) => c.crewId === 'CR03')!;
    expect(cr03.violation).toBe(true); // only 10 minutes of slack in the schedule
    expect(r.metrics.crewExcessMinutes).toBe(v.reduce((a, c) => a + c.excess, 0));
  });
});

describe('capacity', () => {
  it('limits movements per hour deterministically with a stable tie-breaker', () => {
    const r = run([], [], { BOM: 1 });
    const occ = new Map<number, number>();
    for (const f of r.flights) { const d = net.flightById.get(f.id)!; if (d.origin === 'BOM') occ.set(Math.floor(f.actualDep! / 60), (occ.get(Math.floor(f.actualDep! / 60)) ?? 0) + 1); if (d.dest === 'BOM') occ.set(Math.floor(f.actualArr! / 60), (occ.get(Math.floor(f.actualArr! / 60)) ?? 0) + 1); }
    for (const v of occ.values()) expect(v).toBeLessThanOrEqual(1);
    expect(r.flights.some((f) => f.primaryCause === 'CAPACITY')).toBe(true);
    expect(JSON.stringify(run([], [], { BOM: 1 }).flights)).toBe(JSON.stringify(r.flights));
  });
  it('slot priority changes who waits', () => {
    const base = run([], [], { BOM: 1 });
    const waiting = base.flights.find((f) => f.binding.kind === 'CAPACITY' && net.flightById.get(f.id)!.origin === 'BOM')!;
    const pr = run([], [{ id: 'p', type: 'prioritize_flight', flightId: waiting.id }], { BOM: 1 });
    expect(pr.flightById.get(waiting.id)!.arrDelay).toBeLessThanOrEqual(base.flightById.get(waiting.id)!.arrDelay);
  });
});

describe('capacity combined with closures (regression: airborne hold + destination capacity)', () => {
  it('converges, respects capacity, and stays deterministic', () => {
    const go = () => run([BOM_0800], [], { BOM: 1, PNQ: 1, GOI: 1 });
    const r = go();
    const occ = new Map<string, number>();
    for (const f of r.flights) { const d = net.flightById.get(f.id)!; for (const [a, t] of [[d.origin, f.actualDep!], [d.dest, f.actualArr!]] as const) { const k = `${a}|${Math.floor(t / 60)}`; occ.set(k, (occ.get(k) ?? 0) + 1); } }
    for (const [k, v] of occ) if (['BOM', 'PNQ', 'GOI'].includes(k.split('|')[0])) expect(v, k).toBeLessThanOrEqual(1);
    for (const f of r.flights) { const d = net.flightById.get(f.id)!; if (d.origin === 'BOM') expect(f.actualDep! >= 480 && f.actualDep! < 570).toBe(false); if (d.dest === 'BOM') expect(f.actualArr! >= 480 && f.actualArr! < 570).toBe(false); }
    expect(JSON.stringify(go().flights)).toBe(JSON.stringify(r.flights));
  });
});

describe('determinism', () => {
  it('identical output for repeated runs', () => {
    const j = (x: ReturnType<typeof run>) => JSON.stringify({ f: x.flights, c: x.connections, cr: x.crews, m: x.metrics, e: x.events });
    const first = j(run([closure('DEL', hm(12), 120)]));
    for (let i = 0; i < 25; i++) expect(j(run([closure('DEL', hm(12), 120)]))).toBe(first);
  });
  it('does not mutate the network', () => {
    const before = JSON.stringify(net.flights); run([BOM_0800]); expect(JSON.stringify(net.flights)).toBe(before);
  });
});

describe('timeline events', () => {
  it('is chronological and mirrors the computed schedule', () => {
    const r = run([BOM_0800]);
    for (let i = 1; i < r.events.length; i++) expect(r.events[i].time).toBeGreaterThanOrEqual(r.events[i - 1].time);
    const dep = r.events.filter((e) => e.kind === 'departure'); const arr = r.events.filter((e) => e.kind === 'arrival');
    expect(dep).toHaveLength(70); expect(arr).toHaveLength(70);
    for (const e of dep) expect(e.time).toBe(r.flightById.get(e.flightId!)!.actualDep);
    expect(r.events.filter((e) => e.kind === 'closure_start')[0].time).toBe(480);
  });
});

describe('comparison maths', () => {
  it('never divides by zero and flags worse metrics', () => {
    const a = run(); const b = run([BOM_0800]);
    const rows = compareMetrics(a.metrics, b.metrics);
    expect(rows.every((r) => r.pct === null)).toBe(true); // baseline all zeros
    expect(rows.find((r) => r.key === 'delayed')!.direction).toBe('worse');
    const back = compareMetrics(b.metrics, a.metrics);
    expect(back.find((r) => r.key === 'delayed')).toMatchObject({ improvement: 9, pct: 100, direction: 'better' });
    expect(Number.isFinite(back.find((r) => r.key === 'delayMinutes')!.pct!)).toBe(true);
  });
});

describe('simulate() guards', () => {
  it('unknown airport', () => { expect(() => simulate(net, { closures: [{ airport: 'ZZZ', start: 1, end: 2 }], actions: [] })).toThrow(/Unknown/); });
});
