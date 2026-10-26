/*!
 * dni-tracker.js — Dynamic Number Insertion client (Ruler Agency, phase 2)
 *
 * On page load it: captures ad attribution → asks the backend for a tracking number
 * from this client's pool → swaps the displayed phone number(s) on the page to it.
 * The actual call to that number is then tracked + attributed server-side.
 *
 * Mark numbers to swap with `data-ctc-dni` (recommended):
 *     <a href="tel:+302101234567" data-ctc-dni>210 123 4567</a>
 * or let it auto-match your real number via config.realNumbers.
 *
 * Load:
 *   <script>window.CTC_DNI_CONFIG = {
 *      siteId:'client-acme',
 *      apiBase:'https://calls.example.com',
 *      realNumbers:['+302101234567','2101234567'],  // variants to find & replace (optional)
 *      format:function(e164){ return e164; }          // optional display formatter
 *   };</script>
 *   <script src="https://calls.example.com/static/dni-tracker.js" defer></script>
 */
(function () {
  'use strict';
  var cfg = window.CTC_DNI_CONFIG || {};
  if (!cfg.siteId || !cfg.apiBase) { console.warn('[ctc-dni] siteId and apiBase required'); return; }
  var API = cfg.apiBase.replace(/\/$/, '');

  // ── utils ──────────────────────────────────────────────
  function qs(n) { var m = location.search.match(new RegExp('[?&]' + n + '=([^&]+)')); return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : null; }
  function getCookie(n) { var m = document.cookie.match('(?:^|; )' + n.replace(/([.$?*|{}()\[\]\\\/+^])/g, '\\$1') + '=([^;]*)'); return m ? decodeURIComponent(m[1]) : null; }
  function gaClientId() { var v = getCookie('_ga'); if (!v) return null; var p = v.split('.'); return p.length >= 4 ? p.slice(-2).join('.') : null; }
  function normalize(raw) {
    if (!raw) return null;
    var n = String(raw).replace(/^tel:/i, '').replace(/[^\d+]/g, '');
    if (!n) return null;
    if (n[0] === '+') return n;
    if (n.indexOf('00') === 0) return '+' + n.slice(2);
    if (n.length === 10 && (n[0] === '6' || n[0] === '2')) return '+30' + n;
    return n;
  }
  function visitorId() {
    var k = 'ctc_vid_' + cfg.siteId, v = null;
    try { v = localStorage.getItem(k); if (!v) { v = 'v-' + Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem(k, v); } } catch (e) {}
    return v;
  }

  function attribution() {
    return {
      gclid: qs('gclid') || getCookie('_gcl_aw') || null,
      gbraid: qs('gbraid'), wbraid: qs('wbraid'), fbclid: qs('fbclid'), msclkid: qs('msclkid'),
      utm_source: qs('utm_source'), utm_medium: qs('utm_medium'), utm_campaign: qs('utm_campaign'),
      utm_content: qs('utm_content'), utm_term: qs('utm_term'),
      ga_client_id: gaClientId(), fbp: getCookie('_fbp'),
      fbc: getCookie('_fbc') || (qs('fbclid') ? 'fb.1.' + Date.now() + '.' + qs('fbclid') : null),
      landing_page: location.href, referrer: document.referrer || null
    };
  }

  // ── swap logic ─────────────────────────────────────────
  function swapAll(trackingE164) {
    var display = (typeof cfg.format === 'function') ? cfg.format(trackingE164) : trackingE164;
    var realSet = (cfg.realNumbers || []).map(normalize).filter(Boolean);
    var swapped = 0;

    // 1) explicit targets
    [].forEach.call(document.querySelectorAll('[data-ctc-dni]'), function (el) {
      applySwap(el, trackingE164, display); swapped++;
    });

    // 2) auto-match tel: links pointing to the real number
    if (realSet.length) {
      [].forEach.call(document.querySelectorAll('a[href^="tel:"]'), function (el) {
        var cur = normalize(el.getAttribute('href'));
        if (realSet.indexOf(cur) !== -1) { applySwap(el, trackingE164, display); swapped++; }
      });
    }
    return swapped;
  }

  function applySwap(el, e164, display) {
    if (el.tagName === 'A') {
      el.setAttribute('href', 'tel:' + e164);
      // only replace text if it looks like a phone number (don't clobber icons/labels)
      if (el.children.length === 0 && /[\d\s().+-]{6,}/.test(el.textContent)) el.textContent = display;
    } else {
      el.textContent = display;
      el.setAttribute('data-ctc-dni-number', e164);
    }
    el.setAttribute('data-ctc-dni-applied', '1');
  }

  // ── run ────────────────────────────────────────────────
  function assignAndSwap() {
    var body = JSON.stringify({ siteId: cfg.siteId, attribution: attribution(), visitorId: visitorId() });
    fetch(API + '/api/dni/assign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || !data.phone) return;
        var n = swapAll(data.phone);
        window.dataLayer = window.dataLayer || [];
        window.dataLayer.push({ event: 'ctc_dni_assigned', ctc_dni: { phone: data.phone, swapped: n, fallback: !!data.fallback } });
      })
      .catch(function (e) { /* fail silent: real number stays shown */ });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', assignAndSwap);
  else assignAndSwap();

  // expose for SPA re-swaps after route changes
  window.ctcDniReassign = assignAndSwap;
})();
