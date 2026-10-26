'use strict';
const express = require('express');
const path = require('path');
const cfg = require('./config');
const { migrate } = require('./db');

migrate(); // ensure schema exists on boot

const app = express();

// Twilio posts application/x-www-form-urlencoded; the snippet posts JSON.
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.get('/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

// Serve the browser DNI snippet (so clients can <script src="https://calls.../static/dni-tracker.js">).
app.use('/static', express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h' }));

app.use('/api/dni', require('./routes/dni'));
app.use('/webhooks/voice', require('./routes/voice'));
app.use('/api/report', require('./routes/report'));
app.use('/admin/api', require('./routes/admin'));

// Branded admin + reporting UI (auth enforced by the API; SPA shell is public).
app.use('/', express.static(path.join(__dirname, '..', 'public', 'admin'), { index: 'index.html' }));

app.use((err, req, res, next) => {
  console.error('[error]', err && err.stack ? err.stack : err);
  res.status(500).json({ error: 'internal' });
});

app.listen(cfg.port, () => {
  console.log(`ctc-call-tracking listening on :${cfg.port}`);
  if (!cfg.publicBaseUrl) console.warn('⚠ PUBLIC_BASE_URL is empty — Twilio signature validation and callback URLs will break.');
});
