'use strict';
// Scheduled client reports by email: weekly (the last 7 days, sent Monday) or monthly (the last calendar month, sent
// on the 1st), at 06:00 UTC. A short HTML summary with the call log attached as CSV. server.js checks every 15 minutes.
const cfg = require('../config');
const { db } = require('../db');
const calls = require('./../calls');
const mailer = require('./mailer');
const { channel } = require('../sources');

const SYSTEM = { id: 0, role: 'owner', name: 'reports' };
const SCHEDULES = ['off', 'weekly', 'monthly'];
const iso = (d) => d.toISOString().slice(0, 10);
const sqlTime = (d) => d.toISOString().slice(0, 19).replace('T', ' ');

// The next send time after `from`.
function nextAt(schedule, from = new Date()) {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), 6));
  if (schedule === 'weekly') {
    while (d.getUTCDay() !== 1 || d <= from) d.setUTCDate(d.getUTCDate() + 1); // the next Monday 06:00 after `from`
    return d;
  }
  if (schedule === 'monthly') {
    const m = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1, 6));
    if (m <= from) m.setUTCMonth(m.getUTCMonth() + 1);
    return m;
  }
  return null;
}

// The period a report sent at `at` covers.
function periodFor(schedule, at = new Date()) {
  const day = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  if (schedule === 'monthly') {
    const first = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() - 1, 1));
    const last = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 0));
    return { since: iso(first), until: iso(last) };
  }
  const until = new Date(day); until.setUTCDate(until.getUTCDate() - 1);
  const since = new Date(day); since.setUTCDate(since.getUTCDate() - 7);
  return { since: iso(since), until: iso(until) };
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (n) => new Intl.NumberFormat('el-GR').format(n);
const money = (n, cur) => new Intl.NumberFormat('el-GR', { style: 'currency', currency: cur || 'EUR', maximumFractionDigits: 0 }).format(n);
const pct = (n) => (n == null ? '–' : Math.round(n * 100) + '%');

function html(r, period) {
  const t = r.totals;
  const cur = r.client.currency;
  const row = (cells) => `<tr>${cells.map((c, i) => `<td style="padding:8px 0;border-top:1px solid #d8d8d6;${i ? 'text-align:right;' : ''}">${c}</td>`).join('')}</tr>`;
  return `<!doctype html><html><body style="margin:0;background:#e4e4e2;font-family:Manrope,Segoe UI,Arial,sans-serif;color:#0e0e0e">
<div style="max-width:600px;margin:0 auto;padding:32px 20px">
  <p style="margin:0 0 4px;font-size:13px;color:#575756">${esc(period.since)} to ${esc(period.until)}</p>
  <h1 style="margin:0 0 24px;font-size:28px;font-weight:400;letter-spacing:-0.02em">${esc(r.client.name)}: calls</h1>
  <div style="background:#3a3a38;color:#fff;border-radius:20px;padding:20px 24px">
    <table style="width:100%;border-collapse:collapse"><tr>
      <td><div style="font-size:30px;font-weight:300">${fmt(t.calls)}</div><div style="font-size:12px;color:#d6d6d4">Calls</div></td>
      <td><div style="font-size:30px;font-weight:300">${pct(t.answer_rate)}</div><div style="font-size:12px;color:#d6d6d4">Answered</div></td>
      <td><div style="font-size:30px;font-weight:300">${fmt(t.leads)}</div><div style="font-size:12px;color:#d6d6d4">Leads</div></td>
      <td><div style="font-size:30px;font-weight:300">${money(t.value, cur)}</div><div style="font-size:12px;color:#d6d6d4">Lead value</div></td>
    </tr></table>
  </div>
  <div style="background:#fff;border-radius:20px;padding:20px 24px;margin-top:12px">
    <h2 style="margin:0 0 8px;font-size:16px;font-weight:500">Where calls came from</h2>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      ${r.by_channel.map((c) => row([esc(channel(c.channel)), fmt(c.calls), fmt(c.leads) + ' leads'])).join('') || row(['No calls in this period', '', ''])}
    </table>
  </div>
  ${r.by_campaign.length ? `<div style="background:#fff;border-radius:20px;padding:20px 24px;margin-top:12px">
    <h2 style="margin:0 0 8px;font-size:16px;font-weight:500">Campaigns</h2>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      ${r.by_campaign.slice(0, 8).map((c) => row([esc(c.campaign === '(none)' ? 'No campaign' : c.campaign), fmt(c.calls), fmt(c.leads) + ' leads'])).join('')}
    </table></div>` : ''}
  <p style="font-size:13px;color:#575756;margin-top:20px">The full call log is attached as a spreadsheet.${cfg.publicBaseUrl ? ` Open the live report: <a href="${esc(cfg.publicBaseUrl)}/reports?client_id=${encodeURIComponent(r.client.id)}" style="color:#0e0e0e">${esc(cfg.publicBaseUrl.replace(/^https?:\/\//, ''))}</a>` : ''}</p>
  <p style="font-size:12px;color:#575756">${esc(cfg.brand.company)}</p>
</div></body></html>`;
}

async function sendReport(clientId, period) {
  const k = await db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId);
  if (!k) return { skipped: 'no such client' };
  const to = mailer.parseEmails(k.report_emails);
  if (!to.length) return { skipped: 'no report recipients' };
  const r = await calls.report(SYSTEM, { client_id: clientId, since: period.since, until: period.until });
  const csv = '﻿' + await calls.toCsv(SYSTEM, { client_id: clientId, since: period.since, until: period.until });
  return mailer.send({
    to,
    subject: `${k.name}: calls ${period.since} to ${period.until}`,
    text: `${k.name}, ${period.since} to ${period.until}: ${r.totals.calls} calls, ${pct(r.totals.answer_rate)} answered, ${r.totals.leads} leads. The call log is attached.`,
    html: html(r, period),
    attachments: [{ filename: `calls-${clientId}-${period.since}.csv`, content: csv, contentType: 'text/csv; charset=utf-8' }]
  });
}

// Send every report that is due, then move each one to its next time. Safe to call often.
async function runDue(now = new Date()) {
  const due = await db.prepare(`SELECT id, report_schedule, report_next_at FROM clients
    WHERE active = 1 AND report_schedule != 'off' AND report_next_at IS NOT NULL AND report_next_at <= ?`).all(sqlTime(now));
  const results = [];
  for (const k of due) {
    const at = new Date(k.report_next_at.replace(' ', 'T') + 'Z');
    const r = await sendReport(k.id, periodFor(k.report_schedule, at)).catch((e) => ({ error: String(e.message || e) }));
    await db.prepare('UPDATE clients SET report_next_at = ? WHERE id = ?').run(sqlTime(nextAt(k.report_schedule, now)), k.id);
    results.push({ client: k.id, ...r });
  }
  return results;
}

// When a schedule is saved: set (or clear) the next send time.
async function schedule(clientId, sched) {
  const next = nextAt(sched);
  await db.prepare('UPDATE clients SET report_schedule = ?, report_next_at = ? WHERE id = ?').run(sched, next ? sqlTime(next) : null, clientId);
}

module.exports = { SCHEDULES, nextAt, periodFor, sendReport, runDue, schedule };
