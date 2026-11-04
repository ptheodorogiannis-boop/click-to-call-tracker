'use strict';
// Outbound webhooks: every call event is POSTed as JSON to the URLs registered for that client (or for all clients).
// Signed like Stripe: X-CallTrack-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>" with the secret>.
// Three tries (now, then after 1x and 6x WEBHOOK_RETRY_MS); the last outcome is kept on the webhook row.
const crypto = require('crypto');
const { db } = require('../db');
const events = require('../events');
const calls = require('../calls');

const SYSTEM = { id: 0, role: 'owner', name: 'webhooks' };
const retryMs = () => parseInt(process.env.WEBHOOK_RETRY_MS || '5000', 10);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const s = {
  forCall: db.prepare(`SELECT * FROM webhooks WHERE active = 1 AND (client_id IS NULL OR client_id = ?)`),
  result: db.prepare(`UPDATE webhooks SET last_status = ?, last_at = datetime('now'),
    failures = CASE WHEN ? THEN 0 ELSE failures + 1 END WHERE id = ?`)
};

function sign(secret, body, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
}

async function deliver(hook, event, call) {
  const body = JSON.stringify({ event, sent_at: new Date().toISOString(), call });
  let status = '';
  for (const [i, delay] of [0, 1, 6].entries()) {
    if (delay) await wait(delay * retryMs());
    try {
      const r = await fetch(hook.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'Ruler-CallTrack-Webhooks/1', 'X-CallTrack-Event': event, 'X-CallTrack-Signature': sign(hook.secret, body) },
        body,
        signal: AbortSignal.timeout(10000)
      });
      status = `${r.status}${i ? ` after ${i + 1} tries` : ''}`;
      if (r.ok) { await s.result.run(status, 1, hook.id); return true; }
    } catch (e) {
      status = `error: ${String(e && e.message ? e.message : e).slice(0, 80)}`;
    }
  }
  await s.result.run(status, 0, hook.id);
  return false;
}

async function dispatch(callSid, event) {
  let call;
  try { call = await calls.getCall(SYSTEM, callSid); } catch (e) { return; }
  const hooks = (await s.forCall.all(call.client_id)).filter((h) => h.events.split(',').includes(event));
  await Promise.all(hooks.map((h) => deliver(h, event, call)));
}

for (const type of ['call.completed', 'call.updated']) events.on(type, dispatch);

module.exports = { sign, deliver, dispatch };
