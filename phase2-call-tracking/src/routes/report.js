'use strict';
// The v1 report API, kept for Looker Studio / scripts. Needs either REPORT_API_KEY (X-Api-Key, sees every client)
// or a personal Bearer ct_ token (sees that user's clients). With neither, it answers 401: it is never open.
const express = require('express');
const crypto = require('crypto');
const calls = require('../calls');
const { bearerUser } = require('../auth');

const router = express.Router();
const SYSTEM = { id: 0, role: 'owner', name: 'report key' };

function keyOk(req) {
  const need = process.env.REPORT_API_KEY;
  const got = req.header('X-Api-Key');
  if (!need || !got) return false;
  const a = crypto.createHash('sha256').update(need).digest();
  const b = crypto.createHash('sha256').update(got).digest();
  return crypto.timingSafeEqual(a, b);
}

router.use((req, res, next) => {
  req.user = keyOk(req) ? SYSTEM : bearerUser(req);
  if (!req.user) return res.status(401).json({ error: 'unauthorized' });
  next();
});

function since(req) {
  return req.query.since || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
}

// GET /api/report/calls?client=client-acme&since=2026-06-01&limit=500
router.get('/calls', (req, res, next) => {
  try {
    if (!req.query.client) return res.status(400).json({ error: 'client required' });
    const r = calls.listCalls(req.user, { client_id: req.query.client, since: since(req), limit: req.query.limit || 500 });
    res.json({ client: req.query.client, count: r.calls.length, calls: r.calls });
  } catch (e) { next(e); }
});

// GET /api/report/stats?client=client-acme&since=2026-06-01  → per-channel totals
router.get('/stats', (req, res, next) => {
  try {
    if (!req.query.client) return res.status(400).json({ error: 'client required' });
    calls.scopedClient(req.user, req.query.client);
    const f = { client_id: req.query.client, since: since(req) };
    const by = calls.byChannel(req.user, f).map((r) => ({ channel: r.channel, total: r.calls, answered: r.answered, missed: r.missed, qualified: r.leads }));
    const t = calls.totals(req.user, f);
    res.json({
      client: req.query.client,
      totals: { total: t.calls, answered: t.answered, missed: t.missed, qualified: t.leads, first_time: t.first_time },
      by_channel: by
    });
  } catch (e) { next(e); }
});

module.exports = router;
