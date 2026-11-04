'use strict';
// Every read and lead-level write the web app, the report API and MCP make, filtered by the user's client scope.
// Anything outside scope behaves as if it did not exist.
const { db } = require('./db');
const { clientIdsFor, canSeeClient, canEdit } = require('./users');
const { REGIONS } = require('./geo');

const LEAD_STATUSES = ['new', 'good', 'not_lead', 'customer', 'spam'];
const AD_CHANNELS = ['google_ads', 'meta_ads', 'microsoft_ads', 'other_paid'];

// A call counts as a lead when someone marked it good/customer, or nobody judged it and it qualified on duration.
const LEAD = `(CASE WHEN c.lead_status IN ('good','customer') THEN 1 WHEN c.lead_status IN ('not_lead','spam') THEN 0 ELSE c.qualified END)`;
const VALUE = `(CASE WHEN ${LEAD} = 1 THEN COALESCE(c.value, k.lead_value, 0) ELSE 0 END)`;
const MISSED = `(CASE WHEN c.answered = 0 AND c.status != 'ringing' THEN 1 ELSE 0 END)`;
const TO_CALL_BACK = `(c.answered = 0 AND c.status != 'ringing' AND c.caller IS NOT NULL AND c.called_back_at IS NULL
  AND c.lead_status NOT IN ('spam','not_lead') AND c.started_at >= datetime('now','-14 days')
  AND NOT EXISTS (SELECT 1 FROM calls l WHERE l.client_id = c.client_id AND l.caller = c.caller
                  AND l.answered = 1 AND l.started_at > c.started_at))`;
const FROM = 'FROM calls c JOIN clients k ON k.id = c.client_id';

class NotFound extends Error { constructor() { super('not found'); this.status = 404; } }
class Forbidden extends Error { constructor() { super('forbidden'); this.status = 403; } }
class Invalid extends Error { constructor(m) { super(m); this.status = 400; } }

// ── where-clause builder ───────────────────────────────
function where(user, f = {}) {
  const parts = [];
  const params = [];
  const ids = clientIdsFor(user);
  if (ids !== null) {
    if (!ids.length) parts.push('0');
    else { parts.push(`c.client_id IN (${ids.map(() => '?').join(',')})`); params.push(...ids); }
  }
  if (f.client_id) { parts.push('c.client_id = ?'); params.push(f.client_id); }
  if (f.since) { parts.push('c.started_at >= ?'); params.push(f.since + ' 00:00:00'); }
  if (f.until) { parts.push("c.started_at < datetime(?, '+1 day')"); params.push(f.until); }
  if (f.status === 'answered') parts.push('c.answered = 1');
  if (f.status === 'missed') parts.push(MISSED + ' = 1');
  if (f.status === 'to_call_back') parts.push(TO_CALL_BACK);
  if (f.channel) { parts.push('c.channel = ?'); params.push(f.channel); }
  if (f.lead_status) { parts.push('c.lead_status = ?'); params.push(f.lead_status); }
  if (f.leads_only) parts.push(LEAD + ' = 1');
  if (f.tag) { parts.push('EXISTS (SELECT 1 FROM call_tags t WHERE t.call_sid = c.call_sid AND t.tag = ?)'); params.push(f.tag); }
  if (f.q) {
    const like = '%' + String(f.q).trim().replace(/[\\%_]/g, (m) => '\\' + m) + '%';
    parts.push(`(c.caller LIKE ? ESCAPE '\\' OR c.utm_campaign LIKE ? ESCAPE '\\' OR c.utm_term LIKE ? ESCAPE '\\'
      OR c.transcript LIKE ? ESCAPE '\\' OR c.landing_page LIKE ? ESCAPE '\\' OR k.name LIKE ? ESCAPE '\\'
      OR EXISTS (SELECT 1 FROM call_notes n WHERE n.call_sid = c.call_sid AND n.body LIKE ? ESCAPE '\\'))`);
    params.push(like, like, like, like, like, like, like);
  }
  return { sql: parts.length ? 'WHERE ' + parts.join(' AND ') : '', params };
}

// ── dates ──────────────────────────────────────────────
const day = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return day(d); };
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

