// One-shot script: apply `waitlist-signup` tag to all existing Intercom contacts.
// Run: INTERCOM_TOKEN=<token> node tag-waitlist-existing.mjs
//
// Safe to re-run — Intercom tag API is idempotent.

const TOKEN = process.env.INTERCOM_TOKEN;
if (!TOKEN) {
  console.error('Missing INTERCOM_TOKEN env var');
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${TOKEN}`,
  'Content-Type': 'application/json',
  'Intercom-Version': '2.11',
  Accept: 'application/json',
};

// Collect all contact IDs by paginating through each domain.
async function fetchContactsByDomain(domain) {
  let page = 1;
  const ids = [];
  while (true) {
    const res = await fetch(
      `https://api.intercom.io/contacts/search`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          query: { field: 'email', operator: 'CONTAINS', value: `@${domain}` },
          pagination: { page, per_page: 150 },
        }),
      }
    );
    if (!res.ok) {
      console.error(`Search failed for ${domain}:`, res.status, await res.text());
      break;
    }
    const data = await res.json();
    for (const c of data.data || []) ids.push(c.id);
    if (!data.pages || page >= data.pages.total_pages) break;
    page++;
  }
  return ids;
}

// Skip internal/test domains.
const SKIP_DOMAINS = ['selfactual.ai'];

// Domains known to have contacts. Add more if needed.
const DOMAINS = ['gmail.com', 'icloud.com', 'hotmail.com', 'yahoo.com', 'outlook.com'];

console.log('Collecting contact IDs...');
const allIds = new Set();
for (const domain of DOMAINS) {
  if (SKIP_DOMAINS.includes(domain)) continue;
  const ids = await fetchContactsByDomain(domain);
  console.log(`  ${domain}: ${ids.length} contacts`);
  ids.forEach(id => allIds.add(id));
}

const contactIds = [...allIds];
console.log(`\nTotal to tag: ${contactIds.length}`);

if (contactIds.length === 0) {
  console.log('Nothing to tag.');
  process.exit(0);
}

// Intercom POST /tags accepts up to 50 contacts per call.
const BATCH = 50;
for (let i = 0; i < contactIds.length; i += BATCH) {
  const batch = contactIds.slice(i, i + BATCH);
  const res = await fetch('https://api.intercom.io/tags', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: 'waitlist-signup',
      contacts: batch.map(id => ({ id })),
    }),
  });
  if (res.ok) {
    console.log(`Tagged batch ${Math.floor(i / BATCH) + 1}: ${batch.length} contacts ✓`);
  } else {
    const err = await res.text();
    console.error(`Batch ${Math.floor(i / BATCH) + 1} failed:`, res.status, err);
  }
}

console.log('\nDone. Re-enable the Intercom Series with trigger: tag = waitlist-signup');
