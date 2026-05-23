# Pauls Outreach Hub - AMD Dialler Worker
## Cloudflare Web Dashboard Deployment Guide

This Worker enables AMD (Answering Machine Detection) and auto-hangup for the
dialler in Pauls Outreach Hub. Calls go through Telnyx Call Control API, AMD
results trigger auto-hangup on voicemails, and humans are bridged to your browser.

**Estimated setup time: 25-40 minutes**

---

## Part 1 - Telnyx setup (10 min)

### 1.1 Generate a fresh API key

1. Go to https://portal.telnyx.com/#/app/api-keys
2. **First: REVOKE any old API keys you no longer need** (especially any that have been shared anywhere)
3. Click **+ Create API Key**
4. Name: `OutreachHub-Dialler`
5. **Copy the key and save to a password manager** - you'll only see it once
6. Format looks like: `KEY01ABC...` (a long string)

### 1.2 Create a Call Control Application

This is a *different* connection type from your existing SIP Connection. Both stay.

1. Telnyx portal -> **Voice -> Call Control Applications**
2. Click **+ Add new Call Control Application**
3. Settings:
   - **Application Name:** `OutreachHub-AMD`
   - **Webhook URL:** Leave **BLANK** for now - we'll fill this in after the Worker is deployed
   - **Webhook API version:** v2
   - **Webhook Failover URL:** Leave blank
   - Leave other defaults
4. Click **Create**
5. Once created, click into the application and **copy the `Connection ID`** (16-digit number)
6. **Save the Connection ID** - you'll need it as a Worker secret

### 1.3 Verify Outbound Voice Profile is assigned

The Call Control Application needs to route through an outbound profile (the same one your SIP Connection already uses is fine):

1. In the Call Control App, find the **Outbound** tab
2. Set **Outbound Voice Profile** to your existing `Default` profile
3. Save

### 1.4 Note your SIP username

For bridging human-answered calls back to your browser, we need to know your SIP Connection's username:

1. Voice -> SIP Connections -> `DNSIPDialer`
2. Authentication tab
3. Copy the **SIP Username** (the auto-generated string)
4. Save this somewhere - you'll need it as a Worker secret too

---

## Part 2 - Cloudflare Worker deployment (10-15 min)

### 2.1 Cloudflare account

1. Sign up at https://dash.cloudflare.com/sign-up if you don't have one (free)
2. Verify your email
3. Skip the "add a domain" wizard - we don't need one for Workers

### 2.2 Create the Worker

1. Once in your Cloudflare dashboard, find **Workers & Pages** in the left sidebar
2. Click **Create application** -> **Create Worker**
3. Default name: change to `outreach-hub-dialler` (or whatever you want)
4. Click **Deploy** (it'll deploy a hello-world Worker first - that's fine)
5. Once deployed, click **Edit code**

### 2.3 Paste the Worker code

1. In the code editor, you'll see the default hello-world code
2. **Select all** (Ctrl+A) and **delete it**
3. Open `worker.js` from this folder, copy ALL of its contents
4. Paste into the Cloudflare editor
5. Click **Save and deploy**

### 2.4 Note your Worker URL

After deploy, the Worker has a URL like:
```
https://outreach-hub-dialler.<your-subdomain>.workers.dev
```

**Copy this URL** - we'll use it in steps below.

You can test it works by visiting `<your-worker-url>/health` in a browser - should return a JSON response with `ok: true`.

### 2.5 Set the Worker secrets

Secrets are encrypted env vars that the Worker can read but no one can see in the dashboard.

1. In your Worker's page, go to **Settings** -> **Variables and Secrets**
2. Click **Add variable**, **Type: Secret** for each of these:

| Variable name | Value | Notes |
|---------------|-------|-------|
| `TELNYX_API_KEY` | The key from Part 1.1 | The long `KEY01...` string |
| `TELNYX_CONNECTION_ID` | The Connection ID from Part 1.2 | 16-digit number |
| `SHARED_SECRET` | Generate yourself - any random 20+ char string | Use `openssl rand -hex 32` or just type a long random string |
| `BRIDGE_SIP_USERNAME` | The SIP Username from Part 1.4 | For bridging humans to your browser |

3. **Optional secrets** (defaults are fine if you skip these):
   - `AMD_MODE` = `premium` (or `detect` for faster/cheaper, `detect_beep` if leaving VM messages)
   - `NO_ANSWER_TIMEOUT_MS` = `22000` (22 seconds - calls auto-cancel if not answered)
   - `ALLOWED_ORIGIN` = `*` (or your specific origin for tighter security, e.g. `https://your-pwa-domain.com` if you host the HTML)

