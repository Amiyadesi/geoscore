import { getDomain } from 'tldts';
import { isValidPublicHostname } from './security';

export function registrableRoot(hostname: string): string | null {
  const normalized = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!isValidPublicHostname(normalized)) return null;
  return getDomain(normalized, { allowPrivateDomains: false }) ?? null;
}
