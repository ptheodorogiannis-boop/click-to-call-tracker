'use strict';
const cfg = require('./config');
const app = require('./app');

// Scheduled client reports: send whatever is due, every 15 minutes (and once shortly after start).
const reports = require('./services/reports');
const sendDue = () => reports.runDue().then((r) => r.length && console.log('[reports]', JSON.stringify(r))).catch((e) => console.error('[reports]', e));
setTimeout(sendDue, 30000).unref();
setInterval(sendDue, 15 * 60000).unref();

app.boot().catch((e) => { console.error('[boot]', e); process.exit(1); });
app.listen(cfg.port, () => {
  console.log(`ctc-call-tracking listening on :${cfg.port}`);
  if (!cfg.publicBaseUrl) console.warn('⚠ PUBLIC_BASE_URL is empty — Twilio signature validation and callback URLs will break.');
  if (!cfg.admin.sessionSecret) console.warn('⚠ SESSION_SECRET is empty — nobody can sign in to the web app.');
});
