import { test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadDataset } from '@/data/loader';
import { simulate } from '@/engine/simulation';

// Generates a grid of scenarios and writes engine output for the independent Python oracle (see scripts/oracle.py).
test.skipIf(!process.env.DUMP)('dump scenarios for oracle', () => {
  const { network } = loadDataset();
  const out: unknown[] = [];
  for (const a of network!.airports) {
    for (let start = 360; start <= 1200; start += 90) {
      for (const dur of [30, 60, 90, 120, 180, 300]) {
        const res = simulate(network!, { closures: [{ airport: a.id, start, end: start + dur }], actions: [] });
        out.push({
          airport: a.id, start, dur,
          flights: Object.fromEntries(res.flights.map((f) => [f.id, [f.actualDep, f.actualArr]])),
          conn: Object.fromEntries(res.connections.map((c) => [c.id, c.status])),
          crew: Object.fromEntries(res.crews.map((c) => [c.crewId, [c.dutyMinutes, c.violation]])),
          pax: res.metrics.pax,
        });
      }
    }
  }
  // Output location is configurable so nothing depends on the machine's layout.
  const target = process.env.ORACLE_DUMP ?? path.join(os.tmpdir(), 'engine_dump.json');
  fs.writeFileSync(target, JSON.stringify(out));
  console.log(`engine dump written to ${target}`);
});
