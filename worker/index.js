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

    if (request.method === 'POST') return handleCreate(request, env, ctx);
    if (request.method === 'PATCH') return handleUpdate(request, env, ctx);

    return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS });
  },
};

// Debug endpoint
async function handleDebug(env) {
  const results = {
    hasIntercomToken: !!env.INTERCOM_TOKEN,
    tokenLength: env.INTERCOM_TOKEN ? env.INTERCOM_TOKEN.length : 0,
    tokenPrefix: env.INTERCOM_TOKEN ? env.INTERCOM_TOKEN.substring(0, 8) + '...' : 'NOT SET',
    hasSlackWebhook: !!env.SLACK_WEBHOOK,
    intercomApiTest: null,
  };

  if (env.INTERCOM_TOKEN) {
    try {
      const res = await fetch('https://api.intercom.io/me', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${env.INTERCOM_TOKEN}`,
          'Accept': 'application/json',
          'Intercom-Version': '2.11',
        },
      });
      const body = await res.text();
      results.intercomApiTest = {
        status: res.status,
        ok: res.ok,
        body: body.substring(0, 500),
      };
    } catch (e) {
      results.intercomApiTest = { error: e.message };
    }
  }

  return Response.json(results, { headers: CORS_HEADERS });
}

// Waitlist signup — Slack + Intercom
async function handleCreate(request, env, ctx) {
  try {
    const { email, source } = await request.json();

    if (!email || !email.includes('@')) {
      return Response.json({ error: 'Valid email required' }, { status: 400, headers: CORS_HEADERS });
    }

    // Slack notification
    if (env.SLACK_WEBHOOK) {
      ctx.waitUntil(
        fetch(env.SLACK_WEBHOOK, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: `New waitlist signup: *${email}*` + (source ? ` (${source})` : ''),
          }),
        }).catch((e) => console.error('Slack error:', e.message))
      );
    }

    // Intercom contact creation
    if (env.INTERCOM_TOKEN) {
      ctx.waitUntil(
        (async () => {
          try {
            const contactId = await upsertIntercomContact(env, {
              email,
              customAttributes: source ? { source } : {},
            });
            console.log('Intercom waitlist result:', contactId ? `contact ${contactId}` : 'failed');
          } catch (e) {
            console.error('Intercom waitlist error:', e.message, e.stack);
          }
        })()
      );
    }

    return Response.json({ success: true, email }, { headers: CORS_HEADERS });
  } catch (e) {
    console.error('Worker error:', e);
    return Response.json({ error: 'Server error' }, { status: 500, headers: CORS_HEADERS });
  }
}

// Waitlist details update — update Intercom contact with name/company
async function handleUpdate(request, env, ctx) {
  try {
    const { email, firstName, lastName, company, details } = await request.json();

    if (!email) {
      return Response.json({ error: 'email required' }, { status: 400, headers: CORS_HEADERS });
    }

    const fullName = [firstName, lastName].filter(Boolean).join(' ');
    const customAttributes = {};
    if (company) customAttributes.company = company;
    if (details) customAttributes.details = details;

    // Slack notification
    if (env.SLACK_WEBHOOK) {
      const parts = [];
      if (fullName) parts.push(`*Name:* ${fullName}`);
      if (company) parts.push(`*Company:* ${company}`);
      if (details) parts.push(`*Details:* ${details}`);
      if (parts.length > 0) {
        ctx.waitUntil(
          fetch(env.SLACK_WEBHOOK, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              text: `Waitlist update for *${email}*:\n${parts.join('\n')}`,
            }),
          }).catch((e) => console.error('Slack error:', e.message))
        );
      }
    }

    // Update Intercom contact
    if (env.INTERCOM_TOKEN) {
      ctx.waitUntil(
        (async () => {
          try {
            await upsertIntercomContact(env, {
              email,
              name: fullName || undefined,
              customAttributes,
            });
          } catch (e) {
            console.error('Intercom update error:', e.message);
          }
        })()
      );
    }

    return Response.json({ success: true }, { headers: CORS_HEADERS });
  } catch (e) {
    console.error('Worker error:', e);
    return Response.json({ error: 'Server error' }, { status: 500, headers: CORS_HEADERS });
  }
}

// Contact form — Slack + Intercom (with conversation)
async function handleContact(request, env, ctx) {
  try {
    const { name, email, category, message } = await request.json();

    if (!email || !email.includes('@')) {
      return Response.json({ error: 'Valid email required' }, { status: 400, headers: CORS_HEADERS });
    }
    if (!message) {
      return Response.json({ error: 'Message required' }, { status: 400, headers: CORS_HEADERS });
    }

    // Slack notification
    if (env.SLACK_WEBHOOK) {
      ctx.waitUntil(
        fetch(env.SLACK_WEBHOOK, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: `New contact form submission from *${name || email}*` +
              (category ? ` [${category}]` : '') +
              `:\n${message}`,
          }),
        }).catch((e) => console.error('Slack error:', e.message))
      );
    }

    // Intercom contact + conversation
    if (env.INTERCOM_TOKEN) {
      ctx.waitUntil(
        (async () => {
          try {
            const contactId = await upsertIntercomContact(env, {
              email,
              name: name || undefined,
              customAttributes: category ? { category } : {},
            });
            if (contactId) {
              await createIntercomConversation(env, {
                contactId,
                body: message,
              });
              console.log('Intercom contact+conversation created:', contactId);
            }
          } catch (e) {
            console.error('Intercom contact error:', e.message, e.stack);
          }
        })()
      );
    }

    return Response.json({ success: true }, { headers: CORS_HEADERS });
  } catch (e) {
    console.error('Worker error:', e);
    return Response.json({ error: 'Server error' }, { status: 500, headers: CORS_HEADERS });
  }
}

// --- Intercom API ---

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

async function upsertIntercomContact(env, { email, name, role = 'lead', customAttributes = {} }) {
  if (!env.INTERCOM_TOKEN) {
    console.error('INTERCOM_TOKEN not set');
    return null;
  }

  const headers = intercomHeaders(env);

  const searchRes = await fetch(`${INTERCOM_API}/contacts/search`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      query: { field: 'email', operator: '=', value: email },
    }),
  });

  let contactId = null;
  if (searchRes.ok) {
    const searchData = await searchRes.json();
    if (searchData.data && searchData.data.length > 0) {
      contactId = searchData.data[0].id;
    }
  } else {
    const errText = await searchRes.text();
    console.error('Intercom search failed:', searchRes.status, errText);
  }

  const body = { role, email };
  if (name) body.name = name;
  if (Object.keys(customAttributes).length > 0) {
    body.custom_attributes = customAttributes;
  }

  if (contactId) {
    const res = await fetch(`${INTERCOM_API}/contacts/${contactId}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error('Intercom update failed:', res.status, errText);
    }
    return contactId;
  }

  const res = await fetch(`${INTERCOM_API}/contacts`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text();
    console.error('Intercom create failed:', res.status, errText);
    return null;
  }
  const data = await res.json();
  return data.id;
}

async function createIntercomConversation(env, { contactId, body }) {
  if (!env.INTERCOM_TOKEN || !contactId) return;
  const res = await fetch(`${INTERCOM_API}/conversations`, {
    method: 'POST',
    headers: intercomHeaders(env),
    body: JSON.stringify({
      from: { type: 'user', id: contactId },
      body,
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    console.error('Intercom conversation failed:', res.status, errText);
  }
}
