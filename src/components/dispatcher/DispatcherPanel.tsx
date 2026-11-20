import { useMemo, useRef, useState } from 'react';
import { Bot, Cpu, Sparkles, CheckCircle2, X, Layers, Info } from 'lucide-react';
import { useStore, newActionId } from '@/store/useStore';
import { useSim } from '@/utils/hooks';
import { Badge, Button, Empty, Panel } from '@/components/ui/primitives';
import { COLORS } from '@/utils/colors';
import { recommend, buildAiPayload, OPTION_LABELS, type OptionNo, type Recommendation } from '@/engine/dispatcher';
import { describeAction } from '@/engine/recovery';
import { requestAiNarrative, type AiOutcome } from '@/utils/aiClient';
import { nf } from '@/utils/format';
import { ManualActions } from './ManualActions';
import type { RecoveryAction } from '@/types';

const fresh = (a: RecoveryAction): RecoveryAction => ({ ...a, id: newActionId() });
const signed = (n: number, good: 'pos' | 'neg' = 'pos') => <span className="num font-semibold" style={{ color: n === 0 ? COLORS.mute : (good === 'pos' ? n > 0 : n < 0) ? COLORS.ok : COLORS.bad }}>{n > 0 ? '+' : n < 0 ? '−' : ''}{nf(Math.abs(n))}</span>;

