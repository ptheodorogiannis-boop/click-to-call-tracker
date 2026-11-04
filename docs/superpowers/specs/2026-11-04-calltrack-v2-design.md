# CallTrack v2: Hub-glass rebuild, team + client access, MCP (2026-11-04)

Sub-project A of the Ruler Marketing Hub (B: shared design system, C: Hub shell, D: Hub MCP gateway come later,
each with its own spec). CallTrack is the pilot: it proves the Hub look and the MCP pattern on the smallest codebase.

## Decisions (from the brainstorm)

| Question | Decision |
|---|---|
| Where it lives | Standalone app, Hub look, built to plug into the Marketing Hub later |
| Who logs in | Agency team (owner / member) + read-only client portal (client role, scoped to its clients) |
| MCP scope | Remote MCP over HTTPS, per-user tokens; read everything in scope + safe lead-level writes |
| Build approach | Keep the Express + SQLite + Twilio backend; new React 19 + Vite + Tailwind UI; MCP on the same server |
| Overview layout | A, the Quantix board (KPI smoke tile, Greece caller map, sparkline tiles, solid client table, channel bars, red action strip) |

Feature additions from the competitor research (`docs/research/2026-11-04-competitor-features.md`) are wave 2;
they are added to this spec as a section once the report lands. Wave 1 below does not depend on it.

## What stays

`src/routes/dni.js`, `src/routes/voice.js`, `src/numberPool.js`, `src/services/*`, `public/dni-tracker.js`, the
schema and `npm run simulate`. The simulator passed on Node 24 on 2026-11-04 (first real run of the backend) and
must keep passing.

## Architecture

```
phase2-call-tracking/
  src/app.js          builds the Express app (exported for tests); src/server.js only listens
  src/users.js        users, scrypt passwords, roles, client scope, API tokens (hashed)
  src/auth.js         signed-cookie session now carries a user id; getSessionUser(req) is the one seam Hub SSO replaces
  src/scope.js        clientIdsFor(user) → every query filters on it, server side
  src/routes/api.js   /api/v2/* for the web app (session cookie)
  src/routes/report.js  /api/report/* keeps working (X-Api-Key) and also accepts Bearer ct_ tokens
  src/mcp.js          POST /mcp, Streamable HTTP (stateless), Bearer ct_ token → user → scope
  src/geo.js          Greek landline area code → region (approximate; mobiles have no region)
  web/                React + Vite + Tailwind app, built to web/dist and served by Express at /
```

The old `public/admin/` UI and `/admin/api` are removed once the new UI covers them.

### Data (added idempotently in `ensureColumns` / schema.sql)

- `users(id, email UNIQUE, name, password_hash, role owner|member|client, active, created_at, last_login_at)`
- `user_clients(user_id, client_id)`: which clients a `client` user may see (owner/member see all)
- `api_tokens(id, user_id, name, prefix, token_hash, created_at, last_used_at, revoked_at)`: token shown once,
  stored as SHA-256; format `ct_<32 random base64url>`
- `calls` gains `lead_status` (`new|good|not_lead|customer|spam`, default `new`), `value` (REAL, NULL = client
  default), `called_back_at`, `called_back_by`, `region`
- `call_tags(call_sid, tag)`, `call_notes(id, call_sid, user_id, body, created_at)`

Bootstrap: when `users` is empty and `ADMIN_PASSWORD` is set, the server creates an owner from
`ADMIN_USER`/`ADMIN_PASSWORD`, so existing deployments keep their login.

### Roles

| | owner | member | client |
|---|---|---|---|
| See calls, reports, recordings | all clients | all clients | own clients only |
| Tag, lead status, value, notes, call back | yes | yes | no (read-only portal) |
| Clients, numbers, conversion settings | yes | yes | no |
| Team and client users | yes | no | no |
| Own API tokens | yes | yes | yes (read-only tools) |

### MCP (`/mcp`)

Stateless Streamable HTTP (`@modelcontextprotocol/sdk`), one server instance per request, auth by
`Authorization: Bearer ct_…`. Every tool runs as the token's user with that user's client scope; a call outside
scope is reported as not found. Tool names are plain (`list_calls`); the Hub gateway will namespace them.

Read: `whoami`, `list_clients`, `get_overview(days)`, `get_stats(client_id, since, until)`,
`list_calls(client_id?, since?, until?, status?, channel?, lead_status?, limit?)`, `get_call(call_sid)`
(attribution, transcript, tags, notes), `search_calls(query, client_id?)` (caller, campaign, transcript, notes),
`calls_to_call_back(client_id?)`.
Write (owner/member): `tag_call(call_sid, add?, remove?)`, `set_lead_status(call_sid, status, value?)`,
`add_note(call_sid, text)`, `mark_called_back(call_sid)`.
Never exposed: Twilio credentials, number pools, conversion secrets, deletion, users.

Settings shows how to connect: the URL, a token, and ready-to-paste config for Claude (remote connector) and for
clients that only speak stdio (`npx mcp-remote <url> --header "Authorization: Bearer …"`).

## UI (web/)

