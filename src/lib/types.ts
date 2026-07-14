export type BrowserRunResourceType =
  | 'document'
  | 'stylesheet'
  | 'image'
  | 'media'
  | 'font'
  | 'script'
  | 'texttrack'
  | 'xhr'
  | 'fetch'
  | 'prefetch'
  | 'eventsource'
  | 'websocket'
  | 'manifest'
  | 'signedexchange'
  | 'ping'
  | 'cspviolationreport'
  | 'preflight'
  | 'other';

/** Minimal Browser Run Quick Actions binding contract missing from the pinned Workers types. */
export interface BrowserRunContentRequest {
  url: string;
  actionTimeout?: number;
  allowRequestPattern?: string[];
  rejectResourceTypes?: BrowserRunResourceType[];
  gotoOptions?: {
    timeout?: number;
    waitUntil?: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2';
  };
}

export interface BrowserRunBinding {
  quickAction(action: 'content', options: BrowserRunContentRequest): Promise<Response>;
}

export interface Env {
  DB: D1Database;
  AUDIT_KV: KVNamespace;
  BUDGET_KV: KVNamespace;
  VECTORS: VectorizeIndex;
  AI: Ai;
  BROWSER?: BrowserRunBinding;
  NOMINATIM_USER_AGENT: string;
  SEARXNG_URL: string;
  SEARCH_GATEWAY_URL?: string;
  DAILY_BROWSER_BUDGET_SECONDS: string;
  AUDIT_RATE_LIMIT_PER_HOUR?: string;
  SEARCH_RATE_LIMIT_PER_MINUTE?: string;
  PUBLIC_APP_URL: string;
  PUBLIC_API_URL: string;
  ALLOWED_ORIGINS: string;
  RESEND_FROM: string;
  ADMIN_TOKEN?: string;
  GOOGLE_API_KEY?: string;
  PAGESPEED_API_KEY?: string;
  OPENPAGERANK_KEY?: string;
  SEARCH_GATEWAY_API_KEY?: string;
  API_KEY?: string;
  GROQ_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  PERPLEXITY_API_KEY?: string;
  RESEND_API_KEY?: string;
}

export interface Business {
  id?: number;
  name: string;
  domain?: string;
  city?: string;
  country?: string;
  category?: string;
  lat?: number;
  lon?: number;
  osm_id?: string;
  address?: string;
  phone?: string;
}

export interface AuditResult {
  id: string;
  business_id: number;
  status: 'pending' | 'running' | 'complete' | 'failed';
  foundation_score?: number;
  weakness_score?: number;
  modules: Record<string, ModuleResult>;
}

export interface ModuleResult {
  status: 'ok' | 'partial' | 'failed' | 'skipped';
  data?: unknown;
  error?: string;
  duration_ms?: number;
}

export interface SseEvent {
  event: 'progress' | 'section' | 'complete' | 'error';
  data: unknown;
}
