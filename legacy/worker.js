// ==============================================================
// Pauls Outreach Hub - Telnyx AMD Dialler Worker
// ==============================================================
// Architecture:
//   Browser ---POST /dial---> Worker ---Call Control API---> Telnyx
//                                |
//   Browser <--SSE /events----Worker <--webhook /telnyx-----Telnyx
//
// Worker secrets required (set in Cloudflare dashboard):
//   TELNYX_API_KEY            - From https://portal.telnyx.com/#/app/api-keys
//   TELNYX_CONNECTION_ID      - The Call Control Application's connection_id
//   SHARED_SECRET             - Random string, shared with the browser to gate /dial
//
// Optional secrets:
//   AMD_MODE                  - "premium" (default), "detect", "detect_beep"
//   AMD_TOTAL_ANALYSIS_TIME   - Max ms AMD will analyse before falling back (default 6000)
//   NO_ANSWER_TIMEOUT_MS      - Max ms to wait for answer before hangup (default 22000)
//   BRIDGE_SIP_USERNAME       - The SIP username of your WebRTC connection (so we can transfer humans)
// ==============================================================

// Stores per-call state. In production you'd use Durable Objects for
// stronger consistency; for our volume a plain in-memory Map is fine
// because the Worker survives long enough for a single call cycle.
// SSE listeners are kept here so the webhook can push updates to them.
const CALL_STATE = new Map();   // call_control_id -> { state, contactId, runId, lastEvent, ... }
const SSE_CLIENTS = new Map();  // runId -> Set of WritableStream controllers

// =================== ROUTING ===================
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS preflight - browser will send OPTIONS before POST
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(env) });
    }

    try {
      if (path === '/dial' && request.method === 'POST') {
        return await handleDial(request, env);
      }
      if (path === '/hangup' && request.method === 'POST') {
        return await handleHangup(request, env);
      }
      if (path === '/telnyx' && request.method === 'POST') {
        return await handleTelnyxWebhook(request, env, ctx);
      }
      if (path === '/events' && request.method === 'GET') {
        return handleEventStream(request, env);
      }
      if (path === '/health') {
        return jsonResponse({ ok: true, version: '1.0.0', time: new Date().toISOString() }, 200, env);
      }
      return new Response('Not found', { status: 404 });
    } catch (e) {
      console.error('Unhandled error:', e.message, e.stack);
      return jsonResponse({ error: 'internal', message: e.message }, 500, env);
    }
  }
};

// =================== /dial ===================
// Browser sends: { to: "+44...", from: "+44...", contactId: 123, runId: "abc", sharedSecret: "..." }
// Worker tells Telnyx to dial. Returns call_control_id.
async function handleDial(request, env) {
  const body = await request.json();

  // Auth - shared secret must match
  if (!body.sharedSecret || body.sharedSecret !== env.SHARED_SECRET) {
    return jsonResponse({ error: 'unauthorized' }, 401, env);
  }

  if (!body.to || !body.from || !body.runId) {
    return jsonResponse({ error: 'missing required fields: to, from, runId' }, 400, env);
  }

  const amdMode = env.AMD_MODE || 'premium';
  const amdAnalysisTime = parseInt(env.AMD_TOTAL_ANALYSIS_TIME) || 6000;

  // Call Control API: POST /v2/calls
  const dialPayload = {
    connection_id: env.TELNYX_CONNECTION_ID,
    to: body.to,
    from: body.from,
    answering_machine_detection: amdMode,
    answering_machine_detection_config: {
      total_analysis_time_millis: amdAnalysisTime,
      greeting_total_analysis_time_millis: 5000,
      after_greeting_silence_millis: 800,
      between_words_silence_millis: 100,
      greeting_duration_millis: 3500,
      initial_silence_millis: 3500,
      maximum_number_of_words: 5,
      maximum_word_length_millis: 3500,
      silence_threshold: 512
    },
    timeout_secs: parseInt(env.NO_ANSWER_TIMEOUT_MS) ? Math.ceil(parseInt(env.NO_ANSWER_TIMEOUT_MS) / 1000) : 22,
    // Custom headers carry our metadata back via webhooks so we can correlate
    custom_headers: [
      { name: 'X-Hub-Contact-Id', value: String(body.contactId || '') },
      { name: 'X-Hub-Run-Id', value: String(body.runId) }
    ]
  };

  const dialResp = await telnyxAPI(env, 'POST', '/v2/calls', dialPayload);

  if (!dialResp.ok) {
    const err = await dialResp.text();
    console.error('Telnyx dial failed:', dialResp.status, err);
    return jsonResponse({ error: 'telnyx_dial_failed', status: dialResp.status, detail: err }, 502, env);
  }

  const result = await dialResp.json();
  const callControlId = result.data?.call_control_id;
  const callLegId = result.data?.call_leg_id;

  // Track this call
  CALL_STATE.set(callControlId, {
    state: 'dialing',
    contactId: body.contactId,
    runId: body.runId,
    to: body.to,
    from: body.from,
    callLegId,
    startedAt: Date.now(),
    amdResult: null,
    hungupBy: null
  });

  // Notify SSE listeners
  pushEvent(body.runId, {
    type: 'call.created',
    callControlId,
    contactId: body.contactId,
    to: body.to,
    state: 'dialing'
  });

  return jsonResponse({ ok: true, callControlId, callLegId }, 200, env);
}

