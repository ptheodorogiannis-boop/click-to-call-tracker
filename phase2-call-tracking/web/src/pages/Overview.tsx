import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { qs, type CallList, type Overview as OverviewData } from '../lib/api';
import { useLoad, useSession } from '../lib/hooks';
import { change, channel, channelShort, int, money, pct, phone, when } from '../lib/format';
import { ClientSelect, PeriodSeg, useDays, useParam } from '../components/filters';
import { Delta, Empty, ErrorState, Loading, PageHead, Skeleton, Stat, Tile, TileHead } from '../components/ui';
import { Bars, GreeceMap, Sparkline } from '../components/charts';

// The agency board (the Quantix layout): headline figures, where callers are, two trend tiles, the clients table,
// calls by channel, and the red strip that opens the call-back queue.
export default function Overview() {
  const [days] = useDays();
  const [client] = useParam('client_id');
  const { data, error, loading, reload } = useLoad<OverviewData>(`/overview${qs({ days, client_id: client })}`);
  const { me } = useSession();
  const single = me.clients.length <= 1;

  return (
    <>
      <PageHead title={data?.client ? data.client.name : 'Calls overview'}>
        <ClientSelect />
        <PeriodSeg />
      </PageHead>

      {error && !data ? <Tile><ErrorState error={error} retry={reload} /></Tile> : !data ? <OverviewSkeleton /> : (
        <div className={`grid grid-cols-1 gap-3.5 md:grid-cols-6 lg:grid-cols-12 ${loading ? 'opacity-70 transition-opacity' : ''}`} aria-busy={loading}>
          <Headline data={data} />
          <MapTile data={data} />
          <MissedTile data={data} />
          <FirstTimeTile data={data} />
          {single || data.client ? <LatestCalls clientId={data.client?.id || me.clients[0]?.id} /> : <ClientsTable data={data} />}
          <ChannelTile data={data} />
          <CallBackStrip data={data} />
        </div>
      )}
    </>
  );
}

function Headline({ data }: { data: OverviewData }) {
  const t = data.totals;
  const p = data.previous;
  const currency = data.client?.currency || 'EUR';
  return (
    <Tile tone="smoke" className="p-5 md:col-span-6 lg:col-span-5" delay={40}>
      <TileHead title={`Last ${data.range.days} days`} sub={`Compared with the ${data.range.days} days before`} />
      <div className="mt-4 grid grid-cols-3 gap-4">
        <Stat value={int(t.calls)} label="Calls" delta={<Delta value={change(t.calls, p.calls)} />} />
        <Stat value={pct(t.answer_rate)} label="Answered"
          delta={<Delta value={t.answer_rate != null && p.answer_rate != null ? t.answer_rate - p.answer_rate : null} points />} />
        <Stat value={int(t.leads)} label="Leads" delta={<Delta value={change(t.leads, p.leads)} />} />
      </div>
      {t.value > 0 && <p className="mt-4 text-[13px] text-ink-2">Lead value <span className="text-ink num">{money(t.value, currency)}</span></p>}
    </Tile>
  );
}

function MapTile({ data }: { data: OverviewData }) {
  const g = data.geo;
  const placed = g.regions.reduce((s, r) => s + r.calls, 0);
  return (
    <Tile className="flex flex-col p-5 md:col-span-6 lg:col-span-7 lg:row-span-2" delay={80}>
      <TileHead title="Where callers are" sub="From the area code of landline callers" to={`/reports${qs({ client_id: data.client?.id, days: data.range.days })}`} />
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_180px]">
        <div className="relative min-h-[260px]">
          {placed ? <div className="absolute inset-0"><GreeceMap geo={g} compact /></div>
            : <Empty title="No landline calls yet">Mobile numbers carry no area code, so they never appear on the map</Empty>}
        </div>
        <dl className="flex flex-col justify-end gap-2 text-[13px]">
          {g.regions.slice(0, 4).map((r) => (
            <div key={r.region} className="flex justify-between gap-3 border-t border-line pt-2"><dt className="truncate text-ink-2">{r.name}</dt><dd className="num">{int(r.calls)}</dd></div>
          ))}
          <div className="flex justify-between gap-3 border-t border-line pt-2"><dt className="text-ink-2">Mobile</dt><dd className="num">{int(g.mobile)}</dd></div>
          {g.unknown > 0 && <div className="flex justify-between gap-3 border-t border-line pt-2"><dt className="text-ink-2">Hidden or abroad</dt><dd className="num">{int(g.unknown)}</dd></div>}
        </dl>
      </div>
    </Tile>
  );
}

function MissedTile({ data }: { data: OverviewData }) {
  const t = data.totals;
  const worse = data.previous.missed > 0 ? t.missed > data.previous.missed : t.missed > 0;
  return (
    <Tile className="p-5 md:col-span-3 lg:col-span-3" delay={120}>
      <TileHead title="Missed" sub={`Change against the ${data.range.days} days before`} to={`/calls${qs({ status: 'missed', client_id: data.client?.id })}`} />
      <div className="figure">{int(t.missed)}<Delta value={change(t.missed, data.previous.missed)} lowerIsBetter /></div>
      <div className="mt-2 text-ink-2"><Sparkline values={data.daily.map((d) => d.missed)} accent={worse} label={`Missed calls per day over ${data.range.days} days`} /></div>
    </Tile>
  );
}

