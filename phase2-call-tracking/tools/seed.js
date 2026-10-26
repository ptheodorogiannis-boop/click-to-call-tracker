'use strict';
/**
 * Seed a demo client + a small DNI pool. Edit values, then: npm run seed
 * In production you'd add real Twilio numbers you purchased + assigned this server's
 * voice webhook (https://YOUR_BASE/webhooks/voice/incoming).
 */
const { migrate, q } = require('../src/db');
migrate();

const client = {
  id: 'client-acme',
  name: 'ACME Greece',
  forward_number: '+302101111111',          // ACME's REAL line (where calls forward)
  consent_message: null,                     // null = default Greek announcement
  recording_enabled: 1,
  qualified_duration_sec: 30,
  lead_value: 25,
  currency: 'EUR',
  active: 1,
  // Each client uses their OWN Twilio (sub)account credentials:
  twilio_account_sid: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  twilio_auth_token: 'client_specific_auth_token',
  config_json: JSON.stringify({
    googleAds: { customerId: '1234567890', conversionActionId: '987654321' },
    meta: { pixelId: '1234567890', capiToken: 'EAAG...', testEventCode: null },
    ga4: { measurementId: 'G-XXXX', apiSecret: 'xxxx' }
  })
};
q.upsertClient.run(client);

// Demo pool — replace with real Twilio numbers.
['+302100000001', '+302100000002', '+302100000003', '+302100000004'].forEach(function (phone, i) {
  q.upsertNumber.run({ phone, client_id: client.id, label: 'pool-' + (i + 1) });
});

console.log('seeded client', client.id, 'with 4 pool numbers');
