import { lazy, Suspense, useEffect } from 'react';
import { Activity, Plane, Table2, GanttChart, Bot, GitCompareArrows, BarChart3, Users, FolderKanban, Save, ShieldAlert } from 'lucide-react';
import clsx from 'clsx';
import { useStore, type Tab } from '@/store/useStore';
import { NETWORK_STATUS_STYLE } from '@/utils/colors';
import { ControlPanel } from '@/components/simulation/ControlPanel';
import { ReplayDriver } from '@/components/simulation/ReplayDriver';
import { Overview } from '@/components/dashboard/Overview';
import { FlightTable } from '@/components/flights/FlightTable';
import { FlightDrawer } from '@/components/flights/FlightDrawer';
import { TimelineView } from '@/components/simulation/Timeline';
import { DispatcherPanel } from '@/components/dispatcher/DispatcherPanel';
import { CrewConnections } from '@/components/dashboard/CrewConnections';
import { ConfirmDialog, Toasts, Button } from '@/components/ui/primitives';

// Chart-heavy views are code-split so the first paint does not pay for Recharts.
const RecoveryCompare = lazy(() => import('@/components/dispatcher/RecoveryCompare').then((m) => ({ default: m.RecoveryCompare })));
const Analytics = lazy(() => import('@/components/charts/Analytics').then((m) => ({ default: m.Analytics })));
const Scenarios = lazy(() => import('@/components/simulation/Scenarios').then((m) => ({ default: m.Scenarios })));
const ViewLoading = () => <div role="status" aria-live="polite" className="grid h-48 place-items-center text-sm text-mute">Loading view…</div>;

const TABS: { id: Tab; label: string; icon: typeof Activity }[] = [
  { id: 'overview', label: 'Operations', icon: Activity },
  { id: 'flights', label: 'Flights', icon: Table2 },
  { id: 'timeline', label: 'Timeline', icon: GanttChart },
  { id: 'dispatcher', label: 'AI Dispatcher', icon: Bot },
  { id: 'recovery', label: 'Recovery', icon: GitCompareArrows },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'crew', label: 'Crew & connections', icon: Users },
  { id: 'scenarios', label: 'Scenarios', icon: FolderKanban },
];

function DataError({ errors }: { errors: string[] }) {
  return (
    <div className="grid min-h-full place-items-center p-6">
      <div role="alert" className="w-full max-w-2xl rounded-xl border border-bad/50 bg-surface p-6">
        <div className="flex items-center gap-2 text-bad"><ShieldAlert className="h-5 w-5" /><h1 className="text-lg font-semibold">The flight network dataset could not be loaded</h1></div>
        <p className="mt-2 text-sm text-mute">Domino Sky never substitutes made-up data. Fix <code className="text-ink">src/data/flight_network.json</code> and reload. Problems found:</p>
        <ul className="mt-3 max-h-72 list-disc space-y-1 overflow-auto pl-5 text-sm">{errors.slice(0, 40).map((e) => <li key={e}>{e}</li>)}</ul>
      </div>
    </div>
  );
}

export function App() {
  const load = useStore((s) => s.load); const net = useStore((s) => s.network);
  const result = useStore((s) => s.result); const tab = useStore((s) => s.tab); const setTab = useStore((s) => s.setTab);
  const name = useStore((s) => s.scenarioName); const setName = useStore((s) => s.setName);
  const save = useStore((s) => s.saveScenario); const selectedFlight = useStore((s) => s.selectedFlight);
  const nActions = useStore((s) => s.scenario.actions.length);

  useEffect(() => { document.title = result ? `Domino Sky — ${NETWORK_STATUS_STYLE[result.metrics.status].label}` : 'Domino Sky'; }, [result]);

  if (!net || !result) return <DataError errors={load.report.errors} />;
  const st = NETWORK_STATUS_STYLE[result.metrics.status];

  return (
    <div className="flex min-h-full flex-col">
      <ReplayDriver />
      <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur">
        <div className="mx-auto flex max-w-[1800px] flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5">
          <div className="flex items-center gap-2.5">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-rec/15 ring-1 ring-rec/40"><Plane className="h-4 w-4 text-rec" /></div>
            <div className="leading-tight">
              <div className="text-[15px] font-semibold tracking-tight">Domino Sky</div>
              <div className="label !text-[9.5px]">Airline disruption intelligence</div>
            </div>
          </div>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <label className="sr-only" htmlFor="scn-name">Scenario name</label>
            <input id="scn-name" value={name} onChange={(e) => setName(e.target.value)} className="h-8 w-full max-w-xs rounded-md border border-transparent bg-transparent px-2 text-sm font-medium hover:border-line focus:border-rec focus:bg-bg" />
            {nActions > 0 && <span className="rounded-md bg-rec/15 px-2 py-0.5 text-[11px] font-semibold text-rec">{nActions} recovery action{nActions > 1 ? 's' : ''}</span>}
            <Button size="sm" onClick={() => save(name)} aria-label="Save scenario"><Save className="h-3.5 w-3.5" /> Save</Button>
          </div>
          <div role="status" aria-label={`Network status: ${st.label}`} className="flex items-center gap-2.5 rounded-lg border px-3 py-1.5" style={{ borderColor: `${st.color}66`, background: `${st.color}14` }}>
            <span className="relative flex h-2.5 w-2.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: st.color }} /><span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ background: st.color }} /></span>
            <span className="text-xs font-bold tracking-wider" style={{ color: st.color }}>{st.label}</span>
          </div>
        </div>
        <nav aria-label="Sections" className="mx-auto flex max-w-[1800px] gap-1 overflow-x-auto px-3 pb-1.5">
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
              className={clsx('flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition', tab === t.id ? 'bg-elevated text-ink ring-1 ring-line' : 'text-mute hover:text-ink')}>
              <t.icon className="h-3.5 w-3.5" />{t.label}
            </button>
          ))}
        </nav>
      </header>
      <main className="mx-auto grid w-full max-w-[1800px] flex-1 gap-4 p-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="space-y-4 lg:sticky lg:top-[96px] lg:max-h-[calc(100vh-110px)] lg:self-start lg:overflow-y-auto lg:pr-1"><ControlPanel /></aside>
        <div className="min-w-0 anim-fade" key={tab} role="tabpanel">
          {tab === 'overview' && <Overview />}
          {tab === 'flights' && <FlightTable />}
          {tab === 'timeline' && <TimelineView />}
          {tab === 'dispatcher' && <DispatcherPanel />}
          {tab === 'recovery' && <Suspense fallback={<ViewLoading />}><RecoveryCompare /></Suspense>}
          {tab === 'analytics' && <Suspense fallback={<ViewLoading />}><Analytics /></Suspense>}
          {tab === 'crew' && <CrewConnections />}
          {tab === 'scenarios' && <Suspense fallback={<ViewLoading />}><Scenarios /></Suspense>}
        </div>
      </main>
      {selectedFlight && <FlightDrawer />}
      <ConfirmDialog />
      <Toasts />
    </div>
  );
}
