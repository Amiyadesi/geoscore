import { fetchWithTimeout, isValidHttpUrl } from '../lib/http';

const W3C_ENDPOINT = 'https://validator.w3.org/nu/';
const W3C_DOCUMENTATION = 'https://github.com/validator/validator/wiki/Output-%C2%BB-JSON';
const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_MAX_MESSAGES = 25;
const MAX_RESPONSE_BYTES = 500 * 1024;

type CheckStatus = 'pass' | 'fail' | 'unknown' | 'error';
type EvidenceFetcher = (
  url: string,
  init?: RequestInit & { timeoutMs?: number },
) => Promise<Response>;

interface W3cMessageBody {
  type?: unknown;
  subType?: unknown;
  subtype?: unknown;
  message?: unknown;
  extract?: unknown;
  firstLine?: unknown;
  firstColumn?: unknown;
  lastLine?: unknown;
  lastColumn?: unknown;
}

export interface HtmlValidationMessage {
  type: 'error' | 'warning' | 'info' | 'non-document-error';
  subtype: string | null;
  message: string;
  line: number | null;
  column: number | null;
  extract: string | null;
}

export interface HtmlValidationResult {
  id: 'seo.html_conformance';
  category: 'seo';
  title: 'HTML conformance';
  status: CheckStatus;
  weight: number;
  confidence: number;
  source: 'W3C Nu HTML Checker';
  page_url: string;
  evidence: string[];
  retryable: boolean;
  provenance: {
    service: 'W3C Nu HTML Checker';
    endpoint: string;
    documentation: string;
  };
  summary: {
    error_count: number;
    warning_count: number;
    info_count: number;
    indeterminate_count: number;
    messages_truncated: boolean;
  };
  messages: HtmlValidationMessage[];
  error?: {
    code: string;
    message: string;
    http_status: number | null;
  };
}

export interface HtmlValidationOptions {
  fetcher?: EvidenceFetcher;
  timeoutMs?: number;
  maxMessages?: number;
}

function normalizeTarget(rawUrl: string): string | null {
  if (!rawUrl || rawUrl.length > 2048 || !isValidHttpUrl(rawUrl)) return null;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.username || parsed.password) return null;
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, maxLength)
    : '';
}

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

function normalizeMessage(message: W3cMessageBody): HtmlValidationMessage | null {
  const rawType = cleanText(message.type, 40);
  if (!['error', 'info', 'non-document-error'].includes(rawType)) return null;
  const subtype = cleanText(message.subType ?? message.subtype, 60) || null;
  const type: HtmlValidationMessage['type'] = rawType === 'info' && subtype === 'warning'
    ? 'warning'
    : rawType as HtmlValidationMessage['type'];
  return {
    type,
    subtype,
    message: cleanText(message.message, 400) || 'Validator returned a message without text',
    line: positiveInteger(message.lastLine ?? message.firstLine),
    column: positiveInteger(message.lastColumn ?? message.firstColumn),
    extract: cleanText(message.extract, 240) || null,
  };
}

function messageEvidence(message: HtmlValidationMessage): string {
  const location = message.line
    ? ` at line ${message.line}${message.column ? `, column ${message.column}` : ''}`
    : '';
  return `${message.type}${location}: ${message.message}`;
}

function emptySummary() {
  return {
    error_count: 0,
    warning_count: 0,
    info_count: 0,
    indeterminate_count: 0,
    messages_truncated: false,
  };
}

async function cancelResponseBody(response: Response): Promise<void> {
  try { await response.body?.cancel(); } catch { /* best-effort connection cleanup */ }
}

async function readBoundedText(response: Response): Promise<string> {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    await cancelResponseBody(response);
    throw new Error('response-too-large');
  }
  if (!response.body) return '';

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error('response-too-large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function errorResult(
  pageUrl: string,
  code: string,
  message: string,
  retryable: boolean,
  httpStatus: number | null = null,
): HtmlValidationResult {
  return {
    id: 'seo.html_conformance',
    category: 'seo',
    title: 'HTML conformance',
    status: 'error',
    weight: 1,
    confidence: 0,
    source: 'W3C Nu HTML Checker',
    page_url: pageUrl,
    evidence: [`${code}: ${message}`],
    retryable,
    provenance: {
      service: 'W3C Nu HTML Checker',
      endpoint: W3C_ENDPOINT,
      documentation: W3C_DOCUMENTATION,
    },
    summary: emptySummary(),
    messages: [],
    error: { code, message, http_status: httpStatus },
  };
}

