import { fetchWithTimeout } from '../lib/http';

export interface SslCertResult {
  issuer: string;
  valid_from: string;
  valid_to: string;
  days_remaining: number | null;
  is_valid: boolean;
  is_expiring_soon: boolean;
  issues: string[];
}

interface CrtShEntry {
  not_before: string;
  not_after: string;
  issuer_name: string;
  name_value: string;
}

interface CertSpotterEntry {
  not_before: string;
  not_after: string;
  dns_names: string[];
  issuer?: { name?: string; organization?: string };
}

function normName(n: string): string {
  return n.replace(/^dns:/i, '').trim().toLowerCase();
}

function domainMatchesCert(domain: string, names: string[]): boolean {
  const apex = domain.replace(/^www\./, '').toLowerCase();
  const d = domain.toLowerCase();
  return names.some(n => {
    const clean = normName(n);
    return clean === d || clean === apex || clean === `*.${apex}` ||
      (clean.startsWith('*.') && d.endsWith(clean.slice(1)));
  });
}

function buildResult(
  issuer: string, not_before: string, not_after: string,
  extraIssues: string[] = [],
): SslCertResult {
  const now = new Date();
  const expiry = new Date(not_after);
  const issued = new Date(not_before);
  const daysRemaining = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  const isExpiringSoon = daysRemaining <= 30;
  const issues: string[] = [...extraIssues];
  if (isExpiringSoon) issues.push(`SSL certificate expires in ${daysRemaining} day${daysRemaining !== 1 ? 's' : ''} — renew immediately`);
  else if (daysRemaining <= 90) issues.push(`SSL certificate expires in ${daysRemaining} days — schedule renewal soon`);
  return {
    issuer,
    valid_from: issued.toISOString().slice(0, 10),
    valid_to: expiry.toISOString().slice(0, 10),
    days_remaining: daysRemaining,
    is_valid: true,
    is_expiring_soon: isExpiringSoon,
    issues,
  };
}

/** Source 1: CertSpotter — fast (~1-2s), no key required, 100 req/hour */
async function tryCertSpotter(domain: string): Promise<SslCertResult | null> {
  try {
    const apex = domain.replace(/^www\./, '');
    const res = await fetchWithTimeout(
      `https://api.certspotter.com/v1/issuances?domain=${encodeURIComponent(apex)}&include_subdomains=false&expand=dns_names,issuer&limit=10`,
      { timeoutMs: 6000 },
    );
    if (!res.ok) return null;
    const certs = await res.json() as CertSpotterEntry[];
    if (!Array.isArray(certs) || certs.length === 0) return null;

    const now = new Date();
    const valid = certs
      .filter(c => new Date(c.not_after) > now && domainMatchesCert(domain, c.dns_names ?? []))
      .sort((a, b) => new Date(b.not_before).getTime() - new Date(a.not_before).getTime());

    if (valid.length === 0) return null;
    const cert = valid[0];
    const issuer = cert.issuer?.name ?? cert.issuer?.organization ?? 'Unknown';
    return buildResult(issuer, cert.not_before, cert.not_after);
  } catch {
    return null;
  }
}

/** Source 2: crt.sh — comprehensive but slow from EU Cloudflare edge */
async function tryCrtSh(domain: string): Promise<SslCertResult | null> {
  try {
    const apex = domain.replace(/^www\./, '');
    const res = await fetchWithTimeout(
      `https://crt.sh/?q=${encodeURIComponent(apex)}&output=json`,
      { timeoutMs: 8000 },
    );
    if (!res.ok) return null;
    const certs = await res.json() as CrtShEntry[];
    if (!Array.isArray(certs) || certs.length === 0) return null;

    const now = new Date();
    const valid = certs
      .filter(c => {
        if (new Date(c.not_after) <= now) return false;
        const names = c.name_value.split(/[\n,]/).map(normName);
        return domainMatchesCert(domain, names);
      })
      .sort((a, b) => new Date(b.not_before).getTime() - new Date(a.not_before).getTime());

    if (valid.length === 0) return null;
    const cert = valid[0];
    const cnMatch = cert.issuer_name.match(/CN=([^,\n]+)/);
    const orgMatch = cert.issuer_name.match(/O=([^,\n]+)/);
    const issuer = (cnMatch?.[1] ?? orgMatch?.[1] ?? 'Unknown').replace(/['"]/g, '').trim();
    return buildResult(issuer, cert.not_before, cert.not_after);
  } catch {
    return null;
  }
}

export async function runSslCert(domain: string): Promise<SslCertResult> {
  // Run probe, CertSpotter, and crt.sh all in parallel — take the first valid cert result.
  // Previously CertSpotter then crt.sh ran sequentially (up to 6+8=14s worst case);
  // parallel means worst case is max(6, 8) = 8s for the cert sources.
  const [probeResult, certSpotterResult, crtShResult] = await Promise.allSettled([
    fetchWithTimeout(`https://${domain}/`, { timeoutMs: 5000, method: 'HEAD', redirect: 'follow' }),
    tryCertSpotter(domain),
    tryCrtSh(domain),
  ]);

  const httpsReachable = probeResult.status === 'fulfilled';
  const certSpotter = certSpotterResult.status === 'fulfilled' ? certSpotterResult.value : null;
  const crtSh = crtShResult.status === 'fulfilled' ? crtShResult.value : null;

  // Use whichever source returned a valid cert (prefer CertSpotter — usually faster)
  if (certSpotter) return certSpotter;
  if (crtSh) return crtSh;

  // Both cert sources failed — use HTTPS probe for validity, flag details as unavailable.
  if (httpsReachable) {
    return {
      issuer: 'Verified (details unavailable)',
      valid_from: '',
      valid_to: '',
      days_remaining: null,
      is_valid: true,
      is_expiring_soon: false,
      issues: [],
    };
  }

  // Both cert APIs AND HTTPS probe failed.
  // A network timeout does NOT prove the cert is invalid — it may mean the site
  // blocks Cloudflare Worker IPs, or the probe timed out.
  // Return "valid but unverified" rather than falsely marking the cert as broken.
  return {
    issuer: 'Unverified',
    valid_from: '',
    valid_to: '',
    days_remaining: null,
    is_valid: true,
    is_expiring_soon: false,
    issues: ['SSL could not be verified — site may block automated checks'],
  };
}
