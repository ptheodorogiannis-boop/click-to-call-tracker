'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { seed } = require('./helpers');
const users = require('../src/users');
const calls = require('../src/calls');
const { regionForPhone } = require('../src/geo');

let people;
test.before(async () => { people = await seed(); });

test('passwords are salted scrypt and verify', () => {
  const a = users.hashPassword('correct horse battery');
  assert.notEqual(a, users.hashPassword('correct horse battery'));
  assert.ok(users.verifyPassword('correct horse battery', a));
  assert.ok(!users.verifyPassword('wrong', a));
});

test('the bootstrap owner signs in with the old ADMIN_USER, not an email', async () => {
  assert.equal(people.owner.login, 'admin');
  assert.equal(people.owner.role, 'owner');
  assert.ok(await users.login('admin', 'admin-password-123'));
  assert.ok(await users.login('ADMIN', 'admin-password-123'), 'login is case-insensitive');
  assert.equal(await users.login('admin', 'nope'), null);
  assert.equal(await users.bootstrapOwner(), null, 'only on an empty users table');
});

test('tokens: shown once, stored hashed, revocable, die with the user', async () => {
  const { id, token } = await users.createToken(people.member.id, 'Claude');
  assert.match(token, /^ct_[\w-]{32}$/);
  assert.equal((await users.userForToken(token)).id, people.member.id);
  assert.equal(await users.userForToken(token.slice(0, -1) + (token.endsWith('x') ? 'y' : 'x')), null);
  assert.ok(await users.revokeToken(people.member.id, id));
  assert.equal(await users.userForToken(token), null);

  const t2 = (await users.createToken(people.member.id, 'second')).token;
  await users.updateUser(people.member.id, { active: false });
  assert.equal(await users.userForToken(t2), null, 'a switched-off user’s tokens stop working');
  await users.updateUser(people.member.id, { active: true });
});

test('a client user sees only their own client, everywhere', async () => {
  const c = people.client;
  assert.deepEqual((await calls.visibleClients(c)).map((k) => k.id), ['acme']);
  assert.ok((await calls.listCalls(c, { limit: 100 })).calls.every((x) => x.client_id === 'acme'));
  await assert.rejects(() => calls.getCall(c, 'CB1'), { status: 404 });
  await assert.rejects(() => calls.listCalls(c, { client_id: 'beta' }), { status: 404 });
  await assert.rejects(() => calls.report(c, { client_id: 'beta' }), { status: 404 });
  assert.equal((await calls.search(c, 'secret beta')).calls.length, 0, 'search does not leak other clients’ transcripts');
  assert.equal((await calls.overview(c)).by_client.length, 1);
});

test('client users cannot write; members can', async () => {
  await assert.rejects(() => calls.updateLead(people.client, 'CA1', { lead_status: 'good' }), { status: 403 });
  await assert.rejects(() => calls.addNote(people.client, 'CA1', 'hi'), { status: 403 });
  const c = await calls.updateLead(people.member, 'CA1', { lead_status: 'customer', value: 250 });
  assert.equal(c.lead_status, 'customer');
  assert.equal(c.value_effective, 250);
  await assert.rejects(() => calls.updateLead(people.member, 'CA1', { lead_status: 'maybe' }), { status: 400 });
});

test('lead rules: judging a call overrides the duration rule', async () => {
  const leads = async () => (await calls.totals(people.owner, { client_id: 'acme' })).leads;
  const before = await leads();
  await calls.updateLead(people.member, 'CA3', { lead_status: 'good' });          // 12 s, not qualified, now a lead
  await calls.updateLead(people.member, 'CA5', { lead_status: 'spam' });          // qualified, now not a lead
  assert.equal(await leads(), before);
  await calls.updateLead(people.member, 'CA5', { lead_status: 'new' });
  assert.equal(await leads(), before + 1);
});

test('to call back: missed, not followed by an answered call, not done yet', async () => {
  const sids = async () => (await calls.listCalls(people.owner, { status: 'to_call_back' })).calls.map((c) => c.call_sid).sort();
  // CA4 (missed) was followed by CA5 (answered) from the same caller, so only CA2 and CB2 are open.
  assert.deepEqual(await sids(), ['CA2', 'CB2']);
  await calls.markCalledBack(people.member, 'CA2');
  assert.deepEqual(await sids(), ['CB2']);
  await calls.markCalledBack(people.member, 'CA2', false);
  assert.deepEqual(await sids(), ['CA2', 'CB2']);
});

test('tags are normalised and searchable', async () => {
  await calls.tagCall(people.member, 'CA1', { add: ['  Kitchen   Quote ', 'VIP'] });
  assert.deepEqual((await calls.getCall(people.owner, 'CA1')).tags, ['kitchen quote', 'vip']);
  assert.equal((await calls.listCalls(people.owner, { tag: 'vip' })).total, 1);
  await calls.tagCall(people.member, 'CA1', { remove: ['vip'] });
  assert.deepEqual((await calls.getCall(people.owner, 'CA1')).tags, ['kitchen quote']);
});

test('search escapes LIKE wildcards', async () => {
  assert.equal((await calls.listCalls(people.owner, { q: '%' })).total, 0);
  assert.equal((await calls.listCalls(people.owner, { q: 'kitchen' })).total, 1);
});

test('CSV neutralises spreadsheet formulas', async () => {
  const csv = await calls.toCsv(people.owner, { client_id: 'acme' });
  assert.ok(!/,=HYPERLINK/.test(csv));
  assert.ok(csv.includes(`"'=HYPERLINK(""x"")"`));
});

test('Greek area codes map to regions', () => {
  assert.equal(regionForPhone('+302101234567'), 'attica');
  assert.equal(regionForPhone('+302310123456'), 'central_macedonia');
  assert.equal(regionForPhone('+302385012345'), 'west_macedonia');
  assert.equal(regionForPhone('+302661012345'), 'ionian_islands');
  assert.equal(regionForPhone('+302665012345'), 'epirus');
  assert.equal(regionForPhone('+302810123456'), 'crete');
  assert.equal(regionForPhone('+306971234567'), 'mobile');
  assert.equal(regionForPhone('+441234567890'), null);
});
