'use strict';
// Missed-call alerts, per client: a Slack message (incoming webhook) and/or an email, the moment a call ends unanswered.
const cfg = require('../config');
const { q } = require('../db');
const events = require('../events');
const calls = require('../calls');
const mailer = require('./mailer');
const { channel } = require('../sources');

const SYSTEM = { id: 0, role: 'owner', name: 'alerts' };

function missedText(call, link) {
  const from = call.caller ? call.caller : 'a hidden number';
  const src = [channel(call.channel), call.utm_campaign].filter(Boolean).join(', ');
  return `Missed call for ${call.client_name} from ${from} (${src}). ${call.first_time ? 'First time calling.' : 'Has called before.'}\n${link}`;
}

async function onCompleted(callSid) {
  const call = calls.getCall(SYSTEM, callSid);
  if (call.answered || call.status === 'blocked' || call.status === 'ringing' || !call.caller) return;
  const client = q.getClient.get(call.client_id);
  if (!client || !client.alert_missed) return;
  const link = `${cfg.publicBaseUrl}/calls?call=${encodeURIComponent(call.call_sid)}`;
  const text = missedText(call, link);
  const jobs = [];
  if (client.alert_slack_url) {
    jobs.push(fetch(client.alert_slack_url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(10000)
    }).then((r) => { if (!r.ok) throw new Error('Slack answered ' + r.status); }));
  }
  const to = mailer.parseEmails(client.alert_emails);
  if (to.length) jobs.push(mailer.send({ to, subject: `Missed call: ${client.name}`, text }));
  const results = await Promise.allSettled(jobs);
  for (const r of results) if (r.status === 'rejected') console.error('[alerts]', callSid, String(r.reason).slice(0, 160));
}

events.on('call.completed', onCompleted);

module.exports = { missedText, onCompleted };
