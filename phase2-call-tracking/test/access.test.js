'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { seed } = require('./helpers');
const users = require('../src/users');
const calls = require('../src/calls');
const { regionForPhone } = require('../src/geo');

const people = seed();

test('passwords are salted scrypt and verify', () => {
  const a = users.hashPassword('correct horse battery');
  assert.notEqual(a, users.hashPassword('correct horse battery'));
  assert.ok(users.verifyPassword('correct horse battery', a));
  assert.ok(!users.verifyPassword('wrong', a));
});

test('the bootstrap owner signs in with the old ADMIN_USER, not an email', () => {
  assert.equal(people.owner.login, 'admin');
  assert.equal(people.owner.role, 'owner');
  assert.ok(users.login('admin', 'admin-password-123'));
  assert.ok(users.login('ADMIN', 'admin-password-123'), 'login is case-insensitive');
  assert.equal(users.login('admin', 'nope'), null);
  assert.equal(users.bootstrapOwner(), null, 'only on an empty users table');
});

test('tokens: shown once, stored hashed, revocable, die with the user', () => {
  const { id, token } = users.createToken(people.member.id, 'Claude');
  assert.match(token, /^ct_[\w-]{32}$/);
  assert.equal(users.userForToken(token).id, people.member.id);
  assert.equal(users.userForToken(token.slice(0, -1) + (token.endsWith('x') ? 'y' : 'x')), null);
  assert.ok(users.revokeToken(people.member.id, id));
  assert.equal(users.userForToken(token), null);

  const t2 = users.createToken(people.member.id, 'second').token;
  users.updateUser(people.member.id, { active: false });
  assert.equal(users.userForToken(t2), null, 'a switched-off user’s tokens stop working');
  users.updateUser(people.member.id, { active: true });
});

test('a client user sees only their own client, everywhere', () => {
  const c = people.client;
  assert.deepEqual(calls.visibleClients(c).map((k) => k.id), ['acme']);
  assert.ok(calls.listCalls(c, { limit: 100 }).calls.every((x) => x.client_id === 'acme'));
  assert.throws(() => calls.getCall(c, 'CB1'), { status: 404 });
  assert.throws(() => calls.listCalls(c, { client_id: 'beta' }), { status: 404 });
  assert.throws(() => calls.report(c, { client_id: 'beta' }), { status: 404 });
  assert.equal(calls.search(c, 'secret beta').calls.length, 0, 'search does not leak other clients’ transcripts');
  assert.equal(calls.overview(c).by_client.length, 1);
});

test('client users cannot write; members can', () => {
  assert.throws(() => calls.updateLead(people.client, 'CA1', { lead_status: 'good' }), { status: 403 });
  assert.throws(() => calls.addNote(people.client, 'CA1', 'hi'), { status: 403 });
  const c = calls.updateLead(people.member, 'CA1', { lead_status: 'customer', value: 250 });
  assert.equal(c.lead_status, 'customer');
  assert.equal(c.value_effective, 250);
  assert.throws(() => calls.updateLead(people.member, 'CA1', { lead_status: 'maybe' }), { status: 400 });
});

test('lead rules: judging a call overrides the duration rule', () => {
  const before = calls.totals(people.owner, { client_id: 'acme' }).leads;
  calls.updateLead(people.member, 'CA3', { lead_status: 'good' });          // 12 s, not qualified, now a lead
  calls.updateLead(people.member, 'CA5', { lead_status: 'spam' });          // qualified, now not a lead
  assert.equal(calls.totals(people.owner, { client_id: 'acme' }).leads, before);
  calls.updateLead(people.member, 'CA5', { lead_status: 'new' });
  assert.equal(calls.totals(people.owner, { client_id: 'acme' }).leads, before + 1);
});

test('to call back: missed, not followed by an answered call, not done yet', () => {
  const sids = () => calls.listCalls(people.owner, { status: 'to_call_back' }).calls.map((c) => c.call_sid).sort();
  // CA4 (missed) was followed by CA5 (answered) from the same caller, so only CA2 and CB2 are open.
  assert.deepEqual(sids(), ['CA2', 'CB2']);
  calls.markCalledBack(people.member, 'CA2');
  assert.deepEqual(sids(), ['CB2']);
  calls.markCalledBack(people.member, 'CA2', false);
  assert.deepEqual(sids(), ['CA2', 'CB2']);
});

test('tags are normalised and searchable', () => {
  calls.tagCall(people.member, 'CA1', { add: ['  Kitchen   Quote ', 'VIP'] });
  assert.deepEqual(calls.getCall(people.owner, 'CA1').tags, ['kitchen quote', 'vip']);
  assert.equal(calls.listCalls(people.owner, { tag: 'vip' }).total, 1);
  calls.tagCall(people.member, 'CA1', { remove: ['vip'] });
  assert.deepEqual(calls.getCall(people.owner, 'CA1').tags, ['kitchen quote']);
});

test('search escapes LIKE wildcards', () => {
  assert.equal(calls.listCalls(people.owner, { q: '%' }).total, 0);
  assert.equal(calls.listCalls(people.owner, { q: 'kitchen' }).total, 1);
});

test('CSV neutralises spreadsheet formulas', () => {
  const csv = calls.toCsv(people.owner, { client_id: 'acme' });
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
