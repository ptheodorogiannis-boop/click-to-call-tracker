import { useState, type FormEvent } from 'react';
import { Link, NavLink, Route, Routes } from 'react-router-dom';
import { Copy, Send, Trash2 } from 'lucide-react';
import { api, type ClientEditor as EditorData, type Token, type User, type Webhook } from '../lib/api';
import { useLoad, useSession, useThemeMode, useToast } from '../lib/hooks';
import { ago } from '../lib/format';
import { Empty, ErrorState, Field, Loading, PageHead, Tile, TileHead } from '../components/ui';
import { Website } from './ClientEditor';

export default function Settings() {
  const { isOwner, canEdit } = useSession();
  const tabs = [
    { to: '/settings', label: 'Account', end: true },
    { to: '/settings/api', label: 'API, MCP and webhooks' },
    ...(canEdit ? [{ to: '/settings/install', label: 'Website code' }] : []),
    ...(isOwner ? [{ to: '/settings/team', label: 'Team and client logins' }] : [])
  ];
  return (
    <>
      <PageHead title="Settings" />
      <nav className="seg mb-5 flex-wrap md:hidden" aria-label="Settings">
        {tabs.map((t) => <NavLink key={t.to} to={t.to} end={t.end}>{t.label}</NavLink>)}
      </nav>
      <Routes>
        <Route index element={<Account />} />
        <Route path="api" element={<ApiAccess />} />
        {canEdit && <Route path="install" element={<Install />} />}
        {isOwner && <Route path="team" element={<Team />} />}
      </Routes>
    </>
  );
}

function Account() {
  const { me } = useSession();
  const [mode, setMode] = useThemeMode();
  return (
    <div className="grid gap-3.5 lg:grid-cols-2">
      <Tile className="p-5">
        <TileHead title="You" />
        <dl className="grid grid-cols-[120px_minmax(0,1fr)] gap-y-2 text-[14px]">
          <dt className="text-ink-3">Name</dt><dd>{me.user.name}</dd>
          <dt className="text-ink-3">Login</dt><dd className="break-all">{me.user.login}</dd>
          <dt className="text-ink-3">Role</dt><dd>{{ owner: 'Owner: everything, including team and client logins', member: 'Team member: calls, leads and clients', client: 'Client: your calls and reports, read only' }[me.user.role]}</dd>
          <dt className="text-ink-3">Clients</dt><dd>{me.clients.map((k) => k.name).join(', ') || 'None yet'}</dd>
        </dl>
      </Tile>
      <PasswordTile />
      <Tile className="p-5">
        <TileHead title="Look" />
        <div className="seg" role="group" aria-label="Theme">
          {(['system', 'light', 'dark'] as const).map((m) => (
            <button key={m} aria-pressed={mode === m} onClick={() => setMode(m)}>{{ system: 'Same as system', light: 'Light', dark: 'Dark' }[m]}</button>
          ))}
        </div>
        <p className="mt-3 text-[13px] text-ink-2">Remembered on this browser</p>
      </Tile>
    </div>
  );
}

function CodeBlock({ code, label }: { code: string; label: string }) {
  const toast = useToast();
  return (
    <div className="relative">
      <pre className="tone-solid overflow-x-auto whitespace-pre-wrap break-all rounded-[16px] p-4 pr-14 text-[12px] leading-relaxed" aria-label={label}><code>{code}</code></pre>
      <button className="icon-btn icon-btn-sm absolute right-3 top-3" aria-label={`Copy ${label}`}
        onClick={() => navigator.clipboard.writeText(code).then(() => toast('Copied'), () => toast('Copy did not work here', 'error'))}><Copy /></button>
    </div>
  );
}

