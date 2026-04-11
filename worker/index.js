const WAITLIST_DB_ID = '930544000a334dc4b6288b08b70b9a67';
const CONTACT_DB_ID = 'b66b7666586548279f5d58d8c9b287ac';

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

    // Debug endpoint — test Intercom connection
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

async function handleDebug(env) {
  const results = {
    hasIntercomToken: !!env.INTERCOM_TOKEN,
    tokenLength: env.INTERCOM_TOKEN ? env.INTERCOM_TOKEN.length : 0,
    tokenPrefix: env.INTERCOM_TOKEN ? env.INTERCOM_TOKEN.substring(0, 8) + '...' : 'NOT SET',
    hasNotionToken: !!env.NOTION_TOKEN,
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

async function handleCreate(request, env, ctx) {
  try {
    const { email, source } = await request.json();

    if (!email || !email.includes('@')) {
      return Response.json({ error: 'Valid email required' }, { status: 400, headers: CORS_HEADERS });
    }

    const properties = {
      Name: { title: [{ text: { content: email } }] },
      Email: { email: email },
    };

    if (source) {
      properties.Source = { select: { name: source } };
    }

    const res = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.NOTION_TOKEN}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        parent: { database_id: WAITLIST_DB_ID },
        properties,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('Notion API error:', err);
      return Response.json({ error: 'Failed to save' }, { status: 500, headers: CORS_HEADERS });
    }

    const data = await res.json();

    ctx.waitUntil(
      fetch(env.SLACK_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `New waitlist signup: *${email}*` + (source ? ` (${source})` : ''),
        }),
      }).catch(() => {})
    );

    // Intercom — run inline so we can log results
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

    return Response.json({ success: true, pageId: data.id }, { headers: CORS_HEADERS });
  } catch (e) {
    console.error('Worker error:', e);
    return Response.json({ error: 'Server error' }, { status: 500, headers: CORS_HEADERS });
  }
}

async function handleUpdate(request, env, ctx) {
  try {
    const { pageId, email, firstName, lastName, company, details } = await request.json();

    if (!pageId) {
      return Response.json({ error: 'pageId required' }, { status: 400, headers: CORS_HEADERS });
    }

    const properties = {};
    if (firstName) properties['First Name'] = { rich_text: [{ text: { content: firstName } }] };
    if (lastName) properties['Last Name'] = { rich_text: [{ text: { content: lastName } }] };
    if (company) properties['Company'] = { rich_text: [{ text: { content: company } }] };
    if (details) properties['Details'] = { rich_text: [{ text: { content: details } }] };

    if (firstName || lastName) {
      const fullName = [firstName, lastName].filter(Boolean).join(' ');
      properties['Name'] = { title: [{ text: { content: fullName } }] };
    }

    const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${env.NOTION_TOKEN}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ properties }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('Notion API error:', err);
      return Response.json({ error: 'Failed to update' }, { status: 500, headers: CORS_HEADERS });
    }

    const parts = [];
    if (firstName || lastName) parts.push(`*Name:* ${[firstName, lastName].filter(Boolean).join(' ')}`);
    if (company) parts.push(`*Company:* ${company}`);
    if (details) parts.push(`*Details:* ${details}`);
    if (parts.length > 0) {
      ctx.waitUntil(
        fetch(env.SLACK_WEBHOOK, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: `Waitlist update for *${email || 'unknown'}*:\n${parts.join('\n')}`,
          }),
        }).catch(() => {})
      );
    }

    if (email) {
      const fullName = [firstName, lastName].filter(Boolean).join(' ');
      const customAttributes = {};
      if (company) customAttributes.company = company;
      if (details) customAttributes.details = details;
      ctx.waitUntil(
        (async () => {
          try {
            await upsertIntercomContact(env, {
              email,
              name: fullName || undefined,
              customAttributes,
            });
          } catch (e) {
            console.error('Intercom waitlist update error:', e.message);
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

async function handleContact(request, env, ctx) {
  try {
    const { name, email, category, message } = await request.json();

    if (!email || !email.includes('@')) {
      return Response.json({ error: 'Valid email required' }, { status: 400, headers: CORS_HEADERS });
    }
    if (!message) {
      return Response.json({ error: 'Message required' }, { status: 400, headers: CORS_HEADERS });
    }

    const properties = {
      Name: { title: [{ text: { content: name || email } }] },
      Email: { email: email },
      Message: { rich_text: [{ text: { content: message } }] },
    };

    if (category) {
      properties.Category = { select: { name: category } };
    }

    const res = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.NOTION_TOKEN}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        parent: { database_id: CONTACT_DB_ID },
        properties,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('Notion API error:', err);
      return Response.json({ error: 'Failed to save' }, { status: 500, headers: CORS_HEADERS });
    }

    ctx.waitUntil(
      fetch(env.SLACK_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `New contact form submission from *${name || email}*` +
            (category ? ` [${category}]` : '') +
            `:\n${message}`,
        }),
      }).catch(() => {})
    );

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
          }
        } catch (e) {
          console.error('Intercom contact error:', e.message, e.stack);
        }
      })()
    );

    return Response.json({ success: true }, { headers: CORS_HEADERS });
  } catch (e) {
    console.error('Worker error:', e);
    return Response.json({ error: 'Server error' }, { status: 500, headers: CORS_HEADERS });
  }
}

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
