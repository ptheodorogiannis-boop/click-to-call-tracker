'use strict';
// /api/v2: everything the web app needs. Session cookie (or a Bearer ct_ token); every read is scoped by calls.js.
const express = require('express');
const cfg = require('../config');
const { db, q } = require('../db');
const users = require('../users');
const calls = require('../calls');
const { issue, clear, requireUser, requireEdit, requireOwner } = require('../auth');
const { FIXED_SOURCES } = require('../sources');
const ai = require('../services/ai');
const mailer = require('../services/mailer');
const viber = require('../services/viber');
const reports = require('../services/reports');
const webhooks = require('../services/webhooks');
const crypto = require('crypto');

const router = express.Router();
const h = (fn) => (req, res, next) => { try { const r = fn(req, res, next); if (r && r.catch) r.catch(next); } catch (e) { next(e); } };

// ── auth ───────────────────────────────────────────────
// A small brake on password guessing: 10 failures per address per 15 minutes.
const failures = new Map();
function tooMany(ip) {
  const now = Date.now();
  const list = (failures.get(ip) || []).filter((t) => now - t < 15 * 60000);
  failures.set(ip, list);
  return list.length >= 10;
}

router.post('/auth/login', h((req, res) => {
  if (!cfg.admin.sessionSecret) return res.status(500).json({ error: 'SESSION_SECRET is not set on the server' });
  if (tooMany(req.ip)) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  const user = users.login(req.body.login, req.body.password);
  if (!user) { failures.get(req.ip).push(Date.now()); return res.status(401).json({ error: 'Wrong login or password' }); }
  issue(res, user.id);
  res.json({ user });
}));
router.post('/auth/logout', (req, res) => { clear(res); res.json({ ok: true }); });

router.use(requireUser);

router.get('/me', h((req, res) => res.json({
  user: req.user, brand: cfg.brand, public_base_url: cfg.publicBaseUrl,
  clients: calls.visibleClients(req.user).map((k) => ({ id: k.id, name: k.name, active: !!k.active, currency: k.currency })),
  lead_statuses: calls.LEAD_STATUSES,
  fixed_sources: FIXED_SOURCES,
  features: { ai: ai.enabled(), email: mailer.enabled(), viber: viber.enabled() }
})));

router.post('/me/password', h((req, res) => {
  const r = users.changePassword(req.user.id, req.body.current, req.body.next);
  if (r === 'wrong') return res.status(400).json({ error: 'The current password is not right' });
  if (r === 'short') return res.status(400).json({ error: 'The new password needs at least 10 characters' });
  res.json({ ok: true });
}));

// ── reading ────────────────────────────────────────────
router.get('/overview', h((req, res) => res.json(calls.overview(req.user, req.query))));
router.get('/board', h((req, res) => res.json(calls.clientBoard(req.user, req.query))));
router.get('/reports', h((req, res) => res.json(calls.report(req.user, req.query))));
router.get('/reports/calls.csv', h((req, res) => {
  const name = `calls-${req.query.client_id || 'all'}-${calls.range(req.query).since}.csv`;
  res.set('Content-Type', 'text/csv; charset=utf-8').set('Content-Disposition', `attachment; filename="${name}"`);
  res.send('﻿' + calls.toCsv(req.user, { ...calls.range(req.query), ...req.query }));
}));
router.get('/calls', h((req, res) => res.json(calls.listCalls(req.user, req.query))));
router.get('/calls/:sid', h((req, res) => res.json({ call: calls.getCall(req.user, req.params.sid) })));
router.get('/tags', h((req, res) => res.json({ tags: calls.allTags(req.user) })));
router.get('/search', h((req, res) => res.json(calls.search(req.user, req.query.q))));

// Recordings stream through the server with the client's Twilio credentials, after the scope check.
router.get('/calls/:sid/recording', h(async (req, res) => {
  const call = calls.callForRecording(req.user, req.params.sid);
  if (!call.recording_url) return res.status(404).end();
  const k = q.getClient.get(call.client_id) || {};
  const sid = k.twilio_account_sid || cfg.twilio.accountSid;
  const token = k.twilio_auth_token || cfg.twilio.authToken;
  const r = await fetch(call.recording_url + '.mp3', {
    headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64') }
  }).catch(() => null);
  if (!r || !r.ok) return res.status(502).end();
  res.set('Content-Type', 'audio/mpeg').set('Cache-Control', 'private, max-age=3600');
  res.send(Buffer.from(await r.arrayBuffer()));
}));

