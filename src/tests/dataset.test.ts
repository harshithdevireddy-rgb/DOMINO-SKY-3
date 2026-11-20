import { describe, it, expect } from 'vitest';
import raw from '@/data/flight_network.json';
import { loadDataset } from '@/data/loader';
import { validateDataset } from '@/data/validation';
import { parseHHMM, fmtTime, fmtDuration } from '@/engine/timeUtils';
import { net } from './helpers';

const clone = () => JSON.parse(JSON.stringify(raw));

describe('dataset loading', () => {
  it('loads exactly what the JSON contains', () => {
    expect(net.airports).toHaveLength(16);
    expect(net.flights).toHaveLength(70);
    expect(net.tails).toHaveLength(16);
    expect(net.connections).toHaveLength(21);
    expect(net.crews).toHaveLength(16);
    expect(net.spares.map((s) => s.tail).sort()).toEqual(['VT-DS17', 'VT-DS18']);
    expect(net.minTurnaround).toBe(30);
  });
  it('validates references (flights, aircraft, airports, crews, connections)', () => {
    const r = validateDataset(raw);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.counts).toMatchObject({ airports: 16, flights: 70, aircraft: 16, connections: 21, crews: 16, spares: 2 });
    for (const f of net.flights) { expect(net.airportById.has(f.origin)).toBe(true); expect(net.airportById.has(f.dest)).toBe(true); expect(net.tails).toContain(f.tail); }
    for (const c of net.connections) { expect(net.flightById.has(c.from)).toBe(true); expect(net.flightById.has(c.to)).toBe(true); expect(net.airportById.has(c.airport)).toBe(true); }
    for (const c of net.crews) for (const id of c.flightIds) expect(net.flightById.get(id)!.tail).toBe(c.tail);
  });
  it('keeps aircraft leg order and continuity', () => {
    for (const [tail, ids] of net.rotations) {
      ids.forEach((id, i) => expect(net.flightById.get(id)!.leg, `${tail} leg`).toBe(i + 1));
      for (let i = 1; i < ids.length; i++) {
        const a = net.flightById.get(ids[i - 1])!; const b = net.flightById.get(ids[i])!;
        expect(a.dest).toBe(b.origin);
        expect(b.schedDep - a.schedArr).toBe(b.schedTurn);
      }
    }
  });
  it('derives crew report lead (45) from data', () => expect(net.crewReportLead).toBe(45));
  it('uses real data values (spot checks)', () => {
    expect(net.flightById.get('DS0501')).toMatchObject({ origin: 'BOM', dest: 'BLR', schedDep: 495, pax: 159 });
    expect(net.airportById.get('BOM')!.capacityPerHour).toBe(32);
    expect(net.connections.find((c) => c.id === 'CX05')).toMatchObject({ pax: 30, minConnect: 45 });
  });
});

describe('dataset validation rejects malformed data (no fake data)', () => {
  it('null / non-object / missing sections', () => {
    expect(loadDataset(null).network).toBeNull();
    expect(loadDataset('x').report.ok).toBe(false);
    const d = clone(); delete d.flights;
    const r = loadDataset(d); expect(r.network).toBeNull(); expect(r.report.errors.join()).toMatch(/flights/);
  });
  it('unknown airport / crew / connection references', () => {
    const a = clone(); a.flights[0].destination = 'XXX';
    expect(validateDataset(a).errors.join()).toMatch(/unknown destination XXX/);
    const b = clone(); b.crews[0].flight_ids.push('DS9999');
    expect(validateDataset(b).errors.join()).toMatch(/unknown flight DS9999/);
    const c = clone(); c.connections[0].to_flight = 'NOPE';
    expect(validateDataset(c).errors.join()).toMatch(/unknown to_flight/);
  });
  it('broken rotation continuity, block time and tight connection', () => {
    const a = clone(); a.flights[1].origin = 'BOM';
    expect(validateDataset(a).errors.join()).toMatch(/lands at/);
    const b = clone(); b.flights[0].block_minutes = 10;
    expect(validateDataset(b).errors.join()).toMatch(/block_minutes/);
    const c = clone(); c.connections[0].min_connect_minutes = 500;
    expect(validateDataset(c).errors.join()).toMatch(/infeasible/);
  });
  it('connection passengers exceeding flight pax', () => {
    const a = clone(); a.connections[0].passengers = 999;
    expect(validateDataset(a).errors.join()).toMatch(/exceed total pax/);
  });
});

describe('time utilities', () => {
  it('parses and formats', () => {
    expect(parseHHMM('08:15')).toBe(495); expect(parseHHMM('00:00')).toBe(0);
    expect(() => parseHHMM('25:00')).toThrow(); expect(() => parseHHMM('8')).toThrow();
    expect(fmtTime(495)).toBe('08:15'); expect(fmtTime(1500)).toBe('01:00 (+1)'); expect(fmtTime(null)).toBe('—');
    expect(fmtDuration(75)).toBe('1h 15m'); expect(fmtDuration(45)).toBe('45m');
  });
});