function FirstTimeTile({ data }: { data: OverviewData }) {
  const t = data.totals;
  return (
    <Tile className="p-5 md:col-span-3 lg:col-span-2" delay={160}>
      <TileHead title="New callers" />
      <div className="figure">{t.calls ? pct(t.first_time / t.calls) : 'No data'}</div>
      <p className="mt-1 text-[12px] text-ink-2 num">{int(t.first_time)} of {int(t.calls)} called for the first time</p>
    </Tile>
  );
}

function ClientsTable({ data }: { data: OverviewData }) {
  const navigate = useNavigate();
  const rows = data.by_client.slice(0, 6);
  return (
    <Tile tone="solid" className="p-5 md:col-span-6 lg:col-span-7" delay={200}>
      <TileHead title="Calls by client" sub="Needing attention first" to="/clients" />
      {!rows.length ? <Empty title="No clients yet" action={<Link className="btn btn-glass btn-sm" to="/clients?new=1">Add a client</Link>} /> : (
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th>Client</th><th className="r">Calls</th><th className="r">Answered</th><th className="r">Leads</th><th className="r">Call back</th><th className="hidden w-[120px] xl:table-cell">Trend</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} data-href onClick={() => navigate(`/?client_id=${encodeURIComponent(r.id)}&days=${data.range.days}`)}>
                  <td className="max-w-[200px] truncate">
                    <Link to={`/?client_id=${encodeURIComponent(r.id)}&days=${data.range.days}`} onClick={(e) => e.stopPropagation()}>{r.name}</Link>
                  </td>
                  <td className="r num">{int(r.calls)}</td>
                  <td className="r num">{r.flags.includes('answer_rate') ? <span className="chip chip-alert">{pct(r.answer_rate)}</span> : pct(r.answer_rate)}</td>
                  <td className="r num">{int(r.leads)}</td>
                  <td className="r num">{r.to_call_back ? <span className="text-down">{r.to_call_back}</span> : <span className="text-ink-3">None</span>}</td>
                  <td className="hidden xl:table-cell"><Sparkline values={r.trend} height={22} accent={r.flags.includes('calls_down')} label={`${r.name}, calls per day`} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Tile>
  );
}

// For a client (or a single-client view) the table is their latest calls instead.
function LatestCalls({ clientId }: { clientId?: string }) {
  const { data, error, reload } = useLoad<CallList>(clientId ? `/calls${qs({ client_id: clientId, limit: 6 })}` : null);
  return (
    <Tile tone="solid" className="p-5 md:col-span-6 lg:col-span-7" delay={200}>
      <TileHead title="Latest calls" to={`/calls${qs({ client_id: clientId })}`} />
      {error ? <ErrorState error={error} retry={reload} /> : !data ? <Loading rows={5} /> : !data.calls.length ? (
        <Empty title="No calls yet">Calls appear here a few seconds after someone rings a tracking number</Empty>
      ) : (
        <table className="table">
          <thead><tr><th>When</th><th>Caller</th><th>Source</th><th className="r">Length</th></tr></thead>
          <tbody>
            {data.calls.map((c) => (
              <tr key={c.call_sid}>
                <td className="whitespace-nowrap"><Link to={`/calls?call=${encodeURIComponent(c.call_sid)}`}>{when(c.started_at)}</Link></td>
                <td className="whitespace-nowrap num">{phone(c.caller)}</td>
                <td className="truncate">{channel(c.channel)}</td>
                <td className="r num">{c.answered ? `${Math.round(c.duration_sec / 60) || '<1'} min` : <span className="chip chip-alert">Missed</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Tile>
  );
}

function ChannelTile({ data }: { data: OverviewData }) {
  const rows = data.by_channel.slice(0, 6).map((r) => ({ label: channelShort(r.channel), value: r.calls }));
  return (
    <Tile tone="solid" className="p-5 md:col-span-6 lg:col-span-5" delay={240}>
      <TileHead title="Calls by channel" to={`/reports${qs({ client_id: data.client?.id, days: data.range.days })}`} />
      {rows.length ? <Bars rows={rows} /> : <Empty title="No calls in this period" />}
    </Tile>
  );
}

function CallBackStrip({ data }: { data: OverviewData }) {
  const { count, from_ads } = data.to_call_back;
  if (!count) return null;
  const text = from_ads
    ? `${from_ads} missed ${from_ads === 1 ? 'call' : 'calls'} from ads ${from_ads === 1 ? 'has' : 'have'} not been called back${count > from_ads ? `, ${count} in all` : ''}`
    : `${count} missed ${count === 1 ? 'call has' : 'calls have'} not been called back`;
  return (
    <div className="strip rise md:col-span-6 lg:col-span-12" style={{ animationDelay: '280ms' }}>
      <span className="text-[14px]">{text}</span>
      <Link to={`/calls${qs({ status: 'to_call_back', client_id: data.client?.id })}`} className="btn btn-accent shrink-0">Call back list <ArrowRight /></Link>
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3.5 md:grid-cols-6 lg:grid-cols-12" role="status" aria-label="Loading the overview">
      <Skeleton className="h-[170px] rounded-tile md:col-span-6 lg:col-span-5" />
      <Skeleton className="h-[360px] rounded-tile md:col-span-6 lg:col-span-7 lg:row-span-2" />
      <Skeleton className="h-[170px] rounded-tile md:col-span-3 lg:col-span-3" />
      <Skeleton className="h-[170px] rounded-tile md:col-span-3 lg:col-span-2" />
      <Skeleton className="h-[280px] rounded-tile md:col-span-6 lg:col-span-7" />
      <Skeleton className="h-[280px] rounded-tile md:col-span-6 lg:col-span-5" />
    </div>
  );
}