// ── lead work (owner, member) ──────────────────────────
router.patch('/calls/:sid', requireEdit, h((req, res) =>
  res.json({ call: calls.updateLead(req.user, req.params.sid, req.body) })));
router.post('/calls/:sid/tags', requireEdit, h((req, res) =>
  res.json({ call: calls.tagCall(req.user, req.params.sid, req.body) })));
router.post('/calls/:sid/notes', requireEdit, h((req, res) =>
  res.json({ call: calls.addNote(req.user, req.params.sid, req.body.body) })));
router.post('/calls/:sid/called-back', requireEdit, h((req, res) =>
  res.json({ call: calls.markCalledBack(req.user, req.params.sid, req.body.done !== false) })));

// ── clients, numbers (owner, member) ───────────────────
const mask = (s) => (s ? '••••' + String(s).slice(-4) : '');
const safeJson = (s) => { try { return JSON.parse(s || '{}'); } catch (e) { return {}; } };
function clientForEditor(c) {
  const conf = safeJson(c.config_json);
  return {
    id: c.id, name: c.name, forward_number: c.forward_number, active: !!c.active,
    recording_enabled: !!c.recording_enabled, qualified_duration_sec: c.qualified_duration_sec,
    lead_value: c.lead_value, currency: c.currency, consent_message: c.consent_message,
    twilio_account_sid: c.twilio_account_sid || '', twilio_auth_token_masked: mask(c.twilio_auth_token),
    alert_missed: !!c.alert_missed, alert_emails: c.alert_emails || '', alert_slack_url_masked: mask(c.alert_slack_url),
    report_schedule: c.report_schedule || 'off', report_emails: c.report_emails || '', report_next_at: c.report_next_at || null,
    config: {
      googleAds: conf.googleAds || {},
      meta: { pixelId: (conf.meta || {}).pixelId || '', capiToken_masked: mask((conf.meta || {}).capiToken), testEventCode: (conf.meta || {}).testEventCode || '' },
      ga4: { measurementId: (conf.ga4 || {}).measurementId || '', apiSecret_masked: mask((conf.ga4 || {}).apiSecret) }
    }
  };
}

router.get('/clients/:id', requireEdit, h((req, res) => {
  const c = q.getClient.get(req.params.id);
  if (!c) return res.status(404).json({ error: 'not found' });
  const portalUsers = db.prepare(`SELECT u.id, u.login, u.name, u.active FROM user_clients uc JOIN users u ON u.id = uc.user_id
    WHERE uc.client_id = ? ORDER BY u.name`).all(c.id);
  res.json({ client: clientForEditor(c), numbers: q.listNumbers.all(c.id), portal_users: portalUsers });
}));

