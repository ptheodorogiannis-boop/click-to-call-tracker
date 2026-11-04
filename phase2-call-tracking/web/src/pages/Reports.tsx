import { Download, Printer } from 'lucide-react';
import { qs, type Report } from '../lib/api';
import { useLoad } from '../lib/hooks';
import { change, channel, dayLabel, duration, int, money, pct } from '../lib/format';
import { ClientSelect, PeriodSeg, useDays, useParam } from '../components/filters';
import { Delta, Empty, ErrorState, PageHead, Skeleton, Stat, Tile, TileHead } from '../components/ui';
import { GreeceMap } from '../components/charts';
import { MonthlyChart } from '../components/MonthlyChart';

// One client (or all) over a period: what a client report shows, and what prints.
export default function Reports() {
  const [days] = useDays();
  const [client] = useParam('client_id');
  const { data, error, loading, reload } = useLoad<Report>(`/reports${qs({ days, client_id: client })}`);

  return (
    <>
      <PageHead title={data?.client ? `${data.client.name} report` : 'Report, all clients'}>
        <ClientSelect />
        <PeriodSeg />
        <a className="btn btn-glass" href={`/api/v2/reports/calls.csv${qs({ client_id: client, days })}`}><Download /> CSV</a>
        <button className="icon-btn" onClick={() => window.print()} aria-label="Print or save as PDF"><Printer /></button>
      </PageHead>
      {error && !data ? <Tile><ErrorState error={error} retry={reload} /></Tile> : !data ? (
        <div className="grid gap-3.5 lg:grid-cols-12" role="status" aria-label="Loading the report">
          <Skeleton className="h-[150px] rounded-tile lg:col-span-12" />
          <Skeleton className="h-[320px] rounded-tile lg:col-span-7" />
          <Skeleton className="h-[320px] rounded-tile lg:col-span-5" />
        </div>
      ) : <Body data={data} loading={loading} />}
    </>
  );
}

function Body({ data, loading }: { data: Report; loading: boolean }) {
  const t = data.totals;
  const p = data.previous;
  const cur = data.client?.currency || 'EUR';
  const range = `${dayLabel(data.range.since)} to ${dayLabel(data.range.until)}`;
  return (
    <div className={`grid grid-cols-1 gap-3.5 lg:grid-cols-12 ${loading ? 'opacity-70 transition-opacity' : ''}`} aria-busy={loading}>
      <Tile tone="smoke" className="p-5 lg:col-span-12" delay={30}>
        <TileHead title={range} sub={`Change against the ${data.range.days} days before`} />
        <div className="mt-3 grid grid-cols-2 gap-5 sm:grid-cols-3 xl:grid-cols-6">
          <Stat value={int(t.calls)} label="Calls" delta={<Delta value={change(t.calls, p.calls)} />} />
          <Stat value={pct(t.answer_rate)} label="Answered" delta={<Delta value={t.answer_rate != null && p.answer_rate != null ? t.answer_rate - p.answer_rate : null} points />} />
          <Stat value={int(t.leads)} label="Leads" delta={<Delta value={change(t.leads, p.leads)} />} />
          <Stat value={money(t.value, cur)} label="Lead value" delta={<Delta value={change(t.value, p.value)} />} />
          <Stat value={duration(t.avg_duration)} label="Average answered call" />
          <Stat value={t.calls ? pct(data.callers.first_time / t.calls) : 'No data'} label="First-time callers" />
        </div>
      </Tile>

      <Tile tone="solid" className="p-5 lg:col-span-7" delay={70}>
        <TileHead title="Last 12 months" sub="Calls per month; the line is the share answered" />
        {data.monthly.some((m) => m.calls) ? <MonthlyChart months={data.monthly} /> : <Empty title="No calls in the last 12 months" />}
      </Tile>

      <Tile className="flex flex-col p-5 lg:col-span-5 lg:row-span-2" delay={110}>
        <TileHead title="Where callers are" sub="Landline area codes; mobiles carry none" />
        <div className="relative min-h-[300px] flex-1">
          {data.geo.regions.length ? <div className="absolute inset-0"><GreeceMap geo={data.geo} /></div> : <Empty title="No landline calls in this period" />}
        </div>
        <p className="mt-3 text-[13px] text-ink-2 num">{int(data.geo.mobile)} from mobiles{data.geo.unknown ? `, ${int(data.geo.unknown)} hidden or from abroad` : ''}</p>
      </Tile>

      <Tile className="p-5 lg:col-span-7" delay={150}>
        <TileHead title="Channels" />
        {data.by_channel.length ? (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>Channel</th><th className="r">Calls</th><th className="r">Answered</th><th className="r">Missed</th><th className="r">Leads</th><th className="r">Lead value</th></tr></thead>
              <tbody>
                {data.by_channel.map((r) => (
                  <tr key={r.channel}><td>{channel(r.channel)}</td><td className="r num">{int(r.calls)}</td><td className="r num">{pct(r.calls ? r.answered / r.calls : null)}</td><td className="r num">{int(r.missed)}</td><td className="r num">{int(r.leads)}</td><td className="r num">{money(r.value, cur)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty title="No calls in this period" />}
      </Tile>

      <Tile tone="solid" className="p-5 lg:col-span-7" delay={190}>
        <TileHead title="Campaigns" sub="From the campaign tag on the visitor’s link" />
        {data.by_campaign.length ? (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>Campaign</th><th>Channel</th><th className="r">Calls</th><th className="r">Answered</th><th className="r">Leads</th><th className="r">Lead value</th></tr></thead>
              <tbody>
                {data.by_campaign.slice(0, 12).map((r) => (
                  <tr key={r.campaign + r.channel}><td className="max-w-[220px] truncate">{r.campaign === '(none)' ? <span className="text-ink-3">No campaign</span> : r.campaign}</td><td className="whitespace-nowrap text-ink-2">{channel(r.channel)}</td><td className="r num">{int(r.calls)}</td><td className="r num">{int(r.answered)}</td><td className="r num">{int(r.leads)}</td><td className="r num">{money(r.value, cur)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty title="No campaign calls in this period" />}
      </Tile>

      <Tile className="p-5 lg:col-span-5" delay={230}>
        <TileHead title="Keywords" sub="From the keyword tag on ad links" />
        {data.by_keyword.length ? (
          <table className="table">
            <thead><tr><th>Keyword</th><th className="r">Calls</th><th className="r">Leads</th></tr></thead>
            <tbody>{data.by_keyword.slice(0, 10).map((k) => <tr key={k.keyword}><td className="max-w-[220px] truncate">{k.keyword}</td><td className="r num">{int(k.calls)}</td><td className="r num">{int(k.leads)}</td></tr>)}</tbody>
          </table>
        ) : <Empty title="No keywords yet">Add <code className="text-[12px]">utm_term={'{keyword}'}</code> to the Google Ads tracking template and calls will show the keyword that brought them.</Empty>}
      </Tile>
    </div>
  );
}
