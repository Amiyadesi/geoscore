import type { ModuleResult } from './types';
import { visiblePageText } from './audit-html';

export const AUDIT_CHECKPOINT_VERSION = 1 as const;
export const AUDIT_CHECKPOINT_TTL_SECONDS = 30 * 60;

export interface AuditCheckpointScope {
  domain: string;
  mode: 'site' | 'url';
  target_url: string;
  archetype_hint: string | null;
  score_version: string;
}

export interface AuditPageFingerprint {
  url: string;
  final_url: string;
  status: 'complete' | 'error';
  status_code: number;
  html_length: number;
  fingerprint: string;
}

export interface CheckpointPageInput {
  url: string;
  final_url: string;
  status: 'complete' | 'error';
  status_code: number;
  html: string;
}

export interface AuditCheckpoint {
  version: typeof AUDIT_CHECKPOINT_VERSION;
  scope: AuditCheckpointScope;
  audit_id: string;
  business_id: number;
  pages: AuditPageFingerprint[];
  modules: Record<string, ModuleResult>;
  created_at: number;
  updated_at: number;
  expires_at: number;
}

function stripVolatileAttributes(markup: string): string {
  return markup
    .replace(/\s(?:class|id|style|nonce|integrity|value|data-[\w:-]+)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(\s(?:href|src)\s*=\s*["'][^"']*)#[^"']*(["'])/gi, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
}

function stableHeadMarkup(html: string): string {
  const head = html.match(/<head\b[^>]*>[\s\S]*?<\/head\s*>/i)?.[0] ?? html.slice(0, 128 * 1024);
  return head
    .replace(/<!--[^]*?-->/g, ' ')
    .replace(/<(?:style|noscript|template|svg)\b[^>]*>[\s\S]*?<\/(?:style|noscript|template|svg)>/gi, ' ')
    .replace(/<meta\b[^>]*>/gi, tag => {
      const key = tag.match(/\b(?:name|property)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
      const name = (key?.[1] ?? key?.[2] ?? key?.[3] ?? '').toLowerCase();
      return /^(?:request-id|html-safe-nonce|csrf-token|visitor-(?:payload|hmac)|octolytics-)/.test(name)
        ? ' '
        : stripVolatileAttributes(tag);
    })
    .replace(/<script\b([^>]*)>[\s\S]*?<\/script\s*>/gi, (script, attributes: string) => {
      if (/\btype\s*=\s*(?:"application\/ld\+json"|'application\/ld\+json'|application\/ld\+json\b)/i.test(attributes)) {
        return stripVolatileAttributes(script);
      }
      return `<script ${stripVolatileAttributes(attributes)}></script>`;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

function semanticPageEvidence(html: string): string {
  const structure = [...html.matchAll(/<(?:h[1-6]|main|article|section|nav|a|img|form|input|label|button|table|video|iframe)\b[^>]*>/gi)]
    .map(match => stripVolatileAttributes(match[0]))
    .join(' ');
  return `${stableHeadMarkup(html)}\n${structure}\n${visiblePageText(html)}`;
}

/** Reject stale evidence while ignoring request IDs, nonces, and styling-only churn. */
async function fingerprintHtml(html: string): Promise<string> {
  const evidence = semanticPageEvidence(html);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(evidence));
  return Array.from(new Uint8Array(digest).slice(0, 16), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function fingerprintAuditPage(page: CheckpointPageInput): Promise<AuditPageFingerprint> {
  return {
    url: page.url,
    final_url: page.final_url,
    status: page.status,
    status_code: page.status_code,
    html_length: page.html.length,
    fingerprint: await fingerprintHtml(page.html),
  };
}

export function fingerprintAuditPages(pages: CheckpointPageInput[]): Promise<AuditPageFingerprint[]> {
  return Promise.all(pages.map(fingerprintAuditPage));
}

export function checkpointMatchesPageFingerprints(
  checkpoint: AuditCheckpoint,
  current: AuditPageFingerprint[],
): boolean {
  if (!Array.isArray(checkpoint.pages)) return false;
  if (current.length !== checkpoint.pages.length) return false;
  return current.every((page, index) => {
    const previous = checkpoint.pages[index];
    return previous?.url === page.url
      && previous.final_url === page.final_url
      && previous.status === page.status
      && previous.status_code === page.status_code
      && previous.fingerprint === page.fingerprint;
  });
}

export async function checkpointMatchesPages(
  checkpoint: AuditCheckpoint,
  pages: CheckpointPageInput[],
): Promise<boolean> {
  return checkpointMatchesPageFingerprints(checkpoint, await fingerprintAuditPages(pages));
}

export function checkpointMatchesScope(
  checkpoint: AuditCheckpoint | null,
  scope: AuditCheckpointScope,
  now = Date.now(),
): checkpoint is AuditCheckpoint {
  if (!checkpoint || checkpoint.version !== AUDIT_CHECKPOINT_VERSION) return false;
  if (!Number.isFinite(checkpoint.expires_at)) return false;
  if (checkpoint.expires_at <= now) return false;
  if (!checkpoint.scope || typeof checkpoint.scope !== 'object') return false;
  if (!checkpoint.modules || typeof checkpoint.modules !== 'object' || Array.isArray(checkpoint.modules)) return false;
  return checkpoint.scope.domain === scope.domain
    && checkpoint.scope.mode === scope.mode
    && checkpoint.scope.target_url === scope.target_url
    && checkpoint.scope.archetype_hint === scope.archetype_hint
    && checkpoint.scope.score_version === scope.score_version;
}

export async function isReusableCheckpoint(
  checkpoint: AuditCheckpoint | null,
  scope: AuditCheckpointScope,
  pages: CheckpointPageInput[],
  now = Date.now(),
): Promise<boolean> {
  if (!checkpointMatchesScope(checkpoint, scope, now)) return false;
  return checkpointMatchesPages(checkpoint, pages);
}

export function isReusableModule(result: ModuleResult | undefined): boolean {
  if (result?.status === 'ok') return true;
  if (result?.status !== 'partial' || result.error) return false;
  const evidenceStatus = result.data && typeof result.data === 'object'
    ? (result.data as { status?: unknown }).status
    : null;
  return evidenceStatus !== 'error';
}

const PAGE_INDEPENDENT_MODULES = new Set(['authority', 'crux', 'common_crawl']);

export function canReuseCheckpointModule(
  moduleName: string,
  result: ModuleResult | undefined,
  pagesMatch: boolean,
): boolean {
  if (!isReusableModule(result)) return false;
  return pagesMatch || PAGE_INDEPENDENT_MODULES.has(moduleName);
}

export function buildAuditCheckpoint(
  scope: AuditCheckpointScope,
  auditId: string,
  businessId: number,
  pages: AuditPageFingerprint[],
  modules: Record<string, ModuleResult>,
  now = Date.now(),
): AuditCheckpoint {
  return {
    version: AUDIT_CHECKPOINT_VERSION,
    scope,
    audit_id: auditId,
    business_id: businessId,
    pages,
    modules,
    created_at: now,
    updated_at: now,
    expires_at: now + AUDIT_CHECKPOINT_TTL_SECONDS * 1000,
  };
}
