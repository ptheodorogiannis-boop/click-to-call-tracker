-- Call-tracking schema (SQLite). Multi-client. One file DB on the VPS.

CREATE TABLE IF NOT EXISTS clients (
  id                    TEXT PRIMARY KEY,         -- e.g. 'client-acme'
  name                  TEXT NOT NULL,
  forward_number        TEXT NOT NULL,            -- client's REAL line, E.164 (+30…)
  consent_message       TEXT,                     -- Greek announcement; NULL = use default
  recording_enabled     INTEGER NOT NULL DEFAULT 1,
  qualified_duration_sec INTEGER,                 -- NULL = use server default
  lead_value            REAL NOT NULL DEFAULT 0,  -- value sent to ad platforms per qualified call
  currency              TEXT NOT NULL DEFAULT 'EUR',
  -- per-client Twilio credentials (each client's own Twilio (sub)account)
  twilio_account_sid    TEXT,
  twilio_auth_token     TEXT,
  config_json           TEXT NOT NULL DEFAULT '{}', -- {googleAds:{customerId,conversionActionId}, meta:{pixelId,capiToken}, ga4:{measurementId,apiSecret}}
  active                INTEGER NOT NULL DEFAULT 1,
  created_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The DNI pool. Every number is a Twilio number routed to this server.
CREATE TABLE IF NOT EXISTS numbers (
  phone        TEXT PRIMARY KEY,                  -- E.164 Twilio number
  client_id    TEXT NOT NULL REFERENCES clients(id),
  label        TEXT,                              -- optional human label
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_numbers_client ON numbers(client_id, active);

-- A reservation: while active, this tracking number maps to one visitor's attribution.
CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,                  -- uuid
  client_id    TEXT NOT NULL,
  phone        TEXT NOT NULL,                     -- assigned tracking number
  visitor_id   TEXT,
  assigned_at  TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at   TEXT NOT NULL,
  released     INTEGER NOT NULL DEFAULT 0,
  -- attribution snapshot
  channel      TEXT,
  gclid        TEXT, gbraid TEXT, wbraid TEXT, fbclid TEXT, msclkid TEXT,
  utm_source   TEXT, utm_medium TEXT, utm_campaign TEXT, utm_content TEXT, utm_term TEXT,
  ga_client_id TEXT, fbp TEXT, fbc TEXT,
  landing_page TEXT, referrer TEXT, user_agent TEXT, ip TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_phone ON sessions(phone, released, assigned_at);

-- Caller history for first-time vs repeat.
CREATE TABLE IF NOT EXISTS callers (
  client_id   TEXT NOT NULL,
  caller      TEXT NOT NULL,                      -- caller's number (From), E.164
  first_seen  TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen   TEXT NOT NULL DEFAULT (datetime('now')),
  call_count  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (client_id, caller)
);

-- One row per call.
CREATE TABLE IF NOT EXISTS calls (
  call_sid        TEXT PRIMARY KEY,               -- Twilio CallSid
  client_id       TEXT NOT NULL,
  tracking_number TEXT NOT NULL,
  caller          TEXT,
  started_at      TEXT NOT NULL DEFAULT (datetime('now')),
  answered        INTEGER NOT NULL DEFAULT 0,
  status          TEXT,                           -- ringing|answered|missed|busy|failed|completed
  duration_sec    INTEGER NOT NULL DEFAULT 0,
  qualified       INTEGER NOT NULL DEFAULT 0,
  first_time      INTEGER,                        -- 1 first-time caller, 0 repeat
  recording_url   TEXT,
  recording_sid   TEXT,
  transcript      TEXT,
  -- attribution (denormalized from matched session)
  session_id      TEXT,
  channel         TEXT,
  gclid TEXT, gbraid TEXT, wbraid TEXT, fbclid TEXT, msclkid TEXT,
  utm_source TEXT, utm_medium TEXT, utm_campaign TEXT, utm_content TEXT, utm_term TEXT,
  ga_client_id TEXT, fbp TEXT, fbc TEXT, landing_page TEXT, referrer TEXT,
  -- conversion push results
  conv_google TEXT, conv_meta TEXT, conv_ga4 TEXT
);
CREATE INDEX IF NOT EXISTS idx_calls_client ON calls(client_id, started_at);
-- v2 call columns (lead_status, value, called_back_at, called_back_by, region) are added in db.js ensureColumns.

-- ── v2: people, access, lead work ─────────────────────
-- login is an email, or a plain name for the bootstrap owner (ADMIN_USER, 'admin' by default).
CREATE TABLE IF NOT EXISTS users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  login          TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name           TEXT NOT NULL,
  password_hash  TEXT NOT NULL,
  role           TEXT NOT NULL CHECK (role IN ('owner','member','client')),
  active         INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at  TEXT
);

-- Which clients a 'client' user may see. Owners and members see every client.
CREATE TABLE IF NOT EXISTS user_clients (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id  TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, client_id)
);

-- Personal API tokens (REST + MCP). Only the SHA-256 is stored; the token is shown once.
CREATE TABLE IF NOT EXISTS api_tokens (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  prefix        TEXT NOT NULL,                    -- first characters, to recognise a token in the list
  token_hash    TEXT NOT NULL UNIQUE,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at  TEXT,
  revoked_at    TEXT
);

CREATE TABLE IF NOT EXISTS call_tags (
  call_sid  TEXT NOT NULL REFERENCES calls(call_sid) ON DELETE CASCADE,
  tag       TEXT NOT NULL,
  PRIMARY KEY (call_sid, tag)
);

CREATE TABLE IF NOT EXISTS call_notes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  call_sid    TEXT NOT NULL REFERENCES calls(call_sid) ON DELETE CASCADE,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_call_notes_call ON call_notes(call_sid);

-- ── wave 2 ─────────────────────────────────────────────
-- New columns (numbers.kind/source, sessions.fallback, calls.ai_*, clients alert/report settings) are added in
-- db.js ensureColumns.

-- Callers a client never wants to hear from: an exact number (+302101234567) or a prefix ending in * (+30690*).
CREATE TABLE IF NOT EXISTS blocklist (
  client_id   TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  pattern     TEXT NOT NULL,
  note        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (client_id, pattern)
);

-- Outbound webhooks: call events POSTed, HMAC-signed, to a URL. client_id NULL = every client.
CREATE TABLE IF NOT EXISTS webhooks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id    TEXT REFERENCES clients(id) ON DELETE CASCADE,
  url          TEXT NOT NULL,
  secret       TEXT NOT NULL,
  events       TEXT NOT NULL DEFAULT 'call.completed,call.updated',
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  last_status  TEXT,
  last_at      TEXT,
  failures     INTEGER NOT NULL DEFAULT 0
);
