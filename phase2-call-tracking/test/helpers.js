'use strict';
// Test fixtures: two clients with calls, one user per role, a running server and small HTTP helpers.
const { db, migrate } = require('../src/db');
const users = require('../src/users');
const app = require('../src/app');

const today = new Date().toISOString().slice(0, 10);
const ago = (days, time = '10:00:00') => {
  const d = new Date(); d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10) + ' ' + time;
};

async function seed() {
  await migrate();
  const insClient = db.prepare(`INSERT INTO clients (id, name, forward_number, lead_value, currency) VALUES (?, ?, ?, ?, 'EUR')`);
  await insClient.run('acme', 'ACME Greece', '+302101111111', 40);
  await insClient.run('beta', 'Beta Clinic', '+302310222222', 100);
  await db.prepare("INSERT INTO numbers (phone, client_id, label) VALUES ('+302100000001', 'acme', 'pool-1')").run();

  const call = db.prepare(`INSERT INTO calls (call_sid, client_id, tracking_number, caller, started_at, answered, status,
      duration_sec, qualified, first_time, channel, utm_campaign, utm_term, region, transcript, recording_url)
    VALUES (@sid, @client, '+302100000001', @caller, @at, @answered, @status, @dur, @q, @first, @channel, @campaign, @term, @region, @transcript, @rec)`);
  const base = { term: null, transcript: null, rec: null, first: 1 };
  const rows = [
    { sid: 'CA1', client: 'acme', caller: '+302101234567', at: ago(1), answered: 1, status: 'answered', dur: 95, q: 1, channel: 'google_ads', campaign: 'brand', term: 'acme athens', region: 'attica', transcript: 'I would like a quote for the kitchen', rec: 'https://api.twilio.com/rec/RE1' },
    { sid: 'CA2', client: 'acme', caller: '+306971111111', at: ago(2), answered: 0, status: 'missed', dur: 0, q: 0, channel: 'google_ads', campaign: 'brand', region: 'mobile' },
    { sid: 'CA3', client: 'acme', caller: '+302310999999', at: ago(3), answered: 1, status: 'answered', dur: 12, q: 0, channel: 'direct', campaign: null, region: 'central_macedonia' },
    { sid: 'CA4', client: 'acme', caller: '+306972222222', at: ago(4), answered: 0, status: 'missed', dur: 0, q: 0, channel: 'meta_ads', campaign: '=HYPERLINK("x")', region: 'mobile' },
    { sid: 'CA5', client: 'acme', caller: '+306972222222', at: ago(3), answered: 1, status: 'answered', dur: 60, q: 1, channel: 'meta_ads', campaign: 'leads', region: 'mobile', first: 0 },
    { sid: 'CB1', client: 'beta', caller: '+302810555555', at: ago(1), answered: 1, status: 'answered', dur: 200, q: 1, channel: 'google_ads', campaign: 'implants', region: 'crete', transcript: 'secret beta transcript', rec: 'https://api.twilio.com/rec/RE9' },
    { sid: 'CB2', client: 'beta', caller: '+306973333333', at: ago(1), answered: 0, status: 'missed', dur: 0, q: 0, channel: 'google_ads', campaign: 'implants', region: 'mobile' }
  ];
  for (const c of rows) await call.run({ ...base, ...c });

  const owner = (await users.getUser(1)) || (await users.bootstrapOwner());
  const member = await users.createUser({ login: 'maria@ruler.agency', name: 'Maria', password: 'member-password-1', role: 'member' });
  const client = await users.createUser({ login: 'acme@client.gr', name: 'ACME owner', password: 'client-password-1', role: 'client', client_ids: ['acme'] });
  return { owner, member, client };
}

async function start() {
  await app.boot();
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { server, base, close: () => new Promise((r) => server.close(r)) };
}

// A tiny client that keeps the session cookie.
function session(base) {
  let cookie = '';
  const call = async (method, path, body, headers = {}) => {
    const r = await fetch(base + path, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined
    });
    const set = r.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const type = r.headers.get('content-type') || '';
    return { status: r.status, body: type.includes('json') ? await r.json() : await r.text(), headers: r.headers };
  };
  return {
    get: (p, h) => call('GET', p, null, h), post: (p, b, h) => call('POST', p, b || {}, h),
    patch: (p, b) => call('PATCH', p, b), del: (p) => call('DELETE', p),
    login: (login, password) => call('POST', '/api/v2/auth/login', { login, password })
  };
}

module.exports = { seed, start, session, today, ago };
