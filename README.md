# Click-to-Call Tracker (Ruler Agency)

A lightweight, multi-client alternative to CallRail for the Greek market — built to **track
click-to-call leads and report them with full ad attribution**, with **no paid tools and no
server you maintain**.

> **Phase 1 (this repo):** track every click on phone numbers / call buttons, attribute it to
> the campaign that drove it (Google Ads, Meta, organic…), push it as a conversion to **Google
> Ads + Meta + GA4**, and log everything to a **Google Sheet** for client reporting.
> **Phase 2 (designed-in):** swap to real answered-call tracking via Twilio DNI — see
> [`PHASE-2-DNI.md`](PHASE-2-DNI.md).

## What problem this solves
Greek customers call instead of filling forms. You can see *clicks to call* on the website but
can't prove which **campaign** caused them — so paid-media reporting and bid optimization are
blind. CallRail fixes this but is expensive. This does the click-to-call + attribution part for
≈€0 and is ready to grow into full call tracking.

## Architecture
```
 Client website ──(tel: click)──► tracker.js
                                      │
            ┌─────────────────────────┼──────────────────────────┐
            ▼                         ▼                           ▼
      dataLayer (GTM)         direct pixels (optional)     Apps Script web app (free)
            │                                                     │
   ┌────────┼─────────┐                                  ┌────────┴────────┐
   ▼        ▼         ▼                                   ▼                 ▼
 GA4   Google Ads  Meta Pixel  ◄──── event_id dedup ────► Meta CAPI    Google Sheet
                                                                      (Looker Studio)
```

## Files
| Path | What it is |
|------|-----------|
| [`tracker.js`](tracker.js) | The ~5KB client script. Captures attribution, detects calls, fires events. Multi-client via `siteId`. |
| [`gtm/GTM-SETUP.md`](gtm/GTM-SETUP.md) | Step-by-step GTM wiring (GA4 + Google Ads + Meta Pixel). No backend. |
| [`apps-script/Code.gs`](apps-script/Code.gs) | Free Google-hosted collector: logs to a Sheet + relays to Meta CAPI (server-side, dedup'd). |
| [`config/clients.example.json`](config/clients.example.json) | Per-client `CTC_CONFIG` blocks. Secrets stay server-side. |
| [`dashboard/LOOKER-STUDIO.md`](dashboard/LOOKER-STUDIO.md) | Build the white-label client report on the Sheet. |
| [`PHASE-2-DNI.md`](PHASE-2-DNI.md) | Upgrade path to real call tracking with Twilio. |

## Quick start (per client, ~20 min)
1. **Collector:** deploy `apps-script/Code.gs` as a Web App, set `SHEET_ID`, run `setup()`. Copy the `/exec` URL.
2. **Meta CAPI (optional, recommended):** add the client's pixel id + CAPI token to `CLIENTS` in `Code.gs`.
3. **GTM:** follow `gtm/GTM-SETUP.md` — load `tracker.js` with the client's `CTC_CONFIG` (set `collectorUrl` to the `/exec` URL), create the trigger + 3 tags.
4. **Google Ads:** create a "Phone call lead" conversion action; put its ID/Label in the GTM tag.
5. **GA4:** mark `phone_call_click` as a Key Event.
6. **Report:** connect Looker Studio to the Sheet (`dashboard/LOOKER-STUDIO.md`).

No GTM on a client site? Set `fireDirect: true` in `CTC_CONFIG` and fill the GA4/Ads/Pixel IDs — the script fires them itself.

## Why the design choices
- **Apps Script as "backend":** honors your "no backend I run" requirement while still enabling
  the Sheet store + server-side Meta CAPI (which a pure-GTM setup can't do).
- **`event_id` everywhere:** the same id goes to the Meta browser Pixel and the CAPI relay, so
  Meta deduplicates — you recover ad-blocked/iOS conversions without double-counting.
- **First + last touch stored:** clients always ask "which campaign", and last-paid-touch is
  what optimizes bidding; first-touch shows discovery.
- **Greek phone normalization:** `tel:` values are normalized to `+30…` E.164 so reporting and
  CAPI phone-hash matching are consistent.

## Privacy / GDPR
- The phone number captured is the **business's own number** (the one being called), not the
  caller's — no caller PII is collected at the click stage.
- CAPI sends only hashed identifiers (`fbp`/`fbc`/hashed phone) Meta already uses.
- Gate `tracker.js` behind your **Consent Mode / CMP** like any other marketing tag. With GTM,
  add consent checks to the tags; in direct mode, only load the script after consent.

## Limitations (phase 1, be honest with clients)
- Tracks **clicks**, not answered calls. A click is intent, not a guaranteed conversation.
- Desktop tel: clicks may not place a call. Filter/segment by device in reporting.
- For guaranteed answered-call + duration metrics, move to Phase 2 (Twilio DNI).