4. Click **Save and deploy** after adding each secret

### 2.6 Update Telnyx with the Worker webhook URL

Now Telnyx knows where to send events:

1. Telnyx portal -> Voice -> Call Control Applications -> `OutreachHub-AMD`
2. **Webhook URL:** paste `<your-worker-url>/telnyx`
   - Example: `https://outreach-hub-dialler.abc.workers.dev/telnyx`
3. Save

---

## Part 3 - Pauls Outreach Hub setup (2 min)

1. Open `PaulsOutreachHub.html` in your browser
2. Settings -> Telnyx dialler
3. Find the new fields:
   - **Worker URL:** paste `<your-worker-url>` (no path, no trailing slash)
   - **Worker shared secret:** paste the SAME `SHARED_SECRET` you set in step 2.5
4. Save

---

## Part 4 - Test it (5 min)

1. Hard reload Pauls Outreach Hub (Ctrl+Shift+R)
2. Dialler tab -> Connect Telnyx (still uses your existing SIP credentials for the receive side)
3. Pick 1 contact with a known phone number (your own mobile, or a colleague's)
4. Click **Start AMD Run** (the new button - keeps the original Start Run for non-AMD)
5. Watch the browser console (F12)
   - You should see: `[dialler] AMD dial requested`, then SSE events like `call.ringing`, `call.answered`, `amd.result:...`
6. On your test phone:
   - Let it ring out without answering -> Worker should auto-hangup after the timeout, no touchpoint logged
   - Pick up and talk -> bridged to your browser (you hear them, they hear you), outcome panel appears
   - Pick up and play your voicemail greeting (or use a real VM) -> AMD detects machine, auto-hangs up, VM touchpoint logged

---

## Troubleshooting

**Worker /health returns OK but /dial returns 401**
- Shared secret in PaulsOutreachHub doesn't match the SHARED_SECRET in Cloudflare

**Telnyx dial succeeds but no webhooks arrive**
- Webhook URL in Call Control App is missing the `/telnyx` path, or the wrong Worker URL

**AMD never resolves (call rings, you answer, but no auto-bridge)**
- BRIDGE_SIP_USERNAME secret is wrong or missing
- Your SIP Connection isn't currently logged in (check Pauls Outreach Hub's Connect Telnyx button - green pill should be on)

**Calls hang up on humans (false-positive machine detection)**
- AMD_MODE = `premium` is most accurate. Try setting it explicitly.
- Some networks send recorded "Hello, you're connected" intros that fool AMD - this is unfixable without lowering AMD aggressiveness

**Browser console shows SSE keeps reconnecting**
- Normal - SSE reconnects every ~25s due to Cloudflare timeouts. State is preserved.

**Worker logs say "Bridge failed"**
- The SIP username in BRIDGE_SIP_USERNAME doesn't match a currently-registered WebRTC client
- Or you're not connected to Telnyx in the browser at the moment AMD fires

---

## Costs

- **Cloudflare Workers:** Free tier (100K requests/day) - your usage will be a few hundred/day, well under the limit
- **Telnyx Premium AMD:** ~$0.005 per call detection
- **Telnyx call minutes:** Same as before (~£0.013/min UK landline)
- **Total ongoing:** ~£3-5/month at 30 calls/day

vs $300/month parallel dialler subscriptions, this is the better trade.

---

## What to do if AMD turns out wrong for your business

The original direct-dial run button (`Start Run` without AMD) is preserved. If AMD ends up hanging up on humans too often or you decide it's not worth the complexity, just use the non-AMD button and the Worker sits idle (zero cost on Cloudflare free tier).

To turn AMD off entirely: don't use `Start AMD Run`. Or set `AMD_MODE` to `disabled` in Worker secrets (we'll add that switch if you need it later).

---

## Security notes

- The `TELNYX_API_KEY` is the powerful one - if compromised, someone can make calls / SMS from your account. Stored only as a Cloudflare Worker Secret (encrypted at rest, never visible in dashboard).
- The `SHARED_SECRET` gates the `/dial` and `/events` endpoints so random people can't trigger calls if they discover the Worker URL.
- The Worker URL itself is not secret - it's just an HTTPS endpoint. Discoverability does not equal compromise as long as the shared secret holds.
- No prospect data is stored on Cloudflare. Only transient call metadata (call control IDs, contact IDs, run IDs) that auto-clears 30 seconds after each call ends.
