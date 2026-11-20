import { useMemo, useState } from 'react';
import { Download, FolderOpen, Pencil, Save, Trash2, Check } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useStore } from '@/store/useStore';
import { useSim } from '@/utils/hooks';
import { Button, Empty, Panel, inputCls } from '@/components/ui/primitives';
import { simulate } from '@/engine/simulation';
import { compareMetrics } from '@/engine/compare';
import { download, resultToCsv, resultToJson } from '@/utils/exporter';
import { COLORS } from '@/utils/colors';
import { AXIS, TOOLTIP } from '@/components/charts/chartStyle';
import { fmtTime } from '@/engine/timeUtils';
import { nf } from '@/utils/format';
import type { Scenario, SimulationResult } from '@/types';

const describe = (s: Scenario) => (s.closures.length ? s.closures.map((c) => `${c.airport} ${fmtTime(c.start)}–${fmtTime(c.end)}`).join(', ') : 'No disruption') + (s.actions.length ? ` · ${s.actions.length} action${s.actions.length > 1 ? 's' : ''}` : '');

export function Scenarios() {
  const { net, result } = useSim();
  const saved = useStore((s) => s.saved); const name = useStore((s) => s.scenarioName); const setName = useStore((s) => s.setName);
  const save = useStore((s) => s.saveScenario); const open = useStore((s) => s.openScenario); const del = useStore((s) => s.deleteScenario); const rename = useStore((s) => s.renameScenario);
  const compare = useStore((s) => s.compare); const setCompare = useStore((s) => s.setCompare); const toast = useStore((s) => s.toast);
  const [editing, setEditing] = useState<string | null>(null); const [draftName, setDraftName] = useState('');

  const options = useMemo(() => [{ id: '__current', name: `Current: ${name}`, scenario: result.scenario }, { id: '__baseline', name: 'Baseline (no disruption)', scenario: { closures: [], actions: [] } as Scenario }, ...saved.map((s) => ({ id: s.id, name: s.name, scenario: s.scenario }))], [saved, name, result]);
  const get = (id: string | null): { name: string; res: SimulationResult } | null => {
    const o = options.find((x) => x.id === id); if (!o) return null;
    try { return { name: o.name, res: o.id === '__current' ? result : simulate(net, o.scenario) }; } catch { return null; }
  };
  const A = get(compare[0]); const B = get(compare[1]);
  const rows = A && B ? compareMetrics(A.res.metrics, B.res.metrics) : [];

  const exportJson = () => { download(`${name.replace(/\W+/g, '_') || 'scenario'}.json`, resultToJson(name, result), 'application/json'); toast('success', 'Exported scenario results (JSON).'); };
  const exportCsv = () => { download(`${name.replace(/\W+/g, '_') || 'scenario'}_flights.csv`, resultToCsv(net, result), 'text/csv'); toast('success', 'Exported flight table (CSV).'); };

  return (
    <div className="space-y-4">
      <Panel title="Current scenario" subtitle={describe(result.scenario)}>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[240px] flex-1"><label htmlFor="sc-name" className="label mb-1.5 block">Scenario name</label><input id="sc-name" className={inputCls} value={name} onChange={(e) => setName(e.target.value)} /></div>
          <Button variant="primary" onClick={() => save(name)}><Save className="h-4 w-4" />Save scenario</Button>
          <Button onClick={exportJson}><Download className="h-4 w-4" />Export JSON</Button>
          <Button onClick={exportCsv}><Download className="h-4 w-4" />Export flights CSV</Button>
        </div>
        <p className="mt-2 text-[11px] text-mute">Scenarios are stored in this browser (localStorage). Every scenario is recomputed by the same deterministic engine when opened or compared.</p>
      </Panel>

      <Panel title={`Saved scenarios (${saved.length})`}>
        {saved.length === 0 ? <Empty icon={<FolderOpen className="h-6 w-6" />} title="No saved scenarios yet" hint="Save the current scenario to reopen or compare it later." /> : (
          <ul className="divide-y divide-line/60">{saved.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 py-2.5">
              <div className="min-w-[200px] flex-1">
                {editing === s.id ? <form onSubmit={(e) => { e.preventDefault(); rename(s.id, draftName); setEditing(null); }} className="flex gap-2"><input autoFocus aria-label="New scenario name" className={inputCls} value={draftName} onChange={(e) => setDraftName(e.target.value)} /><Button type="submit" size="sm" aria-label="Confirm rename"><Check className="h-3.5 w-3.5" /></Button></form>
                  : <><div className="text-sm font-medium">{s.name}</div><div className="text-xs text-mute">{describe(s.scenario)} · {new Date(s.createdAt).toLocaleString()}</div></>}
              </div>
              <Button size="sm" onClick={() => open(s.id)}><FolderOpen className="h-3.5 w-3.5" />Open</Button>
              <Button size="sm" variant="ghost" aria-label={`Rename ${s.name}`} onClick={() => { setEditing(s.id); setDraftName(s.name); }}><Pencil className="h-3.5 w-3.5" /></Button>
              <Button size="sm" variant="ghost" aria-label={`Delete ${s.name}`} onClick={() => del(s.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
            </li>))}</ul>
        )}
      </Panel>

      <Panel title="Compare two scenarios" subtitle="Any two of: current, baseline, or a saved scenario.">
        <div className="grid gap-3 sm:grid-cols-2">
          {([0, 1] as const).map((slot) => (
            <div key={slot}><label htmlFor={`cmp-${slot}`} className="label mb-1.5 block">Scenario {slot === 0 ? 'A' : 'B'}</label>
              <select id={`cmp-${slot}`} className={inputCls} value={compare[slot] ?? ''} onChange={(e) => setCompare(slot, e.target.value || null)}><option value="">Select…</option>{options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>))}
        </div>
        {!A || !B ? <Empty title="Choose two scenarios to compare" /> : (
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <table className="w-full text-sm"><thead><tr className="label text-left"><th className="py-1.5">Metric</th><th className="px-2 text-right">A</th><th className="px-2 text-right">B</th><th className="text-right">B vs A</th></tr></thead>
              <tbody>{rows.map((r) => { const diff = r.after - r.before; return (<tr key={r.key} className="border-t border-line/60"><th scope="row" className="py-2 text-left font-medium">{r.label}</th><td className="num px-2 text-right">{nf(r.before)}</td><td className="num px-2 text-right font-semibold">{nf(r.after)}</td><td className="num text-right font-semibold" style={{ color: diff < 0 ? COLORS.ok : diff > 0 ? COLORS.bad : COLORS.mute }}>{diff === 0 ? '—' : `${diff > 0 ? '+' : '−'}${nf(Math.abs(diff))}`}</td></tr>); })}</tbody></table>
            <div className="h-64"><ResponsiveContainer width="100%" height="100%"><BarChart data={rows.filter((r) => r.key !== 'delayMinutes').map((r) => ({ name: r.label.replace('Passengers', 'Pax'), A: r.before, B: r.after }))} margin={{ left: -10 }}><CartesianGrid stroke={AXIS.grid} vertical={false} /><XAxis dataKey="name" stroke={AXIS.stroke} fontSize={10} interval={0} angle={-20} textAnchor="end" height={50} /><YAxis stroke={AXIS.stroke} fontSize={11} /><Tooltip {...TOOLTIP} /><Legend wrapperStyle={{ fontSize: 12 }} /><Bar dataKey="A" name={A.name.slice(0, 26)} fill={COLORS.warn} radius={[3, 3, 0, 0]} /><Bar dataKey="B" name={B.name.slice(0, 26)} fill={COLORS.rec} radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer></div>
            <p className="text-[11px] text-mute lg:col-span-2">Total delay: A <span className="num text-ink">{nf(A.res.metrics.totalDelayMinutes)}</span> min · B <span className="num text-ink">{nf(B.res.metrics.totalDelayMinutes)}</span> min.</p>
          </div>
        )}
      </Panel>
    </div>
  );
}
