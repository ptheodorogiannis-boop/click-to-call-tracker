'use strict';
/**
 * Point the agency's Viber bot at this server, once per deploy:
 *   node tools/viber-set-webhook.js
 * Needs VIBER_AUTH_TOKEN and an https PUBLIC_BASE_URL in .env (Viber refuses plain http and self-signed certificates).
 */
const cfg = require('../src/config');
const viber = require('../src/services/viber');

(async () => {
  if (!viber.enabled()) { console.error('Set VIBER_AUTH_TOKEN in .env first.'); process.exit(1); }
  if (!/^https:\/\//.test(cfg.publicBaseUrl)) { console.error('PUBLIC_BASE_URL must be https://… for Viber.'); process.exit(1); }
  const url = cfg.publicBaseUrl + '/webhooks/viber';
  const r = await viber.call('set_webhook', { url, event_types: ['subscribed', 'unsubscribed', 'conversation_started'], send_name: true, send_photo: false });
  console.log('Viber will call', url, 'for', r.event_types ? r.event_types.join(', ') : 'the default events');
})().catch((e) => { console.error(e.message || e); process.exit(1); });