// =================== /hangup ===================
// Browser sends: { callControlId: "...", sharedSecret: "..." }
async function handleHangup(request, env) {
  const body = await request.json();
  if (body.sharedSecret !== env.SHARED_SECRET) {
    return jsonResponse({ error: 'unauthorized' }, 401, env);
  }
  if (!body.callControlId) {
    return jsonResponse({ error: 'missing callControlId' }, 400, env);
  }

  const resp = await telnyxAPI(env, 'POST', `/v2/calls/${body.callControlId}/actions/hangup`, {});
  const ok = resp.ok;

  const tracked = CALL_STATE.get(body.callControlId);
  if (tracked) tracked.hungupBy = 'user';

  return jsonResponse({ ok, status: resp.status }, ok ? 200 : 502, env);
}

// =================== /telnyx (webhook) ===================
// Telnyx sends us events as the call progresses.
async function handleTelnyxWebhook(request, env, ctx) {
  // Telnyx webhook auth - optional signature verification
  // For now we trust by URL obscurity + the API key (no one can do anything without it)
  const event = await request.json();
  const data = event.data || {};
  const eventType = data.event_type;
  const payload = data.payload || {};
  const callControlId = payload.call_control_id;

  console.log('Telnyx webhook:', eventType, 'call:', callControlId);

  if (!callControlId) {
    return new Response('OK', { status: 200 });  // Always ACK
  }

  // Pull our tracked state (or initialize if Worker rebooted mid-call)
  let tracked = CALL_STATE.get(callControlId);
  if (!tracked) {
    // Recover metadata from custom_headers in payload
    const headers = payload.custom_headers || [];
    const contactId = headers.find(h => h.name === 'X-Hub-Contact-Id')?.value;
    const runId = headers.find(h => h.name === 'X-Hub-Run-Id')?.value;
    if (runId) {
      tracked = { state: 'unknown', contactId, runId, startedAt: Date.now() };
      CALL_STATE.set(callControlId, tracked);
    }
  }

  const runId = tracked?.runId;

  // === Event handling ===
  switch (eventType) {
    case 'call.initiated':
      if (tracked) tracked.state = 'initiated';
      pushEvent(runId, { type: 'call.initiated', callControlId });
      break;

    case 'call.ringing':
      if (tracked) tracked.state = 'ringing';
      pushEvent(runId, { type: 'call.ringing', callControlId });
      break;

    case 'call.answered':
      if (tracked) tracked.state = 'answered';
      pushEvent(runId, { type: 'call.answered', callControlId });
      // Don't bridge yet - wait for AMD result
      break;

    case 'call.machine.detection.ended':
      // The big one. AMD just decided what the call is.
      const result = payload.result;  // 'human', 'machine', 'not_sure', 'fax', 'human_residence'
      if (tracked) tracked.amdResult = result;
      console.log('AMD result:', result, 'for call', callControlId);
      pushEvent(runId, {
        type: 'amd.result',
        callControlId,
        result,
        contactId: tracked?.contactId
      });

      if (result === 'machine' || result === 'fax') {
        // Hang up automatically
        ctx.waitUntil(telnyxAPI(env, 'POST', `/v2/calls/${callControlId}/actions/hangup`, {})
          .then(r => console.log('Auto-hangup on machine:', r.status)));
        if (tracked) tracked.hungupBy = 'amd_machine';
        pushEvent(runId, { type: 'call.machine_hangup', callControlId, contactId: tracked?.contactId });
      } else {
        // 'human', 'not_sure', 'human_residence' - bridge to browser
        // We bridge by *transferring* the call to the SIP user (our WebRTC client)
        if (env.BRIDGE_SIP_USERNAME) {
          ctx.waitUntil(bridgeToBrowser(env, callControlId).catch(e => console.error('Bridge failed:', e)));
        }
        pushEvent(runId, { type: 'call.bridge_human', callControlId, contactId: tracked?.contactId });
      }
      break;

    case 'call.machine.greeting.ended':
      // Only fires if AMD mode was 'detect_beep' - signals VM is ready for a message
      pushEvent(runId, { type: 'amd.greeting_ended', callControlId });
      break;

    case 'call.bridged':
      if (tracked) tracked.state = 'bridged';
      pushEvent(runId, { type: 'call.bridged', callControlId });
      break;

    case 'call.hangup':
      if (tracked) tracked.state = 'hangup';
      const hangupCause = payload.hangup_cause;
      const hangupSource = payload.hangup_source;
      pushEvent(runId, {
        type: 'call.hangup',
        callControlId,
        contactId: tracked?.contactId,
        hangupCause,
        hangupSource,
        amdResult: tracked?.amdResult,
        hungupBy: tracked?.hungupBy
      });
      // Clean up tracking after a short delay (in case more events arrive)
      setTimeout(() => CALL_STATE.delete(callControlId), 30000);
      break;

    default:
      // Other events: call.cost, call.dtmf.received, etc. - we don't act on these
      break;
  }

  return new Response('OK', { status: 200 });
}

