# Phase 2 — True call tracking (Dynamic Number Insertion)

Phase 1 tracks **clicks** on phone numbers. That's a strong proxy and covers most of the
reporting gap. But a click ≠ an answered call. Phase 2 upgrades to **real call tracking** at a
fraction of CallRail's price using **Twilio** Greek numbers. The schema in phase 1 already has
`tracking_number`, `call_status`, `call_duration` columns, so this slots in without rework.

## How DNI works
1. Buy a pool of Greek numbers from Twilio (mobile/landline, ~€1–3/number/month + per-minute).
2. Each number forwards to the client's real line (Twilio "forward" TwiML).
3. On the website, `tracker.js` (phase-2 build) **swaps the displayed number** for a tracking
   number, choosing per **channel/campaign** (e.g. one number for Google Ads, one for Meta) or
   per-visitor session for 1:1 attribution.
4. When someone calls, Twilio fires a **status callback webhook** with call duration + status.
5. A webhook handler matches the tracking number → the stored attribution → pushes a
   conversion to Google Ads / Meta and updates the Sheet row.

## What changes vs phase 1

| Piece | Phase 1 | Phase 2 |
|-------|---------|---------|
| Trigger | tel: click | actual answered call |
| Number shown | client's real number | rotating tracking number |
| Backend | Apps Script (Sheet + CAPI) | Apps Script is too limited for Twilio webhooks + number pool → move to Cloudflare Worker or small Node service |
| Google Ads | online conversion (browser) | **offline conversion import** by gclid (call answered, duration ≥ threshold) |
| Meta | Contact (click) | CAPI `Lead` on answered call |

> This is the point where "no backend" stops being enough. Twilio webhooks need a real endpoint.
> Cloudflare Workers (free tier) is the cheapest reliable host — keep the same event schema.

## Attribution matching
Store, per session, `{ tracking_number, gclid/fbc, utm_*, ga_client_id }` keyed by the number
assigned. On the Twilio webhook, look up by `To` (the tracking number) + recency window and
attach the stored attribution to the call conversion.

## Number-pool sizing
For low/medium traffic: **channel-level** numbers (1 per source) are cheap and good enough.
For precise 1:1, use a **session pool** (N numbers rotated, released after ~5–10 min). Size N to
peak concurrent visitors-from-ads, not total traffic.

## Cost sketch (vs CallRail)
- CallRail: ~$45–$145+/mo per account.
- DIY Twilio: number rental + usage. A small client with 5 numbers + a few hundred minutes/mo
  typically lands well under €20/mo, and one Cloudflare Worker covers all clients.

## Suggested build order
1. Ship phase 1 (this repo) — start collecting clicks + attribution now.
2. Add a Cloudflare Worker that replaces the Apps Script collector (same payload), so you have
   a real endpoint ready.
3. Add Twilio numbers + DNI swap + status webhook.
4. Add Google Ads offline conversion import (Click Conversions API) and Meta CAPI `Lead`.