// Create or update. Secrets keep their stored value when sent blank or masked.
router.post('/clients', requireEdit, h((req, res) => {
  const b = req.body || {};
  if (!/^[a-z0-9][a-z0-9-]{1,48}$/.test(b.id || '')) return res.status(400).json({ error: 'id: 2–49 lowercase letters, digits or dashes' });
  if (!b.name || !b.forward_number) return res.status(400).json({ error: 'name and forward number are required' });
  const existing = q.getClient.get(b.id);
  const prev = existing ? safeJson(existing.config_json) : {};
  const keep = (incoming, old) => (incoming && !String(incoming).includes('••••') ? incoming : (old || null));
  const pick = (group, key) => ((b[group] || {})[key] !== undefined ? b[group][key] : (prev[group] || {})[key]) || '';
  const config = {
    googleAds: { customerId: pick('googleAds', 'customerId'), conversionActionId: pick('googleAds', 'conversionActionId') },
    meta: { pixelId: pick('meta', 'pixelId'), capiToken: keep((b.meta || {}).capiToken, (prev.meta || {}).capiToken), testEventCode: pick('meta', 'testEventCode') },
    ga4: { measurementId: pick('ga4', 'measurementId'), apiSecret: keep((b.ga4 || {}).apiSecret, (prev.ga4 || {}).apiSecret) }
  };
  q.upsertClient.run({
    id: b.id, name: b.name, forward_number: b.forward_number,
    consent_message: b.consent_message || null,
    recording_enabled: b.recording_enabled === false ? 0 : 1,
    qualified_duration_sec: b.qualified_duration_sec ? parseInt(b.qualified_duration_sec, 10) : null,
    lead_value: b.lead_value != null && b.lead_value !== '' ? Number(b.lead_value) : 0,
    currency: b.currency || 'EUR',
    active: b.active === false ? 0 : 1,
    twilio_account_sid: b.twilio_account_sid || (existing && existing.twilio_account_sid) || null,
    twilio_auth_token: keep(b.twilio_auth_token, existing && existing.twilio_auth_token),
    config_json: JSON.stringify(config)
  });
  // Alerts and reports: only the fields that were sent change.
  if (b.alert_missed !== undefined || b.alert_emails !== undefined || b.alert_slack_url !== undefined) {
    const slack = keep(b.alert_slack_url, existing && existing.alert_slack_url);
    // https only, except a receiver on this machine while testing
    if (slack && !/^https:\/\//.test(slack) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(slack)) return res.status(400).json({ error: 'The Slack address must start with https://' });
    db.prepare('UPDATE clients SET alert_missed = ?, alert_emails = ?, alert_slack_url = ? WHERE id = ?').run(
      b.alert_missed === undefined ? (existing ? existing.alert_missed : 0) : (b.alert_missed ? 1 : 0),
      b.alert_emails === undefined ? (existing && existing.alert_emails) || null : mailer.parseEmails(b.alert_emails).join(', ') || null,
      b.alert_slack_url === '' ? null : slack, b.id);
  }
  if (b.report_emails !== undefined) db.prepare('UPDATE clients SET report_emails = ? WHERE id = ?').run(mailer.parseEmails(b.report_emails).join(', ') || null, b.id);
  if (b.report_schedule !== undefined) {
    if (!reports.SCHEDULES.includes(b.report_schedule)) return res.status(400).json({ error: 'report_schedule is off, weekly or monthly' });
    if (!existing || existing.report_schedule !== b.report_schedule) reports.schedule(b.id, b.report_schedule);
  }
  res.json({ client: clientForEditor(q.getClient.get(b.id)) });
}));

router.post('/clients/:id/report/send', requireEdit, h(async (req, res) => {
  const k = q.getClient.get(req.params.id);
  if (!k) return res.status(404).json({ error: 'not found' });
  const r = await reports.sendReport(k.id, reports.periodFor(k.report_schedule === 'monthly' ? 'monthly' : 'weekly'));
  if (r.skipped) return res.status(400).json({ error: r.skipped });
  res.json({ ok: true });
}));

router.post('/clients/:id/alerts/test', requireEdit, h(async (req, res) => {
  const k = q.getClient.get(req.params.id);
  if (!k) return res.status(404).json({ error: 'not found' });
  const text = `Test alert for ${k.name}: missed calls will arrive here.`;
  const sent = [];
  if (k.alert_slack_url) {
    const r = await fetch(k.alert_slack_url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(10000) }).catch((e) => ({ ok: false, status: e.message }));
    if (!r.ok) return res.status(502).json({ error: `Slack did not accept it (${r.status})` });
    sent.push('Slack');
  }
  const to = mailer.parseEmails(k.alert_emails);
  if (to.length) {
    const r = await mailer.send({ to, subject: `Test alert: ${k.name}`, text });
    if (r.skipped) return res.status(400).json({ error: r.skipped });
    sent.push('email');
  }
  if (viber.enabled() && viber.subscribers(k.id).length) {
    const n = await viber.alert(k.id, text);
    if (!n) return res.status(502).json({ error: 'Viber did not deliver it' });
    sent.push('Viber');
  }
  if (!sent.length) return res.status(400).json({ error: 'Add a Slack address, an email or a Viber contact first' });
  res.json({ ok: true, sent });
}));

