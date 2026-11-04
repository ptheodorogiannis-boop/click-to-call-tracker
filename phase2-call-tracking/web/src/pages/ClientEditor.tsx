import { useEffect, useState, type FormEvent } from 'react';
import { Copy, Trash2 } from 'lucide-react';
import { api, type ClientEditor as Data } from '../lib/api';
import { useLoad, useSession, useToast } from '../lib/hooks';
import { phone } from '../lib/format';
import { Drawer, ErrorState, Field, Loading } from '../components/ui';

type Tab = 'details' | 'numbers' | 'conversions' | 'website' | 'logins';
const TABS: { id: Tab; label: string; owner?: boolean }[] = [
  { id: 'details', label: 'Details' },
  { id: 'numbers', label: 'Numbers' },
  { id: 'conversions', label: 'Conversions' },
  { id: 'website', label: 'Website code' },
  { id: 'logins', label: 'Client logins', owner: true }
];

const EMPTY: Data = {
  client: {
    id: '', name: '', forward_number: '', active: true, recording_enabled: true, qualified_duration_sec: null, lead_value: 0, currency: 'EUR',
    consent_message: null, twilio_account_sid: '', twilio_auth_token_masked: '',
    config: { googleAds: {}, meta: { pixelId: '', capiToken_masked: '', testEventCode: '' }, ga4: { measurementId: '', apiSecret_masked: '' } }
  },
  numbers: [], portal_users: []
};

// id: a client id to edit, '' for a new client, null when closed.
export default function ClientEditor({ id, onClose, onSaved }: { id: string | null; onClose: () => void; onSaved: () => void }) {
  const { data, error, reload, setData } = useLoad<Data>(id ? `/clients/${encodeURIComponent(id)}` : null);
  const [tab, setTab] = useState<Tab>('details');
  const { isOwner, me } = useSession();
  useEffect(() => setTab('details'), [id]);
  const isNew = id === '';
  const current = isNew ? EMPTY : data && data.client.id === id ? data : null;

  return (
    <Drawer open={id !== null} onClose={onClose} wide title={isNew ? 'New client' : current?.client.name || 'Client'}>
      {error ? <ErrorState error={error} retry={reload} /> : !current ? <Loading rows={8} /> : (
        <>
          {!isNew && (
            <div className="seg mb-6 flex-wrap" role="tablist" aria-label="Client settings">
              {TABS.filter((t) => !t.owner || isOwner).map((t) => (
                <button key={t.id} role="tab" aria-selected={tab === t.id} aria-pressed={tab === t.id} onClick={() => setTab(t.id)}>{t.label}</button>
              ))}
            </div>
          )}
          {tab === 'details' && <Details data={current} isNew={isNew} onSaved={(d) => { onSaved(); if (isNew) onClose(); else setData(d); }} onDeleted={() => { onSaved(); onClose(); }} />}
          {tab === 'numbers' && <Numbers data={current} onChange={(numbers) => { setData({ ...current, numbers }); onSaved(); }} />}
          {tab === 'conversions' && <Conversions data={current} onSaved={(d) => setData(d)} />}
          {tab === 'website' && <Website data={current} base={me.public_base_url || window.location.origin} />}
          {tab === 'logins' && <Logins data={current} onChange={reload} />}
        </>
      )}
    </Drawer>
  );
}

// Everything the server needs to keep a client as it is; each form sends it with its own changes on top.
function payload(d: Data) {
  const c = d.client;
  return {
    id: c.id, name: c.name, forward_number: c.forward_number, active: c.active, recording_enabled: c.recording_enabled,
    qualified_duration_sec: c.qualified_duration_sec, lead_value: c.lead_value, currency: c.currency, consent_message: c.consent_message,
    twilio_account_sid: c.twilio_account_sid,
    googleAds: c.config.googleAds, meta: { pixelId: c.config.meta.pixelId, testEventCode: c.config.meta.testEventCode }, ga4: { measurementId: c.config.ga4.measurementId }
  };
}

function useSave() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const save = async (body: unknown, ok: string) => {
    setBusy(true); setErr('');
    try { const r = await api.post<{ client: Data['client'] }>('/clients', body); toast(ok); return r.client; }
    catch (e) { setErr((e as Error).message); return null; }
    finally { setBusy(false); }
  };
  return { busy, err, save };
}

const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);

