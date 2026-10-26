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
