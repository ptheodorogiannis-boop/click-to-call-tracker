'use strict';
// Drives /mcp with the SDK's own client over the real Streamable HTTP transport.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { seed, start } = require('./helpers');
const users = require('../src/users');

const people = seed();
let srv;
test.before(async () => { srv = await start(); });
test.after(() => srv.close());

async function connect(token) {
  const client = new Client({ name: 'test', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(srv.base + '/mcp'), {
    requestInit: { headers: token ? { Authorization: 'Bearer ' + token } : {} }
  });
  await client.connect(transport);
  return client;
}
const data = (r) => JSON.parse(r.content[0].text);

test('no token, no MCP', async () => {
  await assert.rejects(connect(null));
  await assert.rejects(connect('ct_not-a-real-token-at-all-000000000'));
});

test('a member gets read and write tools and can work a lead', async () => {
  const c = await connect(users.createToken(people.member.id, 'claude').token);
  const names = (await c.listTools()).tools.map((t) => t.name).sort();
  assert.deepEqual(names, ['add_note', 'calls_to_call_back', 'get_call', 'get_overview', 'get_report', 'list_calls',
    'list_clients', 'mark_called_back', 'search_calls', 'set_lead_status', 'tag_call', 'whoami']);

  const clients = data(await c.callTool({ name: 'list_clients', arguments: {} }));
  assert.deepEqual(clients.clients.map((k) => k.id).sort(), ['acme', 'beta']);

  const r = data(await c.callTool({ name: 'set_lead_status', arguments: { call_sid: 'CA1', status: 'good', value: 120 } }));
  assert.equal(r.lead_status, 'good');
  assert.equal(r.value_effective, 120);
  const n = data(await c.callTool({ name: 'add_note', arguments: { call_sid: 'CA1', text: 'from Claude' } }));
  assert.equal(n.notes.at(-1).author, 'Maria');

  const bad = await c.callTool({ name: 'set_lead_status', arguments: { call_sid: 'NOPE', status: 'good' } });
  assert.ok(bad.isError);
  await c.close();
});

test('a client token reads its own client only and has no write tools', async () => {
  const c = await connect(users.createToken(people.client.id, 'portal').token);
  const names = (await c.listTools()).tools.map((t) => t.name);
  assert.ok(!names.includes('set_lead_status') && !names.includes('add_note') && !names.includes('tag_call'));

  const list = data(await c.callTool({ name: 'list_calls', arguments: { limit: 100 } }));
  assert.ok(list.calls.length > 0 && list.calls.every((x) => x.client_id === 'acme'));

  const other = await c.callTool({ name: 'get_call', arguments: { call_sid: 'CB1' } });
  assert.ok(other.isError);
  assert.match(other.content[0].text, /not found/);

  const s = data(await c.callTool({ name: 'search_calls', arguments: { query: 'secret beta' } }));
  assert.equal(s.total, 0);

  const blocked = await c.callTool({ name: 'set_lead_status', arguments: { call_sid: 'CA1', status: 'spam' } });
  assert.ok(blocked.isError, 'unregistered tool');
  await c.close();
});

test('overview through MCP matches the scope', async () => {
  const c = await connect(users.createToken(people.client.id, 'portal2').token);
  const o = data(await c.callTool({ name: 'get_overview', arguments: { days: 30 } }));
  assert.equal(o.by_client.length, 1);
  assert.equal(o.totals.calls, 5);
  await c.close();
});
