# GTM setup — Click-to-Call (no backend)

This wires the tracker into **Google Tag Manager** so a phone-number click fires **GA4**, **Google Ads**, and the **Meta browser Pixel** — with no code on your server. The Apps Script collector (Sheet + Meta CAPI) is optional but recommended; see `../apps-script/Code.gs`.

The flow:

```
visitor clicks tel: link
  → tracker.js pushes dataLayer event "phone_call_click" (+ ctc payload)
      → GTM trigger fires:
          • GA4 event tag      (phone_call_click → mark as Key Event)
          • Google Ads conv.   (counts the click as a conversion, picks up gclid)
          • Meta Pixel tag     (Contact, with eventID for CAPI dedup)
  → tracker.js ALSO beacons the event to Apps Script (Sheet + Meta CAPI)
```

---

## Step 1 — Load the tracker

Create a **Custom HTML** tag, trigger **All Pages — Initialization** (or All Pages):

```html
<script>
  window.CTC_CONFIG = {
    siteId: 'client-acme',
    collectorUrl: 'https://script.google.com/macros/s/AKfycb.../exec', // optional
    selectors: ['a[href^="tel:"]', '[data-ctc-call]', '.call-now'],
    pushToDataLayer: true,
    fireDirect: false        // GTM fires the pixels, not the script
  };
</script>
<script>
  /* paste the entire contents of ../tracker.js here, OR host it and use src= */
</script>
```

> Host `tracker.js` on a CDN and load with `<script src=... defer>` if you prefer to update it in one place across all clients.

---

## Step 2 — dataLayer variables

Create these **Data Layer Variables** (Variables → New → Data Layer Variable):

| Variable name        | Data Layer Variable Name |
|----------------------|--------------------------|
| `DLV - ctc.phone`    | `ctc.phone`              |
| `DLV - ctc.event_id` | `ctc.event_id`           |
| `DLV - ctc.page_url` | `ctc.page_url`           |
| `DLV - ctc.fbc`      | `ctc.fbc`                |
| `DLV - ctc.fbp`      | `ctc.fbp`                |

---

## Step 3 — Trigger

**Triggers → New → Custom Event**
- Event name: `phone_call_click`
- This trigger fires on: All Custom Events
- Name it: `CE - phone_call_click`

---

## Step 4 — The three tags

### 4a. GA4 event
- Tag type: **GA4 Event**
- Configuration tag: your GA4 config tag
- Event name: `phone_call_click`
- Event parameters: `phone` = `{{DLV - ctc.phone}}`
- Trigger: `CE - phone_call_click`
- **In GA4 Admin → Events → mark `phone_call_click` as a Key Event.** Then (optional) import it into Google Ads as a conversion via the GA4↔Ads link.

### 4b. Google Ads conversion
- First create the conversion action in Google Ads: **Goals → Conversions → New → Website**, category **Contact / Phone call lead**, count **One**. Copy the **Conversion ID** (`AW-...`) and **Label**.
- Tag type: **Google Ads Conversion Tracking**
- Conversion ID + Label from above
- Transaction ID: `{{DLV - ctc.event_id}}` (prevents double-counting)
- Trigger: `CE - phone_call_click`

> Because this fires in the browser, Google automatically attaches the `gclid` from the ad click — no offline import needed for click-to-call.

### 4c. Meta Pixel (browser)
- Tag type: **Custom HTML** (or the official Meta Pixel template)
- Code:
```html
<script>
  fbq('track', 'Contact',
    { content_name: 'phone_call_click', phone: {{DLV - ctc.phone}} },
    { eventID: {{DLV - ctc.event_id}} }   // <-- same id Apps Script sends to CAPI = dedup
  );
</script>
```
- Trigger: `CE - phone_call_click`
- Requires your base Meta Pixel to already load on All Pages.

---

## Step 5 — Test

1. GTM **Preview** mode → open the client site → click a phone number.
2. Confirm `phone_call_click` appears and all three tags fired.
3. GA4 **DebugView** → see the event.
4. Google Ads → conversion will show in ~24–48h (test conversions can take time).
5. Meta **Events Manager → Test Events** (set `metaTestEventCode` in Code.gs while testing) → you should see one `Contact` with **Processed: Browser + Server, Deduplicated**.
6. Check the Google Sheet → a new row per click.

---

## Notes
- **Deduplication** is the whole point of matching `event_id` between the browser Pixel (4c) and the CAPI relay (Apps Script). Meta keeps one, not two.
- Google Ads doesn't have a simple "event_id" dedup for online conversions, so fire it **either** in GTM (4b) **or** via `fireDirect`, not both.
- If a client has **no GTM**, set `fireDirect: true` in `CTC_CONFIG` and fill `ga4MeasurementId`, `googleAds`, `metaPixelId` — the tracker fires the pixels itself.
