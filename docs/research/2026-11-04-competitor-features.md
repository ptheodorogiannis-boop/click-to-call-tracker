# Ruler CallTrack: competitor feature research

Date: 2026-11-04. Read-only research. No code was changed.
Method: `replica-recon` (feature matrix) and `replica-entrepreneur` (reviews → pain points → fixes → positioning). The output goes in this one file rather than the skills' usual `replica/` folder, as requested.

**How to read this document**
- **[Fact]** means I saw it at the cited URL. Each fact carries a source ID from the Sources section at the end.
- **[Inference]** is my own reading of the facts. Treat it as opinion.
- In the matrix, `?` means I saw no source for that cell. It does *not* mean "missing".
- Review pain points are **paraphrased**, each with the reviewer, date, rating and a link to the review page. The policy I work under allows only one short verbatim quote per response, so the report carries exactly one (Section 3). The verbatim wording is at each link.

---

## 0. TL;DR

- **Official MCP servers exist at two vendors.** CallRail has one hosted at `mcp.callrail.com/mcp` with OAuth and about 40 read and write tools [S1][S2]. CTM has one that works with Claude custom connectors only and publishes no tool list [C3]. Ringostat's pricing table lists "MCP integration with Claude AI", but I found no documentation for it [G1]. For WhatConverts, Ruler, Invoca, Nimbata, Mediahawk and Infinity/ResponseTap I found no first-party MCP, only third-party bridges.
- **AI call analysis is standard.** Every serious competitor sells AI summaries, scoring or classification on top of transcription. We transcribe but don't analyse. This is the biggest functional gap.
- **Agency basics we lack:** client logins and roles, alerts, tags and notes with lead status, scheduled client reports, webhooks, spam filtering, and static numbers for Google Business Profile and offline use.
- **Our structural advantage [Inference].** CallRail sells only in the US, CA, UK and AU [S3]. UK reviewers complain about mobile forwarding and porting with US vendors. Nimbata is the one competitor with a Greek footprint (Maroussi entity [N2], Greek reviewers on Trustpilot [TP-NB]). A self-hosted, EU-hosted, Greek-language, flat-cost tool is a defensible niche.
- **Name risk [Inference].** "Ruler CallTrack" sits right next to **Ruler Analytics**, a UK call-tracking and attribution vendor in this same comparison. Have a lawyer check the trademark before the product is marketed outside the agency.

---

## 1. Feature matrix