function Details({ data, isNew, onSaved, onDeleted }: { data: Data; isNew: boolean; onSaved: (d: Data) => void; onDeleted: () => void }) {
  const { isOwner } = useSession();
  const toast = useToast();
  const [c, setC] = useState(data.client);
  const [token, setToken] = useState('');
  const [idTouched, setIdTouched] = useState(false);
  const { busy, err, save } = useSave();
  const set = <K extends keyof Data['client']>(k: K, v: Data['client'][K]) => setC((x) => ({ ...x, [k]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const saved = await save({ ...payload({ ...data, client: c }), twilio_auth_token: token || undefined }, isNew ? `${c.name} added` : 'Saved');
    if (saved) { setToken(''); onSaved({ ...data, client: saved }); }
  };
  const remove = async () => {
    if (!window.confirm(`Delete ${c.name}? Its tracking numbers are removed from the pool.`)) return;
    try { await api.del(`/clients/${encodeURIComponent(c.id)}`); toast(`${c.name} deleted`); onDeleted(); }
    catch (e) { toast((e as Error).message, 'error'); }
  };

  return (
    <form className="space-y-5" onSubmit={submit}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Business name" htmlFor="c-name">
          <input id="c-name" className="input" required value={c.name}
            onChange={(e) => { set('name', e.target.value); if (isNew && !idTouched) set('id', slug(e.target.value)); }} />
        </Field>
        <Field label="Short id" htmlFor="c-id" hint={isNew ? 'Used in the website code; cannot change later.' : 'Used in the website code.'}>
          <input id="c-id" className="input" required disabled={!isNew} pattern="[a-z0-9][a-z0-9\-]{1,48}" value={c.id}
            onChange={(e) => { setIdTouched(true); set('id', slug(e.target.value)); }} />
        </Field>
        <Field label="Their real phone line" htmlFor="c-fwd" hint="Calls to tracking numbers ring here.">
          <input id="c-fwd" className="input num" required placeholder="+302101234567" value={c.forward_number} onChange={(e) => set('forward_number', e.target.value.trim())} />
        </Field>
        <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-2">
          <Field label="Value of one lead" htmlFor="c-val">
            <input id="c-val" className="input num" inputMode="decimal" value={c.lead_value} onChange={(e) => set('lead_value', Number(e.target.value.replace(',', '.')) || 0)} />
          </Field>
          <Field label="Currency" htmlFor="c-cur">
            <select id="c-cur" className="select" value={c.currency} onChange={(e) => set('currency', e.target.value)}>
              {['EUR', 'USD', 'GBP', 'CHF'].map((x) => <option key={x}>{x}</option>)}
            </select>
          </Field>
        </div>
        <Field label="A call qualifies after" htmlFor="c-q" hint="Seconds of conversation. Empty uses the server default.">
          <input id="c-q" className="input num" inputMode="numeric" placeholder="30" value={c.qualified_duration_sec ?? ''}
            onChange={(e) => set('qualified_duration_sec', e.target.value ? parseInt(e.target.value, 10) || null : null)} />
        </Field>
        <div className="flex flex-col justify-center gap-3 pt-4">
          <label className="check"><input type="checkbox" checked={c.active} onChange={(e) => set('active', e.target.checked)} /> Tracking is on</label>
          <label className="check"><input type="checkbox" checked={c.recording_enabled} onChange={(e) => set('recording_enabled', e.target.checked)} /> Record calls</label>
        </div>
      </div>
      {c.recording_enabled && (
        <Field label="Recording announcement" htmlFor="c-consent" hint="Played before the call connects. Empty uses the standard Greek wording. Have the client approve it.">
          <textarea id="c-consent" className="textarea" value={c.consent_message || ''} onChange={(e) => set('consent_message', e.target.value || null)}
            placeholder="Η κλήση σας ηχογραφείται για λόγους ποιότητας και εξυπηρέτησης." />
        </Field>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Twilio account SID" htmlFor="c-sid" hint="The client’s own Twilio account or subaccount.">
          <input id="c-sid" className="input num" placeholder="AC…" value={c.twilio_account_sid} onChange={(e) => set('twilio_account_sid', e.target.value.trim())} />
        </Field>
        <Field label="Twilio auth token" htmlFor="c-tok" hint={c.twilio_auth_token_masked ? `Saved, ends in ${c.twilio_auth_token_masked.slice(-4)}. Leave empty to keep it.` : 'Stored on the server, never shown again.'}>
          <input id="c-tok" className="input" type="password" autoComplete="new-password" value={token} onChange={(e) => setToken(e.target.value)} />
        </Field>
      </div>
      {err && <p className="text-[13px] text-down" role="alert">{err}</p>}
      <div className="flex items-center justify-between gap-3 border-t border-line pt-5">
        <button className="btn" disabled={busy}>{isNew ? 'Add client' : 'Save'}</button>
        {!isNew && isOwner && <button type="button" className="btn btn-danger" onClick={remove}><Trash2 /> Delete</button>}
      </div>
    </form>
  );
}

function Numbers({ data, onChange }: { data: Data; onChange: (n: Data['numbers']) => void }) {
  const toast = useToast();
  const [num, setNum] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const id = data.client.id;
  const add = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true);
    try { const r = await api.post<{ numbers: Data['numbers'] }>(`/clients/${encodeURIComponent(id)}/numbers`, { phone: num, label }); onChange(r.numbers); setNum(''); setLabel(''); toast('Number added to the pool'); }
    catch (err) { toast((err as Error).message, 'error'); }
    finally { setBusy(false); }
  };
  const remove = async (p: string) => {
    if (!window.confirm(`Remove ${phone(p)} from the pool? Calls to it will no longer be tracked.`)) return;
    try { await api.del(`/numbers/${encodeURIComponent(p)}`); onChange(data.numbers.filter((n) => n.phone !== p)); toast('Number removed'); }
    catch (err) { toast((err as Error).message, 'error'); }
  };
  return (
    <div className="space-y-5">
      <p className="max-w-[60ch] text-[13px] text-ink-2">Each visitor from an ad gets one of these numbers for an hour, so the call carries their click. Size the pool to the busiest hour: about one number per visitor on the site at the same time. In Twilio, point each number’s voice webhook at <code className="text-[12px]">/webhooks/voice/incoming</code>.</p>
      {data.numbers.length ? (
        <table className="table">
          <thead><tr><th>Number</th><th>Label</th><th className="r" /></tr></thead>
          <tbody>
            {data.numbers.map((n) => (
              <tr key={n.phone}>
                <td className="num">{phone(n.phone)}</td>
                <td className="text-ink-2">{n.label || 'None'}</td>
                <td className="r"><button className="icon-btn icon-btn-sm ml-auto" onClick={() => remove(n.phone)} aria-label={`Remove ${phone(n.phone)}`}><Trash2 /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="text-[14px]">No numbers yet. Until one is added, the website keeps showing the client’s own number and no call is tracked.</p>}
      <form className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end" onSubmit={add}>
        <Field label="Tracking number" htmlFor="n-num"><input id="n-num" className="input num" required placeholder="+302100000001" value={num} onChange={(e) => setNum(e.target.value)} /></Field>
        <Field label="Label" htmlFor="n-label"><input id="n-label" className="input" placeholder="Pool 1" value={label} onChange={(e) => setLabel(e.target.value)} /></Field>
        <button className="btn" disabled={busy}>Add number</button>
      </form>
    </div>
  );
}

function Conversions({ data, onSaved }: { data: Data; onSaved: (d: Data) => void }) {
  const c = data.client.config;
  const [g, setG] = useState({ customerId: c.googleAds.customerId || '', conversionActionId: c.googleAds.conversionActionId || '' });
  const [m, setM] = useState({ pixelId: c.meta.pixelId, testEventCode: c.meta.testEventCode, capiToken: '' });
  const [a, setA] = useState({ measurementId: c.ga4.measurementId, apiSecret: '' });
  const { busy, err, save } = useSave();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const saved = await save({ ...payload(data), googleAds: g, meta: { ...m, capiToken: m.capiToken || undefined }, ga4: { ...a, apiSecret: a.apiSecret || undefined } }, 'Conversion settings saved');
    if (saved) { setM((x) => ({ ...x, capiToken: '' })); setA((x) => ({ ...x, apiSecret: '' })); onSaved({ ...data, client: saved }); }
  };
  const kept = (masked: string) => (masked ? `Saved, ends in ${masked.slice(-4)}. Leave empty to keep it.` : 'Stored on the server, never shown again.');
  return (
    <form className="space-y-7" onSubmit={submit}>
      <p className="max-w-[60ch] text-[13px] text-ink-2">Qualified calls are sent here as conversions, with the lead value. Google Ads needs the visitor’s click id, so it only receives calls from ad clicks.</p>
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-3 text-[14px] font-medium">Google Ads</legend>
        <Field label="Customer id" htmlFor="g-cid"><input id="g-cid" className="input num" placeholder="1234567890" value={g.customerId} onChange={(e) => setG({ ...g, customerId: e.target.value.replace(/\D/g, '') })} /></Field>
        <Field label="Conversion action id" htmlFor="g-act"><input id="g-act" className="input num" value={g.conversionActionId} onChange={(e) => setG({ ...g, conversionActionId: e.target.value.trim() })} /></Field>
      </fieldset>
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-3 text-[14px] font-medium">Meta</legend>
        <Field label="Pixel id" htmlFor="m-px"><input id="m-px" className="input num" value={m.pixelId} onChange={(e) => setM({ ...m, pixelId: e.target.value.trim() })} /></Field>
        <Field label="Conversions API token" htmlFor="m-tok" hint={kept(c.meta.capiToken_masked)}><input id="m-tok" className="input" type="password" autoComplete="new-password" value={m.capiToken} onChange={(e) => setM({ ...m, capiToken: e.target.value })} /></Field>
        <Field label="Test event code" htmlFor="m-test" hint="Only while testing in Events Manager."><input id="m-test" className="input" value={m.testEventCode} onChange={(e) => setM({ ...m, testEventCode: e.target.value.trim() })} /></Field>
      </fieldset>
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-3 text-[14px] font-medium">Google Analytics 4</legend>
        <Field label="Measurement id" htmlFor="a-id"><input id="a-id" className="input num" placeholder="G-XXXXXXX" value={a.measurementId} onChange={(e) => setA({ ...a, measurementId: e.target.value.trim() })} /></Field>
        <Field label="Measurement Protocol secret" htmlFor="a-sec" hint={kept(c.ga4.apiSecret_masked)}><input id="a-sec" className="input" type="password" autoComplete="new-password" value={a.apiSecret} onChange={(e) => setA({ ...a, apiSecret: e.target.value })} /></Field>
      </fieldset>
      {err && <p className="text-[13px] text-down" role="alert">{err}</p>}
      <div className="border-t border-line pt-5"><button className="btn" disabled={busy}>Save</button></div>
    </form>
  );
}

export function Website({ data, base }: { data: Data; base: string }) {
  const toast = useToast();
  const fwd = data.client.forward_number;
  const local = fwd.startsWith('+30') ? fwd.slice(3) : '';
  const real = [fwd, local].filter(Boolean).map((n) => `'${n}'`).join(', ');
  const snippet = `<script>window.CTC_DNI_CONFIG = { siteId: '${data.client.id}', apiBase: '${base}', realNumbers: [${real}] };</script>\n<script src="${base}/static/dni-tracker.js" defer></script>`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(snippet); toast('Website code copied'); }
    catch { toast('Copy did not work here. Select the code and copy it.', 'error'); }
  };
  return (
    <div className="space-y-4">
      <p className="max-w-[60ch] text-[13px] text-ink-2">Put this before <code className="text-[12px]">&lt;/body&gt;</code> on every page, or in Google Tag Manager as a Custom HTML tag on all pages. It swaps the client’s number shown on the site for a tracking number from the pool, for visitors who came from a campaign.</p>
      <pre className="tone-solid overflow-x-auto whitespace-pre-wrap break-all rounded-[16px] p-4 text-[12px] leading-relaxed"><code>{snippet}</code></pre>
      <button className="btn" onClick={copy}><Copy /> Copy code</button>
      <p className="text-[13px] text-ink-2">To mark a number by hand, add <code className="text-[12px]">data-ctc-dni</code> to its link.</p>
    </div>
  );
}

function Logins({ data, onChange }: { data: Data; onChange: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ name: '', login: '', password: '' });
  const [shown, setShown] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const generate = () => {
    const a = new Uint8Array(12); crypto.getRandomValues(a);
    setForm((f) => ({ ...f, password: Array.from(a, (b) => 'abcdefghjkmnpqrstuvwxyzACDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 55]).join('') }));
  };
  const add = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true);
    try {
      await api.post('/users', { ...form, role: 'client', client_ids: [data.client.id] });
      setShown(`${form.login} / ${form.password}`); setForm({ name: '', login: '', password: '' }); onChange(); toast('Client login created');
    } catch (err) { toast((err as Error).message, 'error'); }
    finally { setBusy(false); }
  };
  return (
    <div className="space-y-5">
      <p className="max-w-[60ch] text-[13px] text-ink-2">A client login sees this client’s calls, recordings and reports, and nothing else. It cannot change anything.</p>
      {data.portal_users.length ? (
        <table className="table"><thead><tr><th>Name</th><th>Login</th><th>Status</th></tr></thead>
          <tbody>{data.portal_users.map((u) => <tr key={u.id}><td>{u.name}</td><td className="text-ink-2">{u.login}</td><td>{u.active ? 'Active' : <span className="chip">Off</span>}</td></tr>)}</tbody>
        </table>
      ) : <p className="text-[14px]">Nobody from {data.client.name} can sign in yet.</p>}
      {shown && (
        <div className="rounded-[14px] bg-paper p-4 text-[13px]" role="status">
          <p className="font-medium">Send these to the client now; the password is not shown again.</p>
          <code className="mt-1 block break-all">{shown}</code>
        </div>
      )}
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={add}>
        <Field label="Name" htmlFor="u-name"><input id="u-name" className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="Email" htmlFor="u-login"><input id="u-login" className="input" type="email" required value={form.login} onChange={(e) => setForm({ ...form, login: e.target.value })} /></Field>
        <Field label="Password" htmlFor="u-pass" hint="At least 10 characters.">
          <div className="flex gap-2">
            <input id="u-pass" className="input" required minLength={10} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            <button type="button" className="btn btn-glass" onClick={generate}>Generate</button>
          </div>
        </Field>
        <div className="flex items-end"><button className="btn" disabled={busy}>Create login</button></div>
      </form>
    </div>
  );
}
