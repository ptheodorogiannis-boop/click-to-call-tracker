import { useEffect, useRef, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, RotateCw, X } from 'lucide-react';
import { pct } from '../lib/format';

type Tone = 'glass' | 'smoke' | 'solid' | 'inset';
const TONE: Record<Tone, string> = { glass: '', smoke: 'tone-smoke', solid: 'tone-solid', inset: 'tone-inset' };

export function Tile({ tone = 'glass', className = '', children, delay = 0, as: As = 'section', ...rest }:
  { tone?: Tone; className?: string; children: ReactNode; delay?: number; as?: 'section' | 'div' } & React.HTMLAttributes<HTMLElement>) {
  return (
    <As className={`tile rise ${TONE[tone]} ${className}`} style={{ animationDelay: `${delay}ms` }} {...rest}>
      {children}
    </As>
  );
}

// A tile's title row, with an optional round "go" link to the page behind it.
export function TileHead({ title, sub, to, children }: { title: ReactNode; sub?: ReactNode; to?: string; children?: ReactNode }) {
  const head = (
    <div className="flex min-w-0 items-center gap-3">
      <div className="min-w-0">
        <h2 className="tile-title truncate">{title}</h2>
        {sub && <p className="truncate text-[12px] text-ink-3">{sub}</p>}
      </div>
    </div>
  );
  return (
    <div className="mb-3 flex items-start justify-between gap-3">
      {head}
      <div className="flex shrink-0 items-center gap-2">
        {children}
        {to && (
          <Link to={to} className="rounded-full" aria-label={`Open ${typeof title === 'string' ? title : 'details'}`}>
            <span className="go"><ArrowUpRight /></span>
          </Link>
        )}
      </div>
    </div>
  );
}

// Change against the previous period. Up is good unless `lowerIsBetter`.
export function Delta({ value, lowerIsBetter = false, points = false }: { value: number | null; lowerIsBetter?: boolean; points?: boolean }) {
  if (value == null || !Number.isFinite(value) || Math.abs(value) < 0.005) return null;
  const good = lowerIsBetter ? value < 0 : value > 0;
  const text = points ? `${value > 0 ? '+' : '−'}${Math.abs(Math.round(value * 100))} pts` : `${value > 0 ? '+' : '−'}${pct(Math.abs(value))}`;
  return (
    <span className={`ml-1 align-top text-[11px] font-medium num ${good ? 'text-up' : 'text-down'}`} aria-label={`${good ? 'better' : 'worse'} than the previous period, ${text}`}>
      {value > 0 ? '↑' : '↓'}{text.replace(/^[+−]/, '')}
    </span>
  );
}

export function Stat({ value, label, delta }: { value: ReactNode; label: string; delta?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="figure whitespace-nowrap">{value}{delta}</div>
      <div className="text-[12px] text-ink-2">{label}</div>
    </div>
  );
}

// ── the four states of a data region ──
export function Skeleton({ className = '' }: { className?: string }) { return <div className={`skel ${className}`} aria-hidden="true" />; }

export function Loading({ rows = 4, label = 'Loading' }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-label={label} className="space-y-3 py-1">
      {Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className={`h-4 ${i % 3 === 2 ? 'w-2/3' : 'w-full'}`} />)}
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 py-6">
      <p className="text-[15px] font-medium">{title}</p>
      {children && <p className="max-w-[52ch] text-[13px] text-ink-2">{children}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, retry }: { error: { message: string } | null; retry?: () => void }) {
  return (
    <div className="flex flex-col items-start gap-2 py-6" role="alert">
      <p className="text-[15px] font-medium">This did not load</p>
      <p className="max-w-[52ch] text-[13px] text-ink-2">{error?.message || 'Something went wrong on the server.'}</p>
      {retry && <button className="btn btn-glass btn-sm mt-2" onClick={retry}><RotateCw /> Try again</button>}
    </div>
  );
}

// A side panel over the page (the call drawer, the client editor). Escape and the scrim close it; focus moves in.
export function Drawer({ open, onClose, title, children, wide = false }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const on = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', on);
    return () => { window.removeEventListener('keydown', on); prev?.focus?.(); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-scrim" style={{ animation: 'fade-in var(--dur-short) var(--ease-brand) both' }} onClick={onClose} />
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title}
        className={`overlay absolute inset-y-2 right-2 flex w-[calc(100%-16px)] flex-col overflow-hidden rounded-tile outline-none ${wide ? 'max-w-[760px]' : 'max-w-[560px]'}`}
        style={{ animation: 'drawer-in var(--dur-short) var(--ease-brand) both' }}>
        <div className="flex items-center justify-between gap-3 border-b border-line px-6 py-4">
          <h2 className="tile-title truncate">{title}</h2>
          <button className="icon-btn icon-btn-sm" onClick={onClose} aria-label="Close"><X /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="min-w-0">
      <label className="label" htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

export function PageHead({ title, date, children }: { title: string; date?: string; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {date && <p className="mb-1 text-[13px] text-ink-3">{date}</p>}
        <h1 className="page-title">{title}</h1>
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}