Stack: React 19, Vite, TypeScript, Tailwind 3, lucide-react, recharts, react-router, Manrope self-hosted
(`@fontsource-variable/manrope`, no Google Fonts call). Tokens and tile tones are taken from
`ruler-reports-v2/src/app/globals.css` + `tailwind.config.js` (the Ruler glass pass), with the same rulings:

- ground `#E4E4E2` with one red glow; tiles: glass (no blur), smoke, solid, inset; radius 24 tiles, pills for controls
- red `#DB0100` marks the active place only (nav pill, rail item) plus the one action strip
- labels sentence case, never tracked uppercase; titles 400, figures 300 tabular; Lucide 1.5 stroke
- light and dark (sun/moon toggle in the top bar, remembered per browser, follows the system by default)
- motion: rise-in on tiles, bars grow, sparklines draw, 200–350 ms, `cubic-bezier(.16,1,.3,1)`, off under reduced motion

Frame: top bar (wordmark "Ruler" + "Calls", pill nav, search ⌘K, theme, account), left icon rail for secondary
places, phone tab bar under 768 px.

| Page | Content |
|---|---|
| Overview | Quantix board: smoke KPI tile (calls, answered %, leads, cost per call when spend known else value), Greece caller map, Missed + First-time sparkline tiles, solid "Calls by client" table, solid "Calls by channel" bars, red strip "N missed calls from ads not called back" → Calls filtered |
| Calls | Filter bar (client, period, status, channel, lead status, search) and a solid call table; a row opens the call drawer: player, transcript, attribution (channel, campaign, keyword, landing page, gclid), lead status, value, tags, notes, "Mark called back" |
| Clients | Client board (C): one row per client with trend line, problems first; client editor tabs: Details, Numbers, Conversions, Website snippet, Portal users |
| Reports | Per client and period: KPI band, monthly calls bar + answered-rate line (Quantix "Total invoice" chart), channel and campaign tables, first-time vs repeat, caller map, CSV export |
| Settings | Team (owner), API tokens + MCP connect, branding |
| Client portal | Same app for `client` users: Overview, Calls, Reports for their clients only, no edit controls |

Map: Greece outline and region centroids projected once from Natural Earth 1:50m (`scripts/build-greece-map.mjs`,
scratch deps only) into `web/src/geo/greece.json`. Bubbles per region sized by calls; mobile callers listed
separately as "Mobile (no region)". Region comes from the landline area code and is labelled approximate.

## Testing

- `node:test` (`npm test`): users/roles/scope, token hashing and revocation, `/api/v2` permissions (client cannot
  read another client's call or write), MCP tools through the real transport including the scope check.
- `npm run simulate` stays green.
- UI checked in the browser at 1440 and 390 px, light and dark, with the seeded demo data.

## Build order

1. `app.js`/`server.js` split, data additions, users + tokens + scope, bootstrap owner, tests
2. `/api/v2` (everything the UI needs) + tests
3. MCP + tests
4. web/ scaffold, tokens, frame, theme; Overview; Calls + drawer; Clients + editor; Reports; Settings; portal
5. Greece map data, demo seed with realistic calls, browser QA, remove old admin, docs
6. Wave 2: research features (below)

## Wave 2: features from the competitor research

Source: `docs/research/2026-11-04-competitor-features.md` (top 15, ranked). Wave 1 already covers client logins and
roles (#3), tags, notes, lead status and value (#4, without pushing the value to ad platforms), CSV export (part of
#7) and the MCP server (#11).

**Status 2026-11-04:** the user chose all four groups; everything below is built and tested except value restatement,
keyword from gclid, call flows and GDPR retention. Alerts use Slack and email (no channel was named); scheduled reports
are HTML email with the CSV attached (no PDF yet).

**Can be built and verified on this machine** (no outside accounts):

| Feature | Research rank | Shape |
|---|---|---|
| Spam filter and block list | #6, must, S | per-client blocked numbers and prefixes; blocked calls are rejected before forwarding, logged as spam, never uploaded as conversions |
| Fixed source numbers | #5, must, S | a number can be "fixed" with a source label (Google Business Profile, print, radio); calls to it take that channel instead of falling to direct |
| Outbound webhooks | #10, should, S | per-client URL + signing secret; `call.completed` / `call.updated` events, HMAC-signed, retried; tested against a local receiver |
| Health flags | #8, should, S | in-app flags for a pool that ran out (fallback assignments), conversion upload failures, a client with no calls for N days |
| Password change and reset | gap found in review | change your own password; owner resets anyone's |

**Needs the user's accounts or a decision first:**

| Feature | Research rank | What is needed |
|---|---|---|
| Missed-call and daily alerts | #1, must, S | which channel: email (SMTP), Slack, Viber or SMS |
| AI call summary and lead score in Greek | #2, must, M | `ANTHROPIC_API_KEY`; built against a mock (`ANTHROPIC_BASE_URL`) like Ruler Reports |
| Scheduled client reports by email | #7, must, M | SMTP account, report template |
| Value restatement to ad platforms | #4 | check each platform's API for adjusting or retracting an uploaded conversion |
| Keyword from gclid | #9, should, M | Google Ads API access per client |
| Call flows (hours, voicemail, whisper), text back | #13, #15 | live Twilio numbers to test against |
| GDPR retention and per-caller export/delete | #14, should, M | retention periods agreed with clients |
