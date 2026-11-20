# Domino Sky — airline disruption simulator

Close an airport for a time window and watch the disruption propagate through aircraft rotations,
passenger connections and crew duty limits. Then apply recovery actions and see the before/after
result, recomputed by the same deterministic engine.

* **Source of truth:** `src/data/flight_network.json` (16 airports, 16 aircraft + 2 spares, 70 flights,
  18 connections, 16 crews). It is validated at startup; a malformed file shows a readable error screen
  instead of a broken app. No data is invented anywhere.
* **The engine is deterministic and contains no LLM.** Every number on screen comes from
  `src/engine/`. The AI layer may only *narrate* numbers the engine already computed.

## Features

* **Airport closure simulation** — choose airport, start time and duration (presets included); departures and
  arrivals are both affected, with a documented hold policy.
* **Delay propagation** through aircraft rotations with turnaround buffers, plus airport capacity limits.
* **Passenger model** — connections made/missed, distinct-passenger accounting with no double counting,
  stranded and impacted counts.
* **Crew duty limits** — duty vs. maximum per crew, violations flagged independently of flight delay.
* **Causal explanations** — click any delayed flight for the chain from the closure to that flight.
* **Interactive network map**, **flight table** (search / sort / filter), **Gantt timeline with replay**.
* **Recovery actions** — cancel, deploy spare aircraft (VT-DS17 / VT-DS18), swap aircraft, prioritise a
  flight, protect a connection. All are validated and re-simulated; impossible actions are rejected with a reason.
* **Rule-based Dispatcher** with ranked recommendations and a greedy recovery plan; optional **AI narration**
  that is numerically verified against the engine output.
* **Before/after comparison** dashboard (no divide-by-zero; worsening metrics are flagged).
* **Analytics** — delay distribution, propagation heatmap by aircraft, airport impact, passenger impact,
  recovery performance.
* **Scenarios** — save, rename, delete, reopen, compare two, export JSON / CSV (stored in `localStorage`).
* Loading, empty and error states, toasts, confirmation dialogs, keyboard access, responsive layout.

## Technology stack

| Area | Choice |
|---|---|
| UI | React 19, TypeScript 6 (strict) |
| Build | Vite 8 |
| Styling | Tailwind CSS 4 (via `@tailwindcss/vite`; theme tokens live in `src/index.css`, so there is no `tailwind.config.js`) |
| State | Zustand 5 |
| Charts | Recharts 3 |
| Icons | lucide-react |
| Unit tests | Vitest 5 |
| Browser tests | Playwright |
| Lint | ESLint 10 + typescript-eslint |
| Serverless | Vercel function (`api/dispatch.ts`) sharing `server/dispatchHandler.ts` with the dev server |

## Requirements

* **Node.js ≥ 20.19** (or ≥ 22.12) and npm ≥ 10 — required by Vite 8.
* Python 3 is only needed for the optional oracle cross-check.
* A Chrome/Chromium for the browser tests (see below).

## Quick start

```bash
npm install          # or `npm ci` for an exact, lockfile-based install
npm run dev          # http://localhost:5173
```

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server, including the `/api/dispatch` endpoint |
| `npm run build` | Typecheck (`tsc --noEmit`) then production build to `dist/` |
| `npm run preview` | Serve the production build (static only; `/api` needs Vercel or `npm run dev`) |
| `npm run typecheck` / `npm run lint` | TypeScript strict / ESLint |
| `npm test` | Vitest unit tests (engine, recovery, dataset, AI guard) |
| `npm run test:e2e` | Playwright browser tests (starts its own dev server on port 5199) |

Playwright uses `/usr/bin/google-chrome` if present, or `PLAYWRIGHT_CHROME=/path/to/chrome`.
Otherwise run `npx playwright install chromium` once.

## Environment variables

Copy `.env.example` to `.env`. **Both are optional** — without a key the app works fully and the
dispatcher is labelled **Rule-based Dispatcher**.

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Server-side only. Enables the "Ask AI to explain" narration. Never exposed to the browser. |
| `ANTHROPIC_MODEL` | Model id used by the narration endpoint (see `.env.example`). |

## Deploying to Vercel

1. Import the repo; framework preset **Vite** (build `npm run build`, output `dist`).
2. Optionally add `ANTHROPIC_API_KEY` (and `ANTHROPIC_MODEL`) under Project → Environment Variables.
3. `vercel.json` already rewrites unknown paths to the SPA and keeps `/api/*` for the serverless
   function in `api/dispatch.ts`.

## Simulation rules

All times are integer minutes since 00:00 IST (≥ 1440 means next day).

**Aircraft rotations.** Each aircraft flies its legs in order. A leg cannot depart before the previous
arrival plus the 30-minute minimum turnaround. Scheduled ground time in the dataset is treated as buffer
(`scheduled gap − 30`), so a late arrival is absorbed by buffer before it delays the next leg. Delays
are never negative: nothing departs early.

**Airport closure.** A closure is a window `[start, end)` at one airport; the airport reopens exactly at `end`.
* Departure inside the window → waits until reopening.
* Arrival inside the window → if the aircraft is already airborne when the closure starts it **holds in
  the air** and lands at reopening; otherwise it is **held on the ground at the origin** so it arrives
  at reopening. There are no diversions.

**Airport capacity.** Movements (departures + arrivals) per clock hour are limited to the airport's
hourly capacity. Over-capacity flights are pushed to the next hour in a fixed order (earliest feasible
departure, priority flag, scheduled departure, flight id). A per-airport capacity override is available
in the control panel.

