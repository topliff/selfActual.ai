const WAITLIST_DB_ID = '930544000a334dc4b6288b08b70b9a67';
const CONTACT_DB_ID = 'b66b7666586548279f5d58d8c9b287ac';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    if (url.pathname === '/contact' && request.method === 'POST') {
      return handleContact(request, env, ctx);
    }

    if (request.method === 'POST') return handleCreate(request, env, ctx);
    if (request.method === 'PATCH') return handleUpdate(request, env, ctx);

    return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS });
  },
};

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

    ctx.waitUntil(
      upsertIntercomContact(env, {
        email,
        customAttributes: source ? { source } : {},
      }).catch((e) => console.error('Intercom waitlist error:', e))
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
        upsertIntercomContact(env, {
          email,
          name: fullName || undefined,
          customAttributes,
        }).catch((e) => console.error('Intercom waitlist update error:', e))
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
      })().catch((e) => console.error('Intercom contact error:', e))
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
    console.error('Intercom search failed:', await searchRes.text());
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
      console.error('Intercom update failed:', await res.text());
    }
    return contactId;
  }

  const res = await fetch(`${INTERCOM_API}/contacts`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error('Intercom create failed:', await res.text());
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
    console.error('Intercom conversation failed:', await res.text());
  }
}