// The period asked for plus the one before it, the same length, for change figures.
function range({ since, until, days } = {}) {
  const u = isDate(until) ? until : day(new Date());
  const n = Math.min(Math.max(parseInt(days, 10) || 30, 1), 730);
  const s = isDate(since) ? since : addDays(u, -(n - 1));
  if (s > u) throw new Invalid('since is after until');
  const len = Math.round((Date.parse(u) - Date.parse(s)) / 86400000) + 1;
  return { since: s, until: u, days: len, prev_since: addDays(s, -len), prev_until: addDays(s, -1) };
}
function eachDay(since, until) { const out = []; for (let d = since; d <= until; d = addDays(d, 1)) out.push(d); return out; }

// ── aggregates ─────────────────────────────────────────
function totals(user, f) {
  const w = where(user, f);
  const r = db.prepare(`SELECT COUNT(*) calls, COALESCE(SUM(c.answered),0) answered, COALESCE(SUM(${MISSED}),0) missed,
      COALESCE(SUM(${LEAD}),0) leads, COALESCE(SUM(CASE WHEN c.first_time = 1 THEN 1 ELSE 0 END),0) first_time,
      COALESCE(SUM(${VALUE}),0) value,
      COALESCE(ROUND(AVG(CASE WHEN c.answered = 1 THEN c.duration_sec END)),0) avg_duration
    ${FROM} ${w.sql}`).get(...w.params);
  r.answer_rate = r.calls ? r.answered / r.calls : null;
  return r;
}

function daily(user, f) {
  const w = where(user, f);
  const rows = db.prepare(`SELECT substr(c.started_at,1,10) d, COUNT(*) calls, SUM(${MISSED}) missed,
      SUM(${LEAD}) leads, SUM(CASE WHEN c.first_time = 1 THEN 1 ELSE 0 END) first_time
    ${FROM} ${w.sql} GROUP BY d`).all(...w.params);
  const by = new Map(rows.map((r) => [r.d, r]));
  return eachDay(f.since, f.until).map((d) => {
    const r = by.get(d);
    return { date: d, calls: r ? r.calls : 0, missed: r ? r.missed : 0, leads: r ? r.leads : 0, first_time: r ? r.first_time : 0 };
  });
}

function byChannel(user, f) {
  const w = where(user, f);
  return db.prepare(`SELECT COALESCE(c.channel,'direct') channel, COUNT(*) calls, SUM(c.answered) answered,
      SUM(${MISSED}) missed, SUM(${LEAD}) leads, SUM(${VALUE}) value
    ${FROM} ${w.sql} GROUP BY 1 ORDER BY calls DESC`).all(...w.params);
}

function byCampaign(user, f) {
  const w = where(user, f);
  return db.prepare(`SELECT COALESCE(NULLIF(c.utm_campaign,''),'(none)') campaign, COALESCE(c.channel,'direct') channel,
      COUNT(*) calls, SUM(c.answered) answered, SUM(${LEAD}) leads, SUM(${VALUE}) value
    ${FROM} ${w.sql} GROUP BY 1,2 ORDER BY calls DESC LIMIT 50`).all(...w.params);
}

function byKeyword(user, f) {
  const w = where(user, f);
  return db.prepare(`SELECT c.utm_term keyword, COUNT(*) calls, SUM(c.answered) answered, SUM(${LEAD}) leads
    ${FROM} ${w.sql ? w.sql + ' AND' : 'WHERE'} c.utm_term IS NOT NULL AND c.utm_term != ''
    GROUP BY 1 ORDER BY calls DESC LIMIT 25`).all(...w.params);
}

function byRegion(user, f) {
  const w = where(user, f);
  const rows = db.prepare(`SELECT c.region region, COUNT(*) calls, SUM(${LEAD}) leads
    ${FROM} ${w.sql} GROUP BY 1`).all(...w.params);
  const out = { regions: [], mobile: 0, unknown: 0 };
  for (const r of rows) {
    if (r.region === 'mobile') out.mobile = r.calls;
    else if (r.region && REGIONS[r.region]) out.regions.push({ region: r.region, name: REGIONS[r.region].en, name_el: REGIONS[r.region].el, calls: r.calls, leads: r.leads });
    else out.unknown += r.calls;
  }
  out.regions.sort((a, b) => b.calls - a.calls);
  return out;
}

