'use strict';
// Email out (missed-call alerts, scheduled reports). SMTP from the environment; MAIL_TRANSPORT=json keeps messages in
// memory instead of sending (tests, local demo). Without SMTP_HOST, email is switched off and callers are told so.
const nodemailer = require('nodemailer');

let transport = null;
const sent = []; // the json transport's messages, newest last (tests read them)

function mailer() {
  if (transport) return transport;
  if (process.env.MAIL_TRANSPORT === 'json') transport = nodemailer.createTransport({ jsonTransport: true });
  else if (process.env.SMTP_HOST) {
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: String(process.env.SMTP_PORT) === '465',
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
    });
  }
  return transport;
}

const enabled = () => !!(process.env.MAIL_TRANSPORT === 'json' || process.env.SMTP_HOST);

async function send({ to, subject, text, html, attachments }) {
  const t = mailer();
  if (!t) return { skipped: 'email is not set up (SMTP_HOST)' };
  const info = await t.sendMail({ from: process.env.MAIL_FROM || 'Ruler Calls <calls@localhost>', to, subject, text, html, attachments });
  if (process.env.MAIL_TRANSPORT === 'json') sent.push(JSON.parse(info.message));
  return { ok: true, id: info.messageId };
}

// "a@x.gr, b@y.gr" → valid addresses only
const parseEmails = (s) => String(s || '').split(/[,;\s]+/).map((x) => x.trim()).filter((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x));

module.exports = { send, enabled, parseEmails, sent };
