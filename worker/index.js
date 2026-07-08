// selfactual-waitlist Cloudflare Worker — thin relay to gateway.
//
// Receives waitlist form submissions from selfactual.ai and imprint.selfactual.ai,
// validates input, and forwards to the gateway's /api/waitlist/signup endpoint.
// The gateway owns Intercom upsert, Slack notification, and invite-code lifecycle.
//
// Env vars required:
//   GATEWAY_URL           — gateway base URL, e.g. https://api.selfactual.ai
//   WAITLIST_EMAIL_SECRET — shared secret (sent as Bearer token to gateway)
//   SLACK_WEBHOOK         — plain incoming webhook for non-interactive Slack
//                           fallback (optional; gateway posts the interactive
//                           approve-button message via bot token)
//
// Routes kept:
//   POST /           — waitlist step 1 (email only) or step 2 (enrichment)
//   PATCH /          — waitlist step 2 enrichment (legacy; maps to same gateway call)
//   POST /contact    — contact form (unchanged; not part of the waitlist pipeline)
//   GET  /debug      — env var presence check

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, PATCH, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    if (url.pathname === '/debug' && request.method === 'GET') {
      return handleDebug(env);
    }

    if (url.pathname === '/contact' && request.method === 'POST') {
      return handleContact(request, env, ctx);
    }

    if (request.method === 'POST' || request.method === 'PATCH') {
      return handleWaitlist(request, env, ctx);
    }

    return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS });
  },
};

// ---------------------------------------------------------------------------
// Debug
// ---------------------------------------------------------------------------

function handleDebug(env) {
  return Response.json({
    hasGatewayUrl: !!env.GATEWAY_URL,
    hasWaitlistSecret: !!env.WAITLIST_EMAIL_SECRET,
    hasSlackWebhook: !!env.SLACK_WEBHOOK,
  }, { headers: CORS_HEADERS });
}

// ---------------------------------------------------------------------------
// Waitlist signup / enrichment — POST or PATCH
//
// Step 1 body: { email, source?, landing_url?, referrer?, utm_*, ... }
// Step 2 body: { email, firstName?, lastName?, details?, productUpdates?, ... }
// Both steps forward to POST /api/waitlist/signup on the gateway.
// ---------------------------------------------------------------------------

async function handleWaitlist(request, env, ctx) {
  try {
    const body = await request.json();
    const { email, source } = body;

    if (!email || !email.includes('@')) {
      return Response.json({ error: 'Valid email required' }, { status: 400, headers: CORS_HEADERS });
    }

    const telemetry = extractTelemetry(request, body);

    const gatewayUrl = env.GATEWAY_URL;
    const secret = env.WAITLIST_EMAIL_SECRET;

    if (!gatewayUrl || !secret) {
      console.error('Worker: GATEWAY_URL or WAITLIST_EMAIL_SECRET not configured');
      return Response.json({ error: 'Server misconfigured' }, { status: 503, headers: CORS_HEADERS });
    }

    ctx.waitUntil(
      fetch(`${gatewayUrl}/api/waitlist/signup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${secret}`,
        },
        body: JSON.stringify({
          email,
          name: [body.firstName, body.lastName].filter(Boolean).join(' ') || undefined,
          details: body.details || body.referralSource || undefined,
          productUpdates: typeof body.productUpdates === 'boolean' ? body.productUpdates : undefined,
          source: source || undefined,
          telemetry,
        }),
      }).then(async (res) => {
        if (!res.ok) {
          const text = await res.text();
          console.error('Gateway waitlist/signup failed:', res.status, text);
        }
      }).catch((e) => console.error('Gateway waitlist/signup error:', e.message))
    );

    return Response.json({ success: true, email }, { headers: CORS_HEADERS });
  } catch (e) {
    console.error('Worker error:', e);
    return Response.json({ error: 'Server error' }, { status: 500, headers: CORS_HEADERS });
  }
}

// ---------------------------------------------------------------------------
// Contact form — unchanged; not part of the waitlist pipeline
// ---------------------------------------------------------------------------

