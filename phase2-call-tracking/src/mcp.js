'use strict';
// POST /mcp — Model Context Protocol over Streamable HTTP, stateless: one server per request, authenticated by a
// personal Bearer ct_ token. Every tool runs as that token's user, inside that user's client scope, through calls.js.
// Never exposed: Twilio credentials, number pools, conversion secrets, deletion, users.
const express = require('express');
const { z } = require('zod');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const calls = require('./calls');
const { canEdit } = require('./users');
const { bearerUser } = require('./auth');

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
const ok = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data });
const fail = (message) => ({ content: [{ type: 'text', text: message }], isError: true });

// Errors from calls.js (not found, invalid, forbidden) come back as tool errors the model can read and recover from.
const run = (fn) => async (args) => {
  try { return ok(await fn(args || {})); }
  catch (e) { return fail(e.status ? e.message : 'Something went wrong on the server.'); }
};

function buildServer(user) {
  const server = new McpServer(
    { name: 'ruler-calltrack', version: '2.0.0' },
    { instructions: 'Call tracking for Ruler Agency clients: phone calls with their marketing source (channel, campaign, keyword, landing page), answered or missed, lead status, value, recordings and transcripts. Start with list_clients or get_overview. Dates are YYYY-MM-DD. A lead is a call marked good/customer, or an unjudged call that lasted past the client\'s qualifying duration.' }
  );
  const read = { readOnlyHint: true, openWorldHint: false };
  const write = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };

  server.registerTool('whoami', {
    description: 'The user this token belongs to: name, role and which clients they can see.',
    annotations: read
  }, run(() => ({ user: { name: user.name, login: user.login, role: user.role }, clients: calls.visibleClients(user).map((k) => ({ id: k.id, name: k.name })) })));

  server.registerTool('list_clients', {
    description: 'Clients with their totals for a period (calls, answered, missed, leads, value, answer rate, calls to call back) and attention flags. Most other tools take a client_id from here.',
    inputSchema: { days: z.number().int().min(1).max(730).optional().describe('Period length ending today, default 30') },
    annotations: read
  }, run(({ days }) => {
    const b = calls.clientBoard(user, { days });
    return { range: b.range, clients: b.clients.map(({ trend, ...rest }) => rest) };
  }));

  server.registerTool('get_overview', {
    description: 'Headline numbers for all visible clients or one client: totals with the previous period, calls by channel, by client, by Greek region, and how many missed calls still need a call back.',
    inputSchema: {
      client_id: z.string().optional(), days: z.number().int().min(1).max(730).optional(),
      since: date.optional(), until: date.optional()
    },
    annotations: read
  }, run((a) => { const o = calls.overview(user, a); delete o.daily; o.by_client = o.by_client.map(({ trend, ...rest }) => rest); return o; }));

  server.registerTool('get_report', {
    description: 'A client report for a period: totals and change, last 12 months by month, channels, campaigns, keywords, first-time vs repeat callers, regions.',
    inputSchema: { client_id: z.string().optional(), since: date.optional(), until: date.optional(), days: z.number().int().optional() },
    annotations: read
  }, run((a) => { const r = calls.report(user, a); delete r.daily; return r; }));

  const filters = {
    client_id: z.string().optional(),
    since: date.optional(), until: date.optional(),
    status: z.enum(['answered', 'missed', 'to_call_back', 'blocked']).optional().describe('blocked = callers on the block list, turned away; otherwise blocked calls are left out'),
    channel: z.string().optional().describe('google_ads, meta_ads, microsoft_ads, other_paid, google_organic, meta_organic, referral, direct; fixed numbers: google_business, print, radio, tv, outdoor, partner, offline_other'),
    lead_status: z.enum(['new', 'good', 'not_lead', 'customer', 'spam']).optional(),
    tag: z.string().optional(),
    leads_only: z.boolean().optional(),
    limit: z.number().int().min(1).max(200).optional(), offset: z.number().int().min(0).optional()
  };
  server.registerTool('list_calls', {
    description: 'Calls, newest first, with source, status, duration, lead status, value and tags. Filter by client, dates, status, channel, lead status or tag.',
    inputSchema: filters, annotations: read
  }, run((a) => calls.listCalls(user, a)));

  server.registerTool('search_calls', {
    description: 'Find calls by caller number, campaign, keyword, landing page, client name, transcript text or note text.',
    inputSchema: { query: z.string().min(2), ...filters }, annotations: read
  }, run(({ query, ...a }) => calls.listCalls(user, { ...a, q: query })));

  server.registerTool('get_call', {
    description: 'One call in full: attribution (channel, campaign, keyword, landing page, click ids), outcome, transcript, tags and notes.',
    inputSchema: { call_sid: z.string() }, annotations: read
  }, run(({ call_sid }) => calls.getCall(user, call_sid)));

  server.registerTool('calls_to_call_back', {
    description: 'Missed calls from the last 14 days that nobody has called back and that the caller did not follow up with an answered call. Oldest first is not guaranteed; check started_at.',
    inputSchema: { client_id: z.string().optional(), limit: z.number().int().min(1).max(200).optional() }, annotations: read
  }, run((a) => calls.listCalls(user, { ...a, status: 'to_call_back' })));

  if (canEdit(user)) {
    server.registerTool('set_lead_status', {
      description: 'Judge a call: new, good (a real lead), not_lead, customer (became a customer) or spam. Optionally set its value in the client\'s currency; value null goes back to the client default.',
      inputSchema: { call_sid: z.string(), status: z.enum(['new', 'good', 'not_lead', 'customer', 'spam']), value: z.number().min(0).nullable().optional() },
      annotations: write
    }, run(({ call_sid, status, value }) => calls.updateLead(user, call_sid, { lead_status: status, value })));

    server.registerTool('tag_call', {
      description: 'Add and/or remove tags on a call (lowercase, up to 40 characters each).',
      inputSchema: { call_sid: z.string(), add: z.array(z.string()).optional(), remove: z.array(z.string()).optional() },
      annotations: write
    }, run(({ call_sid, add, remove }) => calls.tagCall(user, call_sid, { add, remove })));

    server.registerTool('add_note', {
      description: 'Add a note to a call, signed with this token\'s user.',
      inputSchema: { call_sid: z.string(), text: z.string().min(1).max(4000) },
      annotations: { ...write, idempotentHint: false }
    }, run(({ call_sid, text }) => calls.addNote(user, call_sid, text)));

    server.registerTool('mark_called_back', {
      description: 'Mark a missed call as called back (done true), or undo it (done false).',
      inputSchema: { call_sid: z.string(), done: z.boolean().optional() },
      annotations: write
    }, run(({ call_sid, done }) => calls.markCalledBack(user, call_sid, done !== false)));
  }
  return server;
}

const router = express.Router();

router.post('/', express.json({ limit: '1mb' }), async (req, res) => {
  const user = bearerUser(req);
  if (!user) {
    res.set('WWW-Authenticate', 'Bearer realm="ruler-calltrack"');
    return res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Send a personal API token: Authorization: Bearer ct_…' }, id: null });
  }
  const server = buildServer(user);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => { transport.close(); server.close(); });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    console.error('[mcp]', e && e.stack ? e.stack : e);
    if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
  }
});

// Stateless: no server-sent stream to resume and no session to end.
const notAllowed = (req, res) => res.status(405).set('Allow', 'POST').json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null });
router.get('/', notAllowed);
router.delete('/', notAllowed);

module.exports = router;
