'use strict';
// Missed-call alerts by Viber, through one agency bot (VIBER_AUTH_TOKEN). Viber lets a bot message only people who
// subscribed, and has no API to list them, so people link themselves: in a client's Alerts and reports they get a short
// code, open the bot and send it; the callback below records their Viber id against that client.
// Bots are commercial (Rakuten Viber or a partner, since 5 Feb 2024): see README › Lead tools.
const crypto = require('crypto');
const { db } = require('../db');

const API = () => (process.env.VIBER_API_BASE || 'https://chatapi.viber.com/pa').replace(/\/$/, '');
const TOKEN = () => process.env.VIBER_AUTH_TOKEN || '';
const SENDER = () => ({ name: (process.env.VIBER_SENDER_NAME || 'Ruler Calls').slice(0, 28) });
const enabled = () => !!TOKEN();

const s = {
  newLink: db.prepare("INSERT INTO viber_links (code, client_id, expires_at) VALUES (?, ?, datetime('now', '+1 day'))"),
  link: db.prepare("SELECT * FROM viber_links WHERE code = ? AND expires_at > datetime('now')"),
  dropLink: db.prepare('DELETE FROM viber_links WHERE code = ?'),
  subscribe: db.prepare('INSERT OR REPLACE INTO viber_subscribers (client_id, viber_id, name) VALUES (?, ?, ?)'),
  forClient: db.prepare('SELECT viber_id, name, linked_at FROM viber_subscribers WHERE client_id = ? ORDER BY linked_at'),
  remove: db.prepare('DELETE FROM viber_subscribers WHERE client_id = ? AND viber_id = ?'),
  unsubscribeAll: db.prepare('DELETE FROM viber_subscribers WHERE viber_id = ?'),
  clientName: db.prepare('SELECT name FROM clients WHERE id = ?')
};

async function call(method, body) {
  const r = await fetch(`${API()}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Viber-Auth-Token': TOKEN() },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000)
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.status !== 0) throw new Error(`Viber ${method}: ${data.status_message || r.status}`);
  return data;
}

const sendText = (receiver, text) => call('send_message', { receiver, type: 'text', text: text.slice(0, 7000), sender: SENDER() });

// A code someone sends the bot to receive one client's alerts. Easy to type: no 0/O or 1/I.
async function linkCode(clientId) {
  const code = 'CT-' + Array.from(crypto.randomBytes(6), (b) => 'ACDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 31]).join('');
  await s.newLink.run(code, clientId);
  return { code, expires_in_hours: 24 };
}

// Viber signs each callback: X-Viber-Content-Signature = hex HMAC-SHA256 of the raw body, keyed with the auth token.
function validSignature(raw, header) {
  if (!TOKEN() || !header) return false;
  const want = crypto.createHmac('sha256', TOKEN()).update(raw).digest('hex');
  return want.length === header.length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(header));
}

// Handle one callback. Returns what to answer Viber with (a welcome message is answered inline).
async function onCallback(ev) {
  if (ev.event === 'conversation_started') {
    return { sender: SENDER(), type: 'text', text: 'Send the code from Ruler Calls (it starts with CT-) to get missed-call alerts here.' };
  }
  if (ev.event === 'unsubscribed' && ev.user_id) { await s.unsubscribeAll.run(ev.user_id); return null; }
  if (ev.event === 'message' && ev.sender && ev.message && ev.message.type === 'text') {
    const code = String(ev.message.text || '').trim().toUpperCase().replace(/\s+/g, '');
    const link = /^CT-[A-Z0-9]{6}$/.test(code) ? await s.link.get(code) : null;
    if (!link) {
      await sendText(ev.sender.id, 'That code did not work. Make a new one in Ruler Calls: the client, Alerts and reports, Viber.');
      return null;
    }
    await s.subscribe.run(link.client_id, ev.sender.id, (ev.sender.name || '').slice(0, 80) || null);
    await s.dropLink.run(code);
    await sendText(ev.sender.id, `Done. Missed calls for ${(await s.clientName.get(link.client_id)).name} will arrive here.`);
  }
  return null;
}

async function alert(clientId, text) {
  const people = await s.forClient.all(clientId);
  const results = await Promise.allSettled(people.map((p) => sendText(p.viber_id, text)));
  return results.filter((r) => r.status === 'fulfilled').length;
}

const subscribers = (clientId) => s.forClient.all(clientId);
const removeSubscriber = async (clientId, viberId) => (await s.remove.run(clientId, viberId)).changes > 0;

module.exports = { enabled, linkCode, validSignature, onCallback, alert, subscribers, removeSubscriber, call };