export async function runHtmlValidation(
  rawUrl: string,
  options: HtmlValidationOptions = {},
): Promise<HtmlValidationResult> {
  const pageUrl = normalizeTarget(rawUrl);
  if (!pageUrl) {
    return errorResult(rawUrl, 'W3C_INVALID_TARGET', 'HTML validation requires a public HTTP(S) URL', false);
  }

  const fetcher = options.fetcher ?? fetchWithTimeout;
  const requestUrl = new URL(W3C_ENDPOINT);
  requestUrl.searchParams.set('doc', pageUrl);
  requestUrl.searchParams.set('out', 'json');
  requestUrl.searchParams.set('level', 'warning');

  let response: Response;
  try {
    response = await fetcher(requestUrl.toString(), {
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip',
        'User-Agent': 'GeoScore/2.0 (+https://geo.sayori.org)',
      },
    });
  } catch {
    return errorResult(pageUrl, 'W3C_UNAVAILABLE', 'W3C Nu HTML Checker could not be reached', true);
  }

  if (!response.ok) {
    await cancelResponseBody(response);
    if (response.status === 429) {
      return errorResult(pageUrl, 'W3C_RATE_LIMITED', 'W3C Nu HTML Checker rate limit reached', true, response.status);
    }
    const retryable = response.status === 408 || response.status >= 500;
    return errorResult(
      pageUrl,
      retryable ? 'W3C_UPSTREAM_ERROR' : 'W3C_REQUEST_REJECTED',
      `W3C Nu HTML Checker returned HTTP ${response.status}`,
      retryable,
      response.status,
    );
  }

  let body: string;
  try {
    body = await readBoundedText(response);
  } catch (error) {
    if (error instanceof Error && error.message === 'response-too-large') {
      return errorResult(pageUrl, 'W3C_RESPONSE_TOO_LARGE', 'W3C response exceeded the 500 KB safe parsing limit', false, response.status);
    }
    return errorResult(pageUrl, 'W3C_INVALID_RESPONSE', 'W3C response body could not be read', true, response.status);
  }

  let parsed: { url?: unknown; messages?: unknown };
  try {
    parsed = JSON.parse(body) as { url?: unknown; messages?: unknown };
  } catch {
    return errorResult(pageUrl, 'W3C_INVALID_RESPONSE', 'W3C returned malformed JSON', true, response.status);
  }
  if (!Array.isArray(parsed.messages)) {
    return errorResult(pageUrl, 'W3C_INVALID_RESPONSE', 'W3C JSON response did not contain a messages array', true, response.status);
  }

  const allMessages = parsed.messages
    .map(item => item && typeof item === 'object' ? normalizeMessage(item as W3cMessageBody) : null)
    .filter((item): item is HtmlValidationMessage => item !== null);
  const maxMessages = Math.max(1, Math.min(100, options.maxMessages ?? DEFAULT_MAX_MESSAGES));
  const messages = allMessages.slice(0, maxMessages);
  const errorCount = allMessages.filter(item => item.type === 'error').length;
  const warningCount = allMessages.filter(item => item.type === 'warning').length;
  const infoCount = allMessages.filter(item => item.type === 'info').length;
  const indeterminateCount = allMessages.filter(item => item.type === 'non-document-error').length;

  // The W3C JSON contract explicitly gives non-document errors priority over
  // document errors because the checker could not examine the complete input.
  const status: CheckStatus = indeterminateCount > 0 ? 'unknown' : errorCount > 0 ? 'fail' : 'pass';
  const checkedUrl = cleanText(parsed.url, 2048) || pageUrl;
  const evidence = messages.slice(0, 12).map(messageEvidence);
  if (evidence.length === 0) evidence.push('W3C reported no HTML errors or warnings');
  evidence.unshift(`Checked ${checkedUrl} with the W3C Nu HTML Checker JSON API`);
  if (status === 'unknown') {
    evidence.push('The checker could not examine the complete document, so the result is indeterminate');
  }

  const retryable = status === 'unknown' && messages.some(message =>
    message.type === 'non-document-error' && ['io', 'internal'].includes(message.subtype ?? '')
  );

  return {
    id: 'seo.html_conformance',
    category: 'seo',
    title: 'HTML conformance',
    status,
    weight: 1,
    confidence: status === 'pass' || status === 'fail' ? 0.95 : 0,
    source: 'W3C Nu HTML Checker',
    page_url: pageUrl,
    evidence,
    retryable,
    provenance: {
      service: 'W3C Nu HTML Checker',
      endpoint: W3C_ENDPOINT,
      documentation: W3C_DOCUMENTATION,
    },
    summary: {
      error_count: errorCount,
      warning_count: warningCount,
      info_count: infoCount,
      indeterminate_count: indeterminateCount,
      messages_truncated: allMessages.length > messages.length,
    },
    messages,
  };
}
