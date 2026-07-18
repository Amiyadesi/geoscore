import { challengeReason, detectJavaScriptShell, pageLocale, titleFromHtml } from './audit-html';
import { isRetryableHttpStatus } from './http';
import { cancelResponseBody, readBoundedText, ResponseTooLargeError } from './response-body';
import { registrableRoot } from './domain';
import type { SubrequestBudgetLike } from './subrequest-budget';
import type { AuditPageCandidate, FetchedAuditPage } from './audit-pages';
import type { BrowserRunBinding, BrowserRunContentRequest, BrowserRunResourceType } from './types';

const MAX_AUDIT_HTML_BYTES = 2 * 1024 * 1024;
const MAX_BROWSER_ENVELOPE_BYTES = MAX_AUDIT_HTML_BYTES + 256 * 1024;
const BROWSER_RUN_RESERVED_SECONDS = 20;
const BROWSER_RUN_FREE_SECONDS = 600;
const BROWSER_RUN_HEADROOM_SECONDS = 60;
const DEFAULT_BROWSER_DAILY_BUDGET_SECONDS = BROWSER_RUN_FREE_SECONDS - BROWSER_RUN_HEADROOM_SECONDS;
const BROWSER_RUN_SETTLE_MS = 1500;
const BROWSER_RUN_CAPTURE_TIMEOUT_MS = 2000;

export const BROWSER_RUN_PROVIDER = 'Cloudflare Browser Run' as const;
export const BROWSER_RUN_SOURCE = 'browser_binding_quick_action' as const;

const BROWSER_REJECTED_RESOURCE_TYPES: BrowserRunResourceType[] = [
  'image',
  'media',
  'font',
  'websocket',
  'eventsource',
  'ping',
  'prefetch',
];

export interface BrowserRunFallbackError {
  code: string;
  message: string;
  retryable: boolean;
  upstream_code?: string;
  target_status?: number;
}

export interface BrowserRunFallbackEvidence {
  status: 'complete' | 'error' | 'skipped';
  provider: typeof BROWSER_RUN_PROVIDER;
  source: typeof BROWSER_RUN_SOURCE;
  reason: string;
  reserved_seconds: number;
  browser_ms_used?: number;
  error?: BrowserRunFallbackError;
}

export interface BrowserRunAttemptState {
  attempted: boolean;
}

export interface BrowserRunFallbackOptions {
  binding?: BrowserRunBinding;
  budgetKv?: KVNamespace;
  dailyBudgetSeconds?: string | number;
  subrequestBudget?: SubrequestBudgetLike;
  attemptState?: BrowserRunAttemptState;
  /** Test hook. Production calls are always capped at 20 seconds. */
  attemptTimeoutMs?: number;
  /** Test hook for the UTC budget key. */
  now?: number;
}

interface BrowserRunEnvelope {
  success?: boolean;
  result?: string;
  meta?: {
    status?: number;
    title?: string;
  };
  errors?: Array<{
    code?: number | string;
    message?: string;
  }>;
}

class BrowserRunAttemptTimeout extends Error {
  constructor() {
    super('Cloudflare Browser Run exceeded the 20-second attempt limit');
    this.name = 'BrowserRunAttemptTimeout';
  }
}

function clampBrowserDailyBudget(value: string | number | undefined): number {
  if (value === undefined || value === '') return DEFAULT_BROWSER_DAILY_BUDGET_SECONDS;
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed)) return DEFAULT_BROWSER_DAILY_BUDGET_SECONDS;
  return Math.max(0, Math.min(DEFAULT_BROWSER_DAILY_BUDGET_SECONDS, parsed));
}

function browserBudgetKey(now = Date.now()): string {
  return `browser:${new Date(now).toISOString().slice(0, 10)}`;
}

type BrowserBudgetReservation =
  | { status: 'reserved'; key: string }
  | { status: 'exhausted'; key: string }
  | { status: 'unavailable'; key: string; message: string };

