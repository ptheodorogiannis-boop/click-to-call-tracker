'use strict';
const cfg = require('../config');
const { sha256 } = require('./attribution');

/**
 * Push a qualified call as a conversion to each configured platform.
 * Because we use a session-level pool, `call` carries the real gclid/fbclid —
 * so Google Ads gets a proper offline CLICK conversion (bid-optimizable) and
 * Meta gets a CAPI Lead keyed by fbc/fbp + hashed caller phone.
 *
 * Returns { google, meta, ga4 } status strings (stored on the call row).
 */
async function pushConversions(client, call) {
  const conf = safeJson(client.config_json);
  const out = {};
  const eventTimeSec = Math.floor(new Date(call.started_at + 'Z').getTime() / 1000) || Math.floor(Date.now() / 1000);

  out.google = await pushGoogle(conf.googleAds, call, client).catch(e => 'error:' + trunc(e));
  out.meta = await pushMeta(conf.meta, call, eventTimeSec).catch(e => 'error:' + trunc(e));
  out.ga4 = await pushGA4(conf.ga4, call).catch(e => 'error:' + trunc(e));
  return out;
}

// ── Google Ads: offline click conversion via gclid ─────────────────────────
async function pushGoogle(g, call, client) {
  if (!g || !g.customerId || !g.conversionActionId) return 'skipped';
  if (!call.gclid && !call.gbraid && !call.wbraid) return 'no_click_id';
  if (!cfg.googleAds.developerToken || !cfg.googleAds.refreshToken) return 'no_credentials';

  const { GoogleAdsApi } = require('google-ads-api');
  const api = new GoogleAdsApi({
    client_id: cfg.googleAds.clientId,
    client_secret: cfg.googleAds.clientSecret,
    developer_token: cfg.googleAds.developerToken
  });
  const customer = api.Customer({
    customer_id: String(g.customerId).replace(/-/g, ''),
    login_customer_id: cfg.googleAds.loginCustomerId,
    refresh_token: cfg.googleAds.refreshToken
  });

  const conversion = {
    conversion_action: `customers/${String(g.customerId).replace(/-/g, '')}/conversionActions/${g.conversionActionId}`,
    conversion_date_time: toGoogleDateTime(call.started_at),
    conversion_value: client.lead_value || 0,
    currency_code: client.currency || 'EUR'
  };
  if (call.gclid) conversion.gclid = call.gclid;
  if (call.gbraid) conversion.gbraid = call.gbraid;
  if (call.wbraid) conversion.wbraid = call.wbraid;

  const res = await customer.conversionUploads.uploadClickConversions([conversion], {
    partial_failure: true
  });
  const err = res && res.partial_failure_error;
  return err ? 'partial_error:' + trunc(err.message || JSON.stringify(err)) : 'ok';
}

// ── Meta Conversions API: Lead ──────────────────────────────────────────────
async function pushMeta(m, call, eventTimeSec) {
  if (!m || !m.pixelId || !m.capiToken) return 'skipped';
  const userData = {};
  if (call.fbc) userData.fbc = call.fbc;
  if (call.fbp) userData.fbp = call.fbp;
  if (call.caller) userData.ph = [sha256(call.caller.replace(/[^\d]/g, ''))];
  if (call.ga_client_id) userData.external_id = [sha256(call.ga_client_id)];

  const payload = {
    data: [{
      event_name: 'Lead',
      event_time: eventTimeSec,
      event_id: call.call_sid,                 // dedup if you also fire a browser Lead
      action_source: 'phone_call',
      user_data: userData,
      custom_data: {
        lead_event_source: 'ctc_call_tracking',
        channel: call.channel,
        call_duration: call.duration_sec
      }
    }]
  };
  if (m.testEventCode) payload.test_event_code = m.testEventCode;

  const r = await fetch(`https://graph.facebook.com/v21.0/${m.pixelId}/events?access_token=${encodeURIComponent(m.capiToken)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  });
  return r.ok ? 'ok' : 'err:' + r.status + ':' + trunc(await r.text());
}

// ── GA4 Measurement Protocol ────────────────────────────────────────────────
async function pushGA4(ga, call) {
  if (!ga || !ga.measurementId || !ga.apiSecret) return 'skipped';
  if (!call.ga_client_id) return 'no_client_id';
  const payload = {
    client_id: call.ga_client_id,
    events: [{
      name: 'phone_call',
      params: {
        channel: call.channel, call_duration: call.duration_sec,
        campaign: call.utm_campaign || undefined, source: call.utm_source || undefined
      }
    }]
  };
  const r = await fetch(`https://www.google-analytics.com/mp/collect?measurement_id=${ga.measurementId}&api_secret=${ga.apiSecret}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  });
  return r.ok ? 'ok' : 'err:' + r.status;
}

// ── helpers ─────────────────────────────────────────────────────────────────
function safeJson(s) { try { return JSON.parse(s || '{}'); } catch (e) { return {}; } }
function trunc(s) { return String(s).slice(0, 140); }
// Google wants "yyyy-MM-dd HH:mm:ss+|-HH:mm". We store UTC; emit +00:00.
function toGoogleDateTime(sqliteUtc) {
  return (sqliteUtc || '').replace('T', ' ').slice(0, 19) + '+00:00';
}

module.exports = { pushConversions };
