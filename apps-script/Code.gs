/**
 * Code.gs — Click-to-Call collector (Google Apps Script Web App)
 * Ruler Agency. FREE, Google-hosted "backend" — no server to run or pay for.
 *
 * Responsibilities
 *  1. Receive POST events from tracker.js (sent as text/plain to avoid CORS preflight).
 *  2. Append each event as a row to a Google Sheet (your reporting source of truth).
 *  3. Relay to Meta Conversions API (CAPI) with the SAME event_id used by the browser
 *     pixel, so Meta deduplicates them. This recovers conversions lost to ad-blockers/iOS.
 *
 * Multi-client: one deployment serves all clients. Per-client config lives in CLIENTS below
 * (or, better, in a "Config" sheet — see getClientConfig()).
 *
 * ──────────────── SETUP (10 min) ────────────────
 * 1. sheets.google.com → create a spreadsheet. Copy its ID from the URL.
 * 2. script.google.com → New project → paste this file.
 * 3. Set SHEET_ID below. Fill CLIENTS with each client's Meta pixel id + CAPI token
 *    (Events Manager → Settings → Conversions API → Generate access token).
 * 4. Deploy → New deployment → type "Web app" → Execute as: Me →
 *    Who has access: "Anyone" → Deploy. Copy the /exec URL.
 * 5. Put that URL into each client's CTC_CONFIG.collectorUrl (config/clients.*.json).
 * 6. Run setup() once from the editor to create the sheet header row (authorize when asked).
 */

// ============================ CONFIG ============================
var SHEET_ID = 'PUT_YOUR_SPREADSHEET_ID_HERE';
var SHEET_NAME = 'events';

// Per-client secrets. Keep CAPI tokens here (script is private to your account).
var CLIENTS = {
  // 'client-acme': {
  //   metaPixelId: '1234567890',
  //   metaCapiToken: 'EAAG...your-token...',
  //   metaTestEventCode: null,      // set e.g. 'TEST12345' while testing in Events Manager
  //   capiEventName: 'Contact'      // Meta standard event to send (Contact or Lead)
  // }
};

var COLUMNS = [
  'received_at', 'event_time', 'site_id', 'event_id', 'event_name', 'event_type',
  'phone', 'page_url', 'page_title', 'referrer',
  'gclid', 'gbraid', 'wbraid', 'fbclid', 'msclkid',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
  'ga_client_id', 'fbp', 'fbc',
  'first_landing', 'first_ts',
  'call_status', 'call_duration', 'tracking_number',  // phase-2 / DNI
  'capi_result', 'user_agent', 'element_text'
];

// ============================ ENTRYPOINTS ============================
function doPost(e) {
  try {
    var raw = (e && e.postData && e.postData.contents) || '{}';
    var ev = JSON.parse(raw);
    var capiResult = relayToMetaCAPI(ev);   // best-effort; never blocks logging
    appendRow(ev, capiResult);
    return json({ ok: true, event_id: ev.event_id, capi: capiResult });
  } catch (err) {
    // Log the failure so nothing is silently dropped.
    try { appendRow({ site_id: 'ERROR', event_name: String(err) }, 'error'); } catch (e2) {}
    return json({ ok: false, error: String(err) });
  }
}

function doGet() {
  return json({ ok: true, service: 'ctc-collector', columns: COLUMNS });
}

// ============================ SHEET ============================
function getSheet_() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  if (sh.getLastRow() === 0) sh.appendRow(COLUMNS);
  return sh;
}

function appendRow(ev, capiResult) {
  var ft = ev.first_touch || {};
  var lt = ev.last_touch || {};
  var row = [
    new Date(),
    ev.event_time ? new Date(ev.event_time * 1000) : '',
    ev.site_id || '', ev.event_id || '', ev.event_name || '', ev.event_type || '',
    ev.phone || '', ev.page_url || '', ev.page_title || '', ev.referrer || '',
    lt.gclid || '', lt.gbraid || '', lt.wbraid || '', lt.fbclid || '', lt.msclkid || '',
    lt.utm_source || '', lt.utm_medium || '', lt.utm_campaign || '', lt.utm_content || '', lt.utm_term || '',
    ev.ga_client_id || '', ev.fbp || '', ev.fbc || '',
    ft.landing_page || '', ft.ts ? new Date(ft.ts) : '',
    ev.call_status || '', ev.call_duration || '', ev.tracking_number || '',
    capiResult || '', ev.user_agent || '', ev.element_text || ''
  ];
  getSheet_().appendRow(row);
}

// ============================ META CAPI ============================
function getClientConfig(siteId) {
  return CLIENTS[siteId] || null;
}

function sha256_(s) {
  if (!s) return null;
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s).trim().toLowerCase());
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function relayToMetaCAPI(ev) {
  var cc = getClientConfig(ev.site_id);
  if (!cc || !cc.metaPixelId || !cc.metaCapiToken) return 'skipped';

  var userData = {};
  if (ev.fbp) userData.fbp = ev.fbp;
  if (ev.fbc) userData.fbc = ev.fbc;
  if (ev.phone) userData.ph = [sha256_(ev.phone.replace(/[^\d]/g, ''))]; // hashed phone improves match
  if (ev.user_agent) userData.client_user_agent = ev.user_agent;
  if (ev.ga_client_id) userData.external_id = [sha256_(ev.ga_client_id)];

  var payload = {
    data: [{
      event_name: cc.capiEventName || 'Contact',
      event_time: ev.event_time || Math.floor(Date.now() / 1000),
      event_id: ev.event_id,                 // <-- dedup with browser pixel
      action_source: 'website',
      event_source_url: ev.page_url || '',
      user_data: userData,
      custom_data: { content_name: 'phone_call_click', phone: ev.phone || '' }
    }]
  };
  if (cc.metaTestEventCode) payload.test_event_code = cc.metaTestEventCode;

  var url = 'https://graph.facebook.com/v21.0/' + cc.metaPixelId +
    '/events?access_token=' + encodeURIComponent(cc.metaCapiToken);
  try {
    var res = UrlFetchApp.fetch(url, {
      method: 'post', contentType: 'application/json',
      payload: JSON.stringify(payload), muteHttpExceptions: true
    });
    var code = res.getResponseCode();
    return code === 200 ? 'ok' : ('err:' + code + ':' + res.getContentText().slice(0, 120));
  } catch (err) {
    return 'exception:' + String(err).slice(0, 120);
  }
}

// ============================ HELPERS ============================
function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// Run once from the editor to initialize the header row + authorize scopes.
function setup() {
  getSheet_();
  Logger.log('Sheet ready: ' + SpreadsheetApp.openById(SHEET_ID).getUrl());
}
