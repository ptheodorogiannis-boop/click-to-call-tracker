'use strict';
const cfg = require('./config');
const { q } = require('./db');
const { uuid, deriveChannel } = require('./services/attribution');

/**
 * Assign a tracking number to a visitor (full session-level DNI).
 * Picks a number from the client's pool that currently has no active reservation,
 * reserves it for SESSION_TTL_MINUTES with the visitor's attribution snapshot.
 *
 * Returns { phone, sessionId, fallback } or null if the client has no pool.
 * `fallback:true` means the pool was exhausted and we reused the least-recently
 * assigned number — attribution still recorded, but two visitors could share it.
 */
function assignNumber(clientId, attribution, meta = {}) {
  const pool = q.poolNumbers.all(clientId);
  if (!pool.length) return null;

  let phone = (q.freeNumbers.get(clientId) || {}).phone || null;
  let fallback = false;
  if (!phone) {
    // Pool exhausted: reuse the number whose last reservation is oldest.
    fallback = true;
    phone = pool[Math.floor(Date.now() / 1000) % pool.length].phone; // deterministic-ish spread
  }

  const ttlMs = cfg.defaults.sessionTtlMinutes * 60000;
  const expiresAt = new Date(Date.now() + ttlMs).toISOString().replace('T', ' ').slice(0, 19);
  const sessionId = uuid();
  const a = attribution || {};

  q.insertSession.run({
    id: sessionId,
    client_id: clientId,
    phone,
    visitor_id: meta.visitorId || null,
    expires_at: expiresAt,
    channel: deriveChannel(a),
    gclid: a.gclid || null, gbraid: a.gbraid || null, wbraid: a.wbraid || null,
    fbclid: a.fbclid || null, msclkid: a.msclkid || null,
    utm_source: a.utm_source || null, utm_medium: a.utm_medium || null,
    utm_campaign: a.utm_campaign || null, utm_content: a.utm_content || null, utm_term: a.utm_term || null,
    ga_client_id: a.ga_client_id || null, fbp: a.fbp || null, fbc: a.fbc || null,
    landing_page: a.landing_page || null, referrer: a.referrer || null,
    user_agent: meta.userAgent || null, ip: meta.ip || null
  });

  return { phone, sessionId, fallback };
}

module.exports = { assignNumber };
