'use strict';
/* Ruler CallTrack — admin + reporting SPA (vanilla, no deps, no CDN). */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [].slice.call(r.querySelectorAll(s));
const el = (t, a = {}, kids = []) => { const e = document.createElement(t); for (const k in a) { if (k === 'class') e.className = a[k]; else if (k === 'html') e.innerHTML = a[k]; else if (k.startsWith('on')) e.addEventListener(k.slice(2), a[k]); else e.setAttribute(k, a[k]); } (Array.isArray(kids) ? kids : [kids]).forEach(c => c != null && e.append(c.nodeType ? c : document.createTextNode(c))); return e; };

let BRAND = { name: 'Ruler CallTrack', company: 'Ruler Agency' };
let BASEURL = '';
let CLIENTS = [];

// ── API ────────────────────────────────────────────────
async function api(method, path, body) {
  const r = await fetch('/admin/api' + path, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin'
  });
  if (r.status === 401) { showLogin(); throw new Error('unauthorized'); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || ('HTTP ' + r.status));
  return data;
}

// ── boot / auth ────────────────────────────────────────
async function boot() {
  try {
    const me = await api('GET', '/me');
    BRAND = me.brand; BASEURL = me.publicBaseUrl || location.origin;
    applyBrand();
    $('#whoami').textContent = 'Signed in as ' + me.user;
    showApp(); go('overview');
  } catch (e) { showLogin(); }
}
function applyBrand() {
  document.title = BRAND.name;
  $('#brandTitle').textContent = BRAND.name;
  const parts = BRAND.name.split(' ');
  $('#logoMain').textContent = parts.shift();
  $('#logoSub').textContent = parts.join(' ');
}
function showLogin() { $('#app').classList.add('hidden'); $('#login').classList.remove('hidden'); }
function showApp() { $('#login').classList.add('hidden'); $('#app').classList.remove('hidden'); }

$('#loginForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  $('#loginErr').textContent = '';
  try {
    await api('POST', '/login', { user: $('#loginUser').value, password: $('#loginPass').value });
    boot();
  } catch (e) { $('#loginErr').textContent = e.message; }
});
$('#logoutBtn').addEventListener('click', async () => { await api('POST', '/logout'); showLogin(); });

// ── nav ────────────────────────────────────────────────
$$('#nav a').forEach(a => a.addEventListener('click', () => go(a.dataset.view)));
function go(view) {
  $$('#nav a').forEach(a => a.classList.toggle('active', a.dataset.view === view));
  $$('.view').forEach(v => v.classList.add('hidden'));
  $('#view-' + view).classList.remove('hidden');
  if (view === 'overview') loadOverview();
  if (view === 'clients') loadClients();
  if (view === 'reports') loadReports();
}
$('#newClientBtn').addEventListener('click', () => openEditor());
$('#newClientBtn2').addEventListener('click', () => openEditor());

// ── overview ───────────────────────────────────────────
async function loadOverview() {
  const { clients } = await api('GET', '/clients'); CLIENTS = clients;
  const g = $('#overviewGrid'); g.innerHTML = '';
  if (!clients.length) { g.append(el('p', { class: 'muted' }, 'No clients yet. Click “New client”.')); return; }
  clients.forEach(c => {
    g.append(el('div', { class: 'client-card', onclick: () => { $('#repClient').value = c.id; go('reports'); } }, [
      el('div', { class: 'head' }, [
        el('div', { class: 'name' }, c.name),
        el('span', { class: 'status' + (c.active ? '' : ' off') })
      ]),
      el('div', { class: 'muted small' }, c.numbers + ' tracking numbers · ' + c.id),
      el('div', { class: 'kpis' }, [
        kpi(c.last30.total, 'Calls 30d'),
        kpi(c.last30.answered, 'Answered'),
        kpi(c.last30.qualified, 'Qualified')
      ])
    ]));
  });
}
const kpi = (v, l) => el('div', { class: 'kpi' }, [el('div', { class: 'v' }, String(v)), el('div', { class: 'l' }, l)]);

// ── clients table ──────────────────────────────────────
async function loadClients() {
  const { clients } = await api('GET', '/clients'); CLIENTS = clients;
  const tb = $('#clientsTable tbody'); tb.innerHTML = '';
  clients.forEach(c => {
    tb.append(el('tr', {}, [
      el('td', {}, [el('strong', {}, c.name), el('div', { class: 'muted small' }, c.id)]),
      el('td', {}, c.forward_number),
      el('td', {}, String(c.numbers)),
      el('td', {}, c.recording_enabled ? 'On' : 'Off'),
      el('td', {}, el('span', { class: 'badge ' + (c.active ? 'answered' : 'repeat') }, c.active ? 'Active' : 'Off')),
      el('td', {}, el('button', { class: 'btn secondary', onclick: () => openEditor(c.id) }, 'Edit'))
    ]));
  });
}

