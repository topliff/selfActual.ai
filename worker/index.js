const NOTION_DB_ID = '930544000a334dc4b6288b08b70b9a67';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS });
    }

    try {
      const { email, interests, source } = await request.json();

      if (!email || !email.includes('@')) {
        return Response.json({ error: 'Valid email required' }, { status: 400, headers: CORS_HEADERS });
      }

      const properties = {
        Name: { title: [{ text: { content: email } }] },
        Email: { email: email },
      };

      if (interests && interests.length > 0) {
        properties.Interest = {
          multi_select: interests.map(name => ({ name })),
        };
      }

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

      return Response.json({ success: true }, { headers: CORS_HEADERS });
    } catch (e) {
      console.error('Worker error:', e);
      return Response.json({ error: 'Server error' }, { status: 500, headers: CORS_HEADERS });
    }
  },
};
