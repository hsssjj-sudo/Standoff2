const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  body: JSON.stringify(body),
});

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function ensureEnv() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not configured');
  }
}

async function supabaseRequest(path, options = {}) {
  ensureEnv();
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(options.headers || {}),
    },
  });

  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    const message = data?.message || data?.error || 'Supabase request failed';
    throw new Error(message);
  }
  return data;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
      body: '',
    };
  }

  try {
    const action = event.queryStringParameters?.action || 'list';

    if (event.httpMethod === 'GET' && action === 'list') {
      const search = (event.queryStringParameters?.search || '').trim().toLowerCase();
      const page = Math.max(1, parseInt(event.queryStringParameters?.page || '1', 10));
      const perPage = Math.min(50, Math.max(1, parseInt(event.queryStringParameters?.perPage || '6', 10)));
      const from = (page - 1) * perPage;
      const to = from + perPage - 1;

      let path = `/rest/v1/market_listings?select=*&status=eq.active&order=created_at.desc`;
      if (search) {
        path += `&or=(name.ilike.*${encodeURIComponent(search)}*,type.ilike.*${encodeURIComponent(search)}*)`;
      }
      path += `&offset=${from}&limit=${perPage}`;

      const items = await supabaseRequest(path, {
        method: 'GET',
        headers: { Prefer: 'count=exact' },
      });

      const totalRows = await supabaseRequest(
        `/rest/v1/market_listings?select=id&status=eq.active${search ? `&or=(name.ilike.*${encodeURIComponent(search)}*,type.ilike.*${encodeURIComponent(search)}*)` : ''}`,
        { method: 'GET' }
      );

      return json(200, {
        items,
        page,
        perPage,
        total: Array.isArray(totalRows) ? totalRows.length : 0,
      });
    }

    if (event.httpMethod === 'POST' && action === 'create') {
      const body = JSON.parse(event.body || '{}');
      const listing = {
        name: body.name,
        rarity: body.rarity,
        type: body.type,
        price: body.price,
        seller_name: body.sellerName,
        seller_id: body.sellerId,
        emoji: body.emoji || '🎯',
        status: 'active',
      };

      if (!listing.name || !listing.rarity || !listing.type || !listing.price || !listing.seller_id) {
        return json(400, { error: 'Missing required listing fields' });
      }

      const inserted = await supabaseRequest('/rest/v1/market_listings', {
        method: 'POST',
        body: JSON.stringify(listing),
      });

      return json(201, { item: inserted?.[0] || null });
    }

    if (event.httpMethod === 'POST' && action === 'buy') {
      const body = JSON.parse(event.body || '{}');
      const listingId = Number(body.listingId);

      if (!listingId || !body.buyerId) {
        return json(400, { error: 'listingId and buyerId are required' });
      }

      const result = await supabaseRequest('/rest/v1/rpc/purchase_market_listing', {
        method: 'POST',
        body: JSON.stringify({
          p_listing_id: listingId,
          p_buyer_id: body.buyerId,
          p_buyer_name: body.buyerName || 'Игрок',
        }),
      });

      if (!result?.success) {
        return json(409, { error: result?.message || 'Listing is unavailable' });
      }

      return json(200, result);
    }

    return json(404, { error: 'Unknown action' });
  } catch (error) {
    return json(500, { error: error.message || 'Unexpected error' });
  }
};
