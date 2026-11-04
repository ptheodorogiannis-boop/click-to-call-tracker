import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { int, monthLabel, pct } from '../lib/format';
import type { Report } from '../lib/api';

// Calls by month as bars, the answer rate as a line on its own scale (the Quantix invoice-and-discount chart).
export function MonthlyChart({ months }: { months: Report['monthly'] }) {
  // The current month is still running: drawn quiet and called "so far", so a few days never read as a collapse.
  const current = new Date().toISOString().slice(0, 7);
  const data = months.map((m) => ({ ...m, label: monthLabel(m.month), partial: m.month === current, rate: m.answer_rate == null ? null : Math.round(m.answer_rate * 100) }));
  return (
    <div className="h-[220px] w-full" role="img" aria-label={`Calls per month over the last ${months.length} months, with the answer rate`}>
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 16, right: 4, left: -18, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--line)" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: 'var(--ink-3)', fontSize: 11 }} />
          <YAxis yAxisId="calls" tickLine={false} axisLine={false} tick={{ fill: 'var(--ink-3)', fontSize: 11 }} allowDecimals={false} />
          <YAxis yAxisId="rate" orientation="right" hide domain={[0, 100]} />
          <Tooltip cursor={{ fill: 'var(--paper)' }} content={<MonthTip />} />
          <Bar yAxisId="calls" dataKey="calls" radius={[8, 8, 3, 3]} maxBarSize={44} isAnimationActive
            shape={(props: unknown) => {
              const p = props as { x?: number; y?: number; width?: number; height?: number; payload?: { partial: boolean } };
              const partial = p.payload?.partial;
              return <rect x={p.x} y={p.y} width={p.width} height={Math.max(0, p.height || 0)} rx={6}
                fill={partial ? 'var(--bar-quiet)' : 'var(--bar)'} stroke={partial ? 'var(--bar)' : 'none'} strokeDasharray={partial ? '3 3' : undefined} />;
            }} />
          <Line yAxisId="rate" dataKey="rate" type="linear" stroke="var(--ink)" strokeWidth={1.5} dot={false} connectNulls />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function MonthTip({ active, payload }: { active?: boolean; payload?: { payload: Report['monthly'][number] & { label: string; partial: boolean } }[] }) {
  if (!active || !payload?.length) return null;
  const m = payload[0].payload;
  return (
    <div className="overlay rounded-pop px-3 py-2 text-[12px] text-ink">
      <p className="font-medium">{m.label}{m.partial ? ', so far' : ''}</p>
      <p className="num">{int(m.calls)} calls, {int(m.leads)} leads</p>
      <p className="text-ink-2 num">{m.answer_rate == null ? 'No calls' : `${pct(m.answer_rate)} answered`}</p>
    </div>
  );
}

