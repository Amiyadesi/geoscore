import { fetchWithTimeout } from '../lib/http';

export interface DomainIntelResult {
  registrar: string | null;
  expiry_date: string | null;
  days_until_expiry: number | null;
  dnssec: boolean;
  domain_status: string[];
  spf: string | null;
  dmarc: string | null;
  dkim_selectors_found: string[];
  email_security_score: number;
  issues: string[];
  caa: {
    present: boolean;
    issue: string[];
    issuewild: string[];
    iodef: string[];
  } | null;
}

async function dnsJson(name: string, type: string): Promise<Array<{ data: string }>> {
  try {
    const res = await fetchWithTimeout(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`,
      { timeoutMs: 5000, headers: { Accept: 'application/dns-json' } }
    );
    if (!res.ok) return [];
    const data = await res.json() as { Answer?: Array<{ data: string }> };
    return data.Answer ?? [];
  } catch {
    return [];
  }
}

async function dohTxt(name: string): Promise<string[]> {
  try {
    const res = await fetchWithTimeout(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=TXT`,
      { timeoutMs: 5000, headers: { Accept: 'application/dns-json' } }
    );
    if (!res.ok) return [];
    const data = await res.json() as { Answer?: Array<{ type: number; data: string }> };
    return (data.Answer ?? [])
      .filter(r => r.type === 16)
      .map(r => r.data.replace(/^"|"$/g, '').replace(/" "/g, ''));
  } catch {
    return [];
  }
}

interface RdapFull {
  registrar: string | null;
  expiry_date: string | null;
  days_until_expiry: number | null;
  dnssec: boolean;
  domain_status: string[];
}

// TLD-specific RDAP servers for common extensions — used as tertiary fallback
const TLD_RDAP: Record<string, string> = {
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
  page:'https://rdap.nic.google/domain',
  info:'https://rdap.afilias.net/rdap/domain',
  biz: 'https://rdap.nic.biz/domain',
};

