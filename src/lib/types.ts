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
  MONITOR_TOKEN_PEPPER?: string;
  API_KEY?: string;
  API_BASE_URL?: string;
  API_MODEL?: string;
  GROQ_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  PERPLEXITY_API_KEY?: string;
  RESEND_API_KEY?: string;
}

export type FixPackLanguage = 'en' | 'zh';
export type FixPackOutput = 'full' | 'code' | 'copy' | 'handoff_prompt';

export interface FixPackCodeSnippet {
  label: string;
  language: string;
  code: string;
}

export interface FixPackDrafts {
  title: string | null;
  meta_description: string | null;
  body_outline: string[];
}

export interface FixPackEvidence {
  check_id: string;
  page_url: string | null;
  status: 'fail';
  observed: string[];
  why: string;
  source: string;
  confidence: number;
}

export interface FixPackRepairGroup {
  id: string;
  stage: 'discovery' | 'fetch' | 'parse' | 'retrieval' | 'selection' | 'attribution';
  page_url: string | null;
  check_ids: string[];
}

export interface FixPack {
  version: '1';
  audit_id: string;
  recommendation_id: string;
  language: FixPackLanguage;
  output: FixPackOutput;
  domain: string;
  evidence: FixPackEvidence;
  evidence_items: FixPackEvidence[];
  repair_group?: FixPackRepairGroup;
  drafts: FixPackDrafts;
  code_snippets: FixPackCodeSnippet[];
  fix_steps: string[];
  verify: string[];
  handoff_prompt: string;
  expansion: {
    status: 'deterministic' | 'ai' | 'unavailable';
    error_code?: string;
  };
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
