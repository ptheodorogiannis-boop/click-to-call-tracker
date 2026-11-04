'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { seed, start, session } = require('./helpers');
const users = require('../src/users');
const { db } = require('../src/db');

const people = seed();
let srv;
test.before(async () => { srv = await start(); });
test.after(() => srv.close());

test('everything under /api/v2 needs a session', async () => {
  const anon = session(srv.base);
  for (const p of ['/api/v2/me', '/api/v2/overview', '/api/v2/calls', '/api/v2/calls/CA1', '/api/v2/calls/CA1/recording']) {
    assert.equal((await anon.get(p)).status, 401, p);
  }
});

test('login sets a session; logout clears it; wrong password is refused', async () => {
  const s = session(srv.base);
  assert.equal((await s.login('admin', 'wrong-password')).status, 401);
  const r = await s.login('admin', 'admin-password-123');
  assert.equal(r.status, 200);
  assert.equal(r.body.user.role, 'owner');
  assert.ok(!('password_hash' in r.body.user));
  assert.equal((await s.get('/api/v2/me')).body.clients.length, 2);
  await s.post('/api/v2/auth/logout');
  assert.equal((await s.get('/api/v2/me')).status, 401);
});

test('client portal user: own data only, read-only', async () => {
  const s = session(srv.base);
  await s.login('acme@client.gr', 'client-password-1');
  const me = await s.get('/api/v2/me');
  assert.deepEqual(me.body.clients.map((c) => c.id), ['acme']);
  const list = await s.get('/api/v2/calls?limit=100');
  assert.ok(list.body.calls.length > 0 && list.body.calls.every((c) => c.client_id === 'acme'));
  assert.equal((await s.get('/api/v2/calls/CB1')).status, 404);
  assert.equal((await s.get('/api/v2/calls/CB1/recording')).status, 404, 'no audio from another client');
  assert.equal((await s.get('/api/v2/reports?client_id=beta')).status, 404);
  assert.equal((await s.patch('/api/v2/calls/CA1', { lead_status: 'good' })).status, 403);
  assert.equal((await s.post('/api/v2/calls/CA1/notes', { body: 'x' })).status, 403);
  assert.equal((await s.get('/api/v2/clients/acme')).status, 403, 'no Twilio credentials for clients');
  assert.equal((await s.get('/api/v2/users')).status, 403);
});

test('member: lead work and clients yes, team no', async () => {
  const s = session(srv.base);
  await s.login('maria@ruler.agency', 'member-password-1');
  const r = await s.post('/api/v2/calls/CA1/notes', { body: 'Called, booked a visit' });
  assert.equal(r.status, 200);
  assert.equal(r.body.call.notes.at(-1).author, 'Maria');
  assert.equal((await s.patch('/api/v2/calls/CA1', { value: -5 })).status, 400);
  const k = await s.get('/api/v2/clients/acme');
  assert.equal(k.status, 200);
  assert.ok(!JSON.stringify(k.body).includes('twilio_auth_token"'), 'only the masked token leaves the server');
  assert.equal((await s.get('/api/v2/users')).status, 403);
  assert.equal((await s.del('/api/v2/clients/acme')).status, 403);
});

test('owner: creates a portal user who then sees only that client', async () => {
  const s = session(srv.base);
  await s.login('admin', 'admin-password-123');
  const r = await s.post('/api/v2/users', { login: 'beta@clinic.gr', name: 'Beta', password: 'beta-password-1', role: 'client', client_ids: ['beta'] });
  assert.equal(r.status, 200);
  assert.equal((await s.post('/api/v2/users', { login: 'beta@clinic.gr', name: 'B', password: 'beta-password-1', role: 'client' })).status, 409);
  assert.equal((await s.patch('/api/v2/users/' + people.owner.id, { role: 'member' })).status, 400, 'cannot demote yourself');
  const b = session(srv.base);
  await b.login('beta@clinic.gr', 'beta-password-1');
  assert.deepEqual((await b.get('/api/v2/me')).body.clients.map((c) => c.id), ['beta']);
  assert.equal((await s.del('/api/v2/clients/acme')).status, 409, 'a client with calls is switched off, not deleted');
});

test('the v1 report API is closed without a key or token, and tokens are scoped', async () => {
  const anon = session(srv.base);
  assert.equal((await anon.get('/api/report/calls?client=acme')).status, 401);
  assert.equal((await anon.get('/api/report/calls?client=acme', { 'X-Api-Key': 'wrong' })).status, 401);
  assert.equal((await anon.get('/api/report/stats?client=beta', { 'X-Api-Key': 'test-report-key' })).status, 200);
  const { token } = users.createToken(people.client.id, 'looker');
  const auth = { Authorization: 'Bearer ' + token };
  assert.equal((await anon.get('/api/report/calls?client=acme', auth)).status, 200);
  assert.equal((await anon.get('/api/report/calls?client=beta', auth)).status, 404);
});

test('CSV export and search', async () => {
  const s = session(srv.base);
  await s.login('admin', 'admin-password-123');
  const csv = await s.get('/api/v2/reports/calls.csv?client_id=acme');
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.match(csv.body, /^﻿?started_at,/); // fetch's text() drops the BOM Excel needs
  const found = await s.get('/api/v2/search?q=acme');
  assert.equal(found.body.clients[0].id, 'acme');
});

test('unknown machine routes answer JSON 404, never the web app', async () => {
  const s = session(srv.base);
  for (const p of ['/api/nope', '/webhooks/nope', '/static/nope.js']) {
    const r = await s.get(p);
    assert.equal(r.status, 404, p);
    assert.equal(typeof r.body, 'object', p);
  }
});

test('logins are braked after 10 failures', async () => {
  const s = session(srv.base);
  let last;
  for (let i = 0; i < 11; i++) last = await s.login('nobody', 'wrong-password');
  assert.equal(last.status, 429);
});

test('the brake counts each visitor behind the proxy apart, not the proxy', async () => {
  const s = session(srv.base);
  const from = (ip) => ({ 'X-Forwarded-For': ip });
  let last;
  for (let i = 0; i < 11; i++) last = await s.post('/api/v2/auth/login', { login: 'nobody', password: 'wrong-password' }, from('203.0.113.7'));
  assert.equal(last.status, 429, 'the guessing address is braked');
  const other = await s.post('/api/v2/auth/login', { login: 'nobody', password: 'wrong-password' }, from('198.51.100.20'));
  assert.equal(other.status, 401, 'someone else is not');
});

test('CSV export has every call in the period, past 500', async () => {
  const ins = db.prepare(`INSERT INTO calls (call_sid, client_id, tracking_number, caller, started_at, answered, status, channel)
    VALUES (?, 'beta', '+302100000001', '+306970000000', datetime('now', '-2 days'), 1, 'answered', 'direct')`);
  db.transaction(() => { for (let i = 0; i < 520; i++) ins.run('CSVBULK' + i); })();
  const s = session(srv.base);
  // its own address: the brake tests above have used up 127.0.0.1
  await s.post('/api/v2/auth/login', { login: 'admin', password: 'admin-password-123' }, { 'X-Forwarded-For': '192.0.2.50' });
  const csv = await s.get('/api/v2/reports/calls.csv?client_id=beta&days=30');
  const lines = csv.body.trim().split(/\r?\n/).length - 1;
  assert.ok(lines >= 522, `expected every row, got ${lines}`);
});