async function handleContact(request, env, ctx) {
  try {
    const { name, email, category, message } = await request.json();

    if (!email || !email.includes('@')) {
      return Response.json({ error: 'Valid email required' }, { status: 400, headers: CORS_HEADERS });
    }
    if (!message) {
      return Response.json({ error: 'Message required' }, { status: 400, headers: CORS_HEADERS });
    }

    if (env.SLACK_WEBHOOK) {
      ctx.waitUntil(
        fetch(env.SLACK_WEBHOOK, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: `New contact form from *${name || email}*${category ? ` [${category}]` : ''}:\n${message}`,
          }),
        }).catch((e) => console.error('Slack error:', e.message))
      );
    }

    // Contact forms still go directly to Intercom to create a conversation.
    // This is separate from the waitlist pipeline.
    if (env.INTERCOM_TOKEN) {
      ctx.waitUntil(
        upsertIntercomContact(env, { email, name: name || undefined })
          .then((contactId) => contactId && createIntercomConversation(env, { contactId, body: message }))
          .catch((e) => console.error('Intercom contact error:', e.message))
      );
    }

    return Response.json({ success: true }, { headers: CORS_HEADERS });
  } catch (e) {
    console.error('Worker error:', e);
    return Response.json({ error: 'Server error' }, { status: 500, headers: CORS_HEADERS });
  }
}

// ---------------------------------------------------------------------------
// Telemetry extraction
// ---------------------------------------------------------------------------

function extractTelemetry(request, body) {
  const cf = request.cf || {};
  const h = request.headers;
  const raw = {
    country: cf.country,
    region: cf.region,
    city: cf.city,
    postal_code: cf.postalCode,
    timezone: cf.timezone,
    continent: cf.continent,
    latitude: cf.latitude,
    longitude: cf.longitude,
    ip: h.get('CF-Connecting-IP'),
    asn: cf.asn,
    asn_org: cf.asOrganization,
    user_agent: h.get('User-Agent'),
    accept_language: h.get('Accept-Language'),
    http_protocol: cf.httpProtocol,
    tls_version: cf.tlsVersion,
    landing_url: body.landing_url,
    landing_path: body.landing_path,
    referrer: body.referrer,
    utm_source: body.utm_source,
    utm_medium: body.utm_medium,
    utm_campaign: body.utm_campaign,
    utm_content: body.utm_content,
    utm_term: body.utm_term,
    first_seen_at: body.first_seen_at,
    current_url: body.current_url,
    screen_width: body.screen_width,
    client_timezone: body.tz_client,
  };
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v !== null && v !== undefined && v !== '') out[k] = v;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Minimal Intercom helpers for the contact form (kept here; not used for
// waitlist anymore).
// ---------------------------------------------------------------------------

const INTERCOM_API = 'https://api.intercom.io';
const INTERCOM_VERSION = '2.11';

function intercomHeaders(env) {
  return {
    'Authorization': `Bearer ${env.INTERCOM_TOKEN}`,
    'Intercom-Version': INTERCOM_VERSION,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
}

async function upsertIntercomContact(env, { email, name }) {
  const searchRes = await fetch(`${INTERCOM_API}/contacts/search`, {
    method: 'POST',
    headers: intercomHeaders(env),
    body: JSON.stringify({ query: { field: 'email', operator: '=', value: email } }),
  });
  let contactId = null;
  if (searchRes.ok) {
    const d = await searchRes.json();
    contactId = d.data?.[0]?.id || null;
  }
  const body = { role: 'lead', email };
  if (name) body.name = name;
  if (contactId) {
    await fetch(`${INTERCOM_API}/contacts/${contactId}`, {
      method: 'PUT', headers: intercomHeaders(env), body: JSON.stringify(body),
    });
    return contactId;
  }
  const res = await fetch(`${INTERCOM_API}/contacts`, {
    method: 'POST', headers: intercomHeaders(env), body: JSON.stringify(body),
  });
  if (!res.ok) return null;
  const d = await res.json();
  return d.id;
}

async function createIntercomConversation(env, { contactId, body }) {
  await fetch(`${INTERCOM_API}/conversations`, {
    method: 'POST',
    headers: intercomHeaders(env),
    body: JSON.stringify({ from: { type: 'user', id: contactId }, body }),
  });
}