// ── Viber contacts for a client's alerts ───────────────
router.get('/clients/:id/viber', requireEdit, h((req, res) => {
  if (!q.getClient.get(req.params.id)) return res.status(404).json({ error: 'not found' });
  res.json({ enabled: viber.enabled(), bot_uri: process.env.VIBER_BOT_URI || null, subscribers: viber.subscribers(req.params.id) });
}));
router.post('/clients/:id/viber/link', requireEdit, h((req, res) => {
  if (!viber.enabled()) return res.status(400).json({ error: 'Viber is not set up on this server (VIBER_AUTH_TOKEN)' });
  if (!q.getClient.get(req.params.id)) return res.status(404).json({ error: 'not found' });
  res.json(viber.linkCode(req.params.id));
}));
router.delete('/clients/:id/viber/:viberId', requireEdit, h((req, res) =>
  res.json({ ok: viber.removeSubscriber(req.params.id, req.params.viberId) })));

// ── block list ─────────────────────────────────────────
router.get('/clients/:id/blocked', requireEdit, h((req, res) => res.json({ blocked: calls.listBlocked(req.user, req.params.id) })));
router.post('/clients/:id/blocked', requireEdit, h((req, res) =>
  res.json({ blocked: calls.addBlocked(req.user, req.params.id, req.body.pattern, req.body.note) })));
router.delete('/clients/:id/blocked/:pattern', requireEdit, h((req, res) =>
  res.json({ blocked: calls.removeBlocked(req.user, req.params.id, req.params.pattern) })));

// Block this call's caller for its client, and mark the call spam.
router.post('/calls/:sid/block', requireEdit, h((req, res) => {
  const c = calls.getCall(req.user, req.params.sid);
  if (!c.caller) return res.status(400).json({ error: 'This caller hid their number' });
  calls.addBlocked(req.user, c.client_id, c.caller, req.body.note || 'Blocked from a call');
  res.json({ call: calls.updateLead(req.user, c.call_sid, { lead_status: 'spam' }) });
}));

router.post('/calls/:sid/summarize', requireEdit, h(async (req, res) => {
  calls.getCall(req.user, req.params.sid);
  const r = await ai.summarise(req.params.sid);
  if (r.skipped) return res.status(400).json({ error: r.skipped });
  res.json({ call: calls.getCall(req.user, req.params.sid), reason: r.reason });
}));

// ── outbound webhooks (owner, member) ──────────────────
const publicHook = (w) => ({ id: w.id, client_id: w.client_id, url: w.url, events: w.events.split(','), active: !!w.active, created_at: w.created_at, last_status: w.last_status, last_at: w.last_at, failures: w.failures });
router.get('/webhooks', requireEdit, h((req, res) =>
  res.json({ webhooks: db.prepare('SELECT * FROM webhooks ORDER BY created_at DESC').all().map(publicHook) })));
