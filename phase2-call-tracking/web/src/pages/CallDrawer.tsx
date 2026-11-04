import { useState, type ReactNode } from 'react';
import { Check, PhoneCall, Plus, X } from 'lucide-react';
import { api, type Call, type LeadStatus } from '../lib/api';
import { useLoad, useSession, useToast } from '../lib/hooks';
import { LEAD_LABEL, ago, channel, duration, money, phone, when } from '../lib/format';
import { Drawer, ErrorState, Loading } from '../components/ui';

const ORDER: LeadStatus[] = ['new', 'good', 'customer', 'not_lead', 'spam'];

// One call in full: hear it, judge it, tag it, note it, and see where it came from.
export default function CallDrawer({ sid, onClose, onChanged }: { sid: string | null; onClose: () => void; onChanged: () => void }) {
  const { data, error, reload, setData } = useLoad<{ call: Call }>(sid ? `/calls/${encodeURIComponent(sid)}` : null);
  const call = data?.call.call_sid === sid ? data.call : null;
  return (
    <Drawer open={!!sid} onClose={onClose} title={call ? `Call from ${phone(call.caller)}` : 'Call'}>
      {error ? <ErrorState error={error} retry={reload} /> : !call ? <Loading rows={8} label="Loading the call" /> : (
        <CallBody call={call} onUpdate={(c) => { setData({ call: c }); onChanged(); }} />
      )}
    </Drawer>
  );
}