function Chip({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="rounded-md border border-line/70 bg-bg/50 px-2 py-1 text-[11px]"><span className="text-mute">{label} </span>{children}</div>;
}

function RecCard({ r, rank, onApply }: { r: Recommendation; rank: number; onApply: (r: Recommendation) => void }) {
  const d = r.delta;
  return (
    <article className="rounded-xl border border-line bg-bg/40 p-3.5" aria-label={r.title}>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div><div className="flex items-center gap-2"><Badge color={COLORS.rec}>#{rank}</Badge><span className="label">Option {r.option} · {r.optionLabel}</span></div>
          <h4 className="mt-1.5 text-sm font-semibold leading-snug">{r.title}</h4></div>
        <Button size="sm" variant="recovery" onClick={() => onApply(r)}>Apply</Button>
      </header>
      <ul className="mt-2 space-y-1 text-xs leading-snug text-ink/90">{r.rationale.map((t, i) => <li key={i} className="flex gap-1.5"><span className="text-rec">›</span>{t}</li>)}</ul>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        <Chip label="Delay min saved">{signed(d.delayMinutes)}</Chip><Chip label="Fewer delayed flights">{signed(d.delayedFlights)}</Chip>
        <Chip label="Pax relieved">{signed(d.paxImpacted)}</Chip><Chip label="Missed-conn pax saved">{signed(d.missedConnectionPax)}</Chip>
        <Chip label="Stranded pax saved">{signed(d.stranded)}</Chip><Chip label="Crew viol. avoided">{signed(d.crewViolations)}</Chip>
      </div>
      {r.tradeoffs.length > 0 && <ul className="mt-2 space-y-0.5 border-t border-line/60 pt-2 text-[11.5px] text-warn/90">{r.tradeoffs.map((t, i) => <li key={i}>⚠ {t}</li>)}</ul>}
    </article>
  );
}

export function DispatcherPanel() {
  const { net, result } = useSim();
  const scenario = useStore((s) => s.scenario); const addActions = useStore((s) => s.addActions); const removeAction = useStore((s) => s.removeAction);
  const clearActions = useStore((s) => s.clearActions); const ask = useStore((s) => s.askConfirm); const setTab = useStore((s) => s.setTab);
  const report = useMemo(() => recommend(net, scenario), [net, scenario]);
  const [ai, setAi] = useState<AiOutcome | { ok: 'idle' } | { ok: 'loading' }>({ ok: 'idle' });
  const abort = useRef<AbortController | null>(null);

  const apply = (r: Recommendation) => {
    const go = () => { addActions(r.actions.map(fresh)); };
    if (r.actions.some((a) => a.type === 'cancel_flight' || a.type === 'deploy_spare' || a.type === 'swap_aircraft')) {
      ask({ title: 'Apply this recovery action?', message: `${r.title}. ${r.tradeoffs.length ? r.tradeoffs.join(' ') + ' ' : ''}The network will be re-simulated.`, confirmLabel: 'Apply & re-simulate', onConfirm: go });
    } else go();
  };
  const applyPlan = () => ask({
    title: `Apply ${report.plan.length}-step recovery plan?`, message: report.plan.map((p, i) => `${i + 1}. ${p.title}`).join('\n') + '\n\nActions are applied in order and the network is re-simulated.', confirmLabel: 'Apply plan',
    onConfirm: () => { addActions(report.plan.flatMap((p) => p.actions.map(fresh))); setTab('recovery'); },
  });
  const askAi = async () => {
    abort.current?.abort(); abort.current = new AbortController();
    setAi({ ok: 'loading' });
    setAi(await requestAiNarrative(buildAiPayload(net, scenario, report), abort.current.signal));
  };

  const m = report.current;
  const byOption = new Map<OptionNo, Recommendation[]>();
  for (const r of report.recommendations) byOption.set(r.option, [...(byOption.get(r.option) ?? []), r]);
  const aiOk = ai.ok === true;
  const disrupted = m.delayed + m.cancelled > 0 || m.crewViolations > 0;

  return (
    <div className="space-y-4">
      <Panel
        title={<span className="flex items-center gap-2"><Bot className="h-4 w-4" />Dispatcher</span>}
        subtitle="Every candidate is scored by re-running the deterministic simulator. The dispatcher never estimates a number."
        actions={<div className="flex items-center gap-2">
          {aiOk ? <Badge color={COLORS.ok}><Sparkles className="h-3 w-3" />AI narrative · {(ai as { model: string }).model}</Badge> : <Badge color={COLORS.rec}><Cpu className="h-3 w-3" />Rule-based Dispatcher</Badge>}
          <Button size="sm" onClick={askAi} disabled={ai.ok === 'loading' || !disrupted}>{ai.ok === 'loading' ? 'Asking…' : 'Ask AI to explain'}</Button>
        </div>}>
        {ai.ok === false && <p role="status" className="mb-3 flex items-start gap-1.5 rounded-lg border border-line bg-bg/50 p-2.5 text-xs text-mute"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />AI narration unavailable — {ai.reason} Showing the deterministic <b className="text-ink">Rule-based Dispatcher</b>; all numbers and actions below are unaffected.</p>}
        {aiOk && (() => { const n = (ai as { narrative: { headline: string; summary: string; priorities: { candidateId: string; why: string }[]; tradeoffs: string[] } }).narrative; return (
          <div className="mb-3 rounded-lg border border-ok/30 bg-ok/5 p-3 text-sm">
            <p className="font-semibold">{n.headline}</p><p className="mt-1 text-ink/90">{n.summary}</p>
            {n.priorities.length > 0 && <ul className="mt-2 space-y-1 text-xs">{n.priorities.map((p) => { const rec = report.recommendations.find((r) => r.id === p.candidateId); return <li key={p.candidateId}><b>{rec?.title ?? p.candidateId}:</b> {p.why}</li>; })}</ul>}
            {n.tradeoffs.length > 0 && <ul className="mt-2 list-disc pl-4 text-xs text-warn/90">{n.tradeoffs.map((t, i) => <li key={i}>{t}</li>)}</ul>}
            <p className="mt-2 text-[11px] text-mute">Numbers in this narrative were verified against the engine payload before display.</p>
          </div>); })()}
        {!disrupted ? (
          <Empty icon={<CheckCircle2 className="h-7 w-7 text-ok" />} title="Nothing to recover" hint="The network is operating to schedule. Simulate an airport closure to get recovery recommendations." />
        ) : (
          <div className="space-y-3">
            <p className="text-sm leading-relaxed">
              <b>{m.status}</b>: <span className="num">{m.delayed}</span> flights delayed (<span className="num">{nf(m.totalDelayMinutes)}</span> min in total, <span className="num">{m.severe}</span> severe), <span className="num">{m.cancelled}</span> cancelled, <span className="num">{nf(m.pax.impacted)}</span> passengers impacted, <span className="num">{nf(m.missedConnectionPax)}</span> missing connections, <span className="num">{m.crewViolations}</span> crew duty violations.
            </p>
            <div><div className="label mb-1.5">Main bottlenecks</div>
              <ul className="space-y-1 text-[13px] text-ink/90">{report.bottlenecks.slice(0, 7).map((b, i) => <li key={i} className="flex gap-2"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: b.kind === 'crew' || b.kind === 'connection' ? COLORS.bad : COLORS.warn }} />{b.text}</li>)}</ul></div>
          </div>
        )}
      </Panel>

      {scenario.actions.length > 0 && (
        <Panel title="Applied recovery actions" actions={<Button size="sm" variant="ghost" onClick={clearActions}>Clear all</Button>}>
          <ol className="space-y-1.5">{scenario.actions.map((a, i) => (
            <li key={a.id} className="flex items-center justify-between gap-3 rounded-lg border border-rec/30 bg-rec/5 px-3 py-2 text-sm"><span><span className="num mr-2 text-rec">{i + 1}.</span>{describeAction(net, a)}</span>
              <button type="button" aria-label={`Remove action ${i + 1}`} className="text-mute hover:text-bad" onClick={() => removeAction(a.id)}><X className="h-4 w-4" /></button></li>))}</ol>
          {result.rejectedActions.length > 0 && <p className="mt-2 text-xs text-bad">{result.rejectedActions.map((r) => r.reason).join(' ')}</p>}
        </Panel>
      )}

      {disrupted && report.plan.length > 0 && report.planAfter && (
        <Panel title={<span className="flex items-center gap-2"><Layers className="h-4 w-4" />Recommended plan</span>} subtitle="Greedy sequence of compatible actions; each step was chosen after re-simulating the previous ones."
          actions={<Button variant="primary" size="sm" onClick={applyPlan}>Apply whole plan</Button>}>
          <ol className="space-y-1.5 text-sm">{report.plan.map((p, i) => <li key={p.id} className="flex flex-wrap items-center gap-2"><Badge color={COLORS.rec}>{i + 1}</Badge><span>{p.title}</span><span className="text-xs text-mute">· Option {p.option}</span><span className="num ml-auto text-xs" title="Change caused by this step, after the previous steps were applied"><span style={{ color: p.delta.delayMinutes > 0 ? COLORS.ok : p.delta.delayMinutes < 0 ? COLORS.bad : COLORS.mute }}>delay {p.delta.delayMinutes > 0 ? "−" : p.delta.delayMinutes < 0 ? "+" : "±"}{nf(Math.abs(p.delta.delayMinutes))} min</span><span className="text-mute"> · </span><span style={{ color: p.delta.paxImpacted >= 0 ? COLORS.ok : COLORS.bad }}>{p.delta.paxImpacted >= 0 ? "−" : "+"}{nf(Math.abs(p.delta.paxImpacted))} pax impacted</span></span></li>)}</ol>
          <div className="mt-3 grid grid-cols-2 gap-2 border-t border-line/60 pt-3 sm:grid-cols-4">
            <Chip label="Delay min"><span className="num">{nf(m.totalDelayMinutes)} → {nf(report.planAfter.totalDelayMinutes)}</span></Chip>
            <Chip label="Pax impacted"><span className="num">{nf(m.pax.impacted)} → {nf(report.planAfter.pax.impacted)}</span></Chip>
            <Chip label="Missed-conn pax"><span className="num">{nf(m.missedConnectionPax)} → {nf(report.planAfter.missedConnectionPax)}</span></Chip>
            <Chip label="Crew viol."><span className="num">{m.crewViolations} → {report.planAfter.crewViolations}</span></Chip>
          </div>
        </Panel>
      )}

      {disrupted && ([1, 2, 3, 4, 5, 6] as OptionNo[]).map((o) => {
        const list = byOption.get(o) ?? [];
        return (
          <Panel key={o} title={`Option ${o} — ${OPTION_LABELS[o]}`} subtitle={list.length ? `${list.length} beneficial candidate${list.length > 1 ? 's' : ''}, best first` : undefined}>
            {list.length === 0 ? <p className="text-xs text-mute">{o === 4 ? 'No beneficial candidate: airport capacity is not the binding constraint in this scenario (slot priority only matters when capacity binds).' : 'No beneficial candidate found that is feasible in this scenario.'}</p>
              : <div className="grid gap-3 lg:grid-cols-2">{list.slice(0, 4).map((r, i) => <RecCard key={r.id} r={r} rank={i + 1} onApply={apply} />)}</div>}
          </Panel>
        );
      })}
      {disrupted && <p className="text-center text-[11px] text-mute">{report.evaluated} candidate scenarios were simulated to build this list.</p>}
      <ManualActions />
    </div>
  );
}