// ── client editor (drawer) ─────────────────────────────
async function openEditor(id) {
  let client = { config: { googleAds: {}, meta: {}, ga4: {} } }, numbers = [];
  if (id) { const r = await api('GET', '/clients/' + id); client = r.client; numbers = r.numbers; }
  const cfg = client.config || { googleAds: {}, meta: {}, ga4: {} };
  const isNew = !id;
  const v = (x) => x == null ? '' : x;

  const drawer = el('div', { class: 'overlay', onclick: (e) => { if (e.target.classList.contains('overlay')) closeDrawer(); } }, [
    el('div', { class: 'drawer' }, [
      el('h3', {}, isNew ? 'New client' : client.name),
      el('p', { class: 'muted small' }, 'Per-client Twilio credentials keep every account isolated.'),

      section('Basics', [
        row2(input('id', 'Client ID (slug)', v(client.id), { disabled: !isNew, placeholder: 'client-acme' }),
             input('name', 'Display name', v(client.name))),
        row2(input('forward_number', 'Forward to (real line, +30…)', v(client.forward_number)),
             input('lead_value', 'Lead value', v(client.lead_value), { type: 'number' })),
        row2(selectField('currency', 'Currency', ['EUR', 'USD', 'GBP'], v(client.currency) || 'EUR'),
             input('qualified_duration_sec', 'Qualified after (sec)', v(client.qualified_duration_sec), { type: 'number', placeholder: '30' })),
        el('div', { class: 'field' }, [label('Consent announcement (Greek, GDPR)'),
          el('textarea', { id: 'f_consent_message', rows: '2', placeholder: '(leave blank for default)' }, v(client.consent_message))]),
        el('div', { class: 'inline' }, [
          checkbox('recording_enabled', 'Record calls', client.recording_enabled),
          checkbox('active', 'Active', client.active == null ? true : client.active)
        ])
      ]),

      section('Twilio (this client’s own account)', [
        input('twilio_account_sid', 'Account SID', v(client.twilio_account_sid), { placeholder: 'AC…' }),
        input('twilio_auth_token', 'Auth token', '', { placeholder: client.twilio_auth_token_masked || 'enter token', type: 'password' }),
        el('div', { class: 'muted small' }, 'Point each Twilio number’s voice webhook to: ' +
          (BASEURL || '') + '/webhooks/voice/incoming  (HTTP POST)')
      ]),

      section('Conversions (optional)', [
        el('div', { class: 'muted small', style: 'margin-bottom:8px' }, 'Google Ads'),
        row2(input('ga_customerId', 'Customer ID', v(cfg.googleAds.customerId)),
             input('ga_conversionActionId', 'Conversion action ID', v(cfg.googleAds.conversionActionId))),
        el('div', { class: 'muted small', style: 'margin:10px 0 8px' }, 'Meta'),
        row2(input('meta_pixelId', 'Pixel ID', v(cfg.meta.pixelId)),
             input('meta_capiToken', 'CAPI token', '', { placeholder: cfg.meta.capiToken_masked || 'token', type: 'password' })),
        input('meta_testEventCode', 'Test event code (optional)', v(cfg.meta.testEventCode)),
        el('div', { class: 'muted small', style: 'margin:10px 0 8px' }, 'GA4'),
        row2(input('ga4_measurementId', 'Measurement ID', v(cfg.ga4.measurementId)),
             input('ga4_apiSecret', 'API secret', '', { placeholder: cfg.ga4.apiSecret_masked || 'secret', type: 'password' }))
      ]),

      id ? numbersSection(id, numbers) : el('div', { class: 'muted small' }, 'Save the client first, then add tracking numbers.'),

      id ? snippetSection(id) : null,

      el('div', { class: 'inline', style: 'margin-top:18px' }, [
        el('button', { class: 'btn', onclick: () => saveClient(isNew) }, 'Save client'),
        el('button', { class: 'btn secondary', onclick: closeDrawer }, 'Cancel'),
        id ? el('button', { class: 'btn ghost', style: 'margin-left:auto;color:var(--bad)', onclick: () => delClient(id) }, 'Delete') : null
      ])
    ])
  ]);
  $('#drawer').innerHTML = ''; $('#drawer').append(drawer);
}
function closeDrawer() { $('#drawer').innerHTML = ''; }

