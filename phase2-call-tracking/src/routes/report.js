'use strict';
const express = require('express');
const { q } = require('../db');

const router = express.Router();

// Optional shared-secret guard for reporting endpoints.
router.use((req, res, next) => {
  const need = process.env.REPORT_API_KEY;
  if (need && req.header('X-Api-Key') !== need) return res.status(401).json({ error: 'unauthorized' });
  next();
});

function sinceParam(req) {
  // default: last 30 days
  const d = req.query.since || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  return String(d).slice(0, 10) + ' 00:00:00';
}

// GET /api/report/calls?client=client-acme&since=2026-06-01&limit=500
router.get('/calls', (req, res) => {
  if (!req.query.client) return res.status(400).json({ error: 'client required' });
  const rows = q.listCalls.all(req.query.client, sinceParam(req), parseInt(req.query.limit || '500', 10));
  res.json({ client: req.query.client, count: rows.length, calls: rows });
});

// GET /api/report/stats?client=client-acme&since=2026-06-01  → per-channel totals
router.get('/stats', (req, res) => {
  if (!req.query.client) return res.status(400).json({ error: 'client required' });
  const byChannel = q.statsByChannel.all(req.query.client, sinceParam(req));
  const totals = byChannel.reduce((t, r) => ({
    total: t.total + r.total, answered: t.answered + r.answered,
    missed: t.missed + r.missed, qualified: t.qualified + r.qualified, first_time: t.first_time + r.first_time
  }), { total: 0, answered: 0, missed: 0, qualified: 0, first_time: 0 });
  res.json({ client: req.query.client, totals, by_channel: byChannel });
});

module.exports = router;
