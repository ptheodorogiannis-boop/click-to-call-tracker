'use strict';
const express = require('express');
const cfg = require('../config');
const { q } = require('../db');
const { validateTwilioSignature, buildConnectTwiml, buildHangupTwiml, buildRejectTwiml } = require('../services/twilio');
const { isBlocked } = require('../calls');
const events = require('../events');
const { normalizePhone } = require('../services/attribution');
const { pushConversions } = require('../services/conversions');
const { transcribe } = require('../services/transcription');
const { regionForPhone } = require('../geo');

const router = express.Router();
router.use(validateTwilioSignature);

const u = (p) => cfg.publicBaseUrl + p;
// Express 4 does not catch rejected promises; a webhook that throws still answers Twilio.
const h = (fn) => (req, res, next) => Promise.resolve().then(() => fn(req, res)).catch(next);

/**
 * Inbound call hits a tracking number. Match it to the visitor's session, record the
 * caller (first-time vs repeat), create the call row, then return connect-TwiML.
 */
router.post('/incoming', h(async (req, res) => {
  const trackingNumber = normalizePhone(req.body.To);
  const caller = normalizePhone(req.body.From);
  const callSid = req.body.CallSid;

  const client = req.ctcClient || await q.clientByNumber.get(trackingNumber);
  if (!client) {
    return res.type('text/xml').send(buildHangupTwiml('Ο αριθμός δεν είναι διαθέσιμος.'));
  }

  // A blocked caller is turned away before anything rings: logged as spam, never forwarded, never uploaded.
  if (await isBlocked(client.id, caller)) {
    await q.insertCall.run({
      call_sid: callSid, client_id: client.id, tracking_number: trackingNumber, caller, status: 'blocked', first_time: null,
      session_id: null, channel: 'direct', gclid: null, gbraid: null, wbraid: null, fbclid: null, msclkid: null,
      utm_source: null, utm_medium: null, utm_campaign: null, utm_content: null, utm_term: null,
      ga_client_id: null, fbp: null, fbc: null, landing_page: null, referrer: null, region: regionForPhone(caller)
    });
    await q.markSpam.run(callSid);
    events.emit('call.completed', callSid);
    return res.type('text/xml').send(buildRejectTwiml());
  }

  // A fixed number (Google Business Profile, print, radio…) carries its own source; a pool number carries the visitor's.
  const [number, existingCaller] = await Promise.all([
    q.getNumber.get(trackingNumber),
    caller ? q.getCaller.get(client.id, caller) : null
  ]);
  const fixed = !!number && number.kind === 'fixed';
  const session = fixed ? {} : (await q.matchSession.get(trackingNumber)) || {};
  const firstTime = existingCaller ? 0 : 1;
  if (caller) await q.upsertCaller.run({ client_id: client.id, caller });

  await q.insertCall.run({
    call_sid: callSid, client_id: client.id, tracking_number: trackingNumber, caller,
    status: 'ringing', first_time: firstTime, session_id: session.id || null,
    channel: fixed ? number.source || 'offline_other' : session.channel || 'direct',
    gclid: session.gclid || null, gbraid: session.gbraid || null, wbraid: session.wbraid || null,
    fbclid: session.fbclid || null, msclkid: session.msclkid || null,
    utm_source: session.utm_source || null, utm_medium: session.utm_medium || null,
    utm_campaign: fixed ? number.label || null : session.utm_campaign || null, utm_content: session.utm_content || null, utm_term: session.utm_term || null,
    ga_client_id: session.ga_client_id || null, fbp: session.fbp || null, fbc: session.fbc || null,
    landing_page: session.landing_page || null, referrer: session.referrer || null,
    region: regionForPhone(caller)
  });

  res.type('text/xml').send(buildConnectTwiml(client, {
    dialActionUrl: u('/webhooks/voice/dial-complete?sid=' + encodeURIComponent(callSid)),
    recordingCallbackUrl: u('/webhooks/voice/recording?sid=' + encodeURIComponent(callSid))
  }));
}));

/**
 * Fired when the <Dial> finishes. Tells us answered vs missed + duration.
 * Triggers conversion push for qualified calls.
 */
router.post('/dial-complete', h(async (req, res) => {
  const callSid = req.query.sid || req.body.CallSid;
  const dialStatus = req.body.DialCallStatus;                 // completed|no-answer|busy|failed|canceled
  const duration = parseInt(req.body.DialCallDuration || '0', 10);
  const answered = dialStatus === 'completed' && duration > 0 ? 1 : 0;

  const call = await q.getCall.get(callSid);
  if (call) {
    const client = await q.getClient.get(call.client_id);
    const threshold = (client && client.qualified_duration_sec) || cfg.defaults.qualifiedDurationSec;
    const qualified = answered && duration >= threshold ? 1 : 0;
    await q.updateCallStatus.run({
      call_sid: callSid,
      status: answered ? 'answered' : (dialStatus === 'busy' ? 'busy' : dialStatus === 'failed' ? 'failed' : 'missed'),
      answered, duration_sec: duration, qualified
    });
    if (call.session_id) await q.releaseSession.run(call.session_id);

    if (qualified) events.background(fireConversions(callSid));
    events.emit('call.completed', callSid);
  }
  res.type('text/xml').send(buildHangupTwiml());
}));

/** Recording finished → store URL, kick transcription. */
router.post('/recording', h(async (req, res) => {
  const callSid = req.query.sid || req.body.CallSid;
  await q.updateRecording.run({
    call_sid: callSid,
    recording_url: req.body.RecordingUrl || null,
    recording_sid: req.body.RecordingSid || null
  });
  const call = await q.getCall.get(callSid);
  if (call) events.background(transcribe(call, req.ctcClient || await q.getClient.get(call.client_id)));
  res.sendStatus(204);
}));

async function fireConversions(callSid) {
  const call = await q.getCall.get(callSid);
  const client = await q.getClient.get(call.client_id);
  try {
    const r = await pushConversions(client, call);
    await q.updateConv.run({ call_sid: callSid, conv_google: r.google || null, conv_meta: r.meta || null, conv_ga4: r.ga4 || null });
  } catch (e) {
    console.error('[conversions]', callSid, String(e).slice(0, 160));
  }
}

module.exports = router;
