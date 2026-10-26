'use strict';
const express = require('express');
const cfg = require('../config');
const { q } = require('../db');
const { issue, clear, requireAuth, checkLogin } = require('../auth');

const router = express.Router();

// ── auth ───────────────────────────────────────────────
router.post('/login', (req, res) => {
  const r = checkLogin(req.body.user, req.body.password);
  if (r === 'not_configured') return res.status(500).json({ error: 'ADMIN_PASSWORD / SESSION_SECRET not set' });
  if (r !== 'ok') return res.status(401).json({ error: 'invalid credentials' });
  issue(res, req.body.user);
  res.json({ ok: true });
});
router.post('/logout', (req, res) => { clear(res); res.json({ ok: true }); });
router.get('/me', requireAuth, (req, res) =>
  res.json({ user: req.adminUser, brand: cfg.brand, publicBaseUrl: cfg.publicBaseUrl }));

// everything below requires auth
router.use(requireAuth);

// ── helpers ────────────────────────────────────────────
const mask = (s) => (s ? '••••' + String(s).slice(-4) : '');
function safeJson(s) { try { return JSON.parse(s || '{}'); } catch (e) { return {}; } }
function publicClient(c) {
  const conf = safeJson(c.config_json);
  return {
    id: c.id, name: c.name, forward_number: c.forward_number, active: c.active,
    recording_enabled: c.recording_enabled, qualified_duration_sec: c.qualified_duration_sec,
    lead_value: c.lead_value, currency: c.currency, consent_message: c.consent_message,
    twilio_account_sid: c.twilio_account_sid || '',
    twilio_auth_token_masked: mask(c.twilio_auth_token),
    config: {
      googleAds: conf.googleAds || {},
      meta: { pixelId: (conf.meta || {}).pixelId || '', capiToken_masked: mask((conf.meta || {}).capiToken), testEventCode: (conf.meta || {}).testEventCode || '' },
      ga4: { measurementId: (conf.ga4 || {}).measurementId || '', apiSecret_masked: mask((conf.ga4 || {}).apiSecret) }
    }
  };
}
function sinceParam(req) {
  const d = req.query.since || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  return String(d).slice(0, 10) + ' 00:00:00';
}

// ── clients ────────────────────────────────────────────
router.get('/clients', (req, res) => {
  const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10) + ' 00:00:00';
  const rows = q.listClients.all().map((c) => {
    const stats = q.statsByChannel.all(c.id, since)
      .reduce((t, r) => ({ total: t.total + r.total, answered: t.answered + r.answered, qualified: t.qualified + r.qualified }), { total: 0, answered: 0, qualified: 0 });
    return { ...publicClient(c), numbers: q.countNumbers.get(c.id).n, last30: stats };
  });
  res.json({ clients: rows });
});

router.get('/clients/:id', (req, res) => {
  const c = q.getClient.get(req.params.id);
  if (!c) return res.status(404).json({ error: 'not found' });
  res.json({ client: publicClient(c), numbers: q.listNumbers.all(c.id) });
});

// create or update. Secret fields keep their existing value when left blank/masked.
router.post('/clients', (req, res) => {
  const b = req.body || {};
  if (!b.id || !b.name || !b.forward_number) return res.status(400).json({ error: 'id, name, forward_number required' });

  const existing = q.getClient.get(b.id);
  const prevConf = existing ? safeJson(existing.config_json) : {};

  const keepIfBlank = (incoming, prev) => (incoming && !String(incoming).includes('••••') ? incoming : (prev || null));

  const config = {
    googleAds: {
      customerId: (b.googleAds && b.googleAds.customerId) || (prevConf.googleAds || {}).customerId || '',
      conversionActionId: (b.googleAds && b.googleAds.conversionActionId) || (prevConf.googleAds || {}).conversionActionId || ''
    },
    meta: {
      pixelId: (b.meta && b.meta.pixelId) || (prevConf.meta || {}).pixelId || '',
      capiToken: keepIfBlank(b.meta && b.meta.capiToken, (prevConf.meta || {}).capiToken),
      testEventCode: (b.meta && b.meta.testEventCode) || (prevConf.meta || {}).testEventCode || ''
    },
    ga4: {
      measurementId: (b.ga4 && b.ga4.measurementId) || (prevConf.ga4 || {}).measurementId || '',
      apiSecret: keepIfBlank(b.ga4 && b.ga4.apiSecret, (prevConf.ga4 || {}).apiSecret)
    }
  };

  q.upsertClient.run({
    id: b.id, name: b.name, forward_number: b.forward_number,
    consent_message: b.consent_message || null,
    recording_enabled: b.recording_enabled ? 1 : 0,
    qualified_duration_sec: b.qualified_duration_sec ? parseInt(b.qualified_duration_sec, 10) : null,
    lead_value: b.lead_value != null ? Number(b.lead_value) : 0,
    currency: b.currency || 'EUR',
    active: b.active === false ? 0 : 1,
    twilio_account_sid: b.twilio_account_sid || (existing && existing.twilio_account_sid) || null,
    twilio_auth_token: keepIfBlank(b.twilio_auth_token, existing && existing.twilio_auth_token),
    config_json: JSON.stringify(config)
  });
  res.json({ ok: true, id: b.id });
});

router.delete('/clients/:id', (req, res) => { q.deleteClient.run(req.params.id); res.json({ ok: true }); });

// ── numbers (DNI pool) ─────────────────────────────────
router.post('/clients/:id/numbers', (req, res) => {
  const phone = (req.body.phone || '').trim();
  if (!phone) return res.status(400).json({ error: 'phone required' });
  q.upsertNumber.run({ phone, client_id: req.params.id, label: req.body.label || null });
  res.json({ ok: true });
});
router.delete('/numbers/:phone', (req, res) => { q.deleteNumber.run(req.params.phone); res.json({ ok: true }); });

// ── reporting (UI) ─────────────────────────────────────
router.get('/report/stats', (req, res) => {
  if (!req.query.client) return res.status(400).json({ error: 'client required' });
  const byChannel = q.statsByChannel.all(req.query.client, sinceParam(req));
  const totals = byChannel.reduce((t, r) => ({
    total: t.total + r.total, answered: t.answered + r.answered, missed: t.missed + r.missed,
    qualified: t.qualified + r.qualified, first_time: t.first_time + r.first_time
  }), { total: 0, answered: 0, missed: 0, qualified: 0, first_time: 0 });
  res.json({ totals, by_channel: byChannel });
});
router.get('/report/calls', (req, res) => {
  if (!req.query.client) return res.status(400).json({ error: 'client required' });
  res.json({ calls: q.listCalls.all(req.query.client, sinceParam(req), parseInt(req.query.limit || '200', 10)) });
});

// Stream a recording through the server using the client's Twilio creds (browser can't auth to Twilio).
router.get('/recording', async (req, res) => {
  const call = q.getCall.get(req.query.sid);
  if (!call || !call.recording_url) return res.status(404).end();
  const c = q.getClient.get(call.client_id) || {};
  const sid = c.twilio_account_sid || cfg.twilio.accountSid;
  const token = c.twilio_auth_token || cfg.twilio.authToken;
  try {
    const r = await fetch(call.recording_url + '.mp3', {
      headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64') }
    });
    if (!r.ok) return res.status(502).end();
    res.set('Content-Type', 'audio/mpeg');
    res.send(Buffer.from(await r.arrayBuffer()));
  } catch (e) { res.status(502).end(); }
});

module.exports = router;
