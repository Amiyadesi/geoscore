import { fetchWithTimeout, type HttpFetcher } from '../lib/http';
import { registrableRoot } from '../lib/audit-pages';

export interface AuthorityResult {
  domain_age_years: number | null;
  wayback_first_seen: string | null;
  wikipedia: boolean;
  wikidata_id: string | null;
  indexed_page_count: number | null;
  registration_date: string | null;
  page_rank: number | null;
  entity_verified_domain: boolean;
  knowledge_entity_url: string | null;
  issues: string[];
}

export interface AuthorityOptions {
  fetcher?: HttpFetcher;
  maxKnowledgeCandidates?: number;
  maxRdapEndpoints?: number;
}

export async function runAuthority(
  domain: string,
  businessName: string,
  openpagerank_key?: string,
  options: AuthorityOptions = {},
): Promise<AuthorityResult> {
  const issues: string[] = [];
  const fetcher = options.fetcher ?? fetchWithTimeout;

  // Common Crawl removed — saved 2 subrequests/invocation (stayed under CF Workers 50 limit).
  const [wayback, knowledgeEntity, rdap, opr] = await Promise.allSettled([
    fetchWayback(domain, fetcher),
    fetchVerifiedKnowledgeEntity(
      businessName,
      domain,
      fetcher,
      Math.max(1, Math.min(2, options.maxKnowledgeCandidates ?? 2)),
    ),
    fetchRdap(domain, fetcher, Math.max(1, Math.min(3, options.maxRdapEndpoints ?? 3))),
    openpagerank_key ? fetchOpenPageRank(domain, openpagerank_key, fetcher) : Promise.resolve(null),
  ]);

  const waybackDate = wayback.status === 'fulfilled' ? wayback.value : null;
  const verifiedEntity = knowledgeEntity.status === 'fulfilled' ? knowledgeEntity.value : null;
  const wikipediaPresent = verifiedEntity?.wikipedia ?? false;
  const wikidataId = verifiedEntity?.wikidataId ?? null;
  const regDate = rdap.status === 'fulfilled' ? rdap.value : null;
  const pageRank = opr.status === 'fulfilled' ? opr.value : null;

  const domainAgeYears = regDate
    ? Math.floor((Date.now() - new Date(regDate).getTime()) / (1000 * 60 * 60 * 24 * 365))
    : null;

  if (!wikipediaPresent) issues.push('No Wikipedia page — low entity authority signal');
  if (!wikidataId) issues.push('No Wikidata entity — reduces LLM training-data inclusion likelihood');
  if (domainAgeYears !== null && domainAgeYears < 2) issues.push(`Domain only ${domainAgeYears} year(s) old — low trust signal`);

  return {
    domain_age_years: domainAgeYears,
    wayback_first_seen: waybackDate,
    wikipedia: wikipediaPresent,
    wikidata_id: wikidataId,
    indexed_page_count: null,   // Common Crawl removed to save subrequests — null = not checked
    registration_date: regDate,
    page_rank: pageRank,
    entity_verified_domain: !!verifiedEntity,
    knowledge_entity_url: verifiedEntity?.url ?? null,
    issues,
  };
}

async function fetchOpenPageRank(domain: string, apiKey: string, fetcher: HttpFetcher): Promise<number | null> {
  try {
    const res = await fetcher(
      'https://openpagerank.keywordseverywhere.com/v1/domains/bulk',
      {
        timeoutMs: 8000,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ domains: [domain], include_history: false }),
      }
    );
    if (!res.ok) return null;
    const data = await res.json() as {
      results?: Array<{ found?: boolean; open_page_rank?: number | null }>;
    };
    const entry = data.results?.[0];
    if (!entry?.found || typeof entry.open_page_rank !== 'number') return null;
    return entry.open_page_rank;
  } catch {
    return null;
  }
}

async function fetchWayback(domain: string, fetcher: HttpFetcher): Promise<string | null> {
  const url = `https://web.archive.org/cdx/search/cdx?url=${domain}&limit=1&output=json&fl=timestamp&from=19900101`;
  const res = await fetcher(url, { timeoutMs: 8000 });
  if (!res.ok) return null;
  const data: string[][] = await res.json();
  if (!data || data.length < 2) return null;
  const ts = data[1][0];
  return `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`;
}

// Derive a clean brand name from a domain: 'hubspot.com' → 'hubspot'
function brandFromDomain(domain: string): string {
  return domain.replace(/^www\./, '').split('.')[0].toLowerCase();
}

// Geo/person entity types that indicate a false-positive brand match (place names, people)
const GEO_PERSON_PATTERN = /\b(village|town|city|municipality|commune|settlement|district|province|region|county|river|mountain|lake|island|peninsula|cape|bay|born|politician|footballer|athlete|actor|singer|musician|painter|philosopher|novelist|poet)\b/i;

