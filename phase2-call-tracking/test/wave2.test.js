'use strict';
// Wave 2: block list, fixed numbers, webhooks, missed-call alerts, health flags, passwords, AI summaries, reports.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const { seed, start, session } = require('./helpers');
const { db } = require('../src/db');
const events = require('../src/events');
const calls = require('../src/calls');
const users = require('../src/users');
const mailer = require('../src/services/mailer');
const reports = require('../src/services/reports');

let people;
let srv;
let receiver;          // a local HTTP endpoint standing in for webhook receivers, Slack and the Anthropic API
const received = [];   // { path, headers, body }
let anthropicReply = null;

test.before(async () => {
  people = await seed();
  srv = await start();
  receiver = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      received.push({ path: req.url, headers: req.headers, body });
      if (req.url.startsWith('/fail')) { res.statusCode = 500; return res.end('no'); }
      if (req.url.startsWith('/v1/messages')) {
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify(anthropicReply));
      }
      res.end('ok');
    });
  });
  await new Promise((r) => receiver.listen(0, r));
});
test.after(async () => { await srv.close(); await new Promise((r) => receiver.close(r)); });

const rx = () => `http://127.0.0.1:${receiver.address().port}`;
const form = (path, obj) => fetch(srv.base + path, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(obj) }).then((r) => r.text());
async function owner() {
  const s = session(srv.base);
  await s.post('/api/v2/auth/login', { login: 'admin', password: 'admin-password-123' }, { 'X-Forwarded-For': '198.18.0.' + Math.floor(Math.random() * 250) });
  return s;
}
let n = 0;
const sid = () => 'CAW2' + (++n);

test('a blocked caller is turned away, logged as spam, and kept out of the counts', async () => {
  const s = await owner();
  const before = (await calls.totals(people.owner, { client_id: 'acme' })).calls;
  const r = await s.post('/api/v2/clients/acme/blocked', { pattern: '+30690 *', note: 'robocalls' });
  assert.equal(r.status, 200);
  assert.equal(r.body.blocked[0].pattern, '+30690*');
  assert.equal((await s.post('/api/v2/clients/acme/blocked', { pattern: 'hello' })).status, 400);

  const callSid = sid();
  const twiml = await form('/webhooks/voice/incoming', { To: '+302100000001', From: '+306901234567', CallSid: callSid });
  assert.match(twiml, /<Reject/);
  await events.settle();
  const c = await calls.getCall(people.owner, callSid);
  assert.equal(c.status, 'blocked');
  assert.equal(c.lead_status, 'spam');
  assert.equal((await calls.totals(people.owner, { client_id: 'acme' })).calls, before, 'not counted');
  assert.equal((await calls.listCalls(people.owner, { status: 'blocked' })).total, 1, 'but listed under Blocked');
  assert.ok(!(await calls.listCalls(people.owner, { status: 'to_call_back' })).calls.some((x) => x.call_sid === callSid));
  assert.equal((await s.get('/api/v2/clients/acme/blocked')).body.blocked[0].blocked_calls, 1);
});

test('blocking from a call adds the caller and marks the call spam; clients cannot', async () => {
  const s = await owner();
  const r = await s.post('/api/v2/calls/CA2/block', {});
  assert.equal(r.status, 200);
  assert.equal(r.body.call.lead_status, 'spam');
  assert.ok(await calls.isBlocked('acme', '+306971111111'));
  const c = session(srv.base);
  await c.post('/api/v2/auth/login', { login: 'acme@client.gr', password: 'client-password-1' }, { 'X-Forwarded-For': '198.18.1.1' });
  assert.equal((await c.post('/api/v2/calls/CA1/block', {})).status, 403);
});