function monthly(user, f, months = 12) {
  const end = f.until.slice(0, 7);
  const list = [];
  const d = new Date(end + '-01T00:00:00Z');
  for (let i = months - 1; i >= 0; i--) {
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    list.push(m.toISOString().slice(0, 7));
  }
  const w = where(user, { ...f, since: list[0] + '-01', until: f.until });
  const rows = db.prepare(`SELECT substr(c.started_at,1,7) m, COUNT(*) calls, SUM(c.answered) answered, SUM(${LEAD}) leads
    ${FROM} ${w.sql} GROUP BY m`).all(...w.params);
  const by = new Map(rows.map((r) => [r.m, r]));
  return list.map((m) => {
    const r = by.get(m) || { calls: 0, answered: 0, leads: 0 };
    return { month: m, calls: r.calls, answered: r.answered, leads: r.leads, answer_rate: r.calls ? r.answered / r.calls : null };
  });
}

function toCallBack(user, f) {
  const w = where(user, { client_id: f.client_id, status: 'to_call_back' });
  const r = db.prepare(`SELECT COUNT(*) n, SUM(CASE WHEN c.channel IN (${AD_CHANNELS.map(() => '?').join(',')}) THEN 1 ELSE 0 END) ads
    ${FROM} ${w.sql}`).get(...AD_CHANNELS, ...w.params);
  return { count: r.n, from_ads: r.ads || 0 };
}

// ── pages ──────────────────────────────────────────────
function scopedClient(user, clientId) {
  if (!clientId) return null;
  if (!canSeeClient(user, clientId)) throw new NotFound();
  const k = db.prepare('SELECT id, name, currency, lead_value FROM clients WHERE id = ?').get(clientId);
  if (!k) throw new NotFound();
  return k;
}

function visibleClients(user) {
  const ids = clientIdsFor(user);
  const all = db.prepare('SELECT id, name, active, currency, lead_value, forward_number FROM clients ORDER BY name').all();
  return ids === null ? all : all.filter((k) => ids.includes(k.id));
}

function overview(user, q = {}) {
  const client = scopedClient(user, q.client_id);
  const r = range(q);
  const f = { client_id: client && client.id, since: r.since, until: r.until };
  const prev = { ...f, since: r.prev_since, until: r.prev_until };
  return {
    range: r, client,
    totals: totals(user, f), previous: totals(user, prev),
    daily: daily(user, f),
    by_client: clientBoard(user, q).clients,
    by_channel: byChannel(user, f),
    geo: byRegion(user, f),
    to_call_back: toCallBack(user, f)
  };
}

// One row per visible client with a daily trend, problems first.
function clientBoard(user, q = {}) {
  const r = range(q);
  const rows = visibleClients(user).filter((k) => !q.client_id || k.id === q.client_id).map((k) => {
    const f = { client_id: k.id, since: r.since, until: r.until };
    const t = totals(user, f);
    const p = totals(user, { ...f, since: r.prev_since, until: r.prev_until });
    const cb = toCallBack(user, f);
    const flags = [];
    if (t.calls >= 5 && t.answer_rate < 0.7) flags.push('answer_rate');
    if (cb.count > 0) flags.push('call_back');
    if (p.calls >= 5 && t.calls < p.calls * 0.6) flags.push('calls_down');
    return {
      id: k.id, name: k.name, active: !!k.active, currency: k.currency,
      ...t, previous: { calls: p.calls, leads: p.leads, answer_rate: p.answer_rate },
      to_call_back: cb.count, flags,
      trend: daily(user, f).map((d) => d.calls),
      numbers: db.prepare('SELECT COUNT(*) n FROM numbers WHERE client_id = ? AND active = 1').get(k.id).n
    };
  });
  rows.sort((a, b) => b.flags.length - a.flags.length || b.calls - a.calls || a.name.localeCompare(b.name));
  return { range: r, clients: rows };
}

function report(user, q = {}) {
  const client = scopedClient(user, q.client_id);
  const r = range(q);
  const f = { client_id: client && client.id, since: r.since, until: r.until };
  const t = totals(user, f);
  return {
    range: r, client, totals: t, previous: totals(user, { ...f, since: r.prev_since, until: r.prev_until }),
    daily: daily(user, f), monthly: monthly(user, f),
    by_channel: byChannel(user, f), by_campaign: byCampaign(user, f), by_keyword: byKeyword(user, f),
    callers: { first_time: t.first_time, repeat: t.calls - t.first_time },
    geo: byRegion(user, f)
  };
}

