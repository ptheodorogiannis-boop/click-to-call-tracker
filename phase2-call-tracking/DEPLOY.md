# Deploy guide — Phase 2 on a free always-on VM

Follow these in order. Commands are copy-paste. Where you see `calls.ruler.agency`, use your own
subdomain. Total time ≈ 60–90 min the first time (most of it waiting on Oracle/DNS/Twilio).

> Works on any Ubuntu VPS. The free path is **Oracle Cloud Always Free**; a €4 Hetzner box uses
> the identical steps from Step 4 onward.

---

## Step 0 — What you need first
- A domain you control (you have **ruler.agency**) so you can add a subdomain.
- A credit card for Oracle sign-up (verification only — Always Free resources are never charged).
- A Twilio account with a Greek regulatory bundle in progress (Step 6).

---

## Step 1 — Create the free VM (Oracle Cloud)
1. Sign up at [cloud.oracle.com](https://cloud.oracle.com) → choose your home region (e.g. Frankfurt/Amsterdam, close to Greece).
2. **Compute → Instances → Create Instance.**
3. Image & shape: **Canonical Ubuntu 22.04**, shape **Ampere (Arm) VM.Standard.A1.Flex** — set 1 OCPU / 6 GB (well within Always Free). If Ampere is unavailable, pick **VM.Standard.E2.1.Micro** (x64, also Always Free).
4. **Add your SSH key** (or let it generate one and download it). Keep it safe.
5. Create. Note the **public IP**.

## Step 2 — Open the ports (TWO places — this is the #1 gotcha)
Oracle blocks ports in two layers; you must open both.

**A. Cloud security list:** VCN → Security Lists → default → **Add Ingress Rules**:
- Source `0.0.0.0/0`, TCP, dest port **80**
- Source `0.0.0.0/0`, TCP, dest port **443**

**B. The VM's own firewall** (Oracle Ubuntu ships with iptables closed). SSH in (Step 4) and run:
```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

## Step 3 — Point DNS at the VM
In your DNS provider for ruler.agency, add an **A record**:
```
calls.ruler.agency  →  <your VM public IP>
```
Wait a few minutes. Verify: `ping calls.ruler.agency` should show the VM IP.

## Step 4 — SSH in and install Docker
```bash
ssh -i /path/to/key ubuntu@<VM_IP>

# install Docker + compose plugin
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER && newgrp docker
docker --version && docker compose version
```

## Step 5 — Get the code on the box
Easiest without git: from **your Windows machine**, copy the folder up with scp:
```powershell
scp -i C:\path\to\key -r "E:\Claude\click-to-call-tracker\phase2-call-tracking" ubuntu@<VM_IP>:~/call-tracking
```
Then back on the VM:
```bash
cd ~/call-tracking
cp .env.example .env
nano .env        # fill values — see "Env checklist" below
nano Caddyfile   # change calls.ruler.agency + email to yours
```

### Env checklist (minimum to go live)
```
PUBLIC_BASE_URL=https://calls.ruler.agency
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
VALIDATE_TWILIO_SIGNATURE=true
```
Google Ads / Meta / GA4 creds can be added later — calls are still tracked + recorded without them.

## Step 6 — Twilio: numbers + webhook
1. Finish your **Greece regulatory bundle** (Phone Numbers → Regulatory Compliance). Approval ~3 business days. You can test earlier with a trial number.
2. Buy your pool of **Local (+30)** numbers.
3. For **each** number: Phone Numbers → Manage → click the number → **Voice → A Call Comes In**:
   - Webhook: `https://calls.ruler.agency/webhooks/voice/incoming`
   - HTTP **POST**
4. Copy your **Account SID + Auth Token** (Console home) into `.env`.

## Step 7 — Launch
```bash
docker compose up -d --build
docker compose logs -f app      # should print: ctc-call-tracking listening on :8080
```
Open `https://calls.ruler.agency/health` in a browser → `{"ok":true,...}` with a valid padlock.
(If the cert doesn't issue, DNS or ports 80/443 aren't open yet — recheck Step 2 & 3.)

## Step 8 — Add your real client + numbers
Edit `tools/seed.js` with the client's real forwarding number + the Twilio numbers you bought, then:
```bash
docker compose exec app node tools/seed.js
```
(Or insert rows into the `clients` / `numbers` tables directly.)

## Step 9 — Smoke test the whole pipeline
```bash
# temporarily allow the simulator to skip signature checks:
docker compose exec app sh -c "VALIDATE_TWILIO_SIGNATURE=false BASE=http://localhost:8080 node test/simulate.js"
```
Expect: `✓ PASS — full attribution → call → qualify path works`.
Then do a **real test call** to one of your tracking numbers from your phone, let it connect to the
forward line, hang up after ~40s, and check:
```bash
curl "https://calls.ruler.agency/api/report/calls?client=client-acme&limit=1"
```
You should see the call with duration, `answered:1`, and a `recording_url`.

## Step 10 — Put the snippet on the client site
```html
<script>window.CTC_DNI_CONFIG = {
  siteId:'client-acme',
  apiBase:'https://calls.ruler.agency',
  realNumbers:['+302101234567','2101234567']
};</script>
<script src="https://calls.ruler.agency/static/dni-tracker.js" defer></script>
```

---

## Day-2 operations
- **Update the app:** `scp` the changed files (or `git pull`) → `docker compose up -d --build`.
- **Backups:** the whole DB is one file — `cp data/calls.db` somewhere, or `cron` a daily copy off-box.
- **Logs:** `docker compose logs -f app`.
- **Add Google Ads conversions later:** fill the `GOOGLE_ADS_*` env + run the OAuth helper (ask me to generate `tools/google-oauth.js`), then put `customerId`/`conversionActionId` in the client's `config_json`.

## Cost reality check
- VM: **€0** (Oracle Always Free) or ~€4/mo (Hetzner).
- HTTPS: €0 (Let's Encrypt via Caddy).
- Twilio: numbers ~€1+/mo each + per-minute. **This is your only guaranteed cost.** Budget per client by call volume — see `README.md` cost shape.
