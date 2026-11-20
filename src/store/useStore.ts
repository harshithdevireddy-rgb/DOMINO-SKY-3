import { create } from 'zustand';
import type { Closure, Network, RecoveryAction, Scenario, SimulationResult } from '@/types';
import { ActionError } from '@/types';
import { loadDataset, type LoadResult } from '@/data/loader';
import { simulate } from '@/engine/simulation';
import { validateActions, describeAction } from '@/engine/recovery';
import { parseHHMM, fmtTime } from '@/engine/timeUtils';
import { loadSaved, persistSaved, type SavedScenario } from '@/utils/storage';
import { EMPTY_FILTER, type FlightFilter } from '@/utils/selectors';

export type Tab = 'overview' | 'map' | 'flights' | 'timeline' | 'dispatcher' | 'recovery' | 'analytics' | 'crew' | 'scenarios';
export interface Draft { airport: string; start: string; duration: number | 'custom'; custom: string; capacity: string }
export interface Toast { id: number; kind: 'success' | 'error' | 'info'; text: string }
export interface ConfirmState { title: string; message: string; confirmLabel: string; danger?: boolean; onConfirm: () => void }

export interface PresetDef { id: string; label: string; closures: { airport: string; start: string; duration: number }[] }
export const PRESETS: PresetDef[] = [
  { id: 'baseline', label: 'Baseline (no disruption)', closures: [] },
  { id: 'mumbai', label: 'Mumbai closure — BOM 08:00, 90 min', closures: [{ airport: 'BOM', start: '08:00', duration: 90 }] },
  { id: 'bengaluru', label: 'Bengaluru closure — BLR 13:00, 120 min', closures: [{ airport: 'BLR', start: '13:00', duration: 120 }] },
  { id: 'delhi', label: 'Delhi closure — DEL 12:00, 120 min', closures: [{ airport: 'DEL', start: '12:00', duration: 120 }] },
];

interface ReplayState { time: number | null; playing: boolean; speed: number }

interface State {
  load: LoadResult;
  network: Network | null;
  draft: Draft;
  scenarioName: string;
  scenario: Scenario;
  result: SimulationResult | null;
  /** same closures, no recovery actions — the "before recovery" reference */
  baseResult: SimulationResult | null;
  tab: Tab;
  selectedAirport: string | null;
  selectedFlight: string | null;
  selectedRoute: string | null;
  filter: FlightFilter;
  replay: ReplayState;
  saved: SavedScenario[];
  compare: [string | null, string | null];
  toasts: Toast[];
  confirm: ConfirmState | null;
  busy: boolean;

  setTab(t: Tab): void;
  setDraft(p: Partial<Draft>): void;
  draftClosure(): { closure: Closure | null; error: string | null };
  runSimulation(): void;
  loadPreset(id: string): void;
  resetScenario(): void;
  addAction(a: RecoveryAction): boolean;
  addActions(a: RecoveryAction[]): boolean;
  removeAction(id: string): void;
  clearActions(): void;
  selectAirport(id: string | null): void;
  selectFlight(id: string | null): void;
  selectRoute(key: string | null): void;
  setFilter(p: Partial<FlightFilter>): void;
  resetFilter(): void;
  setReplay(p: Partial<ReplayState>): void;
  startReplay(): void;
  saveScenario(name: string): void;
  renameScenario(id: string, name: string): void;
  deleteScenario(id: string): void;
  openScenario(id: string): void;
  setCompare(slot: 0 | 1, id: string | null): void;
  toast(kind: Toast['kind'], text: string): void;
  dismissToast(id: number): void;
  askConfirm(c: ConfirmState | null): void;
  setName(n: string): void;
}

const load = loadDataset();
const net = load.network;
let toastSeq = 0;
let actionSeq = 0;
export const newActionId = (prefix = 'act') => `${prefix}-u${++actionSeq}`;

const DEFAULT_DRAFT: Draft = { airport: 'BOM', start: '08:00', duration: 90, custom: '75', capacity: '' };
const MUMBAI = PRESETS[1];

function closureFromPreset(p: PresetDef): Closure[] {
  return p.closures.map((c) => ({ airport: c.airport, start: parseHHMM(c.start), end: parseHHMM(c.start) + c.duration }));
}
function run(n: Network, sc: Scenario): { result: SimulationResult; baseResult: SimulationResult } {
  const result = simulate(n, sc);
  const baseResult = sc.actions.length ? simulate(n, { ...sc, actions: [] }) : result;
  return { result, baseResult };
}
const initialScenario: Scenario = { closures: net ? closureFromPreset(MUMBAI) : [], actions: [] };
const initial = net ? run(net, initialScenario) : { result: null, baseResult: null };

