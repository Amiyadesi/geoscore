import type { Env, Business } from '../lib/types';

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';

export async function resolveBusinessFromQuery(
  query: string,
  env: Env
): Promise<Business[]> {
  // FTS5 exact-word search first
  try {
    const ftsResults = await env.DB.prepare(
      `SELECT b.* FROM businesses b
       JOIN businesses_fts f ON b.id = f.rowid
       WHERE businesses_fts MATCH ? LIMIT 8`
    ).bind(query).all<Business>();
    if (ftsResults.results.length > 0) return ftsResults.results;
  } catch {
    // FTS5 can throw on special characters — fall through
  }

  // LIKE fallback for partial/stem matches (works for small tables)
  const likeResults = await env.DB.prepare(
    `SELECT * FROM businesses
     WHERE name LIKE ? OR category LIKE ? OR city LIKE ? OR domain LIKE ?
     ORDER BY name LIMIT 8`
  ).bind(`%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`).all<Business>();

  if (likeResults.results.length > 0) return likeResults.results;

  // Nominatim fallback for names not in our DB
  return nominatimSearch(query, env);
}

async function nominatimSearch(query: string, env: Env): Promise<Business[]> {
  const url = `${NOMINATIM}?q=${encodeURIComponent(query)}&format=json&addressdetails=1&limit=8`;
  const res = await fetch(url, {
    headers: { 'User-Agent': env.NOMINATIM_USER_AGENT },
  });
  if (!res.ok) return [];

  const data: NominatimResult[] = await res.json();
  return data.map((r) => ({
    name: r.display_name.split(',')[0],
    domain: undefined,
    city: r.address?.city || r.address?.town || r.address?.state,
    country: r.address?.country,
    category: r.type,
    lat: parseFloat(r.lat),
    lon: parseFloat(r.lon),
    osm_id: `${r.osm_type}${r.osm_id}`,
    address: r.display_name,
  }));
}

export async function upsertBusiness(business: Business, env: Env): Promise<number> {
  const existing = business.domain
    ? await env.DB.prepare('SELECT id FROM businesses WHERE domain = ?')
        .bind(business.domain)
        .first<{ id: number }>()
    : null;

  if (existing) return existing.id;

  const result = await env.DB.prepare(
    `INSERT INTO businesses (name, domain, city, country, category, lat, lon, osm_id, address, phone)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(domain) DO UPDATE SET updated_at = unixepoch()
     RETURNING id`
  )
    .bind(
      business.name,
      business.domain ?? null,
      business.city ?? null,
      business.country ?? null,
      business.category ?? null,
      business.lat ?? null,
      business.lon ?? null,
      business.osm_id ?? null,
      business.address ?? null,
      business.phone ?? null
    )
    .first<{ id: number }>();

  if (result) {
    await syncBusinessFts(result.id, business, env);
    return result.id;
  }
  // ON CONFLICT branch may not return a row on some D1 versions — fall back to SELECT
  const fallback = await env.DB.prepare('SELECT id FROM businesses WHERE domain = ?')
    .bind(business.domain ?? '')
    .first<{ id: number }>();
  if (!fallback) throw new Error('upsertBusiness: could not retrieve id after insert');
  await syncBusinessFts(fallback.id, business, env);
  return fallback.id;
}

async function syncBusinessFts(id: number, business: Business, env: Env): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT OR REPLACE INTO businesses_fts(rowid, name, city, category)
       VALUES (?, ?, ?, ?)`
    ).bind(
      id,
      business.name,
      business.city ?? null,
      business.category ?? null,
    ).run();
  } catch {
    // Search autocomplete can fall back to LIKE if FTS is unavailable.
  }
}

interface NominatimResult {
  display_name: string;
  lat: string;
  lon: string;
  type: string;
  osm_type: string;
  osm_id: string;
  address?: {
    city?: string;
    town?: string;
    state?: string;
    country?: string;
  };
}
