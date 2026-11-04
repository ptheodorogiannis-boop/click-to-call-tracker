import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Download, PhoneCall, Search } from 'lucide-react';
import { qs, type Call, type CallList } from '../lib/api';
import { useLoad, useSession } from '../lib/hooks';
import { CHANNELS, LEAD_LABEL, ago, channel, duration, int, phone, when } from '../lib/format';
import { ClientSelect, useDays, useParam } from '../components/filters';
import { Empty, ErrorState, Loading, PageHead, Tile } from '../components/ui';
import CallDrawer from './CallDrawer';

const STATUS = [
  { v: '', label: 'All' },
  { v: 'missed', label: 'Missed' },
  { v: 'to_call_back', label: 'To call back' },
  { v: 'answered', label: 'Answered' },
  { v: 'blocked', label: 'Blocked' }
];
const PAGE = 50;

const sinceFor = (days: number) => { const d = new Date(); d.setDate(d.getDate() - (days - 1)); return d.toISOString().slice(0, 10); };

export default function Calls() {
  const { me, canEdit } = useSession();
  const [sp, setSp] = useSearchParams();
  const [days, setDays] = useDays();
  const [client] = useParam('client_id');
  const [status, setStatus] = useParam('status');
  const [chan, setChan] = useParam('channel');
  const [lead, setLead] = useParam('lead_status');
  const [q, setQ] = useParam('q');
  const [text, setText] = useState(q);
  const offset = Math.max(0, parseInt(sp.get('offset') || '0', 10) || 0);
  const open = sp.get('call');

  useEffect(() => { const t = setTimeout(() => { if (text !== q) setQ(text.trim()); }, 300); return () => clearTimeout(t); }, [text]); // eslint-disable-line react-hooks/exhaustive-deps

  // "To call back" looks at the last 14 days on its own, so the period does not apply to it.
  const since = status === 'to_call_back' ? undefined : sinceFor(days);
  const path = `/calls${qs({ client_id: client, since, status, channel: chan, lead_status: lead, q, limit: PAGE, offset })}`;
  const { data, error, loading, reload } = useLoad<CallList>(path);

  const setParam = (k: string, v: string | null) => {
    const next = new URLSearchParams(sp);
    if (v) next.set(k, v); else next.delete(k);
    setSp(next, { replace: k !== 'call' });
  };
  const multi = me.clients.length > 1 && !client;

  return (
    <>
      <PageHead title="Calls">
        <a className="btn btn-glass" href={`/api/v2/reports/calls.csv${qs({ client_id: client, days })}`}><Download /> Export CSV</a>
      </PageHead>

      <Tile className="mb-3.5 p-3" delay={20}>
        <div className="flex flex-wrap items-center gap-2">
          <div className="seg" role="group" aria-label="Status">
            {STATUS.map((s) => <button key={s.v} aria-pressed={status === s.v} onClick={() => setStatus(s.v)}>{s.label}</button>)}
          </div>
          <ClientSelect />
          {status !== 'to_call_back' && (
            <select className="select h-9 !w-auto rounded-full" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period">
              <option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option><option value={365}>Last 12 months</option>
            </select>
          )}
          <select className="select h-9 !w-auto rounded-full" value={chan} onChange={(e) => setChan(e.target.value)} aria-label="Channel">
            <option value="">Every channel</option>
            {Object.entries(CHANNELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select className="select h-9 !w-auto rounded-full" value={lead} onChange={(e) => setLead(e.target.value)} aria-label="Lead status">
            <option value="">Any lead status</option>
            {Object.entries(LEAD_LABEL).map(([k, v]) => <option key={k} value={k}>{k === 'new' ? 'Not judged, any length' : v}</option>)}
          </select>
          <label className="relative ml-auto min-w-[200px] flex-1 sm:max-w-[300px]">
            <span className="sr-only">Search calls</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" strokeWidth={1.5} />
            <input className="input h-9 rounded-full pl-9" placeholder="Caller, campaign, words said" value={text} onChange={(e) => setText(e.target.value)} />
          </label>
        </div>
      </Tile>

      <Tile tone="solid" className="p-5" delay={60}>
        {error && !data ? <ErrorState error={error} retry={reload} /> : !data ? <Loading rows={8} label="Loading calls" /> : !data.calls.length ? (
          status === 'to_call_back'
            ? <Empty title="Nobody is waiting for a call back">Missed calls from the last 14 days show up here until someone calls them back or they call again and get through</Empty>
            : q || chan || lead || status
              ? <Empty title="No calls match these filters" action={<button className="btn btn-glass btn-sm" onClick={() => setSp(new URLSearchParams(days !== 30 ? { days: String(days) } : {}))}>Clear filters</button>} />
              : <Empty title="No calls in this period">Calls appear here a few seconds after someone rings a tracking number</Empty>
        ) : (
          <div className={loading ? 'opacity-70 transition-opacity' : ''} aria-busy={loading}>
            {/* phones: one stacked row per call, with a call button where someone is waiting */}
            <ul className="md:hidden">
              {data.calls.map((c) => (
                <li key={c.call_sid} className="flex items-center gap-3 border-t border-line py-3 first:border-t-0">
                  <button className="min-w-0 flex-1 text-left" onClick={() => setParam('call', c.call_sid)} aria-label={`Open the call from ${phone(c.caller)}, ${when(c.started_at)}`}>
                    <span className="block truncate text-[15px] num">{phone(c.caller)}</span>
                    <span className="block truncate text-[12px] text-ink-3">{multi ? `${c.client_name}, ` : ''}{when(c.started_at)}, {channel(c.channel)}</span>
                  </button>
                  <span className="shrink-0 text-right text-[13px] num"><Outcome c={c} queue={status === 'to_call_back'} /></span>
                  {canEdit && c.to_call_back && c.caller && (
                    <a className="btn shrink-0 !h-11 !px-4" href={`tel:${c.caller}`} aria-label={`Call ${phone(c.caller)}`}><PhoneCall /></a>
                  )}
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto md:block">
              <table className="table min-w-[860px]">
                <thead>
                  <tr>
                    <th>When</th>{multi && <th>Client</th>}<th>Caller</th><th>Source</th><th>Campaign</th><th>Outcome</th><th>Lead</th><th>Tags</th>
                  </tr>
                </thead>
                <tbody>
                  {data.calls.map((c) => (
                    <tr key={c.call_sid} data-href aria-selected={open === c.call_sid} onClick={() => setParam('call', c.call_sid)}>
                      <td className="whitespace-nowrap">
                        <button className="text-left" onClick={(e) => { e.stopPropagation(); setParam('call', c.call_sid); }} aria-label={`Open the call from ${phone(c.caller)}, ${when(c.started_at)}`}>{when(c.started_at)}</button>
                      </td>
                      {multi && <td className="max-w-[160px] truncate">{c.client_name}</td>}
                      <td className="whitespace-nowrap num">
                        {phone(c.caller)}{c.first_time && <span className="chip ml-2">New</span>}
                      </td>
                      <td className="whitespace-nowrap">{channel(c.channel)}</td>
                      <td className="max-w-[180px] truncate text-ink-2">{c.utm_campaign || 'None'}</td>
                      <td className="whitespace-nowrap num"><Outcome c={c} queue={status === 'to_call_back'} /></td>
                      <td className="whitespace-nowrap">{c.lead_status === 'new' ? (c.is_lead ? <span className="text-ink-2">Lead by length</span> : <span className="text-ink-3">Not judged</span>) : <span className={c.lead_status === 'good' || c.lead_status === 'customer' ? 'chip chip-good' : 'chip'}>{LEAD_LABEL[c.lead_status]}</span>}</td>
                      <td className="max-w-[160px] truncate text-ink-2">{c.tags.join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex items-center justify-between gap-3 text-[13px] text-ink-2">
              <span className="num">{int(offset + 1)} to {int(offset + data.calls.length)} of {int(data.total)}</span>
              <div className="flex gap-2">
                <button className="icon-btn icon-btn-sm" disabled={offset === 0} onClick={() => setParam('offset', offset - PAGE > 0 ? String(offset - PAGE) : null)} aria-label="Newer calls"><ChevronLeft /></button>
                <button className="icon-btn icon-btn-sm" disabled={offset + PAGE >= data.total} onClick={() => setParam('offset', String(offset + PAGE))} aria-label="Older calls"><ChevronRight /></button>
              </div>
            </div>
          </div>
        )}
      </Tile>

      <CallDrawer sid={open} onClose={() => setParam('call', null)} onChanged={reload} />
    </>
  );
}

// What happened on the call. In the to-call-back view every row is waiting, so it says for how long instead.
function Outcome({ c, queue }: { c: Call; queue: boolean }) {
  if (c.answered) return <>{duration(c.duration_sec)}</>;
  if (c.status === 'blocked') return <span className="text-ink-3">Blocked</span>;
  if (c.to_call_back) return queue ? <span className="text-ink-2">Waiting {ago(c.started_at).replace(' ago', '')}</span> : <span className="chip chip-warn">To call back</span>;
  return <span className="text-ink-2">{c.called_back_at ? 'Called back' : c.status === 'ringing' ? 'Ringing' : 'Missed'}</span>;
}