Legend: **Y** = has · **A** = add-on or higher tier only · **P** = partial · **N** = not offered (the source says so, or the vendor's own plan table shows "–") · **?** = not verified.
Columns: CR = CallRail · CTM = CTM (CallTrackingMetrics) · WC = WhatConverts · RUL = Ruler Analytics · INV = Invoca · NIM = Nimbata · RNG = Ringostat · INF = Infinity (now includes ResponseTap [F2]) · MH = Mediahawk · **OURS** = Ruler CallTrack.

Code evidence for the OURS column: `phase2-call-tracking/migrations/schema.sql`, `src/routes/*.js` and `src/services/*.js`. A grep for webhook-out, sms, role, export, csv, alert and keyword found none of these features. `utm_term` is stored. A single admin login lives in `src/auth.js`.

### 1a. Tracking and attribution
| Feature | CR | CTM | WC | RUL | INV | NIM | RNG | INF | MH | OURS |
|---|---|---|---|---|---|---|---|---|---|---|
| Session-level DNI number pool | Y [S1 session tracker] | Y [C2] | Y [W1] | Y [R1] | Y [I1] | A (Pro+) [N1] | A (module) [G1] | Y [F1] | Y [M1] | **Y** |
| Static source numbers (GBP, print, radio) | Y (source trackers) [S1] | Y [C2] | Y [W1] | ? | ? | Y (offline tracking) [N1] | ? | Y (fixed numbers) [F1] | Y [M1] | **N** (`voice.js`: an unmatched call becomes `channel: 'direct'`; `numbers.label` is not used as a source) |
| Keyword-level attribution | Y (keyword analysis) [S3][S5] | Y [C2] | Y [W1] | Y [R1] | Y [I-search] | P (HubSpot listing) [N3] | ? | ? | Y [M1] | **P** (`utm_term` stored, no Google Ads keyword or search-term lookup) |
| Multi-touch journey / visitor timeline | Y [S3][S5] | ? | A (Elite) [W1] | Y (6 models + DDA) [R1] | ? | ? | ? | ? | Y (User Journey) [M1] | **P** (first and last touch) |
| Form tracking | A (Complete plans) [S3] | A (Pro+) [C1] | A (Plus+) [W1] | Y [R1] | ? | A (Marketing+) [N1] | ? | ? | Y [M1] | **N** |
| Chat tracking | ? | Y (ChatAI) [C1] | A (Plus+) [W1] | Y [R1] | ? | ? | A (Pro) [G1] | ? | Y [M1] | **N** |
| Google Ads offline conversion push | Y [S5] | Y [C1] | Y [W1] | Y [R1] | Y [I1] | Y [N1] | ? | Y [F1] | Y [M1] | **Y** |
| Meta CAPI | ? | Y (Facebook) [C1] | ? | ? | Y [I1] | Y [N1] | ? | Y [F1] | Y [M1] | **Y** |
| GA4 | Y [S1] | Y [C1] | Y [W1] | ? | Y [I-search] | Y [N1] | ? | Y [F1] | Y [M1] | **Y** |
| Revenue / ROI matching | Y (ROI by channel) [S5] | ? | Y (sales values) [W1] | Y (CRM revenue) [R1] | Y (revenue import) [I1] | ? | ? | Y (Smart Match) [F1] | Y (Sales Matching) [M1] | **P** (fixed lead value per client) |

### 1b. Call handling
| Feature | CR | CTM | WC | RUL | INV | NIM | RNG | INF | MH | OURS |
|---|---|---|---|---|---|---|---|---|---|---|
| Forward to the client's line | Y (routing) [S3] | Y [C1] | Y [W1] | ? | Y (routing) [I1] | Y [N1] | Y [G1] | Y [F1] | Y [M1] | **Y** |
| Recording | Y [S3] | Y [C1] | Y [W1] | ? | Y [I1] | Y [N1] | Y [G1] | Y [F1] | Y [M1] | **Y** (plus Greek consent announcement) |
| Call flows / IVR / business hours | Y (Call Flow Builder) [S4] | Y [C1] | A (Pro+) [W1] | ? | Y [I1] | Y [N1] | Y [G1] | A (Starter) / Y [F1] | Y [M1] | **N** |
| Whisper to the business ("call from Google Ads") | ? | Y [C2] | Y [W1] | ? | A (Perf. Ent. only) [I1] | Y [N1] | ? | A / Y [F1] | ? | **N** |
| SMS | Y [S3] | Y [C2] | Y [W1] | ? | Y (messaging agent) [I2] | Y [N1] | Y [G1] | ? | ? | **N** |
| Spam blocking / spam flag | Y (spam status) [S1] | ? | ? | ? | ? | Y [N1] | Y (blacklist) [G1] | ? | ? | **N** |
| Missed-call automation / text-back | ? | ? | ? | ? | Y (AI Messaging Agent) [I2] | ? | Y [G1] | ? | ? | **N** |
| AI voice agent (answers calls) | A (Voice Assist, $95+/mo) [S3] | A (VoiceAI, $0.12/min) [C1] | N (vendor says so) [W3] | ? | Y (beta) [I2][I3] | ? | A (module) [G1] | R (Smart Voice, on request) [F1] | ? | **N** |

### 1c. AI / conversation intelligence
| Feature | CR | CTM | WC | RUL | INV | NIM | RNG | INF | MH | OURS |
|---|---|---|---|---|---|---|---|---|---|---|
| Transcription | Y [S3] | Y ($0.02/min) [C1] | Y ($0.02/min) [W1] | ? | A (Signal AI) [I1] | Y ($0.02/min) [N1] | A (Pro, 50+ languages) [G1] | A (AI suite) [F1] | Y [M1] | **Y** (Whisper, optional) |
| AI call summary | A (Lead Conversion) [S3] | A (AskAI, $0.05) [C1] | Y [W2] | ? | A [I1] | Y [N1] | A [G1] | A (AI suite) [F1] | Y [M1] | **N** |
| AI scoring / classification / custom questions | A (AI lead score, automation rules) [S1] | A (AskAI custom asks) [C1] | A (Lead Intelligence, Elite) [W1][W3] | ? | A (Signal AI Studio) [I1] | A (Pro, AI tagging and scoring) [N1] | A [G1] | A (Smart Outcomes) [F1] | Y (outcome questions) [M2] | **N** (duration threshold only) |
| Sentiment | A [S3] | Y [C2] | Y [W2] | ? | A [I1] | Y [N1] | A [G1] | ? | ? | **N** |
| Transcript search / keyword spotting | Y (`search_transcripts`) [S1] | Y [C2] | Y [W2] | ? | A [I1] | Y [N1] | ? | ? | Y [M1] | **N** |
| Questions across many calls (trends) | A ("AI Answers", multi-conversation insights) [S1] | ? | ? | A (AI Agent: Analyst & Media Planner, top plan) [R1] | A (Discovery) [I1] | ? | A (eniq.ai) [G1] | A (Conversion Barriers) [F1] | ? | **N** |
| PII redaction | ? | ? | ? | ? | A (card, SSN, DOB) [I1] | ? | ? | ? | ? | **N** |

### 1d. Reporting and dashboards
| Feature | CR | CTM | WC | RUL | INV | NIM | RNG | INF | MH | OURS |
|---|---|---|---|---|---|---|---|---|---|---|
| Dashboard with scorecards and channel charts | Y [S5] | Y [C2] | Y [W1] | Y [R2] | Y [I2] | Y [N1] | Y [G1] | Y [F1] | Y [M1] | **Y** |
| Call log with recording and transcript | Y [S6] | Y [C2] | Y [W1] | Y [R2] | A (transcripts in Signal AI) [I1] | Y [N1] | A [G1] | A [F1] | Y [M1] | **Y** |
| Custom report builder | ? | ? | A (Pro+) [W1] | Y (segmentation) [R1] | A (advanced reports) [I1] | Y [N1] | Y (Looker Studio) [G1] | Y [F1] | ? | **N** |
| Scheduled / email reports | Y (summary emails) [S1] | ? | A (Pro+) [W1] | ? | ? | ? | ? | ? | ? | **N** |
| Export (Excel / PDF / CSV) | Y [S5] | ? | ? | Y (CSV/FTP) [R1] | ? | ? | ? | ? | ? | **N** (JSON API only) |
| Real-time call / missed-call alerts | Y (notifications) [S1] | ? | Y (email notifications) [W1] | ? | Y [I1] | A (Pro+) [N1] | Y [G1] | Y [F1] | ? | **N** |

### 1e. Integrations
| Feature | CR | CTM | WC | RUL | INV | NIM | RNG | INF | MH | OURS |
|---|---|---|---|---|---|---|---|---|---|---|
| Native CRM (HubSpot / Salesforce) | ? | Y [C1] | P (via Zapier; no native CRM listed) [W1] | Y [R1] | A [I1] | Y [N1] | Y [G1] | A [F1] | Y [M1] | **N** |
| Outbound webhooks | Y (9 event types) [S1] | Y [C2] | Y [W1] | Y [R1] | Y [I1] | A (Agency) [N1] | Y [G1] | Y [F1] | Y [M1] | **N** |
| Zapier / Make | ? | Y [C2] | Y [W1] | Y [R1] | ? | Y [N1] | ? | ? | ? | **N** |
| Slack | Y [S1] | ? | ? | ? | Y [I1] | Y [N1] | ? | ? | ? | **N** |
| BI / Looker Studio | ? | Y (Data Studio) [C1] | ? | Y [R1] | ? | Y (Google Sheets) [N1] | Y [G1] | ? | ? | **P** (Phase 1 Sheet → Looker) |

### 1f. Agency / multi-client
| Feature | CR | CTM | WC | RUL | INV | NIM | RNG | INF | MH | OURS |
|---|---|---|---|---|---|---|---|---|---|---|
| Many clients under one login | A (Agency tools) [S4] | A (sub-accounts, Pro+) [C1] | A (Agency plans, $500+) [W1] | ? | ? (partner network) [I1] | A (Agency, $120) [N1] | ? | Y (locations/brands) [F1] | ? | **Y** |
| Client logins / limited client view | Y (Account Center) [S4] | P (client signup pages) [C1] | Y (roles) [W1] | ? | ? | P ("control what each client sees") [N1] | ? | ? | ? | **N** |
| User roles / permissions | Y (MCP inherits them) [S2] | ? | Y [W1] | ? | Y (SAML SSO) [I1] | Y (seats) [N1] | ? | Y (SSO) [F1] | ? | **N** (single admin) |
| White label | A [S4] | A ($65/domain) [C1] | A (+$50/mo) [W1] | ? | ? | A ($55/mo) [N1] | ? | ? | ? | **P** (BRAND_NAME + CSS vars; self-hosted) |
| Per-client telephony credentials | ? | ? | ? | ? | ? | ? | ? | ? | ? | **Y** (unusual) |

### 1g. Compliance and EU / Greece fit
| Feature | CR | CTM | WC | RUL | INV | NIM | RNG | INF | MH | OURS |
|---|---|---|---|---|---|---|---|---|---|---|
| Sold or hosted for Greece / EU | N (US, CA, UK, AU only) [S3] | P (80+ countries, Greece not named) [C2] | ? | P (UK-based, EUR pricing) [R1] | ? | P (Greek entity, 70+ countries) [N2] | P (EUR pricing) [G1] | A (international from Growth tier) [F1] | P (100+ countries) [M1] | **Y** (Twilio Greek local and toll-free; **no Greek mobile numbers**) |
| GDPR statement / DPA | ? | Y ("GDPR features") [C2] | Y ("GDPR compliance") [W1] | ? | ? | ? | ? | Y (GDPR-ready, ISO 27001) [F2] | Y (DPA, ICO) [M1] | **P** (consent prompt; no retention or DSAR tooling) |
| EU data residency | ? | ? | ? | ? | ? | ? | ? | ? | ? | **Y** (choose an EU VPS) |
| Greek-language AI analysis | ? | ? | ? | ? | ? | ? | P (transcription in 50+ languages) [G1] | ? | ? | **P** (Whisper does Greek; no analysis layer yet) |
| Recording consent announcement | ? | ? | ? | ? | ? | ? | ? | ? | ? | **Y** (Greek) |

### 1h. Developer / API / AI assistants
| Feature | CR | CTM | WC | RUL | INV | NIM | RNG | INF | MH | OURS |
|---|---|---|---|---|---|---|---|---|---|---|
| REST API | Y (charged above 1,500 calls/mo) [S3] | Y [C1] | Y [W1] | Y (webhooks, CSV) [R1] | Y [I1] | A (Agency) [N1] | Y [G1] | Y [F1] | Y (80+ data points) [M1] | **Y** (report API + key) |
| **Official MCP server** | **Y** [S1][S2] | **Y** (Claude only) [C3] | N found (third-party only) [X2] | N found (Zapier, viaSocket) [X2] | N found [I2] | N found (third-party) [X2] | **P** (listed, no docs) [G1] | N found [F1] | N found | **N** |

---

## 2. MCP and LLM integrations (primary sources)

### CallRail: official, hosted, read and write [Fact]
- **Endpoint:** `https://mcp.callrail.com/mcp`. **Auth:** CallRail OAuth 2.0; no API key needed. Access follows the connected user's CallRail permissions [S1][S2].
- **Clients:** an official Claude connector (Customize → Connectors), Claude Desktop via `mcpServers`, the ChatGPT app directory (Plus, Pro, Business, Enterprise and Edu), and manual setup for HubSpot and others [S2]. The help article showed "Updated 22 days ago" when I read it on 2026-11-04, so about mid-October 2026 [S2].
- **Billing:** charged like the API. 0–1,500 calls/mo free, 1,501–12,000 calls are $80/mo, 12,001–300,000 calls are $200/mo [S2].
- **Read tools** [S1]: `get_account`, `list_calls`, `get_call`, `get_call_transcript`, `search_transcripts`, `get_calls_summary`, `get_calls_timeseries`, `get_call_recording`, `get_call_page_views`, `list_companies`, `get_company`, `list_conversations`, `get_conversation`, `get_forms_summary`, `list_form_submissions`, `get_form_submission`, `get_person_timeline`, `list_sms_threads`, `get_sms_thread`, `list_tags`, `list_trackers`, `get_tracker`, `list_users`, `get_user`, `create_feedback`.
- **Write tools** [S1]: `create_call` (a real outbound call, **US and Canada only**), `update_call`, `create_company`, `update_company`, `send_text_message` (150/hr, 1,000/day), `update_form_submission`, `create_tag`, `update_tag`, `delete_tag`, `create_source_tracker`, `create_session_tracker`, `create_user`, `update_user`, `delete_user`. They carry MCP `destructiveHint` annotations. Admins can restrict the assistant to read-only tools in the client [S2].
- Transcripts need Premium Conversation Intelligence, the same entitlement as in the app [S1][S2].
- G2 lists "ChatGPT" and "Claude" among CallRail's integrations [S6].

### CTM: official, Claude custom connector only [Fact]
- Set up under Settings → Integrations → CTM MCP → Generate Credentials, which gives an MCP server URL plus an OAuth client ID and secret. You paste these into a Claude custom connector. The help article says Claude custom connectors are the only supported client for now. Only an account owner or support user can set it up [C3].
- **No tool list is published.** The article says to ask Claude "what CTM tools are available" [C3]. I did not substitute tools from third-party CTM servers.
- CTM's pricing page lists "Claude MCP" as an integration [C1]. Separately, **AskAI** runs custom prompts over transcripts for summaries, classification and scores [C2]. Its launch release said it was powered by ChatGPT [C4].

### Ringostat: listed, not documented [Fact + gap]
- The pricing comparison table on ringostat.com has a row "MCP integration with Claude AI" in its AI Conversation Intelligence section. I confirmed it in the rendered page [G1]. I found no help article, tool list or plan mapping for it.
- A third-party bridge (AnythingMCP, 7 tools) exists [X2].

### No first-party MCP found (as of 2026-11-04)
For each vendor below I checked its own docs, pricing page or `llm-info` page. Third-party bridges exist, but they are not vendor products.
- **WhatConverts:** AI Lead Analysis covers summary, intent, topics, sentiment and keywords [W2][W3]. Its MCP servers come from the community (321webmarketing, devopsbrandmirchi) or from Zapier, viaSocket and Activepieces [X2].
- **Ruler Analytics:** its top plan (Advanced, from £1,499/mo) includes an **"AI Agent – Analyst & Media Planner"** [R1]. MCP is available only via Zapier or viaSocket [X2].
- **Invoca:** its `llm-info` page lists an AI Voice Agent and an AI Messaging Agent and mentions no MCP or Claude/ChatGPT connector [I2]. It announced "Nico", an AI agent, in June 2026 [I3].
- **Nimbata:** a Vinkius-hosted 12-tool server, third-party [X2]. Nimbata's own pricing page lists none [N1].
- **Infinity / ResponseTap:** none on the pricing page [F1].
- **Mediahawk:** none found.

**[Inference] What this means for us:** CallRail's tool set is the reference design. A read-only MCP over our existing report API is cheap and gives the agency something to sell ("ask Claude about your calls"). Mirror CallRail's naming: `list_clients`, `list_calls`, `get_call`, `get_call_transcript`, `search_transcripts`, `get_calls_summary`, `get_calls_timeseries`. Add `update_call` (tags, notes, status) only once roles exist.

---

## 3. What users say

**Sample:** I read 91 reviews in the browser on 2026-11-04:
- CallRail Trustpilot, 1–3★, both pages: 35
- CTM Trustpilot, 1–3★: 20
- WhatConverts Trustpilot, all reviews: 19
- Nimbata Trustpilot, first page: 16
- Ringostat Trustpilot, 1–3★: 1

About 61 of them are negative or mixed.

**Sources I could not use:**
- **Capterra:** blocked by a Cloudflare check, which I did not bypass.
- **G2:** review text doesn't render when logged out.
- **Reddit:** blocked for both the browser pane and search.
- **Ruler and Mediahawk:** 0 Trustpilot reviews each.
- **Invoca:** not sampled.

Many of the CTM 1–3★ reviews are from 2018 and concern softphone call quality, which matters little to us. WhatConverts got a burst of 5★ reviews in October 2026, which may be solicited [Inference].

The single verbatim quote allowed in this response:
> "they don't warn you when you're about to exceed your limit" (Quinton Williams, CallRail, 1★, 2025-11-07) [TP-CR1]

Everything below is paraphrased. Follow the link for the exact wording.

### 3a. What they hate (ranked by count × recency × fit for us)
1. **Unpredictable bills: usage overages, spam minutes, surprise add-ons.** Reviews: CallRail ×6, CTM ×1. Sources: 1.
   - A $50 plan grew to about $200 with no warning before the limit (Quinton Williams, 1★, 2025-11) [TP-CR1].
   - Tens of thousands of dollars in overage fees from spam-call minutes, with no refund (Sean O'Leary, 2022) [TP-CR1].
   - Five toll-free numbers were provisioned when one was asked for, each billed at a rate nobody disclosed; the reviewer left for a vendor with clearer pricing (Davide, AU, 2023) [TP-CR1].
   - A conversation-intelligence add-on charged without approval (Saeed Kh., 2020) [TP-CR2].
   - CTM: 98% of calls were US auto-dialer spam that drained the prepaid balance (Paul Wirsta, 2018) [TP-CTM].
2. **Integrations break silently and conversions stop flowing.** Reviews: CallRail ×4, Nimbata ×1. Sources: 1.
   - The Google Ads link was down for 3 weeks and clients were never told (Zeke D., 2018) [TP-CR2].
   - Integration links keep dropping, which corrupts reporting and costs revenue (Nicholas John, 2023) [TP-CR1].
   - Conversions stopped reaching GA for nearly 30 days (Sam Billings, 2025) [TP-CR1].
   - The Nimbata Google Ads integration guide is outdated and there are no logs to troubleshoot with (Peter Ekornes, 2025-11) [TP-NB].
3. **Account or number cut off without notice.**
   - Nimbata froze a number and locked the account without notifying anyone; a client missed a lead and the reviewer went back to CallRail (Carter Maloff, 1★, 2026-08) [TP-NB].
   - CallRail paused an account without authorisation (Hctr Brnl, 2020) [TP-CR2].
4. **Support is slow and tiered, and agencies running many clients feel it most.** Reviews: CTM ×4, CallRail ×8, WhatConverts ×1, Ringostat ×1. Sources: 1 platform (Trustpilot), 4 vendors.
   - A Swiss, Belgian and French agency with 100+ CTM accounts reports support declining for two years (Olivier Henrotte, 2022) [TP-CTM].
   - An agency running several clients on CTM reports bugs showing up roughly every month, which makes troubleshooting painful (Eric, 2025-01) [TP-CTM].
   - CTM support takes no video calls and replies once a day (Pamela Wallace, 2025-05) [TP-CTM].
   - A Ringostat customer on an annual plan was told to switch CRM modules, the problem stayed, and support stopped helping (Matthew Wilson, 2026-06) [TP-RG].
5. **Porting out is hard, a form of lock-in.** Reviews: CTM ×2, CallRail ×2. Sources: 1.
   - Seven months waiting for a port-out (Ty O., 2024) [TP-CTM].
   - Port-outs delayed and blocked (Tim, 2025) [TP-CTM].
   - Two CallRail port-outs rejected, then pressure to pay another month (MTBCraig, UK, 2021) [TP-CR2].
   - Recordings cannot be bulk-downloaded on exit (Elie Orgel, 2019) [TP-CR2].
6. **US vendors fail at non-US telecom.** Reviews: CallRail ×3. Sources: 1. **Thin, but directly relevant.**
   - CallRail stopped forwarding to UK mobiles without telling customers, and the reviewer lost clients (Michael Acton, UK, 2023) [TP-CR1].
   - After a change of mobile carrier, the reviewer could no longer forward calls because CallRail had few UK mobile partners; they now prefer vendors in their own time zone (MTBCraig, UK, 2021) [TP-CR2].
   - Australian local numbers could not be created (Mark Armstrong, AU, 2018) [TP-CR2].
7. **The DNI script hurts the site or misses page elements.**
   - The CallRail script slowed the site badly (JohnRolins, 2026-08) [TP-CR1].
   - Positive counter-signal: a reviewer says Nimbata is the only vendor whose DNI works on Next.js/React SPAs (Webcontext, 2024) [TP-NB].
8. **Recycled numbers bring the previous owner's calls** (Nicholas John, CallRail, 2023) [TP-CR1]. Thin.

### 3b. What is missing (asked for by name)
- Usage and overage warnings before the bill (Quinton Williams) [TP-CR1].
- Missed-call text-back automation, and AI at the base tier (same review) [TP-CR1].
- Keyword attribution on calls. A WhatConverts trial user says calls were not tied to keywords (Trystan, 1★, 2026-04) [TP-WC].
- CRM matching that merges repeat callers from different numbers into one record instead of creating new leads (Keith Norton, CTM, 2018) [TP-CTM].
- Logs and diagnostics for tracking issues (Peter Ekornes, Nimbata) [TP-NB].
- Safe sub-account management. An agency asked how to cancel a sub-account and support cancelled the whole account, so clients lost calls (David Pickup, WhatConverts, 2023) [TP-WC].
- **Positive signals** worth copying: client-shareable reporting (Tim Clow, WhatConverts 5★, 2026-10) and AI lead-quality insight that feeds the client narrative (Ted Goodman, WhatConverts 5★, 2026-10) [TP-WC].

### 3c. What is unsolved (becomes positioning) [Inference]
- **Non-US SMBs on US platforms.** Mobile forwarding, local numbers, porting and support hours all fail. No reviewed vendor except Nimbata shows a Greek footprint.
- **Agencies running many small clients.** They need per-client isolation, safe sub-account actions, alerts and cheap seats. WhatConverts agency plans start at $500/mo [W1]. CallRail white label is a paid add-on [S4].
- **Cost predictability.** Every US vendor charges per minute, per number and per AI feature on top of the plan [S3][C1][W1][N1].

---

## 4. Recommendations: top 15 features to add

The ranking weights an agency serving Greek SMBs whose leads come by phone. Effort is sized for our stack (Node/Express, SQLite, Twilio, vanilla JS admin): **S** about 1–3 days, **M** about 1–2 weeks, **L** a month or more.

| # | Feature | Tag | Effort | Why (evidence) |
|---|---|---|---|---|
| 1 | **Real-time call and missed-call alerts** per client (email, Slack/Teams, Viber or SMS) | must | S | Standard at Invoca, Nimbata, Infinity, WhatConverts and CallRail [I1][N1][F1][W1][S1]. A missed call is a lost lead for a Greek SMB. Reviewers lost clients without warning [TP-NB][TP-CR1]. |
| 2 | **AI call summary and lead classification in Greek** (LLM over the Whisper transcript: lead or not, service, intent, booked yes/no, sentiment). Use it to set `qualified` and fire offline conversions on real leads, not on duration | must | M | Every competitor sells this, mostly as a paid add-on [S3][C1][W2][N1][F1][M2][I1]. Greek-language support isn't shown anywhere except Ringostat's transcription [G1]. Better conversion signal for Google Ads and Meta [Inference]. |
| 3 | **Client logins and roles** (agency admin, agency staff, client read-only scoped to one client) | must | M | CallRail Account Center, WhatConverts roles, Nimbata client visibility [S4][W1][N1]. We have a single admin login today. Without this the MCP can't inherit permissions the way CallRail's does [S2]. |
| 4 | **Call tags, notes, lead status and value** (manual qualification); push the value or an adjustment to Google Ads, Meta and GA4 | must | S | CallRail `update_call` covers note, tags, lead status and value [S1]. WhatConverts has one-click qualification [W1]. Ringostat has call tagging [G1]. |
| 5 | **Static source numbers** for Google Business Profile, print, radio and vehicle signage, alongside the DNI pool | must | S | CallRail source trackers, Mediahawk static numbers, Nimbata offline tracking [S1][M1][N1]. GBP is a main call source for local SMBs [Inference]. |
| 6 | **Spam/robocall filter and block list.** Exclude spam from conversions and reports, with auto-flag rules | must | S | Spam overage complaints [TP-CR1][TP-CTM]. Nimbata spam filter, Ringostat blacklist, CallRail spam status [N1][G1][S1]. |
| 7 | **Scheduled branded client reports** (weekly or monthly email with PDF) plus CSV export of calls and recordings | must | M | WhatConverts scheduled and branded reports [W1]. CallRail Excel/PDF export and white label [S5]. Recording-export lock-in complaint [TP-CR2]. |
| 8 | **Integration health monitor.** Alert on failed conversion uploads (we already store `conv_google`, `conv_meta` and `conv_ga4` per call), a DNI script that stops firing, pool exhaustion, or a run of unanswered calls | should | S | The top "silent breakage" theme [TP-CR1][TP-CR2][TP-NB]. Cheap because the status columns exist [Inference]. |
| 9 | **Keyword-level attribution.** Capture ValueTrack `{keyword}`, `{matchtype}` and `{campaignid}`, and/or resolve gclid → keyword and search term via the Google Ads API `click_view` | should | M | Keyword reporting at CallRail, WhatConverts, Ruler and Mediahawk [S3][W1][R1][M1]. Complaint [TP-WC]. We already store `utm_term`. |
| 10 | **Outbound webhooks** (`call.started`, `call.completed`, `call.analyzed`, `call.updated`) with HMAC signing; covers Zapier, Make and CRMs | should | S | Every vendor offers them. CallRail exposes 9 event types [S1]. A route to HubSpot and Pipedrive without native builds [Inference]. |
| 11 | **MCP server, read-first** (tools listed in §2), with OAuth or per-client API keys, followed later by `update_call` | should | S–M | CallRail and CTM ship official servers [S1][S2][C3]. Ringostat lists one [G1]. The agency already uses Claude [Inference]. |
| 12 | **Form tracking plus WhatsApp and Viber click tracking** (extend the Phase 1 tel:-click tracker into one leads list) | should | M | Forms and chat appear at CallRail, WhatConverts, Ruler, Nimbata and Mediahawk [S3][W1][R1][N1][M1]. Ringostat sells Viber and Telegram add-ons [G1]. Messenger-app leads matter in Greece [Inference]. |
| 13 | **Call flows:** business-hours routing, voicemail, a whisper to the business ("Κλήση από Google Ads"), simple IVR | should | M | WhatConverts, Nimbata, Infinity, CTM [W1][N1][F1][C2]. Plain TwiML on Twilio [Inference]. |
| 14 | **GDPR toolkit:** automatic purge of recordings and transcripts per client, data-subject export and delete by caller number, PII redaction in transcripts, a DPA template | should | M | Invoca redaction [I1]. Mediahawk DPA and Infinity GDPR-ready positioning [M1][F2]. EU hosting is our edge, so make it provable [Inference]. |
| 15 | **Missed-call text-back** (SMS now; Viber Business later via a provider) | could | M | Reviewer request [TP-CR1]. Ringostat missed-call automation [G1]. Invoca messaging agent [I2]. Greek sender-ID rules add work [Inference]. |

**Next in line (could):**
- Usage and cost meter per client, with a budget alert (S). Answers the bill-shock theme; we pay Twilio directly.
- Visitor journey timeline per call (S–M).
- Repeat-caller merge across numbers (S).
- AI voice agent for after-hours calls (L; Greek voice quality is a risk).
- Geo/map of callers (S).
- Custom report builder (L).

---

## 5. Dashboard UI patterns competitors use

These are vendor-described screens. [Fact] where cited; the synthesis is [Inference].

- **KPI scorecard row:** total calls, answered vs missed, first-time callers, qualified leads, conversion rate, cost per lead and ROI.
  - Ruler's main dashboard combines visitors, form fills, calls, sales, revenue, cost and ROI, filterable by day, week, month and year [R2].
  - CallRail: ROI by channel, a "good lead" flag [S5], and multi-touch CPL [S3].
- **Source / channel report:** calls, leads and revenue by source, medium, campaign, ad and keyword, with an attribution-model switch.
  - Ruler Source Report: clicks, forms, calls, opportunities, revenue, CPA, ROAS, and 5 models to switch between [R2].
  - WhatConverts: leads and sales values by source and keyword, and by landing page [W1].
- **Trend line:** calls and texts over time by campaign, with side-by-side comparison of date ranges [S5].
- **Time distribution:** leads by day and week [W1], leads by call duration [W1].
- **Call log table:** caller, source, duration, status, tags, an audio player, a transcript drawer, AI keyword highlights, and AI summaries over a date range [S6].
- **Sentiment chart:** positive, neutral and negative [S6].
- **Lead / conversion list with journey:** first and last touch, pages viewed, number of sessions, form fields [R2]. CallRail's Leads Report shows journey milestones [S6].
- **Agency layer:**
  - Client switcher and all-clients rollup [Inference from agency plans].
  - Branded, white-label view and scheduled email reports [W1][S4].
  - Exports to Excel or PDF [S5].
- **AI insight panel:** "why calls changed" and "what to do next". This is how CallRail pitches its MCP [S2]. Infinity's "Conversion Barriers" [F1] and Invoca "Discovery" [I1] play the same role.

**[Inference] Gap against our current admin UI:** we have scorecards, channel bars and a call log with playback and transcript. Highest-value additions:
- Date-range comparison (vs. previous period)
- Missed-call and first-time-caller tiles
- Keyword and landing-page tables
- Hour-of-day × weekday heatmap, which helps Greek SMBs staff their phones
- AI summary column with a sentiment chip
- Per-client scheduled PDF

---

## 6. Positioning options [Inference]

1. **"The Greek call tracker that agencies own."**
   For Greek agencies who are tired of US tools that don't serve Greece, bill in dollars per minute and per AI feature, and go down silently, Ruler CallTrack runs on your own EU server with Greek numbers, Greek-language AI call summaries and flat costs.
   Evidence: overage, silent-breakage and non-US themes; CallRail sold only in US/CA/UK/AU [S3]. **Recommended.**
2. **"Every missed call is a lost patient or customer."** Alerts, text-back and AI qualification for local service SMBs (clinics, trades, legal).
   Evidence: alerts are standard at competitors; account-freeze and missed-lead reviews.
3. **"Ask Claude about your calls."** An MCP-first, AI-native agency tool.
   Evidence: CallRail and CTM only just shipped this (CallRail's help article was updated about mid-October 2026) [S2][C3]. Weaker on its own because it's easy to copy.

**Name:** "Ruler CallTrack" is close to **Ruler Analytics** (UK, call tracking and attribution, in this comparison). Expect confusion in search and with clients, and a possible trademark issue. Get legal advice before using the name publicly. Do not use competitor names in ads or comparison pages without legal review.

---

## 7. Sources

### Vendor (primary)
- [S1] CallRail API v3 docs, including the MCP section, webhooks and CI fields: https://apidocs.callrail.com/
- [S2] CallRail Help: "CallRails MCP": https://support.callrail.com/hc/en-us/articles/48582404381069-CallRails-MCP
- [S3] CallRail pricing: https://www.callrail.com/pricing
- [S4] CallRail white label and agency resources and plan types (via search summary of help articles):
  - https://support.callrail.com/hc/en-us/articles/5711803121933-White-labeling-your-CallRail-account
  - https://support.callrail.com/hc/en-us/articles/5711728032909-CallRail-s-resources-for-agencies
  - https://support.callrail.com/hc/en-us/articles/43563657652237-CallRail-s-Plan-Types
  - https://www.callrail.com/blog/after-the-ring-before-the-conversation-creating-the-best-call-experiences
- [S5] CallRail call activity reporting: https://callrail.com/call-tracking/reporting/call-activity
- [S6] G2 CallRail listing (vendor media and integrations list): https://www.g2.com/products/callrail/reviews
- [C1] CTM plans and pricing: https://www.ctm.com/plans-pricing/
- [C2] CTM LLM info page: https://www.ctm.com/llm-info/
- [C3] CTM Help: "CTM MCP: Connect Claude to CTM Tools": https://calltrackingmetrics.zendesk.com/hc/en-us/articles/47339620966925-CTM-MCP-Connect-Claude-to-CTM-Tools
- [C4] CTM AskAI press release (seen in search results, not opened): https://prnewswire.com/news-releases/calltrackingmetrics-introduces-askai-feature-powered-by-chatgpt-to-elevate-customer-engagement-301777641.html
- [W1] WhatConverts pricing: https://www.whatconverts.com/pricing/
- [W2] WhatConverts AI Lead Analysis: https://www.whatconverts.com/features/lead-tracking/call-tracking/ai-lead-analysis/
- [W3] WhatConverts help and blog (via search summary):
  - https://www.whatconverts.com/help/docs/whatconverts-admin/billing-and-usage/understand-the-ai-usage-rates/
  - https://www.whatconverts.com/help/docs/automations-and-advanced-systems/lead-intelligence/understand-the-lead-intelligence-actions
  - https://www.whatconverts.com/blog/whatconverts-weaknesses/
- [R1] Ruler Analytics pricing: https://www.ruleranalytics.com/pricing/
- [R2] G2 Ruler Analytics listing (vendor screenshots described): https://www.g2.com/products/ruler-analytics/reviews
- [I1] Invoca pricing: https://www.invoca.com/pricing
- [I-search] Invoca Signal AI blog and press (via search summary): https://www.invoca.com/blog/signal-ai-launch
- [I2] Invoca LLM info: https://www.invoca.com/llm-info
- [I3] Invoca "Nico" press release (via search summary): https://www.prnewswire.com/news-releases/invoca-introduces-nico-the-ai-agent-that-converts-conversations-into-revenue-302806959.html
- [N1] Nimbata pricing: https://www.nimbata.com/pricing
- [N2] Elevate Greece registry, Nimbata (Maroussi) (via search summary): https://registry.elevategreece.gov.gr/company/nimbata
- [N3] Nimbata HubSpot marketplace listing (via search summary): https://ecosystem.hubspot.com/marketplace/listing/nimbata-app-56503
- [G1] Ringostat pricing; the "MCP integration with Claude AI" row was verified in the browser: https://ringostat.com/en/pricing/
- [M1] Mediahawk features: https://www.mediahawk.co.uk/features/
- [M2] Mediahawk AI Speech Insights: https://www.mediahawk.co.uk/blog/mediahawk-launches-ai-powered-speech-insights/
- [F1] Infinity pricing (UK): https://www.infinity.co/uk/pricing
- [F2] "ResponseTap is now part of Infinity": https://www.infinity.co/uk/responsetap-part-of-infinity

### Third-party (context only; not vendor claims)
- [X1] wmtips "Call Tracking in Greece". Seen only as a search-engine snippet, because the page sits behind a Cloudflare check. The snippet put Google Ads call tracking first, then CTM and Clixtell at about 5.9% each. **Unverified.** https://www.wmtips.com/technologies/call-tracking/country/gr/
- [X2] Third-party MCP bridges:
  - https://github.com/pghdma/callrail-mcp
  - https://manufact.com/mcp-catalog/adzviser-calltrackingmetrics
  - https://github.com/321webmarketing/whatconverts-mcp-server
  - https://zapier.com/mcp/ruler-analytics
  - https://viasocket.com/mcp/ruler-analytics
  - https://anythingmcp.com/marketplace/ringostat
  - https://vinkius.com/client/claude-desktop/connect/nimbata-mcp

### Reviews (read in the browser, 2026-11-04)
- [TP-CR1] https://www.trustpilot.com/review/callrail.com?stars=1&stars=2&stars=3
- [TP-CR2] https://www.trustpilot.com/review/callrail.com?page=2&stars=1&stars=2&stars=3
- [TP-CTM] https://www.trustpilot.com/review/calltrackingmetrics.com?stars=1&stars=2&stars=3
- [TP-WC] https://www.trustpilot.com/review/whatconverts.com
- [TP-NB] https://www.trustpilot.com/review/www.nimbata.com
- [TP-RG] https://www.trustpilot.com/review/ringostat.com?stars=1&stars=2&stars=3

### Telecom fact about our own product
Twilio Greece offers only local (+30) and toll-free numbers, no mobile, and needs a regulatory bundle. This comes from project memory (`project-click-to-call-tracker.md`). Re-check it against Twilio's current Greece regulatory page before relying on it.
