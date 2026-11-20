"""Independent re-implementation of the Domino Sky rules (Python, written separately from the TS engine).
Reads the raw dataset, recomputes every scenario in a dump produced by the TS engine, and reports mismatches.
Rules: rotation (dep>=prev.arr+30), closure departure hold, closure arrival (ground hold / airborne hold),
connections (transfer>=min), crew duty (last arr - duty_start vs max), passenger groups."""
import json, sys, collections
d = json.load(open(sys.argv[1])); dump = json.load(open(sys.argv[2]))
m = lambda s: int(s[:2]) * 60 + int(s[3:])
F = {f['flight_id']: dict(f, dep=m(f['dep']), arr=m(f['arr'])) for f in d['flights']}
by = collections.defaultdict(list)
for f in F.values(): by[f['tail_id']].append(f)
for l in by.values(): l.sort(key=lambda f: f['leg_order'])
cap = {a['id']: a['capacity_per_hour'] for a in d['airports']}
MIN = d['meta']['min_turnaround_minutes']

def run(ap, S, E):
    # process every flight in the global order (time-ordered); with no capacity binding this is a pure per-aircraft chain
    res = {}
    for tail, l in by.items():
        prev_arr = None
        for f in l:
            t = f['dep']
            if prev_arr is not None: t = max(t, prev_arr + MIN)
            while True:
                t0 = t
                if f['origin'] == ap and S <= t < E: t = E
                arr = t + f['block_minutes']
                if f['destination'] == ap and S <= arr < E:
                    if t < S: arr = E            # airborne hold
                    else: t = E - f['block_minutes']; arr = E   # ground hold
                if t == t0: break
            res[f['flight_id']] = (t, arr)
            prev_arr = arr
    return res

bad = 0; checked = 0
for sc in dump:
    ap, S, E = sc['airport'], sc['start'], sc['start'] + sc['dur']
    r = run(ap, S, E)
    # capacity check: oracle assumes it never binds; verify
    occ = collections.Counter()
    for fid, (t, a) in r.items():
        occ[(F[fid]['origin'], t // 60)] += 1; occ[(F[fid]['destination'], a // 60)] += 1
    assert all(v <= cap[k[0]] for k, v in occ.items()), ('capacity binds', sc['airport'], S, E)
    for fid, (t, a) in r.items():
        checked += 1
        if sc['flights'][fid] != [t, a]:
            bad += 1; print('FLIGHT MISMATCH', ap, S, E, fid, sc['flights'][fid], (t, a))
    # connections
    for c in d['connections']:
        tr = r[c['to_flight']][0] - r[c['from_flight']][1]
        exp = 'made' if tr >= c['min_connect_minutes'] else 'missed'
        if sc['conn'][c['connection_id']] != exp: bad += 1; print('CX MISMATCH', ap, S, E, c['connection_id'], sc['conn'][c['connection_id']], exp)
    # crew
    for c in d['crews']:
        last = max(r[x][1] for x in c['flight_ids'])
        duty = last - m(c['duty_start'])
        got = sc['crew'][c['crew_id']]
        if got[0] != duty or got[1] != (duty > c['max_duty_mins']): bad += 1; print('CREW MISMATCH', ap, S, E, c['crew_id'], got, duty)
    # passenger groups
    cin = collections.Counter(); 
    for c in d['connections']: cin[c['from_flight']] += c['passengers']; cin[c['to_flight']] += c['passengers']
    on = dl = ms = 0
    for f in F.values():
        loc = f['pax'] - cin[f['flight_id']]
        t, a = r[f['flight_id']]
        if a - f['arr'] >= 1: dl += loc
        else: on += loc
    for c in d['connections']:
        tr = r[c['to_flight']][0] - r[c['from_flight']][1]
        if tr < c['min_connect_minutes']: ms += c['passengers']
        elif r[c['to_flight']][1] - F[c['to_flight']]['arr'] >= 1: dl += c['passengers']
        else: on += c['passengers']
    p = sc['pax']
    exp = dict(onTime=on, delayed=dl, missedConnection=ms, cancelled=0)
    if any(p[k] != v for k, v in exp.items()) or p['distinct'] != on + dl + ms: bad += 1; print('PAX MISMATCH', ap, S, E, {k: p[k] for k in exp}, exp)
print(f'scenarios={len(dump)} flight-results-checked={checked} mismatches={bad}')
sys.exit(1 if bad else 0)