router.post('/webhooks', requireEdit, h((req, res) => {
  const url = String(req.body.url || '').trim();
  if (!/^https?:\/\/[^\s]+$/.test(url)) return res.status(400).json({ error: 'A full address, like https://hooks.example.com/calls' });
  const clientId = req.body.client_id || null;
  if (clientId && !q.getClient.get(clientId)) return res.status(404).json({ error: 'unknown client' });
  const ev = [].concat(req.body.events || ['call.completed', 'call.updated']).filter((e) => ['call.completed', 'call.updated'].includes(e));
  if (!ev.length) return res.status(400).json({ error: 'Pick at least one event' });
  const secret = 'whsec_' + crypto.randomBytes(24).toString('base64url');
  const r = db.prepare('INSERT INTO webhooks (client_id, url, secret, events) VALUES (?, ?, ?, ?)').run(clientId, url, secret, ev.join(','));
  res.json({ webhook: publicHook(db.prepare('SELECT * FROM webhooks WHERE id = ?').get(r.lastInsertRowid)), secret });
}));
router.delete('/webhooks/:id', requireEdit, h((req, res) => {
  db.prepare('DELETE FROM webhooks WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
}));
// Send the newest call (of the webhook's client, or any) to this webhook now.
router.post('/webhooks/:id/test', requireEdit, h(async (req, res) => {
  const w = db.prepare('SELECT * FROM webhooks WHERE id = ?').get(req.params.id);
  if (!w) return res.status(404).json({ error: 'not found' });
  const latest = calls.listCalls(req.user, { client_id: w.client_id || undefined, limit: 1 }).calls[0];
  if (!latest) return res.status(400).json({ error: 'There is no call to send yet' });
  const ok = await webhooks.deliver({ ...w }, 'call.completed', calls.getCall(req.user, latest.call_sid));
  const after = db.prepare('SELECT * FROM webhooks WHERE id = ?').get(w.id);
  res.status(ok ? 200 : 502).json({ ok, webhook: publicHook(after) });
}));

// Clients with call history are switched off, never deleted, so reports stay whole.
router.delete('/clients/:id', requireOwner, h((req, res) => {
  const n = db.prepare('SELECT COUNT(*) n FROM calls WHERE client_id = ?').get(req.params.id).n;
  if (n) return res.status(409).json({ error: `This client has ${n} calls. Switch it off instead of deleting it.` });
  db.transaction(() => {
    db.prepare('DELETE FROM numbers WHERE client_id = ?').run(req.params.id);
    db.prepare('DELETE FROM sessions WHERE client_id = ?').run(req.params.id);
    q.deleteClient.run(req.params.id);
  })();
  res.json({ ok: true });
}));

router.post('/clients/:id/numbers', requireEdit, h((req, res) => {
  const phone = String(req.body.phone || '').replace(/[^\d+]/g, '');
  if (!/^\+\d{8,15}$/.test(phone)) return res.status(400).json({ error: 'Number in international format, like +302101234567' });
  if (!q.getClient.get(req.params.id)) return res.status(404).json({ error: 'not found' });
  const fixed = req.body.kind === 'fixed';
  if (fixed && !FIXED_SOURCES[req.body.source]) return res.status(400).json({ error: 'Pick where this number is published' });
  q.upsertNumber.run({ phone, client_id: req.params.id, label: req.body.label || null, kind: fixed ? 'fixed' : 'pool', source: fixed ? req.body.source : null });
  res.json({ numbers: q.listNumbers.all(req.params.id) });
}));
router.delete('/numbers/:phone', requireEdit, h((req, res) => {
  q.deleteNumber.run(req.params.phone);
  res.json({ ok: true });
}));

// ── team and portal users (owner) ──────────────────────
router.get('/users', requireOwner, h((req, res) => res.json({ users: users.listUsers() })));
router.post('/users', requireOwner, h((req, res) => {
  try { res.json({ user: users.createUser(req.body || {}) }); }
  catch (e) {
    if (/UNIQUE/.test(e.message)) return res.status(409).json({ error: 'That login is already used' });
    res.status(400).json({ error: e.message });
  }
}));
router.patch('/users/:id', requireOwner, h((req, res) => {
  const id = parseInt(req.params.id, 10);
  if (id === req.user.id && (req.body.role && req.body.role !== 'owner' || req.body.active === false)) {
    return res.status(400).json({ error: 'You cannot demote or switch off your own account' });
  }
  try {
    const u = users.updateUser(id, req.body || {});
    if (!u) return res.status(404).json({ error: 'not found' });
    res.json({ user: u });
  } catch (e) { res.status(400).json({ error: e.message }); }
}));

// ── own API tokens (any role) ──────────────────────────
router.get('/tokens', h((req, res) => res.json({ tokens: users.listTokens(req.user.id) })));
router.post('/tokens', h((req, res) => {
  const t = users.createToken(req.user.id, req.body.name);
  res.json({ id: t.id, token: t.token, mcp_url: (cfg.publicBaseUrl || '') + '/mcp' });
}));
router.delete('/tokens/:id', h((req, res) =>
  res.json({ ok: users.revokeToken(req.user.id, parseInt(req.params.id, 10)) })));

module.exports = router;
