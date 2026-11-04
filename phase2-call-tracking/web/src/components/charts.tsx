import { useId, useMemo, useState } from 'react';
import greece from '../geo/greece.json';
import { int } from '../lib/format';
import type { Geo } from '../lib/api';

// A line of daily counts. The last point is marked; `accent` draws it in the brand red (a worsening series).
export function Sparkline({ values, accent = false, height = 40, label }: { values: number[]; accent?: boolean; height?: number; label: string }) {
  const id = useId();
  if (!values.length) return null;
  const max = Math.max(1, ...values);
  const w = 200;
  const pts = values.map((v, i) => [values.length === 1 ? w : (i / (values.length - 1)) * w, height - 3 - (v / max) * (height - 6)]);
  const last = pts[pts.length - 1];
  // The line stretches to the tile; the end dot is HTML so it stays round.
  return (
    <div className="relative" style={{ height }}>
      <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="block h-full w-full" role="img" aria-label={label}>
        <title id={id}>{label}</title>
        <polyline fill="none" stroke={accent ? 'var(--brand)' : 'currentColor'} strokeWidth="1.5"
          vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" points={pts.map((p) => p.join(',')).join(' ')} />
      </svg>
      <span className="absolute h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full" aria-hidden="true"
        style={{ left: `${(last[0] / w) * 100}%`, top: `${(last[1] / height) * 100}%`, background: accent ? 'var(--brand)' : 'currentColor' }} />
    </div>
  );
}

// Vertical bars with labels under them; the largest bar is the lead, in red. Values sit above the bars.
export function Bars({ rows, height = 128 }: { rows: { label: string; value: number }[]; height?: number }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const lead = rows.reduce((b, r, i) => (r.value > rows[b].value ? i : b), 0);
  return (
    <div>
      <div className="flex items-end gap-2.5" style={{ height }}>
        {rows.map((r, i) => (
          <div key={r.label} className="flex h-full min-w-0 flex-1 flex-col justify-end" title={`${r.label}: ${int(r.value)}`}>
            <span className="mb-1 text-center text-[11px] text-ink-2 num">{int(r.value)}</span>
            <div className="bar-grow rounded-t-[10px] rounded-b-[4px]"
              style={{
                height: `${Math.max(3, (r.value / max) * (height - 22))}px`,
                animationDelay: `${i * 70}ms`,
                background: i === lead && r.value > 0
                  ? 'linear-gradient(to top, color-mix(in srgb, var(--brand) 20%, transparent), var(--brand))'
                  : 'linear-gradient(to top, var(--bar-quiet), var(--bar))'
              }} />
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-2.5">
        {rows.map((r) => <span key={r.label} className="min-w-0 flex-1 truncate text-center text-[11px] text-ink-2">{r.label}</span>)}
      </div>
    </div>
  );
}

// Greece with a bubble per region sized by calls. Area codes place landlines only; mobiles are listed apart.
export function GreeceMap({ geo, compact = false }: { geo: Geo; compact?: boolean }) {
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(1, ...geo.regions.map((r) => r.calls));
  const top = useMemo(() => new Set(geo.regions.slice(0, compact ? 2 : 3).map((r) => r.region)), [geo, compact]);
  const pts = greece.regions as unknown as Record<string, [number, number]>;
  const W = greece.width;
  const H = greece.height;
  // The box keeps the map's proportions, so the HTML callouts (legible at any size) land on their bubbles.
  return (
    <div className="relative mx-auto h-full max-w-full" style={{ aspectRatio: `${W} / ${H}` }}>
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-full w-full" role="img"
        aria-label={geo.regions.length ? `Calls by region: ${geo.regions.map((r) => `${r.name} ${r.calls}`).join(', ')}` : 'No calls from landlines with a known area code yet'}>
        {greece.neighbours.map((d, i) => <path key={i} d={d} fill="var(--map-land)" stroke="var(--map-edge)" strokeWidth="0.6" />)}
        <path d={greece.greece} fill="var(--map-home)" stroke="var(--map-edge)" strokeWidth="0.8" />
        {geo.regions.map((r) => {
          const p = pts[r.region];
          if (!p) return null;
          const on = hover === r.region;
          return (
            <g key={r.region} onMouseEnter={() => setHover(r.region)} onMouseLeave={() => setHover(null)}>
              <circle cx={p[0]} cy={p[1]} r={8 + Math.sqrt(r.calls / max) * (compact ? 32 : 40)} fill="var(--ink)" opacity={on ? 0.3 : 0.16} />
              <circle cx={p[0]} cy={p[1]} r="4" fill="var(--ink)" />
            </g>
          );
        })}
      </svg>
      {geo.regions.filter((r) => pts[r.region] && (top.has(r.region) || hover === r.region)).map((r) => {
        const p = pts[r.region];
        return (
          <div key={r.region} className="callout pointer-events-none absolute -translate-x-1/2 -translate-y-full px-2.5 py-1.5"
            style={{ left: `${(p[0] / W) * 100}%`, top: `calc(${(p[1] / H) * 100}% - 10px)` }}>
            <p className="whitespace-nowrap text-[12px] font-medium leading-4 text-ink num">{int(r.calls)} calls</p>
            <p className="whitespace-nowrap text-[11px] leading-4 text-ink-3">{r.name}</p>
          </div>
        );
      })}
    </div>
  );
}
