'use strict';
/**
 * End-to-end simulation WITHOUT real telephony. Boots nothing — talks to a running server.
 * Usage:
 *   1) cp .env.example .env  (set VALIDATE_TWILIO_SIGNATURE=false for local sim)
 *   2) npm run seed
 *   3) npm start              (in another terminal)
 *   4) npm run simulate
 *
 * It (a) requests a DNI number as a browser would, then (b) fakes the Twilio
 * incoming + dial-complete + recording webhooks for a call to that number, then
 * (c) reads the report endpoints. Verifies the full attribution → call → stats path.
 */
const BASE = process.env.BASE || 'http://localhost:8080';
const CLIENT = 'client-acme';

async function main() {
  // (a) browser asks for a tracking number, carrying a Google Ads click
  const assign = await post('/api/dni/assign', {
    siteId: CLIENT,
    visitorId: 'sim-visitor-1',
    attribution: {
      gclid: 'SIM_GCLID_123', utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'greek_calls',
      ga_client_id: '111.222', landing_page: 'https://acme.gr/landing', referrer: ''
    }
  }, true);
  console.log('DNI assigned:', assign);
  const trackingNumber = assign.phone;
  const callSid = 'CA' + Date.now();

  // (b) Twilio: inbound call to the tracking number (form-encoded, like Twilio)
  const twiml = await postForm('/webhooks/voice/incoming', {
    To: trackingNumber, From: '+306971234567', CallSid: callSid
  });
  console.log('incoming TwiML:\n', twiml);

  // dial finished, answered for 42s (>= qualified threshold)
  await postForm('/webhooks/voice/dial-complete?sid=' + callSid, {
    CallSid: callSid, DialCallStatus: 'completed', DialCallDuration: '42'
  });

  // recording completed
  await postForm('/webhooks/voice/recording?sid=' + callSid, {
    CallSid: callSid, RecordingSid: 'RE' + Date.now(),
    RecordingUrl: 'https://api.twilio.com/recordings/RExxxx', RecordingDuration: '42'
  });

  // (c) read reports
  const stats = await get('/api/report/stats?client=' + CLIENT);
  const calls = await get('/api/report/calls?client=' + CLIENT + '&limit=5');
  console.log('\nSTATS:', JSON.stringify(stats, null, 2));
  const c = calls.calls[0];
  console.log('\nLATEST CALL:', JSON.stringify({
    call_sid: c.call_sid, channel: c.channel, gclid: c.gclid, answered: c.answered,
    duration_sec: c.duration_sec, qualified: c.qualified, first_time: c.first_time,
    recording_url: c.recording_url, conv_google: c.conv_google, conv_meta: c.conv_meta, conv_ga4: c.conv_ga4
  }, null, 2));

  // assertions
  const ok =
    c.channel === 'google_ads' && c.gclid === 'SIM_GCLID_123' &&
    c.answered === 1 && c.qualified === 1 && c.first_time === 1 && c.duration_sec === 42;
  console.log('\n' + (ok ? '✓ PASS — full attribution → call → qualify path works' : '✗ FAIL — see fields above'));
  process.exit(ok ? 0 : 1);
}

async function post(path, body, json) {
  const r = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return json ? r.json() : r.text();
}
async function postForm(path, obj) {
  const body = new URLSearchParams(obj).toString();
  const r = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  return r.text();
}
async function get(path) { return (await fetch(BASE + path)).json(); }

main().catch((e) => { console.error(e); process.exit(1); });
