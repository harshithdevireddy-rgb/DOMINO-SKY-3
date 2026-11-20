import { useEffect, useRef, type ComponentProps, type ReactNode } from 'react';
import clsx from 'clsx';
import { X, CheckCircle2, AlertTriangle, Info } from 'lucide-react';
import { useStore } from '@/store/useStore';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'recovery';
interface BtnProps extends ComponentProps<'button'> { variant?: Variant; size?: 'sm' | 'md' }
export function Button({ variant = 'secondary', size = 'md', className, ...p }: BtnProps) {
  const base = 'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition select-none disabled:opacity-40 disabled:cursor-not-allowed';
  const sizes = { sm: 'h-7 px-2.5 text-xs', md: 'h-9 px-3.5 text-sm' }[size];
  const v: Record<Variant, string> = {
    primary: 'bg-rec text-[#04202a] hover:brightness-110 font-semibold shadow-[0_0_24px_-6px_rgba(34,211,238,.7)]',
    secondary: 'bg-elevated text-ink border border-line hover:border-[#3a4c70] hover:bg-[#1c2940]',
    ghost: 'text-mute hover:text-ink hover:bg-elevated',
    danger: 'bg-bad/15 text-red-300 border border-bad/40 hover:bg-bad/25',
    recovery: 'bg-rec/15 text-rec border border-rec/40 hover:bg-rec/25',
  };
  return <button type="button" className={clsx(base, sizes, v[variant], className)} {...p} />;
}

export function Panel({ title, subtitle, actions, children, className, pad = true }: { title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={clsx('min-w-0 rounded-xl border border-line bg-surface/90 backdrop-blur', className)}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-3 px-4 pt-3.5 pb-2">
          <div>
            {title && <h2 className="label !text-[11px]">{title}</h2>}
            {subtitle && <p className="mt-1 text-xs text-mute">{subtitle}</p>}
          </div>
          {actions}
        </header>
      )}
      <div className={pad ? 'px-4 pb-4 pt-1' : ''}>{children}</div>
    </section>
  );
}

export function Badge({ color, children, className }: { color: string; children: ReactNode; className?: string }) {
  return <span className={clsx('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold num', className)} style={{ color, background: `${color}1f`, boxShadow: `inset 0 0 0 1px ${color}55` }}>{children}</span>;
}

export function Empty({ icon, title, hint }: { icon?: ReactNode; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center text-mute">
      {icon}
      <p className="text-sm text-ink/80">{title}</p>
      {hint && <p className="max-w-sm text-xs">{hint}</p>}
    </div>
  );
}

export function Field({ label, children, hint, htmlFor }: { label: string; children: ReactNode; hint?: ReactNode; htmlFor?: string }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="label block">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-mute">{hint}</p>}
    </div>
  );
}
export const inputCls = 'h-9 w-full rounded-lg border border-line bg-bg/70 px-3 text-sm text-ink placeholder:text-mute/60 hover:border-[#3a4c70] focus:border-rec';

export function Toasts() {
  const toasts = useStore((s) => s.toasts); const dismiss = useStore((s) => s.dismissToast);
  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-[80] flex w-[min(92vw,380px)] flex-col gap-2">
      {toasts.map((t) => {
        const c = t.kind === 'success' ? 'text-ok' : t.kind === 'error' ? 'text-bad' : 'text-rec';
        const Icon = t.kind === 'success' ? CheckCircle2 : t.kind === 'error' ? AlertTriangle : Info;
        return (
          <div key={t.id} role={t.kind === 'error' ? 'alert' : 'status'} className="anim-slide pointer-events-auto flex items-start gap-2.5 rounded-lg border border-line bg-elevated/95 p-3 text-sm shadow-xl">
            <Icon className={clsx('mt-0.5 h-4 w-4 shrink-0', c)} />
            <p className="flex-1 leading-snug">{t.text}</p>
            <button aria-label="Dismiss notification" className="text-mute hover:text-ink" onClick={() => dismiss(t.id)}><X className="h-4 w-4" /></button>
          </div>
        );
      })}
    </div>
  );
}

export function ConfirmDialog() {
  const c = useStore((s) => s.confirm); const ask = useStore((s) => s.askConfirm);
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!c) return;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') ask(null); };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [c, ask]);
  if (!c) return null;
  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-black/60 p-4" role="presentation" onClick={() => ask(null)}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="cf-title" aria-describedby="cf-msg" className="anim-fade w-full max-w-md rounded-xl border border-line bg-surface p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 id="cf-title" className="text-base font-semibold">{c.title}</h3>
        <p id="cf-msg" className="mt-2 text-sm text-mute">{c.message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={() => ask(null)}>Cancel</Button>
          <Button ref={ref} variant={c.danger ? 'danger' : 'primary'} onClick={() => { const f = c.onConfirm; ask(null); f(); }}>{c.confirmLabel}</Button>
        </div>
      </div>
    </div>
  );
}

export function Stat({ label, value, sub, color, hint }: { label: string; value: ReactNode; sub?: ReactNode; color?: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface/90 p-3.5" title={hint}>
      <div className="label">{label}</div>
      <div className="num mt-1.5 text-[26px] font-semibold leading-none tracking-tight" style={color ? { color } : undefined}>{value}</div>
      {sub && <div className="mt-1.5 text-[11px] text-mute">{sub}</div>}
    </div>
  );
}