test('a fixed number carries its own source and is never handed to a website visitor', async () => {
  const s = await owner();
  const add = await s.post('/api/v2/clients/acme/numbers', { phone: '+302100000099', label: 'Google listing', kind: 'fixed', source: 'google_business' });
  assert.equal(add.status, 200);
  assert.equal((await s.post('/api/v2/clients/acme/numbers', { phone: '+302100000098', kind: 'fixed', source: 'nowhere' })).status, 400);
  for (let i = 0; i < 6; i++) {
    const a = await fetch(srv.base + '/api/dni/assign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ siteId: 'acme', attribution: {} }) }).then((r) => r.json());
    assert.equal(a.phone, '+302100000001', 'only the pool number is handed out');
  }
  const callSid = sid();
  await form('/webhooks/voice/incoming', { To: '+302100000099', From: '+302105550000', CallSid: callSid });
  const c = await calls.getCall(people.owner, callSid);
  assert.equal(c.channel, 'google_business');
  assert.equal(c.utm_campaign, 'Google listing');
});

function verify(secret, header, body) {
  const [t, v1] = header.split(',').map((p) => p.split('=')[1]);
  return crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex') === v1;
}

test('webhooks: signed deliveries on completion and on lead work, retries, then a failure on record', async () => {
  const s = await owner();
  const made = await s.post('/api/v2/webhooks', { url: rx() + '/hook', client_id: 'acme' });
  assert.equal(made.status, 200);
  const secret = made.body.secret;
  assert.match(secret, /^whsec_/);
  assert.ok(!('secret' in made.body.webhook), 'the secret is shown once, not listed');
  received.length = 0;

  const callSid = sid();
  await form('/webhooks/voice/incoming', { To: '+302100000001', From: '+302101112233', CallSid: callSid });
  await form('/webhooks/voice/dial-complete?sid=' + callSid, { CallSid: callSid, DialCallStatus: 'completed', DialCallDuration: '75' });
  await events.settle();
  const hit = received.find((r) => r.path === '/hook');
  assert.ok(hit, 'delivered');
  assert.equal(hit.headers['x-calltrack-event'], 'call.completed');
  assert.ok(verify(secret, hit.headers['x-calltrack-signature'], hit.body), 'signature checks out');
  assert.equal(JSON.parse(hit.body).call.call_sid, callSid);

  received.length = 0;
  await s.patch('/api/v2/calls/' + callSid, { lead_status: 'customer', value: 300 });
  await events.settle();
  const upd = received.find((r) => r.path === '/hook');
  assert.equal(upd.headers['x-calltrack-event'], 'call.updated');
  assert.equal(JSON.parse(upd.body).call.lead_status, 'customer');

  const bad = await s.post('/api/v2/webhooks', { url: rx() + '/fail', client_id: 'beta' });
  received.length = 0;
  await s.patch('/api/v2/calls/CB1', { lead_status: 'good' });
  await events.settle();
  assert.equal(received.filter((r) => r.path === '/fail').length, 3, 'three tries');
  const row = await db.prepare('SELECT * FROM webhooks WHERE id = ?').get(bad.body.webhook.id);
  assert.equal(row.failures, 1);
  assert.match(row.last_status, /^500/);
  assert.ok(!received.some((r) => r.path === '/hook'), 'the acme hook does not hear about beta');
});

test('missed-call alerts go to Slack and email when switched on', async () => {
  const s = await owner();
  const r = await s.post('/api/v2/clients', { id: 'beta', name: 'Beta Clinic', forward_number: '+302310222222', alert_missed: true, alert_emails: 'desk@beta.gr, not-an-email', alert_slack_url: rx() + '/slack' });
  assert.equal(r.status, 200);
  assert.equal(r.body.client.alert_emails, 'desk@beta.gr');
  assert.match(r.body.client.alert_slack_url_masked, /^••••/);
  await db.prepare("INSERT OR IGNORE INTO numbers (phone, client_id, label) VALUES ('+302310000001', 'beta', 'pool')").run();
  received.length = 0;
  mailer.sent.length = 0;

  const callSid = sid();
  await form('/webhooks/voice/incoming', { To: '+302310000001', From: '+306977777777', CallSid: callSid });
  await form('/webhooks/voice/dial-complete?sid=' + callSid, { CallSid: callSid, DialCallStatus: 'no-answer', DialCallDuration: '0' });
  await events.settle();
  const slack = received.find((x) => x.path === '/slack');
  assert.ok(slack, 'Slack got it');
  assert.match(JSON.parse(slack.body).text, /Missed call for Beta Clinic from \+306977777777/);
  assert.equal(mailer.sent.at(-1).subject, 'Missed call: Beta Clinic');

  received.length = 0;
  const answered = sid();
  await form('/webhooks/voice/incoming', { To: '+302310000001', From: '+306977777778', CallSid: answered });
  await form('/webhooks/voice/dial-complete?sid=' + answered, { CallSid: answered, DialCallStatus: 'completed', DialCallDuration: '40' });
  await events.settle();
  assert.ok(!received.some((x) => x.path === '/slack'), 'answered calls do not alert');
});

test('health flags: a full pool and failing uploads show on the client board', async () => {
  // beta has one pool number: the second visitor in the same hour shares it, and that is recorded
  await db.prepare("DELETE FROM sessions WHERE client_id = 'beta'").run();
  const assign = () => fetch(srv.base + '/api/dni/assign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ siteId: 'beta', attribution: {} }) }).then((r) => r.json());
  assert.equal((await assign()).fallback, false);
  assert.equal((await assign()).fallback, true);
  assert.ok((await calls.clientBoard(people.owner, {})).clients.find((k) => k.id === 'beta').flags.includes('pool_full'));
  await db.prepare(`UPDATE calls SET conv_google = 'error: invalid gclid' WHERE call_sid = 'CA1'`).run();
  const row = (await calls.clientBoard(people.owner, {})).clients.find((k) => k.id === 'acme');
  assert.ok(row.flags.includes('uploads_failing'));
});

test('passwords: change your own with the current one; owners reset others', async () => {
  const m = session(srv.base);
  await m.post('/api/v2/auth/login', { login: 'maria@ruler.agency', password: 'member-password-1' }, { 'X-Forwarded-For': '198.18.2.2' });
  assert.equal((await m.post('/api/v2/me/password', { current: 'nope', next: 'brand-new-password' })).status, 400);
  assert.equal((await m.post('/api/v2/me/password', { current: 'member-password-1', next: 'short' })).status, 400);
  assert.equal((await m.post('/api/v2/me/password', { current: 'member-password-1', next: 'brand-new-password' })).status, 200);
  assert.ok(await users.login('maria@ruler.agency', 'brand-new-password'));
  const s = await owner();
  assert.equal((await s.patch('/api/v2/users/' + people.member.id, { password: 'reset-by-the-owner' })).status, 200);
  assert.ok(await users.login('maria@ruler.agency', 'reset-by-the-owner'));
});

test('AI summaries: the request asks for structured output with fallbacks; the answer is stored as a suggestion', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  process.env.ANTHROPIC_BASE_URL = rx();
  anthropicReply = {
    id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', stop_sequence: null,
    content: [{ type: 'text', text: JSON.stringify({ summary: 'Ζήτησε προσφορά για κουζίνα.', label: 'good', score: 82, reason: 'Asked for a quote' }) }],
    usage: { input_tokens: 300, output_tokens: 60 }
  };
  received.length = 0;
  const s = await owner();
  const r = await s.post('/api/v2/calls/CA1/summarize', {});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.call.ai_summary, 'Ζήτησε προσφορά για κουζίνα.');
  assert.equal(r.body.call.ai_label, 'good');
  assert.equal(r.body.call.ai_score, 82);
  assert.equal(r.body.call.lead_status, (await calls.getCall(people.owner, 'CA1')).lead_status, 'a suggestion only');

  const sent = received.find((x) => x.path.startsWith('/v1/messages'));
  const body = JSON.parse(sent.body);
  assert.equal(body.model, 'claude-opus-5-5');
  assert.equal(body.fallbacks, 'default');
  assert.equal(body.output_config.format.type, 'json_schema');
  assert.match(sent.headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
  assert.match(body.messages[0].content, /<transcript>\nI would like a quote/);

  assert.equal((await s.post('/api/v2/calls/CA2/summarize', {})).status, 400, 'no transcript, nothing to judge');
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_BASE_URL;
});

test('reports: schedule times, periods, and a due report is emailed with the call log', async () => {
  const wed = new Date(Date.UTC(2026, 10, 4, 12)); // Wednesday 4 Nov 2026
  assert.equal(reports.nextAt('weekly', wed).toISOString(), '2026-11-09T06:00:00.000Z');
  assert.equal(reports.nextAt('weekly', new Date(Date.UTC(2026, 10, 9, 5))).toISOString(), '2026-11-09T06:00:00.000Z');
  assert.equal(reports.nextAt('monthly', wed).toISOString(), '2026-12-01T06:00:00.000Z');
  assert.deepEqual(reports.periodFor('monthly', new Date(Date.UTC(2026, 11, 1, 6))), { since: '2026-11-01', until: '2026-11-30' });
  assert.deepEqual(reports.periodFor('weekly', new Date(Date.UTC(2026, 10, 9, 6))), { since: '2026-11-02', until: '2026-11-08' });

  const s = await owner();
  await s.post('/api/v2/clients', { id: 'acme', name: 'ACME Greece', forward_number: '+302101111111', report_schedule: 'weekly', report_emails: 'owner@acme.gr' });
  await db.prepare("UPDATE clients SET report_next_at = datetime('now', '-1 minute') WHERE id = 'acme'").run();
  mailer.sent.length = 0;
  const out = await reports.runDue();
  assert.equal(out.length, 1);
  const mail = mailer.sent.at(-1);
  assert.deepEqual(mail.to.map((t) => t.address), ['owner@acme.gr']);
  assert.match(mail.subject, /^ACME Greece: calls /);
  assert.equal(mail.attachments.length, 1);
  assert.match(mail.attachments[0].filename, /^calls-acme-/);
  const next = (await db.prepare("SELECT report_next_at FROM clients WHERE id = 'acme'").get()).report_next_at;
  assert.ok(next > new Date().toISOString().slice(0, 19).replace('T', ' '), 'moved to the next send time');
  assert.equal((await reports.runDue()).length, 0, 'not sent twice');
});
