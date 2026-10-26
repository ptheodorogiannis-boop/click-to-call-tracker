# Phase 2 — Call Tracking (Twilio + Node) · CallRail alternative

Real **call tracking** for the Greek market: dynamic number insertion, answered/missed
detection, call duration, first-time-vs-repeat callers, recording + transcription (with GDPR
consent), and **click-precise attribution** pushed to Google Ads, Meta, and GA4. Multi-client,
runs as one Node service on your VPS.

> This is the upgrade from Phase 1 (click tracking). Phase 1's click data still complements
> this; Phase 2 tracks the **actual phone call**.

**Finalized as a self-hosted product:** branded web UI ("Ruler CallTrack"), multi-client with
**per-client Twilio credentials**, login-protected admin, and per-client reports with recordings
+ transcripts. To install on a server, follow **[DEV-BRIEF.md](DEV-BRIEF.md)** (or `DEPLOY.md`
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

## Reporting
- `GET /api/report/stats?client=client-acme&since=2026-06-01` → per-channel totals (calls,
  answered, missed, qualified, first-time).
- `GET /api/report/calls?client=client-acme` → call rows with attribution + recording + transcript.
- Point Looker Studio / Metabase at the SQLite DB (or sync to a sheet) for client dashboards.
- Set `REPORT_API_KEY` in `.env` to require `X-Api-Key` on these endpoints.

## Local test without telephony
With the server running: `npm run simulate`. It requests a DNI number, fakes the Twilio
incoming/dial/recording webhooks for a 42s answered call from a Google click, then asserts the
call is logged as `channel=google_ads`, `gclid` preserved, `qualified=1`, `first_time=1`.
(Set `VALIDATE_TWILIO_SIGNATURE=false` in `.env` for the simulation.)

## Status / honesty
- This backend has **not been executed in the build environment** (no Node runtime there). The
  code is written to run on Node ≥18; validate locally with `npm run simulate` before going live.
- The browser DNI swapper (`public/dni-tracker.js`) **was** verified in a real browser.
