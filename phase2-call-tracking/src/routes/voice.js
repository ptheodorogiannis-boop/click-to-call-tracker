'use strict';
const express = require('express');
const cfg = require('../config');
const { q } = require('../db');
const { validateTwilioSignature, buildConnectTwiml, buildHangupTwiml } = require('../services/twilio');
const { normalizePhone } = require('../services/attribution');
const { pushConversions } = require('../services/conversions');
const { transcribe } = require('../services/transcription');

const router = express.Router();
router.use(validateTwilioSignature);

const u = (p) => cfg.publicBaseUrl + p;

/**
 * Inbound call hits a tracking number. Match it to the visitor's session, record the
 * caller (first-time vs repeat), create the call row, then return connect-TwiML.
 */
router.post('/incoming', (req, res) => {
  const trackingNumber = normalizePhone(req.body.To);
  const caller = normalizePhone(req.body.From);
  const callSid = req.body.CallSid;

  const client = req.ctcClient || q.clientByNumber.get(trackingNumber);
  if (!client) {
    return res.type('text/xml').send(buildHangupTwiml('Ο αριθμός δεν είναι διαθέσιμος.'));
  }

  const session = q.matchSession.get(trackingNumber) || {};
  const existingCaller = caller ? q.getCaller.get(client.id, caller) : null;
  const firstTime = existingCaller ? 0 : 1;
  if (caller) q.upsertCaller.run({ client_id: client.id, caller });

  q.insertCall.run({
    call_sid: callSid, client_id: client.id, tracking_number: trackingNumber, caller,
    status: 'ringing', first_time: firstTime, session_id: session.id || null,
    channel: session.channel || 'direct',
    gclid: session.gclid || null, gbraid: session.gbraid || null, wbraid: session.wbraid || null,
    fbclid: session.fbclid || null, msclkid: session.msclkid || null,
    utm_source: session.utm_source || null, utm_medium: session.utm_medium || null,
    utm_campaign: session.utm_campaign || null, utm_content: session.utm_content || null, utm_term: session.utm_term || null,
    ga_client_id: session.ga_client_id || null, fbp: session.fbp || null, fbc: session.fbc || null,
    landing_page: session.landing_page || null, referrer: session.referrer || null
  });

  res.type('text/xml').send(buildConnectTwiml(client, {
    dialActionUrl: u('/webhooks/voice/dial-complete?sid=' + encodeURIComponent(callSid)),
    recordingCallbackUrl: u('/webhooks/voice/recording?sid=' + encodeURIComponent(callSid))
  }));
});

/**
 * Fired when the <Dial> finishes. Tells us answered vs missed + duration.
 * Triggers conversion push for qualified calls.
 */
router.post('/dial-complete', (req, res) => {
  const callSid = req.query.sid || req.body.CallSid;
  const dialStatus = req.body.DialCallStatus;                 // completed|no-answer|busy|failed|canceled
  const duration = parseInt(req.body.DialCallDuration || '0', 10);
  const answered = dialStatus === 'completed' && duration > 0 ? 1 : 0;

  const call = q.getCall.get(callSid);
  if (call) {
    const threshold = call_threshold(call);
    const qualified = answered && duration >= threshold ? 1 : 0;
    q.updateCallStatus.run({
      call_sid: callSid,
      status: answered ? 'answered' : (dialStatus === 'busy' ? 'busy' : dialStatus === 'failed' ? 'failed' : 'missed'),
      answered, duration_sec: duration, qualified
    });
    if (call.session_id) q.releaseSession.run(call.session_id);

    if (qualified) fireConversions(callSid);
  }
  res.type('text/xml').send(buildHangupTwiml());
});

/** Recording finished → store URL, kick transcription. */
router.post('/recording', (req, res) => {
  const callSid = req.query.sid || req.body.CallSid;
  q.updateRecording.run({
    call_sid: callSid,
    recording_url: req.body.RecordingUrl || null,
    recording_sid: req.body.RecordingSid || null
  });
  const call = q.getCall.get(callSid);
  if (call) transcribe(call, req.ctcClient || q.getClient.get(call.client_id)); // async, best-effort
  res.sendStatus(204);
});

function call_threshold(call) {
  const client = q.getClient.get(call.client_id);
  return (client && client.qualified_duration_sec) || cfg.defaults.qualifiedDurationSec;
}

function fireConversions(callSid) {
  const call = q.getCall.get(callSid);
  const client = q.getClient.get(call.client_id);
  pushConversions(client, call)
    .then((r) => q.updateConv.run({
      call_sid: callSid, conv_google: r.google || null, conv_meta: r.meta || null, conv_ga4: r.ga4 || null
    }))
    .catch((e) => console.error('[conversions]', callSid, String(e).slice(0, 160)));
}

module.exports = router;