interface VerifiedKnowledgeEntity {
  wikidataId: string;
  wikipedia: boolean;
  url: string;
}

async function fetchVerifiedKnowledgeEntity(
  name: string,
  domain: string,
  fetcher: HttpFetcher,
  maxCandidates: number,
): Promise<VerifiedKnowledgeEntity | null> {
  const query = name.includes('.') ? brandFromDomain(name) : name.trim();
  if (!query) return null;
  const language = /[\u3400-\u9fff]/.test(query) ? 'zh' : 'en';
  const searchUrl = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(query)}&language=${language}&uselang=${language}&limit=5&format=json&origin=*`;
  const expectedRoot = registrableRoot(domain);
  if (!expectedRoot) return null;

  try {
    const response = await fetcher(searchUrl, { timeoutMs: 8000 });
    if (!response.ok) return null;
    const data = await response.json() as {
      search?: Array<{ id: string; label?: string; description?: string; match?: { type?: string } }>;
    };
    const normalizedQuery = query.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    const candidates = (data.search ?? [])
      .filter(item => {
        const normalizedLabel = (item.label ?? '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
        const labelMatch = normalizedLabel === normalizedQuery || item.match?.type === 'alias';
        return labelMatch && !GEO_PERSON_PATTERN.test(item.description ?? '');
      })
      .slice(0, maxCandidates);

    for (const candidate of candidates) {
      const entityUrl = `https://www.wikidata.org/wiki/Special:EntityData/${candidate.id}.json`;
      const entityResponse = await fetcher(entityUrl, { timeoutMs: 8000 });
      if (!entityResponse.ok) continue;
      const entityData = await entityResponse.json() as {
        entities?: Record<string, {
          claims?: Record<string, Array<{ mainsnak?: { datavalue?: { value?: unknown } } }>>;
          sitelinks?: Record<string, unknown>;
        }>;
      };
      const entity = entityData.entities?.[candidate.id];
      const officialUrls = (entity?.claims?.P856 ?? [])
        .map(claim => claim.mainsnak?.datavalue?.value)
        .filter((value): value is string => typeof value === 'string');
      const verified = officialUrls.some(officialUrl => {
        try { return registrableRoot(new URL(officialUrl).hostname) === expectedRoot; } catch { return false; }
      });
      if (!verified) continue;
      return {
        wikidataId: candidate.id,
        wikipedia: !!(entity?.sitelinks?.enwiki || entity?.sitelinks?.zhwiki),
        url: entityUrl,
      };
    }
    return null;
  } catch {
    return null;
  }
}

// TLD-specific RDAP servers — mirrors domain_intel.ts
const AUTHORITY_TLD_RDAP: Record<string, string> = {
  com: 'https://rdap.verisign.com/com/v1/domain',
  net: 'https://rdap.verisign.com/net/v1/domain',
  org: 'https://rdap.publicinterestregistry.org/rdap/domain',
  io:  'https://rdap.iana.org/domain',
  co:  'https://rdap.iana.org/domain',
  ai:  'https://rdap.iana.org/domain',
  uk:  'https://rdap.nominet.uk/uk/domain',
  de:  'https://rdap.denic.de/domain',
  fr:  'https://rdap.nic.fr/domain',
  nl:  'https://rdap.sidn.nl/domain',
  au:  'https://rdap.auda.org.au/domain',
  ca:  'https://rdap.cira.ca/domain',
  eu:  'https://rdap.eu/domain',
  app: 'https://rdap.nic.google/domain',
  dev: 'https://rdap.nic.google/domain',
  info:'https://rdap.afilias.net/rdap/domain',
  biz: 'https://rdap.nic.biz/domain',
};

async function fetchRdap(domain: string, fetcher: HttpFetcher, maxEndpoints: number): Promise<string | null> {
  const tld = domain.split('.').pop()?.toLowerCase() ?? '';
  type RdapBody = { events?: Array<{ eventAction: string; eventDate: string }> };

  const endpoints: string[] = [
    `https://rdap.org/domain/${domain}`,
    `https://rdap.iana.org/domain/${domain}`,
  ];
  if (AUTHORITY_TLD_RDAP[tld]) endpoints.push(`${AUTHORITY_TLD_RDAP[tld]}/${domain}`);

  for (const endpoint of endpoints.slice(0, maxEndpoints)) {
    try {
      const res = await fetcher(endpoint, { timeoutMs: 5000 });
      if (!res.ok) continue;
      const data = await res.json() as RdapBody;
      const reg = data.events?.find(e => e.eventAction === 'registration');
      if (reg?.eventDate) return reg.eventDate;
    } catch { /* try next */ }
  }
  return null;
}