function ApiAccess() {
  const { me, canEdit } = useSession();
  const toast = useToast();
  const { data, error, reload } = useLoad<{ tokens: Token[] }>('/tokens');
  const [name, setName] = useState('');
  const [fresh, setFresh] = useState<string | null>(null);
  const base = me.public_base_url || window.location.origin;
  const token = fresh || 'ct_your_token';

  const create = async (e: FormEvent) => {
    e.preventDefault();
    try { const r = await api.post<{ token: string }>('/tokens', { name: name || 'Token' }); setFresh(r.token); setName(''); reload(); }
    catch (err) { toast((err as Error).message, 'error'); }
  };
  const revoke = async (t: Token) => {
    if (!window.confirm(`Revoke “${t.name}”? Anything using it stops working at once.`)) return;
    await api.del(`/tokens/${t.id}`).then(() => { toast('Token revoked'); reload(); }, (err) => toast(err.message, 'error'));
  };

  return (
    <div className="grid gap-3.5 xl:grid-cols-12">
      <Tile className="p-5 xl:col-span-5">
        <TileHead title="Your tokens" sub="Each one acts as you, with your access" />
        {error ? <ErrorState error={error} retry={reload} /> : !data ? <Loading rows={3} /> : !data.tokens.length ? (
          <p className="mb-4 text-[14px]">No tokens yet</p>
        ) : (
          <table className="table mb-5">
            <thead><tr><th>Name</th><th>Starts with</th><th>Last used</th><th /></tr></thead>
            <tbody>
              {data.tokens.map((t) => (
                <tr key={t.id}>
                  <td className="max-w-[140px] truncate">{t.name}</td>
                  <td><code className="text-[12px]">{t.prefix}</code></td>
                  <td className="text-ink-2">{t.last_used_at ? ago(t.last_used_at) : 'Never'}</td>
                  <td className="r"><button className="icon-btn icon-btn-sm ml-auto" onClick={() => revoke(t)} aria-label={`Revoke ${t.name}`}><Trash2 /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <form className="flex items-end gap-2" onSubmit={create}>
          <div className="flex-1"><Field label="New token for" htmlFor="t-name"><input id="t-name" className="input" placeholder="Claude, n8n, Looker Studio" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} /></Field></div>
          <button className="btn">Create</button>
        </form>
        {fresh && (
          <div className="mt-4 rounded-[14px] bg-paper p-4" role="status">
            <p className="text-[13px] font-medium">Copy it now. It is not shown again.</p>
            <div className="mt-2"><CodeBlock code={fresh} label="the new token" /></div>
          </div>
        )}
        <p className="mt-4 text-[13px] text-ink-2">
          {canEdit ? 'Your tokens can read calls and reports for every client, and mark leads, tags, notes and call-backs. They cannot see Twilio or ad-platform keys, change numbers or delete anything.'
            : 'Your tokens can read your calls and reports. They cannot change anything.'}
        </p>
      </Tile>

      <Tile className="p-5 xl:col-span-7">
        <TileHead title="Connect over MCP" sub="Claude, n8n, monday agents and other tools that speak the Model Context Protocol" />
        <div className="space-y-5 text-[13px]">
          <div>
            <p className="mb-2 font-medium">Server address</p>
            <CodeBlock code={`${base}/mcp`} label="the MCP server address" />
            <p className="hint">Streamable HTTP. Send the token as <code>Authorization: Bearer ct_…</code>.</p>
          </div>
          <div>
            <p className="mb-2 font-medium">Claude Code</p>
            <CodeBlock label="the Claude Code command" code={`claude mcp add --transport http ruler-calls ${base}/mcp --header "Authorization: Bearer ${token}"`} />
          </div>
          <div>
            <p className="mb-2 font-medium">Claude Desktop and tools that only run local servers</p>
            <CodeBlock label="the Claude Desktop configuration" code={JSON.stringify({ mcpServers: { 'ruler-calls': { command: 'npx', args: ['-y', 'mcp-remote', `${base}/mcp`, '--header', 'Authorization: Bearer ${CTC_TOKEN}'], env: { CTC_TOKEN: token } } } }, null, 2)} />
          </div>
          <div>
            <p className="mb-2 font-medium">Plain REST, for Looker Studio or a script</p>
            <CodeBlock label="the REST example" code={`curl -H "Authorization: Bearer ${token}" "${base}/api/report/calls?client=${me.clients[0]?.id || 'client-id'}&since=2026-01-01"`} />
          </div>
          <p className="text-ink-2">Tools: whoami, list_clients, get_overview, get_report, list_calls, search_calls, get_call, calls_to_call_back{canEdit ? ', set_lead_status, tag_call, add_note, mark_called_back' : ''}.</p>
        </div>
      </Tile>
      {canEdit && <Webhooks />}
    </div>
  );
}

function Install() {
  const { me } = useSession();
  const [id, setId] = useState(me.clients[0]?.id || '');
  const { data, error, reload } = useLoad<EditorData>(id ? `/clients/${encodeURIComponent(id)}` : null);
  return (
    <Tile className="max-w-[860px] p-5">
      <TileHead title="Website code">
        {me.clients.length > 1 && (
          <select className="select h-9 !w-auto rounded-full" value={id} onChange={(e) => setId(e.target.value)} aria-label="Client">
            {me.clients.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
          </select>
        )}
      </TileHead>
      {!id ? <Empty title="Add a client first" action={<Link className="btn" to="/clients?new=1">New client</Link>} />
        : error ? <ErrorState error={error} retry={reload} /> : !data ? <Loading rows={4} />
          : <Website data={data} base={me.public_base_url || window.location.origin} />}
    </Tile>
  );
}

const ROLE_LABEL = { owner: 'Owner', member: 'Team member', client: 'Client' } as const;

function Team() {
  const { me } = useSession();
  const toast = useToast();
  const { data, error, reload } = useLoad<{ users: User[] }>('/users');
  const [form, setForm] = useState({ name: '', login: '', password: '', role: 'member' as User['role'], client_ids: [] as string[] });
  const [busy, setBusy] = useState(false);
  const clientName = (id: string) => me.clients.find((k) => k.id === id)?.name || id;
  const [newPassword, setNewPassword] = useState<{ name: string; password: string } | null>(null);
  const resetPassword = async (u: User) => {
    if (!window.confirm(`Give ${u.name} a new password? The old one stops working.`)) return;
    const password = makePassword();
    try { await api.patch(`/users/${u.id}`, { password }); setNewPassword({ name: u.name, password }); }
    catch (err) { toast((err as Error).message, 'error'); }
  };

  const add = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true);
    try { await api.post('/users', form); toast(`${form.name} can sign in now`); setForm({ name: '', login: '', password: '', role: 'member', client_ids: [] }); reload(); }
    catch (err) { toast((err as Error).message, 'error'); }
    finally { setBusy(false); }
  };
  const update = async (u: User, body: Partial<User>) => {
    if (body.role && (body.role === 'owner' || u.role === 'owner')
      && !window.confirm(body.role === 'owner' ? `Make ${u.name} an owner? Owners manage the team and client logins.` : `Remove owner rights from ${u.name}?`)) { reload(); return; }
    try { await api.patch(`/users/${u.id}`, body); reload(); toast('Saved'); }
    catch (err) { toast((err as Error).message, 'error'); }
  };

  return (
    <div className="grid gap-3.5 xl:grid-cols-12">
      <Tile className="p-5 xl:col-span-7">
        <TileHead title="People who can sign in" />
        {newPassword && (
          <div className="mb-4 rounded-[14px] bg-paper p-4 text-[13px]" role="status">
            <p className="font-medium">New password for {newPassword.name}. Send it to them now; it is not shown again</p>
            <div className="mt-2"><CodeBlock code={newPassword.password} label="the new password" /></div>
          </div>
        )}
        {error ? <ErrorState error={error} retry={reload} /> : !data ? <Loading rows={5} /> : (
          <div className="overflow-x-auto">
            <table className="table min-w-[560px]">
              <thead><tr><th>Name</th><th>Role</th><th>Sees</th><th>Last sign-in</th><th /></tr></thead>
              <tbody>
                {data.users.map((u) => (
                  <tr key={u.id} className={u.active ? '' : 'opacity-60'}>
                    <td><p>{u.name}</p><p className="text-[12px] text-ink-3">{u.login}</p></td>
                    <td>
                      <select className="select h-8 !w-auto rounded-full text-[12px]" value={u.role} disabled={u.id === me.user.id} aria-label={`Role of ${u.name}`}
                        onChange={(e) => update(u, { role: e.target.value as User['role'] })}>
                        {Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </td>
                    <td className="max-w-[180px] truncate text-ink-2">{u.role === 'client' ? (u.client_ids || []).map(clientName).join(', ') || 'No client yet' : 'Every client'}</td>
                    <td className="text-ink-2">{u.last_login_at ? ago(u.last_login_at) : 'Never'}</td>
                    <td className="r">
                      {u.id !== me.user.id && (
                        <span className="flex justify-end gap-2">
                          <button className="btn btn-glass btn-sm" onClick={() => resetPassword(u)}>Reset password</button>
                          <button className="btn btn-glass btn-sm" onClick={() => update(u, { active: !u.active })}>{u.active ? 'Switch off' : 'Switch on'}</button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Tile>
      <Tile className="p-5 xl:col-span-5">
        <TileHead title="Add someone" />
        <form className="space-y-4" onSubmit={add}>
          <Field label="Name" htmlFor="tm-name"><input id="tm-name" className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Email" htmlFor="tm-login"><input id="tm-login" type="email" className="input" required value={form.login} onChange={(e) => setForm({ ...form, login: e.target.value })} /></Field>
          <Field label="Password" htmlFor="tm-pass" hint="At least 10 characters. Share it with them yourself."><input id="tm-pass" className="input" required minLength={10} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
          <Field label="Role" htmlFor="tm-role">
            <select id="tm-role" className="select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as User['role'] })}>
              <option value="member">Team member: calls, leads and clients</option>
              <option value="owner">Owner: also team and client logins</option>
              <option value="client">Client: their calls and reports, read only</option>
            </select>
          </Field>
          {form.role === 'client' && (
            <fieldset>
              <legend className="label">Which clients they see</legend>
              <div className="flex flex-col gap-2">
                {me.clients.map((k) => (
                  <label key={k.id} className="check">
                    <input type="checkbox" checked={form.client_ids.includes(k.id)}
                      onChange={(e) => setForm({ ...form, client_ids: e.target.checked ? [...form.client_ids, k.id] : form.client_ids.filter((x) => x !== k.id) })} />
                    {k.name}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <button className="btn" disabled={busy || (form.role === 'client' && !form.client_ids.length)}>Add</button>
        </form>
      </Tile>
    </div>
  );
}

// A password someone can type: 14 characters without look-alikes (0/O, 1/l/I).
function makePassword() {
  const a = new Uint8Array(14);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => 'abcdefghjkmnpqrstuvwxyzACDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 55]).join('');
}

function PasswordTile() {
  const toast = useToast();
  const [f, setF] = useState({ current: '', next: '', again: '' });
  const [busy, setBusy] = useState(false);
  const mismatch = f.again.length > 0 && f.next !== f.again;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (mismatch) return;
    setBusy(true);
    try { await api.post('/me/password', { current: f.current, next: f.next }); toast('Password changed'); setF({ current: '', next: '', again: '' }); }
    catch (err) { toast((err as Error).message, 'error'); }
    finally { setBusy(false); }
  };
  return (
    <Tile className="p-5">
      <TileHead title="Password" />
      <form className="space-y-4" onSubmit={submit}>
        <Field label="Current password" htmlFor="pw-cur"><input id="pw-cur" className="input" type="password" autoComplete="current-password" required value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="New password" htmlFor="pw-new" hint="At least 10 characters"><input id="pw-new" className="input" type="password" autoComplete="new-password" required minLength={10} value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} /></Field>
          <Field label="New password again" htmlFor="pw-again" hint={mismatch ? 'The two do not match' : undefined}><input id="pw-again" className="input" type="password" autoComplete="new-password" required aria-invalid={mismatch} value={f.again} onChange={(e) => setF({ ...f, again: e.target.value })} /></Field>
        </div>
        <button className="btn" disabled={busy || mismatch}>Change password</button>
      </form>
    </Tile>
  );
}

const EVENT_LABEL: Record<string, string> = { 'call.completed': 'A call ends', 'call.updated': 'Someone works a lead' };

function Webhooks() {
  const { me } = useSession();
  const toast = useToast();
  const { data, error, reload } = useLoad<{ webhooks: Webhook[] }>('/webhooks');
  const [f, setF] = useState({ url: '', client_id: '', events: ['call.completed', 'call.updated'] });
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const add = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true);
    try {
      const r = await api.post<{ secret: string }>('/webhooks', { ...f, client_id: f.client_id || null });
      setSecret(r.secret); setF({ url: '', client_id: '', events: ['call.completed', 'call.updated'] }); reload();
    } catch (err) { toast((err as Error).message, 'error'); }
    finally { setBusy(false); }
  };
  const test = async (w: Webhook) => {
    try { await api.post(`/webhooks/${w.id}/test`); toast('Delivered'); }
    catch (err) { toast((err as Error).message === 'There is no call to send yet' ? 'There is no call to send yet' : 'The address did not accept it', 'error'); }
    reload();
  };
  const remove = async (w: Webhook) => {
    if (!window.confirm(`Stop sending calls to ${w.url}?`)) return;
    await api.del(`/webhooks/${w.id}`).then(() => { toast('Webhook removed'); reload(); }, (err) => toast(err.message, 'error'));
  };
  return (
    <Tile className="p-5 xl:col-span-12">
      <TileHead title="Webhooks" sub="Each call is sent as JSON to your address when it ends and when someone works it" />
      {error ? <ErrorState error={error} retry={reload} /> : !data ? <Loading rows={2} /> : data.webhooks.length > 0 && (
        <div className="mb-5 overflow-x-auto">
          <table className="table min-w-[640px]">
            <thead><tr><th>Address</th><th>Client</th><th>Sends when</th><th>Last delivery</th><th /></tr></thead>
            <tbody>
              {data.webhooks.map((w) => (
                <tr key={w.id}>
                  <td className="max-w-[260px] truncate"><code className="text-[12px]">{w.url}</code></td>
                  <td>{w.client_id ? me.clients.find((k) => k.id === w.client_id)?.name || w.client_id : 'Every client'}</td>
                  <td className="text-ink-2">{w.events.map((e) => EVENT_LABEL[e] || e).join(', ')}</td>
                  <td>{w.last_at ? <span className={w.failures ? 'text-down' : 'text-ink-2'}>{w.last_status}, {ago(w.last_at)}</span> : <span className="text-ink-3">Never</span>}</td>
                  <td className="r">
                    <span className="flex justify-end gap-2">
                      <button className="btn btn-glass btn-sm" onClick={() => test(w)}><Send /> Test</button>
                      <button className="icon-btn icon-btn-sm" onClick={() => remove(w)} aria-label={`Remove the webhook to ${w.url}`}><Trash2 /></button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {secret && (
        <div className="mb-5 rounded-[14px] bg-paper p-4" role="status">
          <p className="text-[13px] font-medium">Signing secret. Copy it now; it is not shown again</p>
          <p className="mt-1 text-[12px] text-ink-2">Each request carries X-CallTrack-Signature: t=time,v1=HMAC-SHA256 of “time.body” with this secret</p>
          <div className="mt-2"><CodeBlock code={secret} label="the signing secret" /></div>
        </div>
      )}
      <form className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] lg:items-end" onSubmit={add}>
        <Field label="Send to" htmlFor="wh-url"><input id="wh-url" className="input" type="url" required placeholder="https://hooks.zapier.com/… or your own address" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} /></Field>
        <Field label="For" htmlFor="wh-client">
          <select id="wh-client" className="select" value={f.client_id} onChange={(e) => setF({ ...f, client_id: e.target.value })}>
            <option value="">Every client</option>
            {me.clients.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
          </select>
        </Field>
        <button className="btn" disabled={busy || !f.events.length}>Add webhook</button>
        <fieldset className="flex flex-wrap gap-4 lg:col-span-3">
          <legend className="sr-only">Send when</legend>
          {Object.entries(EVENT_LABEL).map(([k, v]) => (
            <label key={k} className="check">
              <input type="checkbox" checked={f.events.includes(k)} onChange={(e) => setF({ ...f, events: e.target.checked ? [...f.events, k] : f.events.filter((x) => x !== k) })} /> {v}
            </label>
          ))}
        </fieldset>
      </form>
    </Tile>
  );
}
