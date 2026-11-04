import { useSearchParams } from 'react-router-dom';
import { useSession } from '../lib/hooks';

const PERIODS = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 365, label: '12 months' }
];

// Filters live in the URL so a view can be shared and survives a reload.
export function useParam(name: string, fallback = ''): [string, (v: string | null) => void] {
  const [sp, setSp] = useSearchParams();
  const set = (v: string | null) => {
    const next = new URLSearchParams(sp);
    if (v === null || v === '' || v === fallback) next.delete(name); else next.set(name, v);
    next.delete('offset');
    setSp(next, { replace: true });
  };
  return [sp.get(name) ?? fallback, set];
}

export function useDays() {
  const [d, set] = useParam('days', '30');
  const days = PERIODS.some((p) => String(p.days) === d) ? Number(d) : 30;
  return [days, (n: number) => set(String(n))] as const;
}

export function PeriodSeg() {
  const [days, setDays] = useDays();
  return (
    <div className="seg" role="group" aria-label="Period">
      {PERIODS.map((p) => (
        <button key={p.days} aria-pressed={days === p.days} onClick={() => setDays(p.days)}>{p.label}</button>
      ))}
    </div>
  );
}

// "All clients" plus each client the person can see. Hidden when there is only one.
export function ClientSelect({ allowAll = true, className = '' }: { allowAll?: boolean; className?: string }) {
  const { me } = useSession();
  const [client, setClient] = useParam('client_id');
  if (me.clients.length <= 1) return null;
  return (
    <select className={`select h-9 !w-auto rounded-full ${className}`} value={client} onChange={(e) => setClient(e.target.value)} aria-label="Client">
      {allowAll && <option value="">All clients</option>}
      {!allowAll && !client && <option value="">Choose a client</option>}
      {me.clients.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
    </select>
  );
}
