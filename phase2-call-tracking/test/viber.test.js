'use strict';
// Viber alerts: link a person with a code, signed callbacks, a missed call reaching them, unsubscribing.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const { seed, start, session } = require('./helpers');
const { db } = require('../src/db');
const events = require('../src/events');

let srv;
let viberApi;
const sent = []; // what the app sent to the Viber API

test.before(async () => {
  viberApi = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      sent.push({ path: req.url, token: req.headers['x-viber-auth-token'], body: JSON.parse(body || '{}') });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ status: 0, status_message: 'ok' }));
    });
  });
  await new Promise((r) => viberApi.listen(0, r));
  process.env.VIBER_AUTH_TOKEN = 'viber-test-token';
  process.env.VIBER_API_BASE = `http://127.0.0.1:${viberApi.address().port}/pa`;
  await seed();
  srv = await start();
});
test.after(async () => {
  delete process.env.VIBER_AUTH_TOKEN;
  delete process.env.VIBER_API_BASE;
  await srv.close();
  await new Promise((r) => viberApi.close(r));
});

const callback = (ev, token = 'viber-test-token') => {
  const body = JSON.stringify(ev);
  const sig = crypto.createHmac('sha256', token).update(body).digest('hex');
  return fetch(srv.base + '/webhooks/viber', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Viber-Content-Signature': sig }, body });
};
async function owner() {
  const s = session(srv.base);
  await s.post('/api/v2/auth/login', { login: 'admin', password: 'admin-password-123' }, { 'X-Forwarded-For': '198.19.0.1' });
  return s;
}

test('a person links their Viber to a client with a one-time code', async () => {
  const s = await owner();
  const link = await s.post('/api/v2/clients/acme/viber/link', {});
  assert.equal(link.status, 200);
  assert.match(link.body.code, /^CT-[A-Z0-9]{6}$/);

  const hello = await callback({ event: 'conversation_started', user: { id: 'vb-maria', name: 'Maria' } });
  assert.equal(hello.status, 200);
  assert.match((await hello.json()).text, /starts with CT-/);

  const forged = await callback({ event: 'message', sender: { id: 'vb-x' }, message: { type: 'text', text: link.body.code } }, 'wrong-token');
  assert.equal(forged.status, 403, 'unsigned callbacks are refused');

  sent.length = 0;
  await callback({ event: 'message', sender: { id: 'vb-maria', name: 'Maria' }, message: { type: 'text', text: ' ' + link.body.code.toLowerCase() } });
  assert.equal(sent.at(-1).path, '/pa/send_message');
  assert.equal(sent.at(-1).token, 'viber-test-token');
  assert.match(sent.at(-1).body.text, /^Done\. Missed calls for ACME Greece/);
  const list = await s.get('/api/v2/clients/acme/viber');
  assert.deepEqual(list.body.subscribers.map((p) => p.viber_id), ['vb-maria']);

  await callback({ event: 'message', sender: { id: 'vb-other' }, message: { type: 'text', text: link.body.code } });
  assert.match(sent.at(-1).body.text, /did not work/, 'a code works once');
  assert.equal((await s.get('/api/v2/clients/acme/viber')).body.subscribers.length, 1);
});

test('a missed call reaches the linked people on Viber', async () => {
  const s = await owner();
  await s.post('/api/v2/clients', { id: 'acme', name: 'ACME Greece', forward_number: '+302101111111', alert_missed: true });
  sent.length = 0;
  const sid = 'CAVIBER1';
  const form = (path, obj) => fetch(srv.base + path, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(obj) });
  await form('/webhooks/voice/incoming', { To: '+302100000001', From: '+306988888888', CallSid: sid });
  await form('/webhooks/voice/dial-complete?sid=' + sid, { CallSid: sid, DialCallStatus: 'no-answer', DialCallDuration: '0' });
  await events.settle();
  const msg = sent.find((m) => m.body.receiver === 'vb-maria');
  assert.ok(msg, 'sent to Maria');
  assert.match(msg.body.text, /Missed call for ACME Greece from \+306988888888/);
  assert.ok(msg.body.sender.name.length <= 28);

  const t = await s.post('/api/v2/clients/acme/alerts/test', {});
  assert.equal(t.status, 200);
  assert.ok(t.body.sent.includes('Viber'));
});

test('unsubscribing or removing someone stops their alerts', async () => {
  const s = await owner();
  await callback({ event: 'unsubscribed', user_id: 'vb-maria' });
  assert.equal((await s.get('/api/v2/clients/acme/viber')).body.subscribers.length, 0);

  await db.prepare("INSERT INTO viber_subscribers (client_id, viber_id, name) VALUES ('acme', 'vb-nikos', 'Nikos')").run();
  assert.equal((await s.del('/api/v2/clients/acme/viber/vb-nikos')).body.ok, true);
  assert.equal((await s.get('/api/v2/clients/acme/viber')).body.subscribers.length, 0);
  const c = session(srv.base);
  await c.post('/api/v2/auth/login', { login: 'acme@client.gr', password: 'client-password-1' }, { 'X-Forwarded-For': '198.19.0.2' });
  assert.equal((await c.post('/api/v2/clients/acme/viber/link', {})).status, 403, 'client logins cannot add Viber contacts');
});
