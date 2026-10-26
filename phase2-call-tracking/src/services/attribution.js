'use strict';
const crypto = require('crypto');

function uuid() { return crypto.randomUUID(); }

// Normalize a phone to E.164, Greek-aware (mirror of the client tracker).
function normalizePhone(raw) {
  if (!raw) return null;
  let n = String(raw).replace(/[^\d+]/g, '');
  if (!n) return null;
  if (n[0] === '+') return n;
  if (n.startsWith('00')) return '+' + n.slice(2);
  if (n.length === 10 && (n[0] === '6' || n[0] === '2')) return '+30' + n; // GR mobile/landline
  return n;
}

// SHA-256 hex of a normalized, lowercased value (for hashed PII to ad platforms).
function sha256(v) {
  if (!v) return null;
  return crypto.createHash('sha256').update(String(v).trim().toLowerCase()).digest('hex');
}

// Decide the marketing channel from attribution. 'google_ads' specifically when a click id exists.
function deriveChannel(a = {}) {
  const src = (a.utm_source || '').toLowerCase();
  const med = (a.utm_medium || '').toLowerCase();
  if (a.gclid || a.gbraid || a.wbraid) return 'google_ads';
  if (a.fbclid || a.fbc) return 'meta_ads';
  if (a.msclkid) return 'microsoft_ads';
  if (/cpc|ppc|paid/.test(med)) {
    if (/google/.test(src)) return 'google_ads';
    if (/facebook|instagram|meta/.test(src)) return 'meta_ads';
    return 'other_paid';
  }
  if (/google/.test(src)) return 'google_organic';
  if (/facebook|instagram|meta/.test(src)) return 'meta_organic';
  if (a.referrer) return 'referral';
  return 'direct';
}

module.exports = { uuid, normalizePhone, sha256, deriveChannel };
