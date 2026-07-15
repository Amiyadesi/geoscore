import { fetchWithTimeout, isValidHttpUrl } from '../lib/http';

const COLLECTIONS_ENDPOINT = 'https://index.commoncrawl.org/collinfo.json';
const COMMON_CRAWL_DOCUMENTATION = 'https://commoncrawl.org/get-started';
const DEFAULT_TIMEOUT_MS = 10000;
const COLLECTION_CACHE_MS = 6 * 60 * 60 * 1000;
const MAX_RESPONSE_BYTES = 200 * 1024;

type CheckStatus = 'pass' | 'unknown' | 'error';
type EvidenceFetcher = (
  url: string,
  init?: RequestInit & { timeoutMs?: number },
) => Promise<Response>;

export interface CommonCrawlCollection {
  id: string;
  index_url: string;
}

interface CommonCrawlCollectionBody {
  id?: unknown;
  'cdx-api'?: unknown;
}

interface CommonCrawlRecordBody {
  url?: unknown;
  timestamp?: unknown;
  status?: unknown;
  mime?: unknown;
  digest?: unknown;
  languages?: unknown;
}

export interface CommonCrawlCapture {
  url: string;
  timestamp: string;
  captured_at: string | null;
  status: string;
  mime: string;
  digest: string | null;
  languages: string | null;
}

export interface CommonCrawlResult {
  id: 'geo.common_crawl_presence';
  category: 'geo';
  title: 'Common Crawl presence';
  status: CheckStatus;
  weight: 0;
  confidence: number;
  source: 'Common Crawl Index';
  page_url: string;
  evidence: string[];
  retryable: boolean;
  present: boolean | null;
  collection: string | null;
  captures: CommonCrawlCapture[];
  provenance: {
    service: 'Common Crawl Index';
    endpoint: string;
    documentation: string;
    query_url: string | null;
  };
  error?: {
    code: string;
    message: string;
    http_status: number | null;
  };
}

export interface CommonCrawlOptions {
  fetcher?: EvidenceFetcher;
  timeoutMs?: number;
  collection?: CommonCrawlCollection;
}

let cachedCollection: { value: CommonCrawlCollection; expiresAt: number } | null = null;

class CommonCrawlFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly httpStatus: number | null = null,
  ) {
    super(message);
  }
}

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, maxLength)
    : '';
}

async function cancelResponseBody(response: Response): Promise<void> {
  try { await response.body?.cancel(); } catch { /* best-effort connection cleanup */ }
}