const CALL_COLUMNS = `c.call_sid, c.client_id, k.name client_name, c.tracking_number, c.caller, c.started_at, c.answered,
  c.status, c.duration_sec, c.qualified, c.first_time, c.channel, c.utm_source, c.utm_medium, c.utm_campaign,
  c.utm_content, c.utm_term, c.landing_page, c.referrer, c.gclid, c.fbclid, c.msclkid, c.region, c.lead_status,
  c.value, k.lead_value default_value, k.currency, c.called_back_at, c.conv_google, c.conv_meta, c.conv_ga4,
  (c.recording_url IS NOT NULL) has_recording, (c.transcript IS NOT NULL AND c.transcript != '') has_transcript,
  ${LEAD} is_lead, ${TO_CALL_BACK} to_call_back`;

function tagsFor(sids) {
  if (!sids.length) return new Map();
  const rows = db.prepare(`SELECT call_sid, tag FROM call_tags WHERE call_sid IN (${sids.map(() => '?').join(',')}) ORDER BY tag`).all(...sids);
  const m = new Map();
  for (const r of rows) { if (!m.has(r.call_sid)) m.set(r.call_sid, []); m.get(r.call_sid).push(r.tag); }
  return m;
}

function listCalls(user, q = {}) {
  if (q.client_id) scopedClient(user, q.client_id);
  const f = {
    client_id: q.client_id, since: isDate(q.since) ? q.since : null, until: isDate(q.until) ? q.until : null,
    status: q.status, channel: q.channel, lead_status: q.lead_status, tag: q.tag, q: q.q, leads_only: q.leads_only
  };
  const w = where(user, f);
  const limit = Math.min(Math.max(parseInt(q.limit, 10) || 50, 1), 500);
  const offset = Math.max(parseInt(q.offset, 10) || 0, 0);
  const total = db.prepare(`SELECT COUNT(*) n ${FROM} ${w.sql}`).get(...w.params).n;
  const calls = db.prepare(`SELECT ${CALL_COLUMNS} ${FROM} ${w.sql} ORDER BY c.started_at DESC LIMIT ? OFFSET ?`)
    .all(...w.params, limit, offset);
  const tags = tagsFor(calls.map((c) => c.call_sid));
  for (const c of calls) shape(c, tags.get(c.call_sid));
  return { total, limit, offset, calls };
}

function shape(c, tags) {
  c.answered = !!c.answered; c.qualified = !!c.qualified; c.is_lead = !!c.is_lead; c.to_call_back = !!c.to_call_back;
  c.has_recording = !!c.has_recording; c.has_transcript = !!c.has_transcript;
  c.first_time = c.first_time == null ? null : !!c.first_time;
  c.value_effective = c.is_lead ? (c.value ?? c.default_value ?? 0) : 0;
  c.region_name = c.region && REGIONS[c.region] ? REGIONS[c.region].en : c.region === 'mobile' ? 'Mobile' : null;
  c.tags = tags || [];
  return c;
}

function getCall(user, sid) {
  const c = db.prepare(`SELECT ${CALL_COLUMNS}, c.transcript ${FROM} WHERE c.call_sid = ?`).get(sid);
  if (!c || !canSeeClient(user, c.client_id)) throw new NotFound();
  shape(c, tagsFor([sid]).get(sid));
  c.notes = db.prepare(`SELECT n.id, n.body, n.created_at, u.name author FROM call_notes n
    LEFT JOIN users u ON u.id = n.user_id WHERE n.call_sid = ? ORDER BY n.created_at, n.id`).all(sid);
  return c;
}

// The raw row (with recording_url) for the recording proxy, after the same scope check.
function callForRecording(user, sid) {
  const c = db.prepare('SELECT call_sid, client_id, recording_url FROM calls WHERE call_sid = ?').get(sid);
  if (!c || !canSeeClient(user, c.client_id)) throw new NotFound();
  return c;
}

// ── lead-level writes (owner/member only) ──────────────
function editable(user, sid) {
  const c = db.prepare('SELECT call_sid, client_id FROM calls WHERE call_sid = ?').get(sid);
  if (!c || !canSeeClient(user, c.client_id)) throw new NotFound();
  if (!canEdit(user)) throw new Forbidden();
  return c;
}

