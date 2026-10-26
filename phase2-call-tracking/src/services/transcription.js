'use strict';
const cfg = require('../config');
const { q } = require('../db');

/**
 * Kick off transcription for a finished recording. Best-effort, async.
 * - 'twilio': create a Twilio transcription job (results fetched on demand or via callback).
 * - 'openai': download the recording and send to Whisper.
 * - 'none'  : store recording only.
 */
async function transcribe(call, client) {
  if (!call.recording_url) return;
  const provider = cfg.transcription.provider;
  try {
    if (provider === 'openai') return await whisper(call, client);
    if (provider === 'twilio') return; // Twilio transcription is enabled per-recording; see README
  } catch (e) {
    // never throw out of the webhook path
    console.error('[transcription]', call.call_sid, String(e).slice(0, 160));
  }
}

async function whisper(call, client) {
  if (!cfg.transcription.openaiApiKey) return;
  // Twilio recording URLs need basic auth — use THIS client's Twilio creds (fallback to env).
  const sid = (client && client.twilio_account_sid) || cfg.twilio.accountSid;
  const token = (client && client.twilio_auth_token) || cfg.twilio.authToken;
  const auth = 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64');
  const audio = await fetch(call.recording_url + '.mp3', { headers: { Authorization: auth } });
  const buf = Buffer.from(await audio.arrayBuffer());

  const form = new FormData();
  form.append('file', new Blob([buf], { type: 'audio/mpeg' }), 'call.mp3');
  form.append('model', 'whisper-1');
  form.append('language', 'el'); // Greek

  const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST', headers: { Authorization: `Bearer ${cfg.transcription.openaiApiKey}` }, body: form
  });
  if (!r.ok) return;
  const data = await r.json();
  if (data.text) q.updateTranscript.run({ call_sid: call.call_sid, transcript: data.text });
}

module.exports = { transcribe };
