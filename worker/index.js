const NOTION_DB_ID = '930544000a334dc4b6288b08b70b9a67';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (request.method === 'POST') return handleCreate(request, env);
    if (request.method === 'PATCH') return handleUpdate(request, env);

    return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS });
  },
};

async function handleCreate(request, env) {
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
        parent: { database_id: NOTION_DB_ID },
        properties,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('Notion API error:', err);
      return Response.json({ error: 'Failed to save' }, { status: 500, headers: CORS_HEADERS });
    }

    const data = await res.json();
    return Response.json({ success: true, pageId: data.id }, { headers: CORS_HEADERS });
  } catch (e) {
    console.error('Worker error:', e);
    return Response.json({ error: 'Server error' }, { status: 500, headers: CORS_HEADERS });
  }
}

async function handleUpdate(request, env) {
  try {
    const { pageId, firstName, lastName, company, details } = await request.json();

    if (!pageId) {
      return Response.json({ error: 'pageId required' }, { status: 400, headers: CORS_HEADERS });
    }

    const properties = {};
    if (firstName) properties['First Name'] = { rich_text: [{ text: { content: firstName } }] };
    if (lastName) properties['Last Name'] = { rich_text: [{ text: { content: lastName } }] };
    if (company) properties['Company'] = { rich_text: [{ text: { content: company } }] };
    if (details) properties['Details'] = { rich_text: [{ text: { content: details } }] };

    // Also update the Name/title to use real name if provided
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

    return Response.json({ success: true }, { headers: CORS_HEADERS });
  } catch (e) {
    console.error('Worker error:', e);
    return Response.json({ error: 'Server error' }, { status: 500, headers: CORS_HEADERS });
  }
}
