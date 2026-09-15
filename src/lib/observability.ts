import type { Env } from './types';

/**
 * Minimal OTLP/JSON error reporter for SigNoz.
 *
 * The Worker report path must never become a new failure mode: exporting is
 * opt-in (no endpoint or no ingestion key means a no-op), the ingestion key
 * never appears in the payload or in logs, and every network or parse problem
 * resolves to `false` instead of throwing into the request that is already
 * failing.
 */

const DEFAULT_SERVICE_NAME = 'sayori-geoscore-api';
const OTLP_TRACES_PATH = '/v1/traces';
const SPAN_NAME = 'geoscore.unhandled_exception';
const SCOPE_NAME = 'geoscore.worker';
const OTLP_SPAN_KIND_INTERNAL = 1;
const OTLP_STATUS_ERROR = 2;
const MAX_ATTRIBUTE_COUNT = 24;
const MAX_ATTRIBUTE_VALUE_CHARS = 512;
const MAX_MESSAGE_CHARS = 512;
const MAX_STACK_CHARS = 4096;

export type OtlpAttributeValue = {
  stringValue?: string;
  intValue?: string;
  boolValue?: boolean;
};

export interface OtlpAttribute {
  key: string;
  value: OtlpAttributeValue;
}

export interface OtlpEvent {
  timeUnixNano: string;
  name: string;
  attributes: OtlpAttribute[];
}

export interface OtlpSpan {
  traceId: string;
  spanId: string;
  name: string;
  kind: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: OtlpAttribute[];
  status: { code: number; message?: string };
  events: OtlpEvent[];
}

export interface OtlpPayload {
  resourceSpans: Array<{
    resource: { attributes: OtlpAttribute[] };
    scopeSpans: Array<{ scope: { name: string; version: string }; spans: OtlpSpan[] }>;
  }>;
}

export interface ObservabilityConfig {
  /** OTLP HTTP traces URL, always ending in `/v1/traces`. */
  tracesUrl: string;
  /** SigNoz ingestion key, sent as the `signoz-ingestion-key` header. */
  ingestionKey: string;
  serviceName: string;
  serviceVersion: string;
}

export type ObservabilityEnv = Pick<
  Env,
  'SIGNOZ_OTLP_ENDPOINT' | 'SIGNOZ_INGESTION_KEY' | 'SIGNOZ_SERVICE_NAME'
>;

export interface ReportErrorOptions {
  /** Bounded, non-secret context such as the failing route or cron expression. */
  attributes?: Record<string, string | number | boolean | undefined>;
  /** `ExecutionContext.waitUntil`, so an acknowledged response is not kept open. */
  waitUntil?: (promise: Promise<unknown>) => void;
  version?: string;
  now?: number;
  fetcher?: typeof fetch;
}

function randomHex(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return Array.from(buffer, byte => byte.toString(16).padStart(2, '0')).join('');
}