async function reserveBrowserBudget(options: BrowserRunFallbackOptions): Promise<BrowserBudgetReservation> {
  const key = browserBudgetKey(options.now);
  if (!options.budgetKv) {
    return { status: 'unavailable', key, message: 'Browser Run daily budget storage is unavailable' };
  }

  const limit = clampBrowserDailyBudget(options.dailyBudgetSeconds);
  try {
    const raw = await options.budgetKv.get(key);
    const used = raw === null ? 0 : Number(raw);
    if (!Number.isFinite(used) || used < 0) {
      return { status: 'unavailable', key, message: 'Browser Run daily budget counter is invalid' };
    }
    if (used + BROWSER_RUN_RESERVED_SECONDS > limit) return { status: 'exhausted', key };

    // KV is eventually consistent, so each attempt conservatively reserves the full
    // 20-second maximum. The 60-second free-tier headroom covers three concurrent races.
    await options.budgetKv.put(key, String(Math.floor(used) + BROWSER_RUN_RESERVED_SECONDS), {
      expirationTtl: 60 * 60 * 48,
    });
    return { status: 'reserved', key };
  } catch (error) {
    return {
      status: 'unavailable',
      key,
      message: error instanceof Error ? error.message : 'Browser Run daily budget could not be reserved',
    };
  }
}

export function buildBrowserAllowRequestPattern(root: string): string[] {
  const normalizedRoot = registrableRoot(root);
  if (!normalizedRoot) return [];
  const escaped = normalizedRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [`^https?:\\/\\/(?:[a-z0-9-]+\\.)*${escaped}(?::(?:80|443))?(?:[\\/?#]|$)`];
}

