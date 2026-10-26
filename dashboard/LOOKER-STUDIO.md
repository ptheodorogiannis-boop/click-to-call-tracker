# Client reporting — Looker Studio on the Google Sheet

Your Apps Script collector logs every click-to-call to the `events` sheet. That sheet is your
reporting source. Build one Looker Studio template and reuse it per client (filter by `site_id`).

## Connect
1. [lookerstudio.google.com](https://lookerstudio.google.com) → Create → Data source → **Google Sheets** → pick your spreadsheet → `events` sheet.
2. Set field types: `received_at`/`event_time`/`first_ts` = Date & Time; `call_duration` = Number; rest = Text.
3. Add a **report-level filter control** on `site_id` so each client sees only their data
   (or duplicate the report and hard-filter per client for white-labeled sharing).

## Scorecards (top row)
| Metric | How |
|--------|-----|
| **Total call clicks** | Record Count |
| **Calls from Google** | Record Count, filter `utm_source` contains google OR `gclid` is not null |
| **Calls from Meta** | Record Count, filter `fbclid`/`fbc` is not null OR `utm_source` in (facebook, instagram, meta) |
| **Calls from paid** | filter `utm_medium` in (cpc, ppc, paid, paidsocial) |

## Charts
- **Time series** — call clicks by day (dimension `received_at`).
- **Bar / table** — clicks by `utm_source` / `utm_campaign` (this is the "which campaign drove the call" view clients want).
- **Table** — top landing pages (`first_landing`) and top clicked pages (`page_url`).
- **Pie** — `event_type` (tel vs chat) once you enable chat selectors.

## Channel grouping (calculated field)
Create a field `channel`:
```
CASE
  WHEN gclid <> '' OR REGEXP_MATCH(utm_source,'(?i)google') THEN 'Google Ads'
  WHEN fbc <> '' OR REGEXP_MATCH(utm_source,'(?i)(facebook|instagram|meta)') THEN 'Meta'
  WHEN REGEXP_MATCH(utm_medium,'(?i)(cpc|ppc|paid)') THEN 'Other Paid'
  WHEN referrer = '' THEN 'Direct'
  ELSE 'Organic / Referral'
END
```
Use `channel` as the primary breakdown dimension in client reports.

## Phase-2 (when DNI is added)
`call_status` and `call_duration` populate from Twilio. Add:
- **Answered rate** = answered calls / total calls.
- **Qualified calls** = filter `call_duration` >= 30 (clients usually treat 30s+ as a real lead).
- Send only `call_status = answered` (or duration ≥ threshold) to Google Ads / Meta to optimize on *real* calls, not clicks.
