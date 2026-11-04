# Ruler CallTrack — Developer Brief (install & handover)

A self-hosted, multi-client **call-tracking platform** (CallRail alternative) for the Greek
market. Node + SQLite + Twilio, with a branded web UI for managing clients and reading reports.
Each client uses **their own Twilio credentials**, isolated per account.

---

## v2 at a glance (2026-11-04)
- **People and access:** owner, team member and client (read-only portal) logins; a client login sees only its own clients, enforced on the server. The `ADMIN_USER`/`ADMIN_PASSWORD` pair only creates the first owner on first boot.
- **Lead work:** lead status (lead, customer, not a lead, spam), value per call, tags, notes and a call-back queue for missed calls; the region of landline callers from the Greek area code.
- **MCP server** at `POST /mcp` (Streamable HTTP) for Claude, n8n and other tools, authenticated with personal `ct_` tokens made in Settings › API and MCP. Read tools for everyone; lead-level writes for team members. No access to Twilio or ad-platform secrets, numbers or deletion.
- **New web app** (React + Vite + Tailwind, Ruler Hub glass design), built into `web/dist` by `npm run build` and served by the same Node process. The old `public/admin` UI and `/admin/api` are gone.
- **Tests:** `npm test` (node:test, throwaway DB). **Demo:** `DB_PATH=./data/demo.db node tools/demo.js`, then `node tools/run-demo.js` (port 8099).

## Wave 2 (2026-11-04)
Block list, fixed source numbers, missed-call alerts (Slack, email, Viber), scheduled email reports, outbound webhooks,
AI call summaries (Claude), health flags, password change and reset. New optional `.env` values: `SMTP_*`,
`MAIL_FROM`, `VIBER_*`, `ANTHROPIC_API_KEY`, `AI_MODEL`, `TRUST_PROXY` (see `.env.example`). Reports are sent by the app
itself every 15 minutes when due; nothing extra to schedule.

## 1. What it does
- **DNI (dynamic number insertion):** swaps the phone number on a client's website per visitor, carrying the ad attribution (gclid/fbclid/utm).
- **Call tracking:** answered/missed, duration, first-time vs repeat caller, recording + transcription (with a Greek GDPR consent announcement).
- **Attribution → conversions:** pushes qualified calls to **Google Ads** (offline click conversion via gclid), **Meta CAPI** (Lead), and **GA4**.
- **Web app:** overview of every client, the call log with recordings and transcripts, lead work, client settings (Twilio creds, conversion config, number pool, website code), reports, team and client logins, API tokens.
- **MCP + REST:** `/mcp` for AI assistants and automation tools, `/api/report/*` for Looker Studio and scripts.

## 2. Architecture
```
Browser snippet (dni-tracker.js) ──POST /api/dni/assign──► Node app ──► SQLite (data/calls.db)
Twilio (per client) ──POST /webhooks/voice/*──► Node app  (signature checked w/ that client's token)
Team + clients ──► /  (web app, web/dist) ──► /api/v2/*  (cookie session, roles, client scope)
Claude, n8n … ──► /mcp  (Bearer ct_ token, same scope)          Looker ──► /api/report/*  (key or token)
                                   └─► conversion push: Google Ads / Meta CAPI / GA4
Caddy (reverse proxy) terminates HTTPS in front of the Node app.
```
- **Stack:** Node ≥20 (22 in Docker), Express, React + Vite (build time only), @modelcontextprotocol/sdk, better-sqlite3 (single-file DB), Twilio SDK, google-ads-api.
- **No external DB/service** required. One container does it all; Caddy adds auto-HTTPS.

## 3. Prerequisites
- A Linux server reachable on a public HTTPS domain (e.g. `calls.ruler.agency`). Free option: Oracle Cloud Always Free; cheap: Hetzner ~€4/mo. (Full VM walkthrough in `DEPLOY.md`.)
- Docker + Docker Compose on that server.
- A subdomain DNS A-record pointing to the server.
- Per client: a Twilio account (or subaccount) with a Greek **regulatory bundle** approved and **Local (+30)** numbers purchased.

## 4. Install (Docker — recommended)
```bash
# on the server
git clone <your repo> ruler-calltrack   # or scp the phase2-call-tracking folder
cd ruler-calltrack
cp .env.example .env
nano .env            # fill the REQUIRED vars below
nano Caddyfile       # set your domain + email

docker compose up -d --build
docker compose logs -f app    # → "ctc-call-tracking listening on :8080"
```
Open `https://<your-domain>/health` → `{"ok":true}` with a valid certificate.