function truncate(value: string, limit: number): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}…`;
}

function sanitizeAttributeValue(value: string): string {
  return truncate(value.replace(/\s+/g, ' ').trim(), MAX_ATTRIBUTE_VALUE_CHARS);
}

function toAttributeValue(value: string | number | boolean): OtlpAttributeValue {
  if (typeof value === 'number' && Number.isFinite(value)) return { intValue: String(Math.trunc(value)) };
  if (typeof value === 'boolean') return { boolValue: value };
  return { stringValue: sanitizeAttributeValue(String(value)) };
}

function toAttributes(attributes: Record<string, string | number | boolean | undefined>): OtlpAttribute[] {
  return Object.entries(attributes)
    .filter(([, value]) => value !== undefined && value !== '')
    .slice(0, MAX_ATTRIBUTE_COUNT)
    .map(([key, value]) => ({ key, value: toAttributeValue(value as string | number | boolean) }));
}

function normalizeTracesUrl(endpoint: string): string | null {
  try {
    const parsed = new URL(endpoint.trim());
    if (parsed.protocol !== 'https:') return null;
    return new URL(OTLP_TRACES_PATH, parsed.origin).toString();
  } catch {
    return null;
  }
}

/** Returns `null` when monitoring is not configured, so callers stay no-op by default. */
export function observabilityConfig(env: ObservabilityEnv, version = '0.0.0'): ObservabilityConfig | null {
  const endpoint = env.SIGNOZ_OTLP_ENDPOINT?.trim();
  const ingestionKey = env.SIGNOZ_INGESTION_KEY?.trim();
  if (!endpoint || !ingestionKey) return null;

  const tracesUrl = normalizeTracesUrl(endpoint);
  if (!tracesUrl) return null;

  return {
    tracesUrl,
    ingestionKey,
    serviceName: env.SIGNOZ_SERVICE_NAME?.trim() || DEFAULT_SERVICE_NAME,
    serviceVersion: version,
  };
}

function describeError(error: unknown): { type: string; message: string; stacktrace: string } {
  if (error instanceof Error) {
    return {
      type: sanitizeAttributeValue(error.name || 'Error'),
      message: truncate(error.message || '', MAX_MESSAGE_CHARS),
      stacktrace: error.stack ? truncate(error.stack, MAX_STACK_CHARS) : '',
    };
  }

  let serialized: string;
  try {
    serialized = typeof error === 'string' ? error : JSON.stringify(error) ?? '';
  } catch {
    serialized = '[unserializable thrown value]';
  }
  return {
    type: 'NonError',
    message: truncate(serialized, MAX_MESSAGE_CHARS),
    stacktrace: '',
  };
}

/** Builds the OTLP/JSON payload for one error span. Never includes the ingestion key. */
export function buildErrorPayload(
  config: ObservabilityConfig,
  error: unknown,
  attributes: Record<string, string | number | boolean | undefined> = {},
  now = Date.now(),
): OtlpPayload {
  const details = describeError(error);
  const timestamp = String(now * 1_000_000);

  const exceptionAttributes: OtlpAttribute[] = [
    { key: 'exception.type', value: { stringValue: details.type } },
    { key: 'exception.message', value: { stringValue: details.message } },
  ];
  if (details.stacktrace) {
    exceptionAttributes.push({ key: 'exception.stacktrace', value: { stringValue: details.stacktrace } });
  }

  return {
    resourceSpans: [
      {
        resource: {
          attributes: toAttributes({
            'service.name': config.serviceName,
            'service.version': config.serviceVersion,
            'deployment.environment': 'production',
          }),
        },
        scopeSpans: [
          {
            scope: { name: SCOPE_NAME, version: config.serviceVersion },
            spans: [
              {
                traceId: randomHex(16),
                spanId: randomHex(8),
                name: SPAN_NAME,
                kind: OTLP_SPAN_KIND_INTERNAL,
                startTimeUnixNano: timestamp,
                endTimeUnixNano: timestamp,
                attributes: toAttributes(attributes),
                status: { code: OTLP_STATUS_ERROR, message: details.message },
                events: [{ timeUnixNano: timestamp, name: 'exception', attributes: exceptionAttributes }],
              },
            ],
          },
        ],
      },
    ],
  };
}

async function postOtlp(config: ObservabilityConfig, payload: OtlpPayload, fetcher: typeof fetch): Promise<boolean> {
  try {
    const response = await fetcher(config.tracesUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'signoz-ingestion-key': config.ingestionKey,
      },
      body: JSON.stringify(payload),
    });
    await response.text().catch(() => '');
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Exports one exception span and resolves to whether the exporter accepted it.
 * Returns `false` immediately when SigNoz is not configured.
 */
export function reportError(
  env: ObservabilityEnv,
  error: unknown,
  options: ReportErrorOptions = {},
): Promise<boolean> {
  const config = observabilityConfig(env, options.version);
  if (!config) return Promise.resolve(false);

  const promise = postOtlp(
    config,
    buildErrorPayload(config, error, options.attributes, options.now),
    options.fetcher ?? fetch,
  );
  options.waitUntil?.(promise);
  return promise;
}
