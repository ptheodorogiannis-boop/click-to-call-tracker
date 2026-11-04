'use strict';
const cfg = require('./config');
const app = require('./app');

app.listen(cfg.port, () => {
  console.log(`ctc-call-tracking listening on :${cfg.port}`);
  if (!cfg.publicBaseUrl) console.warn('⚠ PUBLIC_BASE_URL is empty — Twilio signature validation and callback URLs will break.');
  if (!cfg.admin.sessionSecret) console.warn('⚠ SESSION_SECRET is empty — nobody can sign in to the web app.');
});
