# Deploy on Vercel with Turso

CallTrack runs on Vercel as one Express function (`src/app.js`) with its data in a Turso database (hosted SQLite,
same SQL as the local file). The web app is served from Vercel's CDN, scheduled reports run from a daily Vercel Cron
Job, and everything else (Twilio webhooks, MCP, the API) goes through the function.

> **Plan.** Vercel's free Hobby plan is for personal, non-commercial use. Call tracking for agency clients is commercial
> use, so the project belongs on a Pro team. Turso's free tier is plenty for this size.

## 1. Turso: the database

1. Sign up at [turso.tech](https://turso.tech) and create a database. Pick the **Frankfurt** location
   (`aws-eu-central-1`): the Vercel function runs in Frankfurt too (`vercel.json` › `regions: ["fra1"]`), so every
   query is a short hop.
2. Copy two values (database page › Connect, or the CLI):
   - the database URL, `libsql://<name>-<org>.turso.io` (`turso db show <name> --url`)
   - an auth token (`turso db tokens create <name>`)

The schema is created on the first request; nothing to run by hand.

## 2. Vercel: the project

1. Vercel › Add New › Project › import `ptheodorogiannis-boop/click-to-call-tracker`.
2. **Root Directory: `phase2-call-tracking`**. Framework preset: Other (Vercel detects the Express app). Leave the
   build and output settings as they are; `vercel.json` sets the build command.
3. Environment variables (Production; add them to Preview as well only with a *separate* Turso database, so previews
   never write to live data):

| Name | Value |
|---|---|
| `TURSO_DATABASE_URL` | the `libsql://…` URL |
| `TURSO_AUTH_TOKEN` | the token |
| `SESSION_SECRET` | a long random string (`openssl rand -base64 48`) |
| `ADMIN_USER` / `ADMIN_PASSWORD` | the first owner's login, used once when the database is empty |
| `CRON_SECRET` | another long random string; Vercel sends it to the report cron |
| `PUBLIC_BASE_URL` | only with a custom domain, e.g. `https://calls.ruler.agency` (defaults to the project's production URL) |
| `REPORT_API_KEY` | optional, for `/api/report/*` from Looker Studio |
| `SMTP_*`, `MAIL_FROM`, `ANTHROPIC_API_KEY`, `VIBER_*`, `TRANSCRIPTION_PROVIDER`, `OPENAI_API_KEY` | optional features, see `.env.example` |

4. Deploy. Sign in at the production URL with `ADMIN_USER` / `ADMIN_PASSWORD`.

## 3. Twilio

Point each tracking number's voice webhook at `https://<production address>/webhooks/voice/incoming` (POST). Twilio's
signature is checked against `PUBLIC_BASE_URL` + the path, so with a custom domain set `PUBLIC_BASE_URL` to it.

## Good to know

- **Reports** are checked once a day at 06:00 UTC (Hobby allows daily crons); weekly reports go out on Mondays, monthly
  ones on the 1st.
- **Work after a call** (conversion uploads, alerts, webhooks with their retries, AI summaries) runs after Twilio has
  its answer, kept alive with `waitUntil` within the function's time limit.
- **Sign-in brake** (10 wrong passwords per address per 15 minutes) is counted per running instance on Vercel.
- **Moving existing data** from a local `data/calls.db`: `turso db create <name> --from-file data/calls.db`, or ask
  before uploading it anywhere.
- The same code still runs on a VPS with Docker (`DEPLOY.md`), on a local SQLite file.
