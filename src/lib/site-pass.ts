import type { Env } from './types';

export const DEFAULT_SITE_PASS_STATUS_URL = 'https://pay.geo.sayori.org';

export interface SitePassStatus {
  active: boolean;
  domain: string;
  owner?: boolean;
  expires_at?: number;
  reruns_remaining?: number | string;
}

function statusBase(env: Pick<Env, 'SITE_PASS_STATUS_URL'>): string {
  const configured = String(env.SITE_PASS_STATUS_URL || '').trim().replace(/\/$/, '');
  if (/^https:\/\/[a-z0-9.-]+$/i.test(configured)) return configured;
  return DEFAULT_SITE_PASS_STATUS_URL;
}

export function normalizePassDomain(value: string | null | undefined): string {
  return String(value || '')
    .trim()
    .replace(/^www\./i, '')
    .toLowerCase();
}

export async function fetchSitePassStatus(
  env: Pick<Env, 'SITE_PASS_STATUS_URL'>,
  domain: string,
): Promise<SitePassStatus> {
  const normalized = normalizePassDomain(domain);
  if (!normalized) return { active: false, domain: '' };
  try {
    const response = await fetch(
      `${statusBase(env)}/api/site-pass?domain=${encodeURIComponent(normalized)}`,
      {
        method: 'GET',
        headers: { accept: 'application/json' },
      },
    );
    if (!response.ok) return { active: false, domain: normalized };
    const payload = await response.json().catch(() => null) as Partial<SitePassStatus> | null;
    return {
      active: Boolean(payload?.active),
      domain: normalized,
      owner: Boolean(payload?.owner),
      expires_at: typeof payload?.expires_at === 'number' ? payload.expires_at : undefined,
      reruns_remaining: payload?.reruns_remaining,
    };
  } catch {
    return { active: false, domain: normalized };
  }
}

export async function hasActiveSitePass(
  env: Pick<Env, 'SITE_PASS_STATUS_URL'>,
  domain: string,
): Promise<boolean> {
  const status = await fetchSitePassStatus(env, domain);
  return status.active === true;
}
