'use strict';
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const cfg = require('./config');

fs.mkdirSync(path.dirname(cfg.dbPath), { recursive: true });
const db = new Database(cfg.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// The statements below are prepared when this file loads, so the tables must exist first (idempotent on an existing DB).
migrate();

function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', 'schema.sql'), 'utf8');
  db.exec(sql);
  ensureColumns();
}

// Add columns to existing DBs that pre-date them (SQLite has no "ADD COLUMN IF NOT EXISTS").
function ensureColumns() {
  const cols = (table) => db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  const add = (table, name, ddl) => { if (!cols(table).includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`); };
  add('clients', 'twilio_account_sid', 'twilio_account_sid TEXT');
  add('clients', 'twilio_auth_token', 'twilio_auth_token TEXT');
  add('clients', 'active', 'active INTEGER NOT NULL DEFAULT 1');
  add('calls', 'lead_status', "lead_status TEXT NOT NULL DEFAULT 'new'");
  add('calls', 'value', 'value REAL');
  add('calls', 'called_back_at', 'called_back_at TEXT');
  add('calls', 'called_back_by', 'called_back_by INTEGER');
  add('numbers', 'kind', "kind TEXT NOT NULL DEFAULT 'pool'");          // pool (website DNI) | fixed (one source)
  add('numbers', 'source', 'source TEXT');                              // a fixed number's channel, e.g. google_business
  add('sessions', 'fallback', 'fallback INTEGER NOT NULL DEFAULT 0');   // 1 = the pool was full, the number is shared
  add('calls', 'ai_summary', 'ai_summary TEXT');
  add('calls', 'ai_label', 'ai_label TEXT');                            // the model's suggestion: good | not_lead | spam
  add('calls', 'ai_score', 'ai_score INTEGER');                         // 0–100, how likely a real lead
  add('calls', 'ai_at', 'ai_at TEXT');
  add('clients', 'alert_missed', 'alert_missed INTEGER NOT NULL DEFAULT 0');
  add('clients', 'alert_emails', 'alert_emails TEXT');
  add('clients', 'alert_slack_url', 'alert_slack_url TEXT');
  add('clients', 'report_schedule', "report_schedule TEXT NOT NULL DEFAULT 'off'");   // off | weekly | monthly
  add('clients', 'report_emails', 'report_emails TEXT');
  add('clients', 'report_next_at', 'report_next_at TEXT');
  if (!cols('calls').includes('region')) {
    db.exec('ALTER TABLE calls ADD COLUMN region TEXT');
    const { regionForPhone } = require('./geo');
    const set = db.prepare('UPDATE calls SET region = ? WHERE call_sid = ?');
    for (const c of db.prepare('SELECT call_sid, caller FROM calls WHERE caller IS NOT NULL').all()) {
      set.run(regionForPhone(c.caller), c.call_sid);
    }
  }
}

// ── clients / numbers ──────────────────────────────────
const q = {
  getClient: db.prepare('SELECT * FROM clients WHERE id = ?'),
  clientByNumber: db.prepare(
    `SELECT c.* FROM numbers n JOIN clients c ON c.id = n.client_id WHERE n.phone = ? AND n.active = 1`
  ),
  clientByTwilioSid: db.prepare('SELECT * FROM clients WHERE twilio_account_sid = ?'),
  upsertClient: db.prepare(`
    INSERT INTO clients (id,name,forward_number,consent_message,recording_enabled,qualified_duration_sec,lead_value,currency,twilio_account_sid,twilio_auth_token,config_json,active)
    VALUES (@id,@name,@forward_number,@consent_message,@recording_enabled,@qualified_duration_sec,@lead_value,@currency,@twilio_account_sid,@twilio_auth_token,@config_json,@active)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, forward_number=excluded.forward_number, consent_message=excluded.consent_message,
      recording_enabled=excluded.recording_enabled, qualified_duration_sec=excluded.qualified_duration_sec,
      lead_value=excluded.lead_value, currency=excluded.currency,
      twilio_account_sid=excluded.twilio_account_sid, twilio_auth_token=excluded.twilio_auth_token,
      config_json=excluded.config_json, active=excluded.active`),
  listClients: db.prepare('SELECT * FROM clients ORDER BY name'),
  deleteClient: db.prepare('DELETE FROM clients WHERE id = ?'),
  upsertNumber: db.prepare(`
    INSERT INTO numbers (phone,client_id,label,active,kind,source) VALUES (@phone,@client_id,@label,1,@kind,@source)
    ON CONFLICT(phone) DO UPDATE SET client_id=excluded.client_id, label=excluded.label, active=1, kind=excluded.kind, source=excluded.source`),
  poolNumbers: db.prepare("SELECT phone FROM numbers WHERE client_id = ? AND active = 1 AND kind = 'pool'"),
  getNumber: db.prepare('SELECT * FROM numbers WHERE phone = ? AND active = 1'),
  listNumbers: db.prepare('SELECT * FROM numbers WHERE client_id = ? ORDER BY created_at'),
  deleteNumber: db.prepare('DELETE FROM numbers WHERE phone = ?'),
  countNumbers: db.prepare('SELECT COUNT(*) n FROM numbers WHERE client_id = ? AND active = 1'),

  // ── sessions / pool ──────────────────────────────────
  // numbers in this client's pool with NO active (unreleased & unexpired) reservation
  freeNumbers: db.prepare(`
    SELECT n.phone FROM numbers n
    WHERE n.client_id = ? AND n.active = 1 AND n.kind = 'pool'
      AND NOT EXISTS (
        SELECT 1 FROM sessions s
        WHERE s.phone = n.phone AND s.released = 0 AND s.expires_at > datetime('now')
      )
    LIMIT 1`),
  insertSession: db.prepare(`
    INSERT INTO sessions (id,client_id,phone,visitor_id,expires_at,fallback,channel,
      gclid,gbraid,wbraid,fbclid,msclkid,utm_source,utm_medium,utm_campaign,utm_content,utm_term,
      ga_client_id,fbp,fbc,landing_page,referrer,user_agent,ip)
    VALUES (@id,@client_id,@phone,@visitor_id,@expires_at,@fallback,@channel,
      @gclid,@gbraid,@wbraid,@fbclid,@msclkid,@utm_source,@utm_medium,@utm_campaign,@utm_content,@utm_term,
      @ga_client_id,@fbp,@fbc,@landing_page,@referrer,@user_agent,@ip)`),
  // best match for an inbound call: the most recent reservation for this number (active first)
  matchSession: db.prepare(`
    SELECT * FROM sessions
    WHERE phone = ?
    ORDER BY (CASE WHEN released = 0 AND expires_at > datetime('now') THEN 0 ELSE 1 END), assigned_at DESC
    LIMIT 1`),
  releaseSession: db.prepare('UPDATE sessions SET released = 1 WHERE id = ?'),

  // ── callers ──────────────────────────────────────────
  getCaller: db.prepare('SELECT * FROM callers WHERE client_id = ? AND caller = ?'),
  upsertCaller: db.prepare(`
    INSERT INTO callers (client_id,caller,call_count,last_seen)
    VALUES (@client_id,@caller,1,datetime('now'))
    ON CONFLICT(client_id,caller) DO UPDATE SET
      call_count = call_count + 1, last_seen = datetime('now')`),

  // ── calls ────────────────────────────────────────────
  insertCall: db.prepare(`
    INSERT INTO calls (call_sid,client_id,tracking_number,caller,status,first_time,session_id,channel,
      gclid,gbraid,wbraid,fbclid,msclkid,utm_source,utm_medium,utm_campaign,utm_content,utm_term,
      ga_client_id,fbp,fbc,landing_page,referrer,region)
    VALUES (@call_sid,@client_id,@tracking_number,@caller,@status,@first_time,@session_id,@channel,
      @gclid,@gbraid,@wbraid,@fbclid,@msclkid,@utm_source,@utm_medium,@utm_campaign,@utm_content,@utm_term,
      @ga_client_id,@fbp,@fbc,@landing_page,@referrer,@region)
    ON CONFLICT(call_sid) DO NOTHING`),
  getCall: db.prepare('SELECT * FROM calls WHERE call_sid = ?'),
  updateCallStatus: db.prepare(
    `UPDATE calls SET status=@status, answered=@answered, duration_sec=@duration_sec, qualified=@qualified WHERE call_sid=@call_sid`),
  updateRecording: db.prepare(
    `UPDATE calls SET recording_url=@recording_url, recording_sid=@recording_sid WHERE call_sid=@call_sid`),
  updateTranscript: db.prepare('UPDATE calls SET transcript=@transcript WHERE call_sid=@call_sid'),
  markSpam: db.prepare("UPDATE calls SET lead_status = 'spam' WHERE call_sid = ?"),
  updateConv: db.prepare(
    `UPDATE calls SET conv_google=COALESCE(@conv_google,conv_google), conv_meta=COALESCE(@conv_meta,conv_meta), conv_ga4=COALESCE(@conv_ga4,conv_ga4) WHERE call_sid=@call_sid`),
  callByRecordingSid: db.prepare('SELECT * FROM calls WHERE recording_sid = ?'),

  // ── reporting ────────────────────────────────────────
  listCalls: db.prepare(
    `SELECT * FROM calls WHERE client_id = ? AND started_at >= ? ORDER BY started_at DESC LIMIT ?`),
  statsByChannel: db.prepare(`
    SELECT channel,
           COUNT(*) total,
           SUM(answered) answered,
           SUM(CASE WHEN answered=0 THEN 1 ELSE 0 END) missed,
           SUM(qualified) qualified,
           SUM(CASE WHEN first_time=1 THEN 1 ELSE 0 END) first_time
    FROM calls WHERE client_id = ? AND started_at >= ? GROUP BY channel ORDER BY total DESC`)
};

module.exports = { db, migrate, q };