function parseRdapResponse(data: {
  events?: Array<{ eventAction: string; eventDate: string }>;
  entities?: Array<{ roles?: string[]; vcardArray?: unknown }>;
  secureDNS?: { delegationSigned?: boolean; zoneSigned?: boolean };
  status?: string[];
}): RdapFull {
  const expEvent = data.events?.find(e => e.eventAction === 'expiration');
  const expiryDate = expEvent?.eventDate ?? null;
  const daysUntilExpiry = expiryDate
    ? Math.floor((new Date(expiryDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null;

  let registrar: string | null = null;
  for (const entity of data.entities ?? []) {
    if (entity.roles?.includes('registrar')) {
      const vcard = entity.vcardArray as [string, Array<[string, unknown, unknown, string]>] | undefined;
      if (Array.isArray(vcard) && Array.isArray(vcard[1])) {
        for (const field of vcard[1]) {
          if (Array.isArray(field) && field[0] === 'fn') {
            registrar = String(field[3]);
            break;
          }
        }
      }
      break;
    }
  }

  const dnssec = !!(data.secureDNS?.delegationSigned || data.secureDNS?.zoneSigned);
  const domainStatus = (data.status ?? []).map(s => s.toLowerCase());
  return { registrar, expiry_date: expiryDate, days_until_expiry: daysUntilExpiry, dnssec, domain_status: domainStatus };
}

async function fetchRdapFull(domain: string): Promise<RdapFull> {
  const empty: RdapFull = { registrar: null, expiry_date: null, days_until_expiry: null, dnssec: false, domain_status: [] };
  const tld = domain.split('.').pop()?.toLowerCase() ?? '';

  // Build endpoint list: rdap.org proxy → IANA → TLD-specific
  const endpoints: string[] = [
    `https://rdap.org/domain/${domain}`,
    `https://rdap.iana.org/domain/${domain}`,
  ];
  if (TLD_RDAP[tld]) endpoints.push(`${TLD_RDAP[tld]}/${domain}`);

  // Track the best result seen across all endpoints — more fields = higher score
  let best: RdapFull = empty;
  let bestScore = 0;

  for (const endpoint of endpoints) {
    try {
      const res = await fetchWithTimeout(endpoint, { timeoutMs: 7000 });
      if (!res.ok) continue;
      const data = await res.json() as Parameters<typeof parseRdapResponse>[0];
      const parsed = parseRdapResponse(data);
      const score =
        (parsed.expiry_date   ? 4 : 0) +
        (parsed.registrar     ? 3 : 0) +
        (parsed.dnssec        ? 1 : 0) +
        (parsed.domain_status.length > 0 ? 1 : 0);
      if (score > bestScore) {
        best = parsed;
        bestScore = score;
        // Short-circuit: we have the two most valuable fields
        if (parsed.expiry_date && parsed.registrar) break;
      }
    } catch { /* try next endpoint */ }
  }

  return best;
}

// Keep to 2 selectors — each costs 1 subrequest and we're near the CF Workers 50-req limit.
// 'google' covers Google Workspace; 'selector1' covers Microsoft 365 (Office 365).
const DKIM_SELECTORS = ['google', 'selector1'];

export async function runDomainIntel(domain: string): Promise<DomainIntelResult> {
  const issues: string[] = [];

  // Wrap each DNS lookup independently so a single failure doesn't null out all results.
  // dohTxt returns [] on network error, which is indistinguishable from "no record" —
  // track whether the lookup itself succeeded to avoid false "no SPF" warnings.
  const [rdap, spfResult, dmarcResult, caaRecords, ...dkimResults] = await Promise.all([
    fetchRdapFull(domain),
    dohTxt(domain).then(txts => ({ ok: true, txts })).catch(() => ({ ok: false, txts: [] as string[] })),
    dohTxt(`_dmarc.${domain}`).then(txts => ({ ok: true, txts })).catch(() => ({ ok: false, txts: [] as string[] })),
    dnsJson(domain, 'CAA').catch(() => [] as Array<{ data: string }>),
    ...DKIM_SELECTORS.map(sel =>
      dohTxt(`${sel}._domainkey.${domain}`).then(txts => ({
        sel,
        found: txts.some(t => t.includes('v=DKIM1')),
        ok: true,
      })).catch(() => ({ sel, found: false, ok: false }))
    ),
  ]);
  const spfTxts = (spfResult as { ok: boolean; txts: string[] }).txts;
  const spfLookupOk = (spfResult as { ok: boolean }).ok;
  const dmarcTxts = (dmarcResult as { ok: boolean; txts: string[] }).txts;
  const dmarcLookupOk = (dmarcResult as { ok: boolean }).ok;

  const spfRecord = spfTxts.find(t => t.startsWith('v=spf1')) ?? null;
  const dmarcRecord = dmarcTxts.find(t => t.startsWith('v=DMARC1')) ?? null;
  const dkimSelectorsFound = (dkimResults as Array<{ sel: string; found: boolean; ok: boolean }>)
    .filter(c => c.found).map(c => c.sel);

  // ── CAA record parsing ────────────────────────────────────────────────────
  // Each CAA record data field format: "0 issue \"ca.example.com\""
  const caaIssue: string[] = [];
  const caaIssuewild: string[] = [];
  const caaIodef: string[] = [];
  for (const rec of (caaRecords as Array<{ data: string }>)) {
    // e.g. data = '0 issue "letsencrypt.org"' or '0 issuewild ";"'
    const m = rec.data.match(/^\d+\s+(issue|issuewild|iodef)\s+"?([^"]*)"?/i);
    if (!m) continue;
    const tag = m[1].toLowerCase();
    const value = m[2].trim();
    if (tag === 'issue') caaIssue.push(value);
    else if (tag === 'issuewild') caaIssuewild.push(value);
    else if (tag === 'iodef') caaIodef.push(value);
  }
  const caaPresent = caaIssue.length > 0 || caaIssuewild.length > 0 || caaIodef.length > 0;
  const caa: DomainIntelResult['caa'] = caaPresent
    ? { present: true, issue: caaIssue, issuewild: caaIssuewild, iodef: caaIodef }
    : null;

  let emailScore = 0;
  if (spfRecord) emailScore += 34;
  if (dmarcRecord) emailScore += 33;
  if (dkimSelectorsFound.length > 0) emailScore += 33;

  // SPF/DMARC/DKIM missing findings are surfaced by the Email & Ads Security card and the
  // Off-Page SEO email-infrastructure grid — emitting them here too creates duplicate bullets.
  // Domain Intel issues are reserved for registrar/expiry/DNSSEC concerns only.
  const dkimLookupOk = (dkimResults as Array<{ ok: boolean }>).some(c => c.ok);
  if (dkimLookupOk && dkimSelectorsFound.length === 0) issues.push('No DKIM found on common selectors (checked Google Workspace & Microsoft 365 selectors — other providers may use different selectors)');
  if (rdap.days_until_expiry !== null && rdap.days_until_expiry < 60)
    issues.push(`Domain expires in ${rdap.days_until_expiry} days — renew soon`);
  if (!rdap.dnssec) issues.push('DNSSEC not enabled');
  if (!caaPresent) issues.push('No CAA records — any Certificate Authority can issue certificates for this domain');

  return {
    ...rdap,
    spf: spfRecord,
    dmarc: dmarcRecord,
    dkim_selectors_found: dkimSelectorsFound,
    email_security_score: emailScore,
    issues,
    caa,
  };
}
