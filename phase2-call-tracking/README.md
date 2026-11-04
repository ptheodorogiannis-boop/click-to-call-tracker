# Phase 2 — Call Tracking (Twilio + Node) · CallRail alternative

Real **call tracking** for the Greek market: dynamic number insertion, answered/missed
detection, call duration, first-time-vs-repeat callers, recording + transcription (with GDPR
consent), and **click-precise attribution** pushed to Google Ads, Meta, and GA4. Multi-client,
runs as one Node service on your VPS.

> This is the upgrade from Phase 1 (click tracking). Phase 1's click data still complements
> this; Phase 2 tracks the **actual phone call**.

**v2 (2026-11-04):** a new web app in the Ruler Hub glass design, team and client logins with
server-side client scope, lead work (status, value, tags, notes, call-back queue) and an **MCP
server** so Claude and other tools can read calls and work leads. Multi-client with **per-client
Twilio credentials**. To install on a server, follow **[DEV-BRIEF.md](DEV-BRIEF.md)** (or `DEPLOY.md`
for the free-VM walkthrough). Manage everything at `https://<your-domain>/` after login.

## How it works
```
Visitor lands ─► dni-tracker.js captures gclid/fbclid/utm ─► POST /api/dni/assign
   ◄─ a tracking number from this client's pool (reserved to this visitor)
   page swaps the displayed number to it

Visitor calls the tracking number
   Twilio ─► POST /webhooks/voice/incoming
       • match number → visitor's attribution (incl. real gclid)
       • first-time vs repeat (caller-id history)
       • play Greek consent announcement (if recording on)
       • <Dial> forward to client's real line, record the bridge
   Twilio ─► POST /webhooks/voice/dial-complete   (answered? duration?)
       • qualified (answered ≥ threshold) ⇒ push conversions:
           Google Ads offline CLICK conversion (gclid)  ← bid-optimizable
           Meta CAPI Lead (fbc/fbp + hashed phone)
           GA4 Measurement Protocol event
   Twilio ─► POST /webhooks/voice/recording        (store + transcribe)
```

## Why session-level pool (your choice)
Each visitor gets a unique number, so an inbound call carries the **real gclid** → Google Ads
gets a true offline conversion it can optimize bidding on (not just channel-level reporting).
Cost is more numbers; see pool sizing below.

## Setup
### 1. Server
```bash
cd phase2-call-tracking
cp .env.example .env          # fill Twilio + (optional) Google Ads / OpenAI
npm install
npm run migrate
npm run seed                  # demo client + pool — edit tools/seed.js for real values
npm run build                 # the web app → web/dist
npm start                     # listens on :8080
```
Put it behind HTTPS (Caddy/Nginx) and set `PUBLIC_BASE_URL` to the public URL — Twilio must
reach `/webhooks/...` and signatures are validated against this exact URL.

### 2. Twilio
1. Create a **Regulatory Bundle** for Greece (business reg + Greek address) — approval ~3 business days. Twilio Greece offers **Local (+30)** and **Toll-Free** numbers (no mobile).
2. Buy a pool of numbers. For each, set **A Call Comes In → Webhook → `https://YOUR_BASE/webhooks/voice/incoming` (HTTP POST)**.
3. Add the numbers to a client's pool (see `tools/seed.js` / the `numbers` table).

### 3. Client website
```html
<script>window.CTC_DNI_CONFIG = {
  siteId:'client-acme',
  apiBase:'https://YOUR_BASE',
  realNumbers:['+302101234567','2101234567']   // your client's displayed number variants
};</script>
<script src="https://YOUR_BASE/static/dni-tracker.js" defer></script>
```
Or mark elements explicitly: `<a href="tel:+302101234567" data-ctc-dni>210 123 4567</a>`.

### 4. Conversions (optional but the point)
- **Google Ads:** create an offline conversion action ("Phone call lead"), put `customerId` +
  `conversionActionId` in the client's `config_json`. Set agency OAuth creds in `.env`.
- **Meta:** pixel id + CAPI token in `config_json`.
- **GA4:** measurement id + API secret in `config_json`.

## GDPR / recording (Greece)
Recording requires informing the caller. The server plays a Greek announcement **before
connecting** (`config.defaultConsentMessageEl`, overridable per client). To disable recording for
a client, set `recording_enabled = 0`. Transcripts are personal data — store/retain per your DPA.
This is a compliance-sensitive feature; have the client sign off on the announcement wording and
retention period.

## Pool sizing
A number is reserved per visitor for `SESSION_TTL_MINUTES` (default 60). Size the pool to **peak
concurrent ad visitors**, not total traffic. If the pool exhausts, the server reuses the
oldest-reserved number (`fallback:true`) — attribution still logs but could be shared. Start with
5–10 numbers per busy client and watch for `fallback` in the `ctc_dni_assigned` dataLayer event.

## Web app, people and MCP
`npm run build` builds the web app (`web/`, React + Vite + Tailwind) into `web/dist`; `npm start` serves it at `/`.

| Role | Sees | Can change |
|---|---|---|
| Owner | every client | everything, plus team and client logins |
| Team member | every client | lead status, value, tags, notes, called back; clients, numbers, conversions |
| Client | only the clients on their login | nothing (read-only portal) |

The first owner comes from `ADMIN_USER` / `ADMIN_PASSWORD` on first boot. Every read goes through
`src/calls.js`, which filters by the user's clients.

**MCP.** `POST /mcp` speaks the Model Context Protocol over Streamable HTTP (stateless). Make a
personal token in **Settings › API and MCP** and send it as `Authorization: Bearer ct_…`. Tools:
`whoami`, `list_clients`, `get_overview`, `get_report`, `list_calls`, `search_calls`, `get_call`,
`calls_to_call_back`, and for team members `set_lead_status`, `tag_call`, `add_note`,
`mark_called_back`. Claude Code: `claude mcp add --transport http ruler-calls https://YOUR_BASE/mcp --header "Authorization: Bearer ct_…"`.

## Reporting API
- `GET /api/report/stats?client=client-acme&since=2026-06-01` → per-channel totals.
- `GET /api/report/calls?client=client-acme` → call rows with attribution.
- Never open: send `REPORT_API_KEY` as `X-Api-Key` (every client) or a personal token as
  `Authorization: Bearer ct_…` (that user's clients).
- `GET /api/v2/reports/calls.csv` (signed in) exports the call log.

## Tests and local runs
- `npm test`: access rules, client scope, lead work, the report API and MCP (through the SDK's own
  client), on a throwaway database.
- Demo data: `DB_PATH=./data/demo.db node tools/demo.js`, then `node tools/run-demo.js` → http://localhost:8099,
  sign in as `admin` / `demo-password-1` (or `lyra@client.demo` for the client view).
- Web app with hot reload: `node tools/run-demo.js` and `npm run dev:web` (port 5173, proxies the API).

### Without telephony
With the server running: `npm run simulate` (with `REPORT_API_KEY` set). It requests a DNI number, fakes the Twilio
incoming/dial/recording webhooks for a 42s answered call from a Google click, then asserts the
call is logged as `channel=google_ads`, `gclid` preserved, `qualified=1`, `first_time=1`.
(Set `VALIDATE_TWILIO_SIGNATURE=false` in `.env` for the simulation.)

## Status / honesty
- Since 2026-11-04 the backend runs locally on Node 24: `npm test` (24 tests) and `npm run simulate`
  pass. It has **not** taken a real Twilio call yet; place a test call after deploying.
- Google Ads / Meta / GA4 uploads are untested against the live APIs.
- The browser DNI swapper (`public/dni-tracker.js`) was verified in a real browser.
