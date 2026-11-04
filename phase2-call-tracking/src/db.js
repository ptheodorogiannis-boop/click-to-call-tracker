'use strict';
// The database: libSQL. On Vercel it is a Turso database (TURSO_DATABASE_URL + TURSO_AUTH_TOKEN); everywhere else
// (tests, the demo, Docker) a local SQLite file (DB_PATH). Same SQL, same code.
// Statements keep the better-sqlite3 shape the app was written against — q.getClient.get(id), db.prepare(sql).all(…),
// .run({ named }) — but every call returns a promise.
const fs = require('fs');
const path = require('path');
const { createClient } = require('@libsql/client');
const cfg = require('./config');

const SCHEMA_VERSION = '2026-11-04.4'; // bump when schema.sql or ensureColumns changes

function url() {
  const turso = process.env.TURSO_DATABASE_URL;
  if (turso) {
    // libSQL echoes a bad URL in its error, and a token pasted here by mistake would land in the logs.
    if (!/^(libsql|https?|wss?):\/\//.test(turso)) throw new Error('TURSO_DATABASE_URL must start with libsql:// (is the auth token in it by mistake?)');
    return turso;
  }
  const file = path.resolve(cfg.dbPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return 'file:' + file.split(path.sep).join('/');
}
const isLocal = () => !process.env.TURSO_DATABASE_URL;

let client = null;
const conn = () => (client ||= createClient({ url: url(), authToken: process.env.TURSO_AUTH_TOKEN, intMode: 'number' }));

// better-sqlite3 call shapes → libSQL args: one plain object is named (@name), anything else positional.
// undefined becomes null (libSQL refuses undefined).
function args(list) {
  if (list.length === 1 && list[0] && typeof list[0] === 'object' && !Array.isArray(list[0])) {
    return Object.fromEntries(Object.entries(list[0]).map(([k, v]) => [k, v === undefined ? null : v]));
  }
  return list.map((v) => (v === undefined ? null : v));
}
const plain = (rows) => rows.map((r) => Object.assign({}, r));

function statement(exec, sql) {
  return {
    get: async (...a) => plain((await exec({ sql, args: args(a) })).rows)[0],
    all: async (...a) => plain((await exec({ sql, args: args(a) })).rows),
    run: async (...a) => {
      const r = await exec({ sql, args: args(a) });
      return { changes: r.rowsAffected, lastInsertRowid: r.lastInsertRowid == null ? null : Number(r.lastInsertRowid) };
    }
  };
}

const db = {
  prepare: (sql) => statement((s) => conn().execute(s), sql),
  exec: (sql) => conn().executeMultiple(sql),
  // Run fn(t) in one write transaction; t.prepare(sql) works like db.prepare. Rolls back if fn throws.
  async tx(fn) {
    const t = await conn().transaction('write');
    try {
      const out = await fn({ prepare: (sql) => statement((s) => t.execute(s), sql) });
      await t.commit();
      return out;
    } catch (e) {
      await t.rollback().catch(() => {});
      throw e;
    } finally {
      t.close();
    }
  },
  close: () => { if (client) { client.close(); client = null; } }
};

// ── schema ─────────────────────────────────────────────
// Idempotent, and safe when two cold starts run it at once: CREATE … IF NOT EXISTS, and a column another instance
// added a moment ago is not an error. Skipped entirely once the stored version matches (one round trip).
let ready = null;
function migrate() { return (ready ||= runMigrations().catch((e) => { ready = null; throw e; })); }

async function runMigrations() {
  if (isLocal()) await conn().execute('PRAGMA foreign_keys = ON');
  const meta = await db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get().catch(() => null);
  if (meta && meta.value === SCHEMA_VERSION) return;
  await db.exec(schemaSql());
  await ensureColumns();
  await db.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(SCHEMA_VERSION);
}

// On Vercel the schema comes bundled (src/generated, made by tools/vercel-prepare.js); elsewhere from migrations/.
function schemaSql() {
  if (process.env.VERCEL) { try { return require('./generated/schema-sql'); } catch (e) { /* fall through */ } }
  return fs.readFileSync(path.join(__dirname, '..', 'migrations', 'schema.sql'), 'utf8');
}

// Add columns to existing DBs that pre-date them (SQLite has no "ADD COLUMN IF NOT EXISTS").
async function ensureColumns() {
  const have = {};
  const cols = async (table) => (have[table] ||= (await db.prepare(`SELECT name FROM pragma_table_info('${table}')`).all()).map((c) => c.name));
  const add = async (table, name, ddl) => {
    if ((await cols(table)).includes(name)) return false;
    try { await db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`); } catch (e) { if (!/duplicate column/i.test(e.message)) throw e; return false; }
    return true;
  };
  await add('clients', 'twilio_account_sid', 'twilio_account_sid TEXT');
  await add('clients', 'twilio_auth_token', 'twilio_auth_token TEXT');
  await add('clients', 'active', 'active INTEGER NOT NULL DEFAULT 1');
  await add('calls', 'lead_status', "lead_status TEXT NOT NULL DEFAULT 'new'");
  await add('calls', 'value', 'value REAL');
  await add('calls', 'called_back_at', 'called_back_at TEXT');
  await add('calls', 'called_back_by', 'called_back_by INTEGER');
  await add('numbers', 'kind', "kind TEXT NOT NULL DEFAULT 'pool'");          // pool (website DNI) | fixed (one source)
  await add('numbers', 'source', 'source TEXT');                              // a fixed number's channel, e.g. google_business
  await add('sessions', 'fallback', 'fallback INTEGER NOT NULL DEFAULT 0');   // 1 = the pool was full, the number is shared
  await add('calls', 'ai_summary', 'ai_summary TEXT');
  await add('calls', 'ai_label', 'ai_label TEXT');                            // the model's suggestion: good | not_lead | spam
  await add('calls', 'ai_score', 'ai_score INTEGER');                         // 0–100, how likely a real lead
  await add('calls', 'ai_at', 'ai_at TEXT');
  await add('clients', 'alert_missed', 'alert_missed INTEGER NOT NULL DEFAULT 0');
  await add('clients', 'alert_emails', 'alert_emails TEXT');
  await add('clients', 'alert_slack_url', 'alert_slack_url TEXT');
  await add('clients', 'report_schedule', "report_schedule TEXT NOT NULL DEFAULT 'off'");   // off | weekly | monthly
  await add('clients', 'report_emails', 'report_emails TEXT');
  await add('clients', 'report_next_at', 'report_next_at TEXT');
  if (await add('calls', 'region', 'region TEXT')) {
    const { regionForPhone } = require('./geo');
    for (const c of await db.prepare('SELECT call_sid, caller FROM calls WHERE caller IS NOT NULL').all()) {
      await db.prepare('UPDATE calls SET region = ? WHERE call_sid = ?').run(regionForPhone(c.caller), c.call_sid);
    }
  }
}

// ── clients / numbers ──────────────────────────────────
const p = db.prepare;
const q = {
  getClient: p('SELECT * FROM clients WHERE id = ?'),
  clientByNumber: p(`SELECT c.* FROM numbers n JOIN clients c ON c.id = n.client_id WHERE n.phone = ? AND n.active = 1`),
  clientByTwilioSid: p('SELECT * FROM clients WHERE twilio_account_sid = ?'),
  upsertClient: p(`
    INSERT INTO clients (id,name,forward_number,consent_message,recording_enabled,qualified_duration_sec,lead_value,currency,twilio_account_sid,twilio_auth_token,config_json,active)
    VALUES (@id,@name,@forward_number,@consent_message,@recording_enabled,@qualified_duration_sec,@lead_value,@currency,@twilio_account_sid,@twilio_auth_token,@config_json,@active)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, forward_number=excluded.forward_number, consent_message=excluded.consent_message,
      recording_enabled=excluded.recording_enabled, qualified_duration_sec=excluded.qualified_duration_sec,
      lead_value=excluded.lead_value, currency=excluded.currency,
      twilio_account_sid=excluded.twilio_account_sid, twilio_auth_token=excluded.twilio_auth_token,
      config_json=excluded.config_json, active=excluded.active`),
  listClients: p('SELECT * FROM clients ORDER BY name'),
  deleteClient: p('DELETE FROM clients WHERE id = ?'),
  upsertNumber: p(`
    INSERT INTO numbers (phone,client_id,label,active,kind,source) VALUES (@phone,@client_id,@label,1,@kind,@source)
    ON CONFLICT(phone) DO UPDATE SET client_id=excluded.client_id, label=excluded.label, active=1, kind=excluded.kind, source=excluded.source`),
  poolNumbers: p("SELECT phone FROM numbers WHERE client_id = ? AND active = 1 AND kind = 'pool'"),
  getNumber: p('SELECT * FROM numbers WHERE phone = ? AND active = 1'),
  listNumbers: p('SELECT * FROM numbers WHERE client_id = ? ORDER BY created_at'),
  deleteNumber: p('DELETE FROM numbers WHERE phone = ?'),
  countNumbers: p('SELECT COUNT(*) n FROM numbers WHERE client_id = ? AND active = 1'),

  // ── sessions / pool ──────────────────────────────────
  // numbers in this client's pool with NO active (unreleased & unexpired) reservation
  freeNumbers: p(`
    SELECT n.phone FROM numbers n
    WHERE n.client_id = ? AND n.active = 1 AND n.kind = 'pool'
      AND NOT EXISTS (
        SELECT 1 FROM sessions s
        WHERE s.phone = n.phone AND s.released = 0 AND s.expires_at > datetime('now')
      )
    LIMIT 1`),
  insertSession: p(`
    INSERT INTO sessions (id,client_id,phone,visitor_id,expires_at,fallback,channel,
      gclid,gbraid,wbraid,fbclid,msclkid,utm_source,utm_medium,utm_campaign,utm_content,utm_term,
      ga_client_id,fbp,fbc,landing_page,referrer,user_agent,ip)
    VALUES (@id,@client_id,@phone,@visitor_id,@expires_at,@fallback,@channel,
      @gclid,@gbraid,@wbraid,@fbclid,@msclkid,@utm_source,@utm_medium,@utm_campaign,@utm_content,@utm_term,
      @ga_client_id,@fbp,@fbc,@landing_page,@referrer,@user_agent,@ip)`),
  // best match for an inbound call: the most recent reservation for this number (active first)
  matchSession: p(`
    SELECT * FROM sessions
    WHERE phone = ?
    ORDER BY (CASE WHEN released = 0 AND expires_at > datetime('now') THEN 0 ELSE 1 END), assigned_at DESC
    LIMIT 1`),
  releaseSession: p('UPDATE sessions SET released = 1 WHERE id = ?'),

  // ── callers ──────────────────────────────────────────
  getCaller: p('SELECT * FROM callers WHERE client_id = ? AND caller = ?'),
  upsertCaller: p(`
    INSERT INTO callers (client_id,caller,call_count,last_seen)
    VALUES (@client_id,@caller,1,datetime('now'))
    ON CONFLICT(client_id,caller) DO UPDATE SET
      call_count = call_count + 1, last_seen = datetime('now')`),

  // ── calls ────────────────────────────────────────────
  insertCall: p(`
    INSERT INTO calls (call_sid,client_id,tracking_number,caller,status,first_time,session_id,channel,
      gclid,gbraid,wbraid,fbclid,msclkid,utm_source,utm_medium,utm_campaign,utm_content,utm_term,
      ga_client_id,fbp,fbc,landing_page,referrer,region)
    VALUES (@call_sid,@client_id,@tracking_number,@caller,@status,@first_time,@session_id,@channel,
      @gclid,@gbraid,@wbraid,@fbclid,@msclkid,@utm_source,@utm_medium,@utm_campaign,@utm_content,@utm_term,
      @ga_client_id,@fbp,@fbc,@landing_page,@referrer,@region)
    ON CONFLICT(call_sid) DO NOTHING`),
  getCall: p('SELECT * FROM calls WHERE call_sid = ?'),
  updateCallStatus: p(`UPDATE calls SET status=@status, answered=@answered, duration_sec=@duration_sec, qualified=@qualified WHERE call_sid=@call_sid`),
  updateRecording: p(`UPDATE calls SET recording_url=@recording_url, recording_sid=@recording_sid WHERE call_sid=@call_sid`),
  updateTranscript: p('UPDATE calls SET transcript=@transcript WHERE call_sid=@call_sid'),
  markSpam: p("UPDATE calls SET lead_status = 'spam' WHERE call_sid = ?"),
  updateConv: p(`UPDATE calls SET conv_google=COALESCE(@conv_google,conv_google), conv_meta=COALESCE(@conv_meta,conv_meta), conv_ga4=COALESCE(@conv_ga4,conv_ga4) WHERE call_sid=@call_sid`),
  callByRecordingSid: p('SELECT * FROM calls WHERE recording_sid = ?')
};

module.exports = { db, migrate, q, isLocal };