function sanitizeBrowserMessage(value: unknown): string {
  return String(value ?? 'Cloudflare Browser Run failed')
    .replace(/((?:api[-_ ]?key|token|authorization))\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

function browserError(
  code: string,
  message: string,
  retryable: boolean,
  upstreamCode?: string,
  targetStatus?: number,
): BrowserRunFallbackError {
  return {
    code,
    message: sanitizeBrowserMessage(message),
    retryable,
    ...(upstreamCode ? { upstream_code: upstreamCode } : {}),
    ...(targetStatus === undefined ? {} : { target_status: targetStatus }),
  };
}

function skippedBrowserFallback(
  reason: string,
  error: BrowserRunFallbackError,
): BrowserRunFallbackEvidence {
  return {
    status: 'skipped',
    provider: BROWSER_RUN_PROVIDER,
    source: BROWSER_RUN_SOURCE,
    reason,
    reserved_seconds: 0,
    error,
  };
}

function failedBrowserFallback(
  reason: string,
  error: BrowserRunFallbackError,
  measuredBrowserMs?: number,
): BrowserRunFallbackEvidence {
  return {
    status: 'error',
    provider: BROWSER_RUN_PROVIDER,
    source: BROWSER_RUN_SOURCE,
    reason,
    reserved_seconds: BROWSER_RUN_RESERVED_SECONDS,
    ...(measuredBrowserMs === undefined ? {} : { browser_ms_used: measuredBrowserMs }),
    error,
  };
}

function browserMsUsed(response: Response): number | undefined {
  const raw = response.headers.get('X-Browser-Ms-Used');
  if (raw === null || raw.trim() === '') return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : undefined;
}

function upstreamEnvelopeError(envelope: BrowserRunEnvelope): BrowserRunFallbackError {
  const upstream = envelope.errors?.[0];
  const upstreamCode = upstream?.code === undefined ? undefined : String(upstream.code);
  const message = upstream?.message || 'Cloudflare Browser Run returned an unsuccessful response';
  if (upstreamCode === '6002') {
    return browserError('BROWSER_RUN_TIMEOUT', message, true, upstreamCode);
  }
  if (upstreamCode === '429') {
    return browserError('BROWSER_RUN_RATE_LIMITED', message, true, upstreamCode);
  }
  return browserError('BROWSER_RUN_UPSTREAM_ERROR', message, true, upstreamCode);
}

function providerHttpError(response: Response, envelope?: BrowserRunEnvelope): BrowserRunFallbackError {
  const upstream = envelope?.errors?.[0];
  const upstreamCode = upstream?.code === undefined ? undefined : String(upstream.code);
  const message = upstream?.message || `Cloudflare Browser Run returned HTTP ${response.status}`;
  if (response.status === 408 || response.status === 504 || upstreamCode === '6002') {
    return browserError('BROWSER_RUN_TIMEOUT', message, true, upstreamCode);
  }
  if (response.status === 429) {
    return browserError('BROWSER_RUN_RATE_LIMITED', message, true, upstreamCode);
  }
  return browserError('BROWSER_RUN_UPSTREAM_ERROR', message, response.status >= 500, upstreamCode);
}

async function quickActionWithTimeout(
  binding: BrowserRunBinding,
  request: BrowserRunContentRequest,
  timeoutMs: number,
): Promise<Response> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      binding.quickAction('content', request),
      new Promise<Response>((_resolve, reject) => {
        timer = setTimeout(() => reject(new BrowserRunAttemptTimeout()), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

interface BrowserRunAttemptResult {
  page?: FetchedAuditPage;
  evidence: BrowserRunFallbackEvidence;
}

function browserRunTiming(totalMs: number): {
  navigationTimeoutMs: number;
  settleMs: number;
  captureTimeoutMs: number;
} {
  const settleMs = totalMs > BROWSER_RUN_SETTLE_MS + 2 ? BROWSER_RUN_SETTLE_MS : 0;
  const captureTimeoutMs = Math.max(
    1,
    Math.min(BROWSER_RUN_CAPTURE_TIMEOUT_MS, totalMs - settleMs - 1),
  );
  return {
    navigationTimeoutMs: Math.max(1, totalMs - settleMs - captureTimeoutMs),
    settleMs,
    captureTimeoutMs,
  };
}

export async function attemptBrowserRun(
  candidate: AuditPageCandidate,
  reason: string,
  options: BrowserRunFallbackOptions,
  overallStarted: number,
): Promise<BrowserRunAttemptResult> {
  if (!options.binding) {
    return {
      evidence: skippedBrowserFallback(
        reason,
        browserError('BROWSER_RUN_UNAVAILABLE', 'Cloudflare Browser Run binding is not configured', false),
      ),
    };
  }
  if (options.attemptState?.attempted) {
    return {
      evidence: skippedBrowserFallback(
        reason,
        browserError('BROWSER_RUN_UNAVAILABLE', 'Browser Run was already attempted for this audit', false),
      ),
    };
  }

  const target = new URL(candidate.url);
  const root = registrableRoot(target.hostname);
  const allowRequestPattern = root ? buildBrowserAllowRequestPattern(root) : [];
  if (target.username || target.password || target.port || !root || allowRequestPattern.length === 0) {
    return {
      evidence: skippedBrowserFallback(
        reason,
        browserError('BROWSER_RUN_UNAVAILABLE', 'Browser Run target is not a valid public registrable domain', false),
      ),
    };
  }

  try {
    options.subrequestBudget?.consume('browser-run:content');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Browser Run subrequest budget is exhausted';
    return {
      evidence: skippedBrowserFallback(
        reason,
        browserError('BROWSER_RUN_SUBREQUEST_BUDGET_EXCEEDED', message, true),
      ),
    };
  }

  const reservation = await reserveBrowserBudget(options);
  if (reservation.status === 'exhausted') {
    return {
      evidence: skippedBrowserFallback(
        reason,
        browserError('BROWSER_RUN_BUDGET_EXHAUSTED', 'Cloudflare Browser Run daily budget is exhausted', true),
      ),
    };
  }
  if (reservation.status === 'unavailable') {
    return {
      evidence: skippedBrowserFallback(
        reason,
        browserError('BROWSER_RUN_BUDGET_UNAVAILABLE', reservation.message, true),
      ),
    };
  }

  if (options.attemptState) options.attemptState.attempted = true;
  const timeoutMs = Math.max(1, Math.min(20_000, Math.floor(options.attemptTimeoutMs ?? 20_000)));
  const timing = browserRunTiming(timeoutMs);
  const request: BrowserRunContentRequest = {
    url: candidate.url,
    actionTimeout: timing.captureTimeoutMs,
    ...(timing.settleMs > 0 ? { waitForTimeout: timing.settleMs } : {}),
    allowRequestPattern,
    rejectResourceTypes: BROWSER_REJECTED_RESOURCE_TYPES,
    gotoOptions: {
      timeout: timing.navigationTimeoutMs,
      waitUntil: 'load',
    },
  };

  let response: Response;
  try {
    response = await quickActionWithTimeout(options.binding, request, timeoutMs);
  } catch (error) {
    const timedOut = error instanceof BrowserRunAttemptTimeout
      || (error instanceof Error && /timed?\s*out|timeout/i.test(error.message));
    return {
      evidence: failedBrowserFallback(
        reason,
        browserError(
          timedOut ? 'BROWSER_RUN_TIMEOUT' : 'BROWSER_RUN_UPSTREAM_ERROR',
          error instanceof Error ? error.message : 'Cloudflare Browser Run request failed',
          true,
        ),
      ),
    };
  }

  const measuredBrowserMs = browserMsUsed(response);
  let rawEnvelope: string;
  try {
    rawEnvelope = await readBoundedText(response, MAX_BROWSER_ENVELOPE_BYTES, 'Browser Run response');
  } catch (error) {
    return {
      evidence: failedBrowserFallback(
        reason,
        browserError(
          error instanceof ResponseTooLargeError ? 'BROWSER_RUN_RESPONSE_TOO_LARGE' : 'BROWSER_RUN_UPSTREAM_ERROR',
          error instanceof Error ? error.message : 'Cloudflare Browser Run response could not be read',
          true,
        ),
        measuredBrowserMs,
      ),
    };
  }

  let envelope: BrowserRunEnvelope;
  try {
    const parsed = JSON.parse(rawEnvelope) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid envelope');
    envelope = parsed as BrowserRunEnvelope;
  } catch {
    if (!response.ok) {
      return {
        evidence: failedBrowserFallback(reason, providerHttpError(response), measuredBrowserMs),
      };
    }
    return {
      evidence: failedBrowserFallback(
        reason,
        browserError('BROWSER_RUN_INVALID_RESPONSE', 'Cloudflare Browser Run returned malformed JSON', true),
        measuredBrowserMs,
      ),
    };
  }

  if (!response.ok) {
    return {
      evidence: failedBrowserFallback(reason, providerHttpError(response, envelope), measuredBrowserMs),
    };
  }
  if (envelope.success !== true) {
    return {
      evidence: failedBrowserFallback(reason, upstreamEnvelopeError(envelope), measuredBrowserMs),
    };
  }
  if (typeof envelope.result !== 'string') {
    return {
      evidence: failedBrowserFallback(
        reason,
        browserError('BROWSER_RUN_INVALID_RESPONSE', 'Cloudflare Browser Run response did not contain HTML content', true),
        measuredBrowserMs,
      ),
    };
  }

  const html = envelope.result;
  if (!html.trim()) {
    return {
      evidence: failedBrowserFallback(
        reason,
        browserError('BROWSER_RUN_EMPTY_CONTENT', 'Cloudflare Browser Run returned empty HTML content', true),
        measuredBrowserMs,
      ),
    };
  }
  if (new TextEncoder().encode(html).byteLength > MAX_AUDIT_HTML_BYTES) {
    return {
      evidence: failedBrowserFallback(
        reason,
        browserError('BROWSER_RUN_RESPONSE_TOO_LARGE', 'Rendered HTML exceeds the 2048 KB response limit', false),
        measuredBrowserMs,
      ),
    };
  }

  const renderedStatus = Number(envelope.meta?.status);
  const statusCode = Number.isFinite(renderedStatus) && renderedStatus > 0 ? renderedStatus : 200;
  const renderedChallenge = challengeReason(html, candidate.url, statusCode);
  if (renderedChallenge) {
    return {
      evidence: failedBrowserFallback(
        reason,
        browserError('BROWSER_RUN_BOT_CHALLENGE', renderedChallenge, true),
        measuredBrowserMs,
      ),
    };
  }
  if (statusCode >= 400) {
    return {
      evidence: failedBrowserFallback(
        reason,
        browserError(
          'BROWSER_RUN_TARGET_HTTP_ERROR',
          `Rendered target returned HTTP ${statusCode}`,
          isRetryableHttpStatus(statusCode),
          undefined,
          statusCode,
        ),
        measuredBrowserMs,
      ),
    };
  }
  if (detectJavaScriptShell(html)) {
    return {
      evidence: failedBrowserFallback(
        reason,
        browserError('BROWSER_RUN_JS_SHELL', 'Browser Run still returned a JavaScript shell without extractable content', true),
        measuredBrowserMs,
      ),
    };
  }

  const evidence: BrowserRunFallbackEvidence = {
    status: 'complete',
    provider: BROWSER_RUN_PROVIDER,
    source: BROWSER_RUN_SOURCE,
    reason,
    reserved_seconds: BROWSER_RUN_RESERVED_SECONDS,
    ...(measuredBrowserMs === undefined ? {} : { browser_ms_used: measuredBrowserMs }),
  };
  return {
    evidence,
    page: {
      ...candidate,
      status: 'complete',
      title: titleFromHtml(html) ?? envelope.meta?.title,
      locale: pageLocale(html),
      html,
      // Quick Action response headers describe the Browser Run API response, not
      // the target page. Keep target header evidence unknown instead of fabricating it.
      headers: new Headers(),
      response_ms: Date.now() - overallStarted,
      status_code: statusCode,
      final_url: candidate.url,
      fetch_source: 'browser_run',
      provider: BROWSER_RUN_PROVIDER,
      fallback_reason: reason,
      ...(measuredBrowserMs === undefined ? {} : { browser_ms_used: measuredBrowserMs }),
      browser_fallback: evidence,
    },
  };
}