async function readBoundedText(response: Response): Promise<string> {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    await cancelResponseBody(response);
    throw new CommonCrawlFailure('COMMON_CRAWL_RESPONSE_TOO_LARGE', 'Common Crawl response exceeded the 200 KB safe parsing limit', false, response.status);
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
        throw new CommonCrawlFailure('COMMON_CRAWL_RESPONSE_TOO_LARGE', 'Common Crawl response exceeded the 200 KB safe parsing limit', false, response.status);
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

function validCollection(value: CommonCrawlCollection): boolean {
  if (!/^CC-MAIN-\d{4}-\d{2}$/.test(value.id)) return false;
  try {
    const endpoint = new URL(value.index_url);
    return endpoint.protocol === 'https:' && endpoint.hostname === 'index.commoncrawl.org';
  } catch {
    return false;
  }
}

function normalizeTarget(rawTarget: string): { query: string; pageUrl: string } | null {
  const target = rawTarget.trim();
  if (!target || target.length > 2048) return null;

  if (/^https?:\/\//i.test(target)) {
    if (!isValidHttpUrl(target)) return null;
    try {
      const parsed = new URL(target);
      if (parsed.username || parsed.password) return null;
      parsed.hash = '';
      return { query: parsed.toString(), pageUrl: parsed.toString() };
    } catch {
      return null;
    }
  }

  const hostname = target.toLowerCase().replace(/\.$/, '');
  if (/[\s\/?#@:]/.test(hostname) || !isValidHttpUrl(`https://${hostname}/`)) return null;
  return { query: `${hostname}/*`, pageUrl: `https://${hostname}/` };
}

function parseTimestamp(timestamp: string): string | null {
  if (!/^\d{14}$/.test(timestamp)) return null;
  const iso = `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)}T${timestamp.slice(8, 10)}:${timestamp.slice(10, 12)}:${timestamp.slice(12, 14)}Z`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

function parseCapture(value: CommonCrawlRecordBody): CommonCrawlCapture | null {
  const url = cleanText(value.url, 2048);
  const timestamp = cleanText(value.timestamp, 20);
  const status = cleanText(value.status, 8);
  const mime = cleanText(value.mime, 100);
  if (!url || !timestamp || status !== '200' || !/^text\/html\b/i.test(mime)) return null;
  return {
    url,
    timestamp,
    captured_at: parseTimestamp(timestamp),
    status,
    mime,
    digest: cleanText(value.digest, 120) || null,
    languages: cleanText(value.languages, 120) || null,
  };
}

async function latestCollection(fetcher: EvidenceFetcher, timeoutMs: number): Promise<CommonCrawlCollection> {
  if (cachedCollection && cachedCollection.expiresAt > Date.now()) return cachedCollection.value;

  let response: Response;
  try {
    response = await fetcher(COLLECTIONS_ENDPOINT, {
      timeoutMs,
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip',
        'User-Agent': 'GeoScore/2.2 (+https://geo.sayori.org)',
      },
    });
  } catch {
    throw new CommonCrawlFailure('COMMON_CRAWL_UNAVAILABLE', 'Common Crawl collection index could not be reached', true);
  }
  if (!response.ok) {
    await cancelResponseBody(response);
    throw new CommonCrawlFailure(
      response.status === 429 ? 'COMMON_CRAWL_RATE_LIMITED' : 'COMMON_CRAWL_UPSTREAM_ERROR',
      `Common Crawl collection index returned HTTP ${response.status}`,
      response.status === 429 || response.status === 408 || response.status >= 500,
      response.status,
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(await readBoundedText(response));
  } catch (error) {
    if (error instanceof CommonCrawlFailure) throw error;
    throw new CommonCrawlFailure('COMMON_CRAWL_INVALID_RESPONSE', 'Common Crawl collection index returned malformed JSON', true, response.status);
  }
  if (!Array.isArray(body)) {
    throw new CommonCrawlFailure('COMMON_CRAWL_INVALID_RESPONSE', 'Common Crawl collection list was not an array', true, response.status);
  }

  const entry = body
    .map(item => {
      const collection = item && typeof item === 'object' ? item as CommonCrawlCollectionBody : {};
      return {
        id: cleanText(collection.id, 40),
        index_url: cleanText(collection['cdx-api'], 300),
      };
    })
    .find(validCollection);
  if (!entry) {
    throw new CommonCrawlFailure('COMMON_CRAWL_INVALID_RESPONSE', 'No valid Common Crawl collection endpoint was returned', true, response.status);
  }
  cachedCollection = { value: entry, expiresAt: Date.now() + COLLECTION_CACHE_MS };
  return entry;
}

function errorResult(
  pageUrl: string,
  code: string,
  message: string,
  retryable: boolean,
  collection: string | null,
  queryUrl: string | null,
  httpStatus: number | null = null,
): CommonCrawlResult {
  return {
    id: 'geo.common_crawl_presence',
    category: 'geo',
    title: 'Common Crawl presence',
    status: 'error',
    weight: 0,
    confidence: 0,
    source: 'Common Crawl Index',
    page_url: pageUrl,
    evidence: [`${code}: ${message}`],
    retryable,
    present: null,
    collection,
    captures: [],
    provenance: {
      service: 'Common Crawl Index',
      endpoint: COLLECTIONS_ENDPOINT,
      documentation: COMMON_CRAWL_DOCUMENTATION,
      query_url: queryUrl,
    },
    error: { code, message, http_status: httpStatus },
  };
}

export async function runCommonCrawlPresence(
  rawTarget: string,
  options: CommonCrawlOptions = {},
): Promise<CommonCrawlResult> {
  const target = normalizeTarget(rawTarget);
  if (!target) {
    return errorResult(
      rawTarget,
      'COMMON_CRAWL_INVALID_TARGET',
      'Common Crawl lookup requires a public hostname or HTTP(S) URL',
      false,
      null,
      null,
    );
  }

  const fetcher = options.fetcher ?? fetchWithTimeout;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let collection: CommonCrawlCollection;
  try {
    collection = options.collection ?? await latestCollection(fetcher, timeoutMs);
    if (!validCollection(collection)) {
      throw new CommonCrawlFailure('COMMON_CRAWL_INVALID_COLLECTION', 'Common Crawl collection endpoint is invalid', false);
    }
  } catch (error) {
    const failure = error instanceof CommonCrawlFailure
      ? error
      : new CommonCrawlFailure('COMMON_CRAWL_UNAVAILABLE', 'Common Crawl collection discovery failed', true);
    return errorResult(target.pageUrl, failure.code, failure.message, failure.retryable, null, null, failure.httpStatus);
  }

  const queryUrl = new URL(collection.index_url);
  queryUrl.searchParams.set('url', target.query);
  queryUrl.searchParams.set('output', 'json');
  queryUrl.searchParams.append('filter', 'status:200');
  queryUrl.searchParams.append('filter', 'mime:text/html');
  queryUrl.searchParams.set('collapse', 'urlkey');
  queryUrl.searchParams.set('limit', '3');

  let response: Response;
  try {
    response = await fetcher(queryUrl.toString(), {
      timeoutMs,
      headers: {
        Accept: 'application/x-ndjson, application/json',
        'Accept-Encoding': 'gzip',
        'User-Agent': 'GeoScore/2.2 (+https://geo.sayori.org)',
      },
    });
  } catch {
    return errorResult(
      target.pageUrl,
      'COMMON_CRAWL_UNAVAILABLE',
      'Common Crawl index query could not be reached',
      true,
      collection.id,
      queryUrl.toString(),
    );
  }

  if (response.status === 404) {
    await cancelResponseBody(response);
    return {
      id: 'geo.common_crawl_presence',
      category: 'geo',
      title: 'Common Crawl presence',
      status: 'unknown',
      weight: 0,
      confidence: 0,
      source: 'Common Crawl Index',
      page_url: target.pageUrl,
      evidence: [
        `No matching HTTP 200 HTML capture was found in the latest collection ${collection.id}`,
        'Absence from one Common Crawl collection is an unknown coverage signal, not evidence that the page is unindexable',
      ],
      retryable: false,
      present: false,
      collection: collection.id,
      captures: [],
      provenance: {
        service: 'Common Crawl Index',
        endpoint: collection.index_url,
        documentation: COMMON_CRAWL_DOCUMENTATION,
        query_url: queryUrl.toString(),
      },
    };
  }

  if (!response.ok) {
    await cancelResponseBody(response);
    const retryable = response.status === 429 || response.status === 408 || response.status >= 500;
    return errorResult(
      target.pageUrl,
      response.status === 429 ? 'COMMON_CRAWL_RATE_LIMITED' : 'COMMON_CRAWL_UPSTREAM_ERROR',
      `Common Crawl index returned HTTP ${response.status}`,
      retryable,
      collection.id,
      queryUrl.toString(),
      response.status,
    );
  }

  let text: string;
  try {
    text = await readBoundedText(response);
  } catch (error) {
    if (error instanceof CommonCrawlFailure) {
      return errorResult(target.pageUrl, error.code, error.message, error.retryable, collection.id, queryUrl.toString(), error.httpStatus);
    }
    return errorResult(target.pageUrl, 'COMMON_CRAWL_INVALID_RESPONSE', 'Common Crawl response body could not be read', true, collection.id, queryUrl.toString(), response.status);
  }

  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines.length === 0 || /^No Captures found/i.test(lines[0])) {
    return {
      id: 'geo.common_crawl_presence', category: 'geo', title: 'Common Crawl presence', status: 'unknown',
      weight: 0, confidence: 0, source: 'Common Crawl Index', page_url: target.pageUrl,
      evidence: [
        `No matching HTTP 200 HTML capture was found in the latest collection ${collection.id}`,
        'Absence from one Common Crawl collection is an unknown coverage signal, not evidence that the page is unindexable',
      ],
      retryable: false, present: false, collection: collection.id, captures: [],
      provenance: { service: 'Common Crawl Index', endpoint: collection.index_url, documentation: COMMON_CRAWL_DOCUMENTATION, query_url: queryUrl.toString() },
    };
  }

  const captures: CommonCrawlCapture[] = [];
  for (const line of lines.slice(0, 10)) {
    try {
      const record = JSON.parse(line) as CommonCrawlRecordBody;
      const capture = parseCapture(record);
      if (capture) captures.push(capture);
    } catch {
      return errorResult(target.pageUrl, 'COMMON_CRAWL_INVALID_RESPONSE', 'Common Crawl returned malformed JSON lines', true, collection.id, queryUrl.toString(), response.status);
    }
  }

  if (captures.length === 0) {
    return errorResult(target.pageUrl, 'COMMON_CRAWL_INVALID_RESPONSE', 'Common Crawl returned no usable HTML capture records', true, collection.id, queryUrl.toString(), response.status);
  }

  return {
    id: 'geo.common_crawl_presence',
    category: 'geo',
    title: 'Common Crawl presence',
    status: 'pass',
    weight: 0,
    confidence: 0.9,
    source: 'Common Crawl Index',
    page_url: target.pageUrl,
    evidence: [
      `Latest collection ${collection.id} contains ${captures.length} matching HTTP 200 HTML capture(s)`,
      ...captures.map(capture => `${capture.captured_at ?? capture.timestamp}: ${capture.url} (${capture.mime})`),
      'A Common Crawl capture is verifiable archive evidence; it does not prove Google indexing or AI citation',
    ],
    retryable: false,
    present: true,
    collection: collection.id,
    captures,
    provenance: {
      service: 'Common Crawl Index',
      endpoint: collection.index_url,
      documentation: COMMON_CRAWL_DOCUMENTATION,
      query_url: queryUrl.toString(),
    },
  };
}
