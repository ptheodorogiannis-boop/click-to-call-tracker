/*!
 * ctc-tracker.js — Click-to-Call tracker (multi-client, no-backend-friendly)
 * Ruler Agency — phase 1: click-to-call attribution.
 *
 * What it does
 *  - Captures ad attribution on landing (gclid, gbraid/wbraid, fbclid, UTMs, GA client_id,
 *    Meta _fbp/_fbc, referrer, landing page) with first-touch + last-touch, 90-day window.
 *  - Detects clicks on tel: links and any element matching the configured selectors
 *    (call buttons, WhatsApp/Viber click-to-chat if you want them counted as a lead).
 *  - On each qualifying click it:
 *      1. mints a unique event_id (used to DEDUPE browser pixel vs server CAPI),
 *      2. pushes a `phone_call_click` event to dataLayer (so GTM can fire GA4 / Google Ads / Meta),
 *      3. (optional) fires gtag + fbq directly if you are NOT using GTM,
 *      4. sends a beacon to the Apps Script collector (Google Sheet + Meta CAPI relay).
 *
 * How to load (pick ONE):
 *  A) Standalone <script>:
 *       <script>window.CTC_CONFIG = { ...see config/clients.example.json... };</script>
 *       <script src="https://yourcdn/ctc-tracker.js" defer></script>
 *  B) Inside a GTM "Custom HTML" tag firing on All Pages — paste this file wrapped in <script>,
 *     and set window.CTC_CONFIG just above it. (See gtm/GTM-SETUP.md.)
 *
 * IMPORTANT: this file is deliberately dependency-free and ~5KB. Safe to ship to clients.
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // 0. Config resolution
  // ---------------------------------------------------------------------------
  var cfg = (window.CTC_CONFIG || {});
  if (!cfg.siteId) {
    // Multi-client safety: refuse to run unlabeled so data in the sheet is always attributable.
    console.warn('[ctc] CTC_CONFIG.siteId is required — tracker disabled.');
    return;
  }

  var DEFAULTS = {
    // selectors that count as a "call lead". tel: links are auto-detected regardless.
    selectors: ['a[href^="tel:"]', '[data-ctc-call]'],
    // optional: also treat these as call-intent leads (set to [] to ignore)
    chatSelectors: [], // e.g. ['a[href*="wa.me"]','a[href^="viber:"]','a[href*="api.whatsapp.com"]']
    attributionWindowDays: 90,
    dedupeWindowMs: 1500,      // ignore double-clicks on the same number within this window
    eventName: 'phone_call_click',
    collectorUrl: null,        // Apps Script web-app URL (the Sheet + CAPI relay). Optional.
    pushToDataLayer: true,     // recommended path when using GTM
    fireDirect: false,         // set true ONLY if you are not using GTM and want this file to fire pixels
    googleAds: null,           // { conversionId:'AW-XXXX', conversionLabel:'abc' }  (direct mode)
    ga4MeasurementId: null,    // 'G-XXXX' (direct mode)
    metaPixelId: null,         // '1234567890' (direct mode)
    debug: false
  };
  var C = {};
  for (var k in DEFAULTS) C[k] = (cfg[k] != null ? cfg[k] : DEFAULTS[k]);
  C.siteId = cfg.siteId;

  function log() { if (C.debug) try { console.log.apply(console, ['[ctc]'].concat([].slice.call(arguments))); } catch (e) {} }

  // ---------------------------------------------------------------------------
  // 1. Small utils (cookies, storage, uuid)
  // ---------------------------------------------------------------------------
  function now() { return new Date().getTime(); }

  function uuid() {
    // RFC4122-ish; good enough for dedup keys
    return 'ctc-' + 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0, v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function getCookie(name) {
    var m = document.cookie.match('(?:^|; )' + name.replace(/([.$?*|{}()\[\]\\\/+^])/g, '\\$1') + '=([^;]*)');
    return m ? decodeURIComponent(m[1]) : null;
  }

  function lsGet(key) { try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; } }
  function lsSet(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} }

  function qs(name) {
    var m = location.search.match(new RegExp('[?&]' + name + '=([^&]+)'));
    return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : null;
  }

  // GA4 client_id from the _ga cookie ("GA1.1.XXXXXXXXX.TTTTTTTTTT" -> "XXXXXXXXX.TTTTTTTTTT")
  function gaClientId() {
    var v = getCookie('_ga');
    if (!v) return null;
    var parts = v.split('.');
    return parts.length >= 4 ? parts.slice(-2).join('.') : null;
  }

  // ---------------------------------------------------------------------------
  // 2. Attribution capture (first-touch + last-touch, persisted)
  // ---------------------------------------------------------------------------
  var ATTR_KEY = 'ctc_attr_' + C.siteId;

  function collectTouch() {
    return {
      ts: now(),
      gclid: qs('gclid') || getCookie('_gcl_aw') || null,
      gbraid: qs('gbraid') || null,
      wbraid: qs('wbraid') || null,
      fbclid: qs('fbclid') || null,
      msclkid: qs('msclkid') || null,
      utm_source: qs('utm_source'),
      utm_medium: qs('utm_medium'),
      utm_campaign: qs('utm_campaign'),
      utm_content: qs('utm_content'),
      utm_term: qs('utm_term'),
      landing_page: location.href,
      referrer: document.referrer || null
    };
  }

  function hasSignal(t) {
    return !!(t.gclid || t.gbraid || t.wbraid || t.fbclid || t.msclkid ||
      t.utm_source || t.utm_medium || t.utm_campaign);
  }

  function getAttribution() {
    var store = lsGet(ATTR_KEY) || {};
    var maxAge = C.attributionWindowDays * 86400000;
    var t = collectTouch();

    // First touch: set once, refresh if expired.
    if (!store.first || (now() - store.first.ts) > maxAge) {
      store.first = t;
    }
    // Last touch: overwrite whenever this visit carries a fresh ad signal.
    if (hasSignal(t) || !store.last || (now() - store.last.ts) > maxAge) {
      store.last = t;
    }
    lsSet(ATTR_KEY, store);
    return store;
  }

  // ---------------------------------------------------------------------------
  // 3. Phone normalization (Greek-aware)
  // ---------------------------------------------------------------------------
  function normalizePhone(raw) {
    if (!raw) return null;
    var n = String(raw).replace(/^tel:/i, '').replace(/[^\d+]/g, '');
    if (!n) return null;
    if (n.charAt(0) === '+') return n;            // already E.164
    if (n.indexOf('00') === 0) return '+' + n.slice(2);
    // Greek defaults: 10-digit national numbers -> +30; mobile starts with 69, landline with 2.
    if (n.length === 10 && (n.charAt(0) === '6' || n.charAt(0) === '2')) return '+30' + n;
    return n;
  }

  // ---------------------------------------------------------------------------
  // 4. Event dispatch
  // ---------------------------------------------------------------------------
  var lastFire = {}; // phone -> ts, for dedupe

  function buildEvent(phone, sourceEl, kind) {
    var attr = getAttribution();
    return {
      v: 1,
      site_id: C.siteId,
      event_id: uuid(),               // dedup key (pixel <-> CAPI)
      event_name: C.eventName,
      event_type: kind,               // 'tel' | 'chat'
      event_time: Math.floor(now() / 1000),
      phone: normalizePhone(phone),
      page_url: location.href,
      page_title: document.title,
      referrer: document.referrer || null,
      user_agent: navigator.userAgent,
      // identifiers for ad platforms
      ga_client_id: gaClientId(),
      fbp: getCookie('_fbp'),
      fbc: getCookie('_fbc') || (qs('fbclid') ? ('fb.1.' + now() + '.' + qs('fbclid')) : null),
      // attribution (first + last touch)
      first_touch: attr.first || null,
      last_touch: attr.last || null,
      // phase-2 / DNI placeholders (kept null now so the sheet schema is stable)
      call_status: null,              // 'answered' | 'missed' | 'voicemail'
      call_duration: null,            // seconds
      tracking_number: null,          // DNI number served to this visitor
      element_text: (sourceEl && (sourceEl.innerText || sourceEl.textContent) || '').trim().slice(0, 80)
    };
  }

  function pushDataLayer(ev) {
    if (!C.pushToDataLayer) return;
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({
      event: ev.event_name,
      ctc: ev                          // full payload available to GTM variables: {{DLV - ctc.phone}} etc.
    });
    log('dataLayer push', ev.event_name, ev.phone);
  }

  function fireDirectPixels(ev) {
    if (!C.fireDirect) return;
    // GA4
    if (C.ga4MeasurementId && typeof window.gtag === 'function') {
      window.gtag('event', ev.event_name, {
        phone_number: ev.phone, event_id: ev.event_id, send_to: C.ga4MeasurementId
      });
    }
    // Google Ads conversion
    if (C.googleAds && C.googleAds.conversionId && typeof window.gtag === 'function') {
      window.gtag('event', 'conversion', {
        send_to: C.googleAds.conversionId + '/' + (C.googleAds.conversionLabel || ''),
        transaction_id: ev.event_id
      });
    }
    // Meta browser pixel
    if (C.metaPixelId && typeof window.fbq === 'function') {
      window.fbq('track', 'Contact', { content_name: 'phone_call_click' }, { eventID: ev.event_id });
    }
  }

  function sendToCollector(ev) {
    if (!C.collectorUrl) return;
    var body = JSON.stringify(ev);
    // text/plain avoids a CORS preflight against Apps Script and works with sendBeacon.
    try {
      if (navigator.sendBeacon) {
        var blob = new Blob([body], { type: 'text/plain;charset=UTF-8' });
        if (navigator.sendBeacon(C.collectorUrl, blob)) { log('beacon sent'); return; }
      }
    } catch (e) {}
    try {
      fetch(C.collectorUrl, { method: 'POST', body: body, keepalive: true,
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, mode: 'no-cors' });
      log('fetch sent');
    } catch (e) { log('collector send failed', e); }
  }

  function handleCall(phone, el, kind) {
    var norm = normalizePhone(phone) || phone || '_';
    if (lastFire[norm] && (now() - lastFire[norm]) < C.dedupeWindowMs) { log('dedupe skip', norm); return; }
    lastFire[norm] = now();

    var ev = buildEvent(phone, el, kind);
    pushDataLayer(ev);
    fireDirectPixels(ev);
    sendToCollector(ev);
  }

  // ---------------------------------------------------------------------------
  // 5. Click delegation (works for elements added after load)
  // ---------------------------------------------------------------------------
  function matches(el, selectorList) {
    for (var i = 0; i < selectorList.length; i++) {
      try { if (el.matches(selectorList[i])) return true; } catch (e) {}
    }
    return false;
  }

  function closestMatch(el, selectorList) {
    while (el && el !== document) {
      if (matches(el, selectorList)) return el;
      el = el.parentNode;
    }
    return null;
  }

  function onClick(e) {
    var target = e.target;
    // tel: links (also covers nested spans/icons via closest)
    var telEl = closestMatch(target, C.selectors);
    if (telEl) {
      var href = telEl.getAttribute && telEl.getAttribute('href');
      var phone = (href && href.indexOf('tel:') === 0) ? href
        : (telEl.getAttribute && telEl.getAttribute('data-ctc-phone')) || href || telEl.innerText;
      handleCall(phone, telEl, 'tel');
      return;
    }
    // chat-intent (optional)
    if (C.chatSelectors && C.chatSelectors.length) {
      var chatEl = closestMatch(target, C.chatSelectors);
      if (chatEl) handleCall(chatEl.getAttribute('href') || '', chatEl, 'chat');
    }
  }

  // capture phase so we record even if the site stops propagation
  document.addEventListener('click', onClick, true);
  // touchend helps on some mobile browsers that don't reliably emit click for tel:
  document.addEventListener('touchend', function (e) { /* click usually follows; left as hook */ }, true);

  // Prime attribution on load so first-touch is captured even without a click.
  getAttribution();
  log('ready', C.siteId);
})();
