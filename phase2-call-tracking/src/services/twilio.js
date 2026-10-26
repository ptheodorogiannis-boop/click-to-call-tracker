'use strict';
const twilio = require('twilio');
const cfg = require('../config');
const { q } = require('../db');

const VoiceResponse = twilio.twiml.VoiceResponse;

// Resolve which client a Twilio webhook belongs to (by AccountSid, then by called number).
function resolveClient(req) {
  const sid = req.body && req.body.AccountSid;
  let client = sid ? q.clientByTwilioSid.get(sid) : null;
  if (!client && req.body && req.body.To) client = q.clientByNumber.get(normalizeTo(req.body.To));
  return client || null;
}
function normalizeTo(to) {
  // keep E.164 as-is; webhooks already send E.164
  return to;
}

/**
 * Express middleware: validate X-Twilio-Signature using THE CLIENT'S auth token.
 * Falls back to the account-level token in .env if the client has none set.
 * Attaches req.ctcClient for downstream handlers.
 */
function validateTwilioSignature(req, res, next) {
  const client = resolveClient(req);
  req.ctcClient = client;

  if (!cfg.twilio.validateSignature) return next();

  const token = (client && client.twilio_auth_token) || cfg.twilio.authToken;
  if (!token) return res.status(403).type('text/plain').send('no auth token for this client');

  const signature = req.header('X-Twilio-Signature');
  const url = cfg.publicBaseUrl + req.originalUrl;
  const ok = twilio.validateRequest(token, signature, url, req.body || {});
  if (!ok) return res.status(403).type('text/plain').send('invalid twilio signature');
  next();
}

function buildConnectTwiml(client, { dialActionUrl, recordingCallbackUrl }) {
  const vr = new VoiceResponse();
  const record = !!client.recording_enabled;

  if (record) {
    const msg = client.consent_message || cfg.defaultConsentMessageEl;
    vr.say({ language: 'el-GR', voice: 'Polly.Nicos' }, msg);
  }

  const dial = vr.dial({
    answerOnBridge: true,
    action: dialActionUrl,
    method: 'POST',
    record: record ? 'record-from-answer-dual' : 'do-not-record',
    recordingStatusCallback: record ? recordingCallbackUrl : undefined,
    recordingStatusCallbackEvent: record ? 'completed' : undefined
  });
  dial.number(client.forward_number);
  return vr.toString();
}

function buildHangupTwiml(message) {
  const vr = new VoiceResponse();
  if (message) vr.say({ language: 'el-GR', voice: 'Polly.Nicos' }, message);
  vr.hangup();
  return vr.toString();
}

module.exports = { validateTwilioSignature, buildConnectTwiml, buildHangupTwiml, resolveClient };