function updateLead(user, sid, { lead_status, value } = {}) {
  editable(user, sid);
  if (lead_status !== undefined && !LEAD_STATUSES.includes(lead_status)) throw new Invalid('lead_status must be one of ' + LEAD_STATUSES.join(', '));
  if (value !== undefined && value !== null && !(Number.isFinite(Number(value)) && Number(value) >= 0)) throw new Invalid('value must be a number ≥ 0');
  if (lead_status !== undefined) db.prepare('UPDATE calls SET lead_status = ? WHERE call_sid = ?').run(lead_status, sid);
  if (value !== undefined) db.prepare('UPDATE calls SET value = ? WHERE call_sid = ?').run(value === null ? null : Number(value), sid);
  return getCall(user, sid);
}

const cleanTag = (t) => String(t || '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 40);
function tagCall(user, sid, { add = [], remove = [] } = {}) {
  editable(user, sid);
  db.transaction(() => {
    for (const t of [].concat(add).map(cleanTag).filter(Boolean)) db.prepare('INSERT OR IGNORE INTO call_tags (call_sid, tag) VALUES (?, ?)').run(sid, t);
    for (const t of [].concat(remove).map(cleanTag).filter(Boolean)) db.prepare('DELETE FROM call_tags WHERE call_sid = ? AND tag = ?').run(sid, t);
  })();
  return getCall(user, sid);
}

function addNote(user, sid, body) {
  editable(user, sid);
  const text = String(body || '').trim();
  if (!text) throw new Invalid('note text is required');
  db.prepare('INSERT INTO call_notes (call_sid, user_id, body) VALUES (?, ?, ?)').run(sid, user.id, text.slice(0, 4000));
  return getCall(user, sid);
}

function markCalledBack(user, sid, done = true) {
  editable(user, sid);
  if (done) db.prepare("UPDATE calls SET called_back_at = datetime('now'), called_back_by = ? WHERE call_sid = ?").run(user.id, sid);
  else db.prepare('UPDATE calls SET called_back_at = NULL, called_back_by = NULL WHERE call_sid = ?').run(sid);
  return getCall(user, sid);
}

function allTags(user) {
  const w = where(user, {});
  return db.prepare(`SELECT t.tag, COUNT(*) n FROM call_tags t JOIN calls c ON c.call_sid = t.call_sid
    JOIN clients k ON k.id = c.client_id ${w.sql} GROUP BY t.tag ORDER BY n DESC, t.tag LIMIT 100`).all(...w.params);
}

function search(user, text) {
  const s = String(text || '').trim();
  if (!s) return { clients: [], calls: [] };
  const fold = (v) => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const needle = fold(s);
  return {
    clients: visibleClients(user).filter((k) => fold(k.name).includes(needle) || fold(k.id).includes(needle)).slice(0, 8),
    calls: listCalls(user, { q: s, limit: 8 }).calls
  };
}

// The whole period, no row cap (an export that silently stops is worse than none). Tags come in the same query.
function toCsv(user, q = {}) {
  if (q.client_id) scopedClient(user, q.client_id);
  const w = where(user, {
    client_id: q.client_id, since: isDate(q.since) ? q.since : null, until: isDate(q.until) ? q.until : null,
    status: q.status, channel: q.channel, lead_status: q.lead_status, tag: q.tag, q: q.q
  });
  const cols = ['started_at', 'client_name', 'caller', 'status', 'duration_sec', 'channel', 'utm_source', 'utm_medium',
    'utm_campaign', 'utm_term', 'landing_page', 'region_name', 'first_time', 'lead_status', 'is_lead', 'value_effective', 'tags'];
  const cell = (v) => {
    const t = Array.isArray(v) ? v.join('; ') : v == null ? '' : String(v);
    return /[",\n;]/.test(t) || /^[=+\-@]/.test(t) ? '"' + t.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""') + '"' : t;
  };
  const out = [cols.join(',')];
  const stmt = db.prepare(`SELECT ${CALL_COLUMNS},
      (SELECT GROUP_CONCAT(t.tag, '; ') FROM call_tags t WHERE t.call_sid = c.call_sid) tag_list
    ${FROM} ${w.sql} ORDER BY c.started_at DESC`);
  for (const r of stmt.all(...w.params)) {
    shape(r, r.tag_list ? r.tag_list.split('; ') : []);
    out.push(cols.map((c) => cell(r[c])).join(','));
  }
  return out.join('\n');
}

module.exports = {
  LEAD_STATUSES, NotFound, Forbidden, Invalid, range, visibleClients, scopedClient, overview, clientBoard, report,
  listCalls, getCall, callForRecording, updateLead, tagCall, addNote, markCalledBack, allTags, search, toCsv,
  totals, byChannel
};
