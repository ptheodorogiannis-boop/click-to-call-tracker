'use strict';
// Builds the Express app. src/server.js listens; tests import this directly.
const express = require('express');
const fs = require('fs');
const path = require('path');
const { migrate } = require('./db');
const { bootstrapOwner } = require('./users');

migrate(); // ensure schema exists on boot
// What reacts to call events: outbound webhooks, missed-call alerts, AI summaries.
require('./services/webhooks');
require('./services/alerts');
require('./services/ai');

const owner = bootstrapOwner();
if (owner) console.log(`created owner "${owner.login}" from ADMIN_USER / ADMIN_PASSWORD`);

const app = express();
// Behind Caddy (its own container on the private compose network), req.ip must be the visitor's address, or every
// sign-in shares one brake. Trust the local hops by default; TRUST_PROXY overrides (e.g. a hop count behind a CDN).
app.set('trust proxy', process.env.TRUST_PROXY || 'loopback, uniquelocal');

// MCP parses its own JSON body (before the global parsers touch it).
app.use('/mcp', require('./mcp'));

// Viber bot callbacks: the signature covers the raw body, so this reads it before any parser does.
const viber = require('./services/viber');
app.post('/webhooks/viber', express.raw({ type: '*/*', limit: '100kb' }), async (req, res) => {
  if (!viber.enabled()) return res.status(404).end();
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
  if (!viber.validSignature(raw, req.get('X-Viber-Content-Signature') || req.query.sig)) return res.status(403).end();
  let ev;
  try { ev = JSON.parse(raw.toString('utf8')); } catch (e) { return res.status(400).end(); }
  try {
    const reply = await viber.onCallback(ev);
    return reply ? res.json(reply) : res.status(200).end();
  } catch (e) {
    console.error('[viber]', String(e.message || e).slice(0, 160));
    return res.status(200).end(); // answered; Viber would otherwise retry a message we already handled
  }
});

// Twilio posts application/x-www-form-urlencoded; the snippet and the web app post JSON.
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.get('/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

// Serve the browser DNI snippet (so clients can <script src="https://calls.../static/dni-tracker.js">).
app.use('/static', express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h' }));

app.use('/api/dni', require('./routes/dni'));
app.use('/webhooks/voice', require('./routes/voice'));
app.use('/api/report', require('./routes/report'));
app.use('/api/v2', require('./routes/api'));

// Machine routes never fall through to the web app: an unknown one is a JSON 404, not an HTML page.
app.use(['/api', '/webhooks', '/mcp', '/static'], (req, res) => res.status(404).json({ error: 'not found' }));

// The web app (web/dist, built by `npm run build`). Hashed assets cache for a year; every other path gets
// index.html so client-side routes survive a reload. Auth is enforced by the API; the shell is public.
const web = path.join(__dirname, '..', 'web', 'dist');
if (fs.existsSync(path.join(web, 'index.html'))) {
  app.use('/assets', express.static(path.join(web, 'assets'), { immutable: true, maxAge: '1y' }));
  app.use(express.static(web, { index: false, maxAge: '1h' }));
  app.get('*', (req, res) => res.set('Cache-Control', 'no-cache').sendFile(path.join(web, 'index.html')));
} else {
  app.get('/', (req, res) => res.type('text').send('CallTrack API is running. Build the web app with `npm run build`.'));
}

app.use((err, req, res, next) => {
  if (err && err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid JSON' });
  console.error('[error]', err && err.stack ? err.stack : err);
  res.status(500).json({ error: 'internal' });
});

module.exports = app;