function section(title, kids) { return el('div', { class: 'section' }, [el('h4', {}, title), ...kids]); }
function label(t) { return el('label', {}, t); }
function input(id, lbl, val, attrs = {}) {
  return el('div', { class: 'field' }, [label(lbl), el('input', Object.assign({ id: 'f_' + id, value: val }, attrs))]);
}
function selectField(id, lbl, opts, val) {
  return el('div', { class: 'field' }, [label(lbl),
    el('select', { id: 'f_' + id }, opts.map(o => el('option', { value: o, ...(o === val ? { selected: 'selected' } : {}) }, o)))]);
}
function checkbox(id, lbl, checked) {
  const c = el('input', { type: 'checkbox', id: 'f_' + id }); if (checked) c.checked = true;
  return el('label', { class: 'inline', style: 'font-weight:600' }, [c, ' ' + lbl]);
}
function row2(a, b) { return el('div', { class: 'row2' }, [a, b]); }
const fval = (id) => { const e = $('#f_' + id); return e ? (e.type === 'checkbox' ? e.checked : e.value) : ''; };

function numbersSection(id, numbers) {
  const list = el('div', { class: 'numlist' });
  const render = (arr) => { list.innerHTML = ''; if (!arr.length) list.append(el('div', { class: 'muted small' }, 'No numbers yet.')); arr.forEach(n => list.append(el('div', { class: 'n' }, [el('span', {}, n.phone + (n.label ? '  · ' + n.label : '')), el('button', { class: 'btn ghost', style: 'color:var(--bad)', onclick: async () => { await api('DELETE', '/numbers/' + encodeURIComponent(n.phone)); const r = await api('GET', '/clients/' + id); render(r.numbers); } }, '✕')]))); };
  render(numbers);
  const phoneInput = el('input', { placeholder: '+302100000001', style: 'flex:1' });
  const labelInput = el('input', { placeholder: 'label (optional)', style: 'width:140px' });
  return section('DNI pool — tracking numbers', [
    list,
    el('div', { class: 'inline', style: 'margin-top:10px' }, [phoneInput, labelInput,
      el('button', { class: 'btn secondary', onclick: async () => { if (!phoneInput.value) return; await api('POST', '/clients/' + id + '/numbers', { phone: phoneInput.value.trim(), label: labelInput.value.trim() }); phoneInput.value = labelInput.value = ''; const r = await api('GET', '/clients/' + id); render(r.numbers); } }, '+ Add')])
  ]);
}

function snippetSection(id) {
  const snip = `<script>window.CTC_DNI_CONFIG={siteId:'${id}',apiBase:'${BASEURL}',realNumbers:['+302101234567']};<\/script>\n<script src="${BASEURL}/static/dni-tracker.js" defer><\/script>`;
  return section('Website snippet', [
    el('div', { class: 'muted small', style: 'margin-bottom:8px' }, 'Paste on the client site (edit realNumbers to their displayed number):'),
    el('div', { class: 'snippet' }, snip),
    el('button', { class: 'btn secondary', style: 'margin-top:10px', onclick: () => { navigator.clipboard.writeText(snip); toast('Snippet copied'); } }, 'Copy snippet')
  ]);
}

async function saveClient(isNew) {
  const body = {
    id: fval('id'), name: fval('name'), forward_number: fval('forward_number'),
    lead_value: fval('lead_value'), currency: fval('currency'),
    qualified_duration_sec: fval('qualified_duration_sec'), consent_message: fval('consent_message'),
    recording_enabled: fval('recording_enabled'), active: fval('active'),
    twilio_account_sid: fval('twilio_account_sid'), twilio_auth_token: fval('twilio_auth_token'),
    googleAds: { customerId: fval('ga_customerId'), conversionActionId: fval('ga_conversionActionId') },
    meta: { pixelId: fval('meta_pixelId'), capiToken: fval('meta_capiToken'), testEventCode: fval('meta_testEventCode') },
    ga4: { measurementId: fval('ga4_measurementId'), apiSecret: fval('ga4_apiSecret') }
  };
  try {
    const r = await api('POST', '/clients', body);
    toast('Saved');
    if (isNew) openEditor(r.id); else closeDrawer();
    loadOverview();
  } catch (e) { toast(e.message); }
}
async function delClient(id) {
  if (!confirm('Delete client ' + id + '? Call history stays in the DB.')) return;
  await api('DELETE', '/clients/' + id); closeDrawer(); loadClients(); loadOverview();
}

// ── reports ────────────────────────────────────────────
async function loadReports() {
  if (!CLIENTS.length) { try { CLIENTS = (await api('GET', '/clients')).clients; } catch (e) {} }
  const sel = $('#repClient'); const cur = sel.value;
  sel.innerHTML = '';
  CLIENTS.forEach(c => sel.append(el('option', { value: c.id }, c.name)));
  if (cur) sel.value = cur;
  if (!$('#repSince').value) $('#repSince').value = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  if (sel.value) renderReport();
}
$('#repRefresh').addEventListener('click', renderReport);
$('#repClient').addEventListener('change', renderReport);
$('#repSince').addEventListener('change', renderReport);