**Connections.** A connection is made when the onward flight's actual departure is at least
`min_connect_minutes` after the inbound flight's actual arrival. Otherwise it is missed; if either flight
is cancelled the connection is lost.

**Passenger accounting (no double counting).** Passengers on a connection occupy a seat on two flights,
so seat counts overstate people. The app therefore reports *distinct* passengers
(`Σ flight pax − Σ connection pax`) split into disjoint groups: on time, delayed, missed connection,
cancelled itinerary. *Stranded* = cancelled + missed connection (no re-booking is modelled).
*Impacted* = delayed + stranded. Seat-based counts are shown separately and labelled.

**Crew duty.** Duty = simulated arrival of the crew's last operated flight − duty start, compared with the
crew's maximum duty. Crews follow their aircraft. A violation is independent of whether a flight is
"delayed": a crew can breach its limit with a modest delay, and a delayed crew can still be within limits.
Spare aircraft are staffed by a standby crew reporting 45 minutes before its first departure (derived
from the dataset's own report-to-departure lead time).

**Network status.** From the share of flights affected (delayed or cancelled), stranded passengers, severe
delays (≥ 60 min) and crew violations — thresholds in `src/engine/config.ts`:
* **NORMAL** — no flight affected and no crew violation.
* **MINOR** — some flights affected, below the MAJOR triggers.
* **MAJOR** — ≥ 10 % of flights affected, **or** any stranded passengers, **or** any crew violation, **or** ≥ 3 severe delays.
* **CRITICAL** — ≥ 25 % of flights affected, **or** ≥ 2 crew violations.

## Recovery actions

Every action is rebuilt into a plan and **validated before it is applied**; an invalid action is
rejected with a reason and changes nothing.

1. **Cancel** flight(s) — only sets that keep the aircraft's position valid.
2. **Deploy spare** (VT-DS17 / VT-DS18) — must be based at the right airport, available, and have enough seats.
3. **Swap aircraft** — continuity, seats and turnaround checked for both aircraft.
4. **Prioritise** a flight for capacity slots.
5. **Protect a connection** — hold the onward flight (max 90 minutes) for the inbound passengers. Holding
   delays the onward flight's own passengers; the UI shows that trade-off.

Actions can be applied one at a time (with a confirmation), as a whole recommended plan, removed
individually, or cleared. Each change re-simulates the network.

## Dispatcher

* **Rule-based Dispatcher** (always available): enumerates candidate actions, **re-simulates each one**,
  and ranks them by an explicit cost
  (`passenger delay minutes + 120 × stranded passengers + 20 000 × crew violations + 50 × excess duty minutes`;
  weights in `src/engine/config.ts`). It builds a greedy plan of compatible actions, each step chosen after
  re-simulating the previous steps. Recommendation cards report *savings* (positive = better).
* **AI narration** (optional): `server/dispatchHandler.ts` sends the engine's numbers to the model. A
  numeric guard (`server/aiGuard.ts`) rejects any narrative containing a number that is not in the payload,
  or an unknown action id; the client then falls back to the rule-based text. If there is no key, a 503 is
  returned and the UI says so — it never presents fallback text as AI output.

## Architecture

```
src/
  data/        flight_network.json, validation.ts, loader.ts
  engine/      simulation.ts (event loop), aircraftRotation, airportCapacity, connections,
               passengerImpact, crewDuty, recovery (plan builder + validation), explain,
               compare, dispatcher, config, timeUtils      — pure TypeScript, no React
  store/       Zustand store (draft vs. simulated scenario, saved scenarios, toasts, confirm)
  components/  simulation/, dashboard/, flights/, dispatcher/, charts/, map/, ui/
  utils/       formatting, selectors, colours, exporter (JSON/CSV), localStorage, AI client
  tests/       Vitest: dataset, engine, recovery, AI guard
server/        dispatchHandler.ts, aiGuard.ts     (shared by dev middleware and Vercel function)
api/           dispatch.ts                         (Vercel serverless entry)
e2e/           Playwright workflows
scripts/       oracle.py — independent Python re-implementation used to cross-check the engine
```

## How the results were verified

* **Unit tests** cover each rule (closure windows, airborne vs. ground hold, buffer absorption, capacity,
  connections, passenger de-duplication, crew limits) and every recovery validation.
* **Independent oracle:** `scripts/oracle.py` re-implements the rules separately (needs Python 3 only).
  ```bash
  ORACLE_DUMP=./engine_dump.json DUMP=1 npx vitest run src/tests/dump.test.ts --disableConsoleIntercept
  python3 -I scripts/oracle.py src/data/flight_network.json ./engine_dump.json
  ```
  (On Windows PowerShell set the variables first: `$env:DUMP=1; $env:ORACLE_DUMP='engine_dump.json'`.)
  It compares every flight across 960 closure scenarios and should print `mismatches=0`.
* **Browser tests** (`e2e/`) drive the real UI and compare displayed numbers with values derived outside
  the engine.

## Known limitations

* The model has no diversions, no passenger re-booking, no weather/ATC en-route effects and no
  maintenance/crew-rest rules beyond the dataset's maximum duty.
* One airport closure per scenario is exposed in the UI (the engine itself accepts several).
* Scenarios are stored in the browser (`localStorage`) — they are per-browser, not shared.
* The live AI path cannot be exercised without an API key; it is covered by tests with a mocked
  model response (grounded, invented-number, unknown-id, malformed-output, provider-error, bad-request
  and network-failure cases). `ANTHROPIC_MODEL` defaults to `claude-sonnet-5-5`; that default has not been
  exercised against the live API.