export const useStore = create<State>((set, get) => ({
  load, network: net,
  draft: DEFAULT_DRAFT,
  scenarioName: 'Mumbai closure',
  scenario: initialScenario,
  result: initial.result, baseResult: initial.baseResult,
  tab: 'overview', selectedAirport: null, selectedFlight: null, selectedRoute: null,
  filter: EMPTY_FILTER,
  replay: { time: null, playing: false, speed: 1 },
  saved: loadSaved(), compare: [null, null],
  toasts: [], confirm: null, busy: false,

  setTab: (tab) => set({ tab }),
  setDraft: (p) => set((s) => ({ draft: { ...s.draft, ...p } })),
  setName: (scenarioName) => set({ scenarioName }),

  draftClosure: () => {
    const { draft, network } = get();
    if (!network) return { closure: null, error: 'Dataset not loaded.' };
    let start: number;
    try { start = parseHHMM(draft.start); } catch { return { closure: null, error: 'Enter a start time as HH:MM.' }; }
    const dur = draft.duration === 'custom' ? Number(draft.custom) : draft.duration;
    if (!Number.isFinite(dur) || !Number.isInteger(dur) || dur < 1) return { closure: null, error: 'Duration must be a whole number of minutes (≥ 1).' };
    if (dur > 720) return { closure: null, error: 'Duration is limited to 720 minutes (12 h).' };
    if (draft.capacity !== '') {
      const c = Number(draft.capacity);
      if (!Number.isInteger(c) || c < 1 || c > 200) return { closure: null, error: 'Capacity override must be a whole number between 1 and 200 movements/hour.' };
    }
    return { closure: { airport: draft.airport, start, end: start + dur }, error: null };
  },

  runSimulation: () => {
    const { network, draftClosure, scenario } = get();
    if (!network) return;
    const { closure, error } = draftClosure();
    if (!closure) { get().toast('error', error ?? 'Invalid disruption.'); return; }
    const go = () => {
      const cap = get().draft.capacity !== '' ? { [closure.airport]: Number(get().draft.capacity) } : undefined;
      const sc: Scenario = { closures: [closure], actions: [], capacityOverrides: cap };
      try {
        const r = run(network, sc);
        set({ scenario: sc, ...r, scenarioName: `${closure.airport} closure ${fmtTime(closure.start)}+${closure.end - closure.start}m`, replay: { time: null, playing: false, speed: get().replay.speed }, selectedFlight: null, selectedRoute: null, selectedAirport: closure.airport });
        get().toast('success', `Simulated ${closure.airport} closure ${fmtTime(closure.start)}–${fmtTime(closure.end)}: ${r.result.metrics.delayed} delayed flights.`);
      } catch (e) { get().toast('error', (e as Error).message); }
    };
    if (scenario.actions.length) {
      get().askConfirm({ title: 'Discard recovery actions?', message: `Running a new disruption clears the ${scenario.actions.length} applied recovery action${scenario.actions.length > 1 ? 's' : ''}.`, confirmLabel: 'Run new simulation', danger: true, onConfirm: go });
    } else go();
  },

  loadPreset: (id) => {
    const { network } = get();
    const p = PRESETS.find((x) => x.id === id);
    if (!network || !p) return;
    const sc: Scenario = { closures: closureFromPreset(p), actions: [] };
    const r = run(network, sc);
    const c = p.closures[0];
    set({ scenario: sc, ...r, scenarioName: p.label.split(' — ')[0], draft: c ? { ...get().draft, airport: c.airport, start: c.start, duration: [30, 60, 90, 120, 180].includes(c.duration) ? c.duration : 'custom', custom: String(c.duration), capacity: '' } : get().draft, replay: { time: null, playing: false, speed: get().replay.speed }, selectedFlight: null, selectedRoute: null, selectedAirport: c?.airport ?? null });
  },

  resetScenario: () => {
    get().askConfirm({
      title: 'Reset scenario?', message: 'This removes the current disruption and every applied recovery action, returning to the baseline schedule.', confirmLabel: 'Reset', danger: true,
      onConfirm: () => { get().loadPreset('baseline'); set({ draft: DEFAULT_DRAFT, filter: EMPTY_FILTER, tab: 'overview' }); get().toast('info', 'Scenario reset to baseline.'); },
    });
  },

  addActions: (acts) => {
    const { network, scenario } = get();
    if (!network) return false;
    const next: Scenario = { ...scenario, actions: [...scenario.actions, ...acts] };
    const reason = validateActions(network, next.actions);
    if (reason) { get().toast('error', `Cannot apply: ${reason}`); return false; }
    try {
      const r = run(network, next);
      const bad = r.result.rejectedActions.find((x) => acts.some((a) => a.id === x.actionId));
      if (bad) { get().toast('error', `Cannot apply: ${bad.reason}`); return false; }
      set({ scenario: next, ...r });
      get().toast('success', acts.length === 1 ? `Applied: ${describeAction(network, acts[0])}` : `Applied ${acts.length} recovery actions.`);
      return true;
    } catch (e) {
      get().toast('error', e instanceof ActionError ? e.message : (e as Error).message);
      return false;
    }
  },
  addAction: (a) => get().addActions([a]),

  removeAction: (id) => {
    const { network, scenario } = get();
    if (!network) return;
    const next: Scenario = { ...scenario, actions: scenario.actions.filter((a) => a.id !== id) };
    const reason = validateActions(network, next.actions);
    if (reason) { get().toast('error', `Cannot remove: later actions depend on it (${reason})`); return; }
    set({ scenario: next, ...run(network, next) });
    get().toast('info', 'Recovery action removed; network re-simulated.');
  },
  clearActions: () => {
    const { network, scenario } = get();
    if (!network || !scenario.actions.length) return;
    const next: Scenario = { ...scenario, actions: [] };
    set({ scenario: next, ...run(network, next) });
    get().toast('info', 'All recovery actions cleared.');
  },

  selectAirport: (selectedAirport) => set({ selectedAirport }),
  selectFlight: (selectedFlight) => set({ selectedFlight }),
  selectRoute: (selectedRoute) => set({ selectedRoute }),
  setFilter: (p) => set((s) => ({ filter: { ...s.filter, ...p } })),
  resetFilter: () => set({ filter: EMPTY_FILTER }),
  setReplay: (p) => set((s) => ({ replay: { ...s.replay, ...p } })),
  startReplay: () => {
    const r = get().result;
    if (!r) return;
    const t0 = Math.max(0, Math.min(...r.events.map((e) => e.time)) - 15);
    set((s) => ({ replay: { ...s.replay, time: t0, playing: true } }));
  },

  saveScenario: (name) => {
    const { scenario, saved, scenarioName } = get();
    const entry: SavedScenario = { id: `sc-${Date.now().toString(36)}-${saved.length}`, name: name.trim() || scenarioName, createdAt: Date.now(), scenario: JSON.parse(JSON.stringify(scenario)) };
    const list = [entry, ...saved];
    const ok = persistSaved(list);
    set({ saved: list });
    get().toast(ok ? 'success' : 'error', ok ? `Saved “${entry.name}”.` : 'Saved for this session only — browser storage is unavailable.');
  },
  renameScenario: (id, name) => {
    const list = get().saved.map((s) => (s.id === id ? { ...s, name: name.trim() || s.name } : s));
    persistSaved(list); set({ saved: list });
  },
  deleteScenario: (id) => {
    const list = get().saved.filter((s) => s.id !== id);
    persistSaved(list);
    set((s) => ({ saved: list, compare: [s.compare[0] === id ? null : s.compare[0], s.compare[1] === id ? null : s.compare[1]] }));
  },
  openScenario: (id) => {
    const { network, saved } = get();
    const s = saved.find((x) => x.id === id);
    if (!network || !s) return;
    try {
      const r = run(network, s.scenario);
      const c = s.scenario.closures[0];
      set({ scenario: s.scenario, ...r, scenarioName: s.name, draft: c ? { ...get().draft, airport: c.airport, start: fmtTime(c.start, { dayMarker: false }), duration: [30, 60, 90, 120, 180].includes(c.end - c.start) ? c.end - c.start : 'custom', custom: String(c.end - c.start), capacity: '' } : get().draft, selectedFlight: null, replay: { time: null, playing: false, speed: get().replay.speed } });
      get().toast('success', `Opened “${s.name}”.`);
    } catch (e) { get().toast('error', `Could not open scenario: ${(e as Error).message}`); }
  },
  setCompare: (slot, id) => set((s) => ({ compare: slot === 0 ? [id, s.compare[1]] : [s.compare[0], id] })),

  toast: (kind, text) => {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, text }] }));
    setTimeout(() => get().dismissToast(id), 5000);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  askConfirm: (confirm) => set({ confirm }),
}));
