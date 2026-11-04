import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { qs, type BoardRow, type Range } from '../lib/api';
import { useLoad } from '../lib/hooks';
import { int, pct } from '../lib/format';
import { PeriodSeg, useDays } from '../components/filters';
import { Empty, ErrorState, Loading, PageHead, Tile } from '../components/ui';
import { Sparkline } from '../components/charts';
import ClientEditor from './ClientEditor';

const FLAG: Record<string, string> = {
  answer_rate: 'Low answer rate', call_back: 'Calls to call back', calls_down: 'Calls down',
  pool_full: 'Pool ran out', uploads_failing: 'Uploads failing', silent: 'No calls for a week'
};

// Every client as a row with its trend, the ones that need the agency first (the Ruler Reports overview pattern).
export default function Clients() {
  const [days] = useDays();
  const [sp, setSp] = useSearchParams();
  const navigate = useNavigate();
  const { data, error, loading, reload } = useLoad<{ range: Range; clients: BoardRow[] }>(`/board${qs({ days })}`);
  const editing = sp.get('edit') || (sp.get('new') ? '' : null);
  const openEditor = (id: string | null) => {
    const next = new URLSearchParams(sp);
    next.delete('edit'); next.delete('new');
    if (id === '') next.set('new', '1'); else if (id) next.set('edit', id);
    setSp(next);
  };

  return (
    <>
      <PageHead title="Clients">
        <PeriodSeg />
        <button className="btn" onClick={() => openEditor('')}><Plus /> New client</button>
      </PageHead>
      <Tile className="p-5" delay={40}>
        {error && !data ? <ErrorState error={error} retry={reload} /> : !data ? <Loading rows={6} label="Loading clients" /> : !data.clients.length ? (
          <Empty title="No clients yet" action={<button className="btn" onClick={() => openEditor('')}><Plus /> Add the first client</button>}>
            A client is one business whose calls you track: their real phone line, a pool of tracking numbers and where to send conversions.
          </Empty>
        ) : (
          <div className={`overflow-x-auto ${loading ? 'opacity-70 transition-opacity' : ''}`}>
            <table className="table min-w-[820px]">
              <thead>
                <tr><th>Client</th><th className="r">Calls</th><th className="r">Answered</th><th className="r">Leads</th><th className="r">To call back</th><th className="r">Numbers</th><th className="w-[140px]">Calls per day</th><th>Needs</th></tr>
              </thead>
              <tbody>
                {data.clients.map((r) => (
                  <tr key={r.id} data-href onClick={() => openEditor(r.id)}>
                    <td>
                      <button className="text-left font-medium" onClick={(e) => { e.stopPropagation(); openEditor(r.id); }}>{r.name}</button>
                      {!r.active && <span className="chip ml-2">Off</span>}
                    </td>
                    <td className="r num">{int(r.calls)}</td>
                    <td className="r num">{pct(r.answer_rate)}</td>
                    <td className="r num">{int(r.leads)}</td>
                    <td className="r num">
                      {r.to_call_back
                        ? <button className="underline underline-offset-2" onClick={(e) => { e.stopPropagation(); navigate(`/calls?status=to_call_back&client_id=${encodeURIComponent(r.id)}`); }}>{r.to_call_back}</button>
                        : <span className="text-ink-3">None</span>}
                    </td>
                    <td className={`r num ${r.numbers ? '' : 'text-down'}`}>{r.numbers || 'None'}</td>
                    <td><Sparkline values={r.trend} height={22} accent={r.flags.includes('calls_down')} label={`${r.name}, calls per day`} /></td>
                    <td className="whitespace-nowrap">
                      {r.flags.length ? r.flags.map((f) => <span key={f} className={`chip mr-1 ${f === 'calls_down' || f === 'answer_rate' ? '' : 'chip-warn'}`}>{FLAG[f]}</span>) : <span className="text-ink-3">Nothing</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Tile>
      <ClientEditor id={editing} onClose={() => openEditor(null)} onSaved={reload} />
    </>
  );
}