async function renderReport() {
  const client = $('#repClient').value, since = $('#repSince').value;
  if (!client) return;
  const stats = await api('GET', `/report/stats?client=${client}&since=${since}`);
  const calls = await api('GET', `/report/calls?client=${client}&since=${since}&limit=300`);
  renderScorecards(stats.totals);
  renderBars(stats.by_channel);
  renderCalls(calls.calls);
}

function renderScorecards(t) {
  const answerRate = t.total ? Math.round(t.answered / t.total * 100) : 0;
  const cards = [
    ['Total calls', t.total, ''], ['Answered', t.answered, 'good'], ['Missed', t.missed, 'bad'],
    ['Qualified', t.qualified, 'accent'], ['First-time', t.first_time, ''], ['Answer rate', answerRate + '%', '']
  ];
  $('#scorecards').innerHTML = '';
  cards.forEach(([l, v, cls]) => $('#scorecards').append(
    el('div', { class: 'score ' + cls }, [el('div', { class: 'v' }, String(v)), el('div', { class: 'l' }, l)])));
}

function renderBars(rows) {
  const box = $('#channelBars'); box.innerHTML = '';
  if (!rows.length) { box.append(el('div', { class: 'muted' }, 'No calls in this period.')); return; }
  const max = Math.max(...rows.map(r => r.total));
  rows.forEach(r => {
    box.append(el('div', { class: 'bar-row' }, [
      el('div', { class: 'lbl' }, channelLabel(r.channel)),
      el('div', { class: 'bar-track' }, el('div', { class: 'bar-fill', style: `width:${max ? r.total / max * 100 : 0}%` })),
      el('div', { class: 'num' }, `${r.total} (${r.qualified}✓)`)
    ]));
  });
}

function renderCalls(calls) {
  const tb = $('#callsTable tbody'); tb.innerHTML = '';
  if (!calls.length) { tb.append(el('tr', {}, el('td', { colspan: '9', class: 'muted' }, 'No calls.'))); return; }
  calls.forEach(c => {
    const rec = c.recording_url
      ? el('audio', { controls: 'controls', preload: 'none', src: '/admin/api/recording?sid=' + encodeURIComponent(c.call_sid), style: 'height:30px;max-width:160px' })
      : el('span', { class: 'muted' }, '—');
    const tx = c.transcript ? el('button', { class: 'chip', onclick: () => openText('Transcript — ' + c.caller, c.transcript) }, '📝 transcript') : null;
    tb.append(el('tr', {}, [
      el('td', {}, fmtTime(c.started_at)),
      el('td', {}, c.caller || '—'),
      el('td', {}, channelLabel(c.channel)),
      el('td', {}, c.utm_campaign || '—'),
      el('td', {}, statusBadge(c)),
      el('td', {}, dur(c.duration_sec)),
      el('td', {}, c.first_time == null ? '—' : el('span', { class: 'badge ' + (c.first_time ? 'first' : 'repeat') }, c.first_time ? 'First' : 'Repeat')),
      el('td', {}, [rec, tx]),
      el('td', {}, convChips(c))
    ]));
  });
}

function statusBadge(c) {
  const s = c.status || (c.answered ? 'answered' : 'missed');
  const wrap = el('span', {}, [el('span', { class: 'badge ' + s }, s)]);
  if (c.qualified) wrap.append(' ', el('span', { class: 'badge qual' }, 'qualified'));
  return wrap;
}
function convChips(c) {
  const wrap = el('span', {});
  [['G', c.conv_google], ['M', c.conv_meta], ['GA4', c.conv_ga4]].forEach(([k, val]) => {
    if (!val) return;
    const cls = val === 'ok' ? 'ok' : /err|exception|partial/.test(val) ? 'err' : '';
    wrap.append(el('span', { class: 'chip ' + cls, title: val }, k));
  });
  return wrap.childNodes.length ? wrap : document.createTextNode('—');
}
function channelLabel(ch) { return ({ google_ads: 'Google Ads', meta_ads: 'Meta Ads', microsoft_ads: 'Microsoft', other_paid: 'Other paid', google_organic: 'Google organic', meta_organic: 'Meta organic', referral: 'Referral', direct: 'Direct' })[ch] || ch || 'Direct'; }
function dur(s) { s = s || 0; return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
function fmtTime(t) { const d = new Date((t || '').replace(' ', 'T') + 'Z'); return isNaN(d) ? t : d.toLocaleString(); }

function openText(title, text) {
  const o = el('div', { class: 'overlay', onclick: (e) => { if (e.target.classList.contains('overlay')) o.remove(); } }, [
    el('div', { class: 'drawer' }, [el('h3', {}, title), el('p', { class: 'small', style: 'white-space:pre-wrap' }, text),
      el('button', { class: 'btn secondary', onclick: () => o.remove() }, 'Close')])
  ]);
  document.body.append(o);
}

let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2200); }

boot();
