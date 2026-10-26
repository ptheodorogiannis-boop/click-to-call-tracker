'use strict';
const express = require('express');
const { q } = require('../db');
const { assignNumber } = require('../numberPool');

const router = express.Router();

// Permissive CORS for the browser snippet (tighten allowed origins per client if desired).
router.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

/**
 * POST /api/dni/assign
 * body: { siteId, attribution:{gclid,fbclid,utm_*,ga_client_id,fbp,fbc,landing_page,referrer}, visitorId }
 * → { phone, sessionId, fallback } | { error }
 * The browser swaps the displayed number to `phone`.
 */
router.post('/assign', (req, res) => {
  const { siteId, attribution, visitorId } = req.body || {};
  if (!siteId) return res.status(400).json({ error: 'siteId required' });

  const client = q.getClient.get(siteId);
  if (!client) return res.status(404).json({ error: 'unknown siteId' });

  const result = assignNumber(siteId, attribution || {}, {
    visitorId,
    userAgent: req.header('User-Agent'),
    ip: req.header('X-Forwarded-For') || req.ip
  });
  if (!result) return res.status(409).json({ error: 'no numbers in pool for this client' });

  res.json(result);
});

module.exports = router;