### Required `.env` values
```
PUBLIC_BASE_URL=https://calls.ruler.agency   # exact public URL (used for Twilio signature checks)
BRAND_NAME=Ruler CallTrack                   # UI name
ADMIN_USER=admin
ADMIN_PASSWORD=<strong password>             # UI login
SESSION_SECRET=<openssl rand -base64 48>     # signs session cookies
# TWILIO_* are FALLBACK only — real creds are entered per-client in the UI
```

### Run without Docker (alternative)
```bash
npm install
npm run migrate
ADMIN_PASSWORD=... SESSION_SECRET=... PUBLIC_BASE_URL=... npm start
# put Nginx/Caddy in front for HTTPS; keep alive with pm2 or a systemd unit
```

## 5. First-run configuration (via the UI)
1. Go to `https://<your-domain>/` → sign in with `ADMIN_USER` / `ADMIN_PASSWORD` (the first owner). Add your team, and later client logins, in **Settings › Team and client logins**.
2. **New client** → fill:
   - **Basics:** client id (slug), name, forward-to number (their real line), lead value, qualified-after seconds, recording on/off, Greek consent text.
   - **Twilio:** that client's **Account SID + Auth Token**.
   - **Conversions (optional):** Google Ads `customerId`/`conversionActionId`, Meta `pixelId`/`capiToken`, GA4 `measurementId`/`apiSecret`.
3. Save → add the client's **tracking numbers** to the DNI pool.
4. In **Twilio**, set each number's *Voice → A Call Comes In* webhook to:
   `https://<your-domain>/webhooks/voice/incoming`  (HTTP **POST**).
5. Copy the **website snippet** shown in the editor onto the client's site.

> Secrets (Twilio token, CAPI token, GA4 secret) are write-only in the UI — they're stored in the DB and shown masked (`••••1234`); leaving a secret field blank keeps the existing value.

## 6. Google Ads conversions (one-time agency setup)
Offline click-conversion upload needs agency-level OAuth. Set in `.env`:
`GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET`,
`GOOGLE_ADS_REFRESH_TOKEN`, `GOOGLE_ADS_LOGIN_CUSTOMER_ID`. (Ask for `tools/google-oauth.js` to generate the refresh token.) Per-client `customerId`/`conversionActionId` go in the UI.

## 7. Verify the pipeline
```bash
# fake the whole flow without real telephony (set VALIDATE_TWILIO_SIGNATURE=false first):
docker compose exec app sh -c "VALIDATE_TWILIO_SIGNATURE=false BASE=http://localhost:8080 REPORT_API_KEY=$REPORT_API_KEY node test/simulate.js"
# → ✓ PASS — full attribution → call → qualify path works
```
Then place a real test call to a tracking number and confirm it appears in the UI report with duration, status, and a playable recording.

## 8. Security notes
- Admin UI is protected by a signed-cookie session (`SESSION_SECRET`); cookies are `HttpOnly`, `SameSite=Lax`, `Secure` under HTTPS.
- Every Twilio webhook is validated against **that client's** auth token (`X-Twilio-Signature`). Keep `VALIDATE_TWILIO_SIGNATURE=true` in production.
- Recordings are streamed through the app using the client's Twilio creds (browsers never get the token).
- `/api/report/*` is never open: it needs `REPORT_API_KEY` (as `X-Api-Key`, sees every client) or a personal `ct_` token (sees that user's clients).
- Passwords are scrypt-hashed; API tokens are stored as SHA-256 and shown once; sign-in is braked after 10 failures per address per 15 minutes.
- Every read in the web app, the report API and MCP goes through `src/calls.js`, which filters by the user's clients. A client login cannot see another client's calls, recordings or transcripts (covered by `npm test`).

## 9. GDPR (Greece)
Recording requires informing callers. The app plays a Greek announcement before connecting
(editable per client; default in `src/config.js`). Disable per client by unticking "Record calls".
Transcripts are personal data — agree retention with each client. Have clients approve the wording.

## 10. Day-2 operations
- **Backup:** the DB is one file — `cp data/calls.db` off-box on a cron (it's the whole dataset).
- **Update:** pull/scp new code → `docker compose up -d --build`.
- **Logs:** `docker compose logs -f app`.
- **Re-skin/rename:** the design tokens are at the top of `web/src/styles.css` (rebuild with `npm run build`); `BRAND_NAME` / `BRAND_COMPANY` in `.env`.

## 11. Cost
- Server + HTTPS: €0 (Oracle Always Free + Caddy/Let's Encrypt) or ~€4/mo (Hetzner).
- Twilio (per client): numbers ~€1+/mo each + per-minute (inbound + forward leg). This is the only guaranteed cost; budget by call volume.