function CallBody({ call, onUpdate }: { call: Call; onUpdate: (c: Call) => void }) {
  const { canEdit } = useSession();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const act = async (fn: () => Promise<{ call: Call }>, ok?: string) => {
    setBusy(true);
    try { onUpdate((await fn()).call); if (ok) toast(ok); }
    catch (e) { toast((e as Error).message, 'error'); }
    finally { setBusy(false); }
  };
  const path = `/calls/${encodeURIComponent(call.call_sid)}`;

  return (
    <div className="space-y-7">
      <section>
        <p className="text-[13px] text-ink-3">{when(call.started_at)}, {call.client_name}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {call.answered ? <span className="chip">Answered, {duration(call.duration_sec)}</span>
            : <span className={call.to_call_back ? 'chip chip-alert' : 'chip'}>{call.status === 'ringing' ? 'Ringing' : 'Missed'}</span>}
          {call.first_time != null && <span className="chip">{call.first_time ? 'First call' : 'Called before'}</span>}
          {call.qualified && <span className="chip">Long enough to qualify</span>}
          {call.called_back_at && <span className="chip chip-good"><Check /> Called back {ago(call.called_back_at)}</span>}
        </div>
        {call.has_recording && (
          <audio className="mt-4 w-full" controls preload="none" src={`/api/v2${path}/recording`}>
            <a href={`/api/v2${path}/recording`}>Download the recording</a>
          </audio>
        )}
        {canEdit && call.to_call_back && (
          <div className="mt-4 flex flex-wrap gap-2">
            {call.caller && <a className="btn" href={`tel:${call.caller}`}><PhoneCall /> Call {phone(call.caller)}</a>}
            <button className="btn btn-glass" disabled={busy} onClick={() => act(() => api.post(`${path}/called-back`, { done: true }), 'Marked as called back')}>
              <Check /> Mark called back
            </button>
          </div>
        )}
        {canEdit && call.called_back_at && (
          <button className="mt-3 text-[13px] text-ink-2 underline underline-offset-2" disabled={busy}
            onClick={() => act(() => api.post(`${path}/called-back`, { done: false }), 'Back on the call-back list')}>Undo called back</button>
        )}
      </section>

      <Section title="Lead">
        {canEdit ? (
          <>
            <div className="seg flex-wrap" role="group" aria-label="Lead status">
              {ORDER.map((s) => (
                <button key={s} aria-pressed={call.lead_status === s} disabled={busy}
                  onClick={() => act(() => api.patch(path, { lead_status: s }), `Marked as ${LEAD_LABEL[s].toLowerCase()}`)}>
                  {LEAD_LABEL[s]}
                </button>
              ))}
            </div>
            <p className="hint">
              {call.lead_status === 'new'
                ? (call.qualified ? 'Counts as a lead because it lasted long enough. Judging it changes that here' : 'Not counted as a lead until it is judged or a call lasts long enough')
                : 'Judged by your team; this replaces the duration rule in CallTrack’s counts and reports'}
              {(call.conv_google || call.conv_meta || call.conv_ga4) && '. Ad platforms received this call as a conversion when it ended, and that upload is not changed'}
            </p>
            <ValueField call={call} busy={busy} onSave={(v) => act(() => api.patch(path, { value: v }), 'Value saved')} />
          </>
        ) : (
          <p className="text-[14px]">{call.is_lead ? `A lead, worth ${money(call.value_effective, call.currency)}` : LEAD_LABEL[call.lead_status]}</p>
        )}
      </Section>

      <Section title="Tags">
        <Tags call={call} canEdit={canEdit} busy={busy}
          onChange={(add, remove) => act(() => api.post(`${path}/tags`, { add, remove }))} />
      </Section>

      <Section title="Where it came from">
        <dl className="grid grid-cols-[140px_minmax(0,1fr)] gap-x-4 gap-y-2 text-[13px]">
          <Row k="Channel" v={channel(call.channel)} />
          <Row k="Campaign" v={call.utm_campaign} />
          <Row k="Keyword" v={call.utm_term} />
          <Row k="Source and medium" v={call.utm_source || call.utm_medium ? `${call.utm_source || 'none'} / ${call.utm_medium || 'none'}` : null} />
          <Row k="Landing page" v={call.landing_page && <a className="break-all underline underline-offset-2" href={call.landing_page} target="_blank" rel="noreferrer">{call.landing_page.replace(/^https?:\/\//, '')}</a>} />
          <Row k="Referrer" v={call.referrer} />
          <Row k="Google click id" v={call.gclid && <code className="break-all text-[12px]">{call.gclid}</code>} />
          <Row k="Meta click id" v={call.fbclid && <code className="break-all text-[12px]">{call.fbclid}</code>} />
          <Row k="Tracking number" v={phone(call.tracking_number)} />
          <Row k="Caller region" v={call.region_name} />
        </dl>
      </Section>

      {(call.conv_google || call.conv_meta || call.conv_ga4) && (
        <Section title="Ad platform uploads">
          <dl className="grid grid-cols-[140px_minmax(0,1fr)] gap-x-4 gap-y-2 text-[13px]">
            <Row k="Google Ads" v={call.conv_google} /><Row k="Meta" v={call.conv_meta} /><Row k="Google Analytics" v={call.conv_ga4} />
          </dl>
        </Section>
      )}

      <Section title="Notes">
        <Notes call={call} canEdit={canEdit} busy={busy} onAdd={(body) => act(() => api.post(`${path}/notes`, { body }), 'Note added')} />
      </Section>

      {call.transcript && (
        <Section title="Transcript">
          <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-ink-2">{call.transcript}</p>
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section><h3 className="mb-3 text-[14px] font-medium">{title}</h3>{children}</section>;
}

function Row({ k, v }: { k: string; v: ReactNode }) {
  if (!v) return null;
  return <><dt className="text-ink-3">{k}</dt><dd className="min-w-0 text-ink">{v}</dd></>;
}

function ValueField({ call, busy, onSave }: { call: Call; busy: boolean; onSave: (v: number | null) => void }) {
  const [v, setV] = useState(call.value == null ? '' : String(call.value));
  const dirty = v !== (call.value == null ? '' : String(call.value));
  return (
    <form className="mt-4 flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); onSave(v.trim() === '' ? null : Number(v.replace(',', '.'))); }}>
      <div className="w-40">
        <label className="label" htmlFor="call-value">Value ({call.currency})</label>
        <input id="call-value" className="input" inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} placeholder={String(call.default_value)} />
      </div>
      <button className="btn btn-glass" disabled={busy || !dirty}>Save</button>
      <p className="hint mb-2.5">Empty uses the client’s value, {money(call.default_value, call.currency)}.</p>
    </form>
  );
}

function Tags({ call, canEdit, busy, onChange }: { call: Call; canEdit: boolean; busy: boolean; onChange: (add: string[], remove: string[]) => void }) {
  const [text, setText] = useState('');
  return (
    <div className="flex flex-wrap items-center gap-2">
      {call.tags.map((t) => (
        <span key={t} className="tag">
          {t}
          {canEdit && <button className="-mr-1 grid h-5 w-5 place-items-center rounded-full hover:bg-paper" onClick={() => onChange([], [t])} disabled={busy} aria-label={`Remove tag ${t}`}><X className="h-3 w-3" /></button>}
        </span>
      ))}
      {!call.tags.length && !canEdit && <span className="text-[13px] text-ink-3">No tags</span>}
      {canEdit && (
        <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); if (text.trim()) { onChange([text.trim()], []); setText(''); } }}>
          <input className="input h-8 w-36 text-[13px]" value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a tag" aria-label="New tag" maxLength={40} />
          <button className="icon-btn icon-btn-sm" disabled={busy || !text.trim()} aria-label="Add tag"><Plus /></button>
        </form>
      )}
    </div>
  );
}

function Notes({ call, canEdit, busy, onAdd }: { call: Call; canEdit: boolean; busy: boolean; onAdd: (body: string) => void }) {
  const [text, setText] = useState('');
  const notes = call.notes || [];
  return (
    <div className="space-y-3">
      {notes.map((n) => (
        <div key={n.id} className="rounded-[14px] bg-paper px-4 py-3">
          <p className="whitespace-pre-wrap text-[14px]">{n.body}</p>
          <p className="mt-1 text-[12px] text-ink-3">{n.author || 'Someone removed'}, {ago(n.created_at)}</p>
        </div>
      ))}
      {!notes.length && !canEdit && <p className="text-[13px] text-ink-3">No notes</p>}
      {canEdit && (
        <form onSubmit={(e) => { e.preventDefault(); if (text.trim()) { onAdd(text.trim()); setText(''); } }}>
          <label className="sr-only" htmlFor="note">New note</label>
          <textarea id="note" className="textarea" value={text} onChange={(e) => setText(e.target.value)} placeholder="What happened on the call, what to do next" maxLength={4000} />
          <button className="btn btn-glass mt-2" disabled={busy || !text.trim()}>Add note</button>
        </form>
      )}
    </div>
  );
}