// Transfer the answered call to the WebRTC user. This is how the human-answered
// call ends up on Paul's headset. Requires a SIP username that's logged in.
async function bridgeToBrowser(env, callControlId) {
  if (!env.BRIDGE_SIP_USERNAME) {
    console.warn('BRIDGE_SIP_USERNAME not set - cannot bridge');
    return;
  }
  const transferTo = `sip:${env.BRIDGE_SIP_USERNAME}@sip.telnyx.com`;
  const resp = await telnyxAPI(env, 'POST', `/v2/calls/${callControlId}/actions/transfer`, {
    to: transferTo
  });
  if (!resp.ok) {
    const err = await resp.text();
    console.error('Transfer failed:', resp.status, err);
  } else {
    console.log('Transferred to', transferTo);
  }
}

// =================== /events (SSE) ===================
// Browser opens long-lived GET, Worker pushes events to it.
function handleEventStream(request, env) {
  const url = new URL(request.url);
  const runId = url.searchParams.get('runId');
  const secret = url.searchParams.get('secret');

  if (secret !== env.SHARED_SECRET) {
    return new Response('Unauthorized', { status: 401, headers: corsHeaders(env) });
  }
  if (!runId) {
    return new Response('Missing runId', { status: 400, headers: corsHeaders(env) });
  }

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  // Register this listener
  if (!SSE_CLIENTS.has(runId)) SSE_CLIENTS.set(runId, new Set());
  const listeners = SSE_CLIENTS.get(runId);
  const listener = { writer, encoder };
  listeners.add(listener);

  // Initial ping so client knows we're alive
  writer.write(encoder.encode(`event: hello\ndata: {"ok":true,"runId":"${runId}"}\n\n`)).catch(() => {});

  // Keepalive ping every 25s (Cloudflare kills idle SSE after ~100s)
  const keepalive = setInterval(() => {
    writer.write(encoder.encode(`: keepalive ${Date.now()}\n\n`)).catch(() => {
      clearInterval(keepalive);
      listeners.delete(listener);
    });
  }, 25000);

  // Clean up if browser disconnects
  request.signal.addEventListener('abort', () => {
    clearInterval(keepalive);
    listeners.delete(listener);
    try { writer.close(); } catch (e) {}
  });

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      ...corsHeaders(env)
    }
  });
}

function pushEvent(runId, payload) {
  if (!runId) return;
  const listeners = SSE_CLIENTS.get(runId);
  if (!listeners || listeners.size === 0) return;
  const msg = `data: ${JSON.stringify(payload)}\n\n`;
  listeners.forEach(l => {
    l.writer.write(l.encoder.encode(msg)).catch(() => {
      listeners.delete(l);
    });
  });
}

// =================== HELPERS ===================
async function telnyxAPI(env, method, path, body) {
  return fetch(`https://api.telnyx.com${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${env.TELNYX_API_KEY}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: method !== 'GET' ? JSON.stringify(body || {}) : undefined
  });
}

function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400'
  };
}

function jsonResponse(obj, status, env) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(env)
    }
  });
}
