import { useMemo } from 'react';
import { GitCompareArrows, ArrowRight } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useStore } from '@/store/useStore';
import { useSim } from '@/utils/hooks';
import { Badge, Button, Empty, Panel } from '@/components/ui/primitives';
import { COLORS, NETWORK_STATUS_STYLE } from '@/utils/colors';
import { compareMetrics, actionContributions } from '@/engine/compare';
import { describeAction } from '@/engine/recovery';
import { nf, pct } from '@/utils/format';
import { TOOLTIP, AXIS } from '@/components/charts/chartStyle';

export function RecoveryCompare() {
  const { net, result, base } = useSim();
  const scenario = useStore((s) => s.scenario); const setTab = useStore((s) => s.setTab);
  const rows = useMemo(() => compareMetrics(base.metrics, result.metrics), [base, result]);
  const contrib = useMemo(() => actionContributions(net, scenario), [net, scenario]);

  if (scenario.actions.length === 0) {
    return <Panel title="Before / after recovery"><Empty icon={<GitCompareArrows className="h-7 w-7" />} title="No recovery actions applied yet" hint="Apply a recommendation from the AI Dispatcher (or build one manually) and this page compares the original disruption with the recovered network." />
      <div className="flex justify-center pb-4"><Button variant="primary" onClick={() => setTab('dispatcher')}>Open dispatcher</Button></div></Panel>;
  }
  const bs = NETWORK_STATUS_STYLE[base.metrics.status]; const as = NETWORK_STATUS_STYLE[result.metrics.status];
  const tails = net.tails.map((t) => {
    const sum = (r: typeof base) => r.flights.filter((f) => f.scheduledTail === t && !f.cancelled).reduce((a, f) => a + f.arrDelay, 0);
    return { tail: t.replace('VT-', ''), before: sum(base), after: sum(result) };
  }).filter((x) => x.before + x.after > 0);
  const contribData = scenario.actions.map((a, i) => ({ name: `${i + 1}. ${describeAction(net, a)}`, marginal: contrib.find((c) => c.actionId === a.id)?.marginal ?? null, standalone: contrib.find((c) => c.actionId === a.id)?.standalone ?? null }));

  return (
    <div className="space-y-4">
      <Panel title="Before vs after recovery" subtitle="Same disruption, same engine — the right column includes the applied recovery actions.">
        <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
          <Badge color={bs.color}>{bs.label}</Badge><ArrowRight className="h-4 w-4 text-mute" /><Badge color={as.color}>{as.label}</Badge>
          <span className="text-xs text-mute">Objective cost <span className="num text-ink">{nf(base.metrics.cost)}</span> → <span className="num text-ink">{nf(result.metrics.cost)}</span> ({result.metrics.cost <= base.metrics.cost ? 'lower is better' : 'worse'})</span>
        </div>
        <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm">
          <thead><tr className="label text-left"><th className="py-2 pr-3">Metric</th><th className="px-3">Before</th><th className="px-3">After</th><th className="w-[34%] px-3">Comparison</th><th className="px-3 text-right">Change</th><th className="pl-3 text-right">%</th></tr></thead>
          <tbody>{rows.map((r) => {
            const max = Math.max(r.before, r.after, 1);
            const color = r.direction === 'better' ? COLORS.ok : r.direction === 'worse' ? COLORS.bad : COLORS.mute;
            return (<tr key={r.key} className="border-t border-line/60">
              <th scope="row" className="py-2.5 pr-3 text-left font-medium">{r.label}</th>
              <td className="num px-3">{nf(r.before)}</td><td className="num px-3 font-semibold">{nf(r.after)}</td>
              <td className="px-3"><div className="space-y-1" aria-hidden><div className="h-1.5 rounded-full bg-warn/70" style={{ width: `${(r.before / max) * 100}%` }} /><div className="h-1.5 rounded-full" style={{ width: `${(r.after / max) * 100}%`, background: color === COLORS.mute ? COLORS.rec : color }} /></div></td>
              <td className="num px-3 text-right font-semibold" style={{ color }}>{r.direction === 'same' ? '—' : `${r.improvement > 0 ? '−' : '+'}${nf(Math.abs(r.improvement))}`}{r.direction === 'worse' && ' ▲ worse'}</td>
              <td className="num pl-3 text-right" style={{ color }}>{r.direction === 'worse' ? '' : pct(r.pct)}</td>
            </tr>);
          })}</tbody></table></div>
        <p className="mt-2 text-[11px] text-mute">Percentages are shown only when the “before” value is above zero. Amber bar = before, coloured bar = after.</p>
      </Panel>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Delay minutes by aircraft" subtitle="Before vs after recovery (operated flights, scheduled aircraft)">
          <div className="h-64"><ResponsiveContainer width="100%" height="100%"><BarChart data={tails} margin={{ left: -10, right: 6 }}><CartesianGrid stroke={AXIS.grid} vertical={false} /><XAxis dataKey="tail" stroke={AXIS.stroke} fontSize={11} /><YAxis stroke={AXIS.stroke} fontSize={11} /><Tooltip {...TOOLTIP} /><Legend wrapperStyle={{ fontSize: 12 }} /><Bar dataKey="before" name="Before" fill={COLORS.warn} radius={[3, 3, 0, 0]} /><Bar dataKey="after" name="After" fill={COLORS.rec} radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer></div>
        </Panel>
        <Panel title="Recovery performance" subtitle="Cost saved by each action (re-simulated). Marginal = given all other actions.">
          <ul className="space-y-2.5">{contribData.map((c) => (
            <li key={c.name} className="rounded-lg border border-line/70 bg-bg/40 p-2.5 text-sm"><div className="font-medium leading-snug">{c.name}</div>
              <div className="mt-1 flex gap-4 text-xs text-mute"><span>marginal: <b className="num" style={{ color: (c.marginal ?? 0) >= 0 ? COLORS.ok : COLORS.bad }}>{c.marginal === null ? 'n/a (others depend on it)' : nf(c.marginal)}</b></span><span>alone: <b className="num text-ink">{c.standalone === null ? 'n/a' : nf(c.standalone)}</b></span></div></li>))}</ul>
        </Panel>
      </div>
    </div>
  );
}
