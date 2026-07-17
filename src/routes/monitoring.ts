import {
  canCompareMonitorBaseline,
  isSiteArchetype,
  monitorBaselineFromSummary,
  type AuditContext,
  type MonitorScoreBaseline,
  type ScoreSummary,
} from '../lib/audit-core';
import {
  EVIDENCE_SNAPSHOT_VERSION,
  MAX_FREE_EVIDENCE_QUERIES,
  planEvidenceQueries,
  type EvidenceQueryIntent,
  type EvidenceQueryPlan,
  type PlannedEvidenceQuery,
} from '../lib/query-evidence';
import {
  requestAnswerSnapshots,
  requestEvidenceSearch,
  validateRequestScopedAnswerConfig,
  type RequestScopedAnswerConfig,
} from '../lib/search-gateway';
import { publicAppUrl } from '../lib/security';
import { sendEmail, type EmailDeliveryResult } from '../lib/email';
import type { Env } from '../lib/types';
import { monotonicFactory } from 'ulid';

const ulid = monotonicFactory();
const TOKEN_VERSION = 1;
export const MONITOR_RETENTION_LIMIT = 12;
const WEEK_SECONDS = 7 * 24 * 60 * 60;
const QUERY_INTENTS = new Set<EvidenceQueryIntent>([
  'branded', 'informational', 'task', 'comparison', 'local', 'navigational',
]);

interface MonitorProjectRow {
  id: string;
  root_domain: string;
  audit_id: string;
  context_json: string;
  token_version: number;
  token_hash: string;
  token_hint: string;
  baseline_json: string | null;
  email: string | null;
  email_verified: number;
  email_verify_hash: string | null;
  email_verify_expires_at: number | null;
  schedule: 'weekly';
  last_run_at: number | null;
  created_at: number;
  updated_at: number;
}

interface MonitorQueryRow {
  position: number;
  query: string;
  intent: EvidenceQueryIntent;
}

interface StoredMonitorAudit {
  audit_id: string;
  domain: string;
  score_version: string;
  audit_context: AuditContext;
  score_summary: ScoreSummary;
}

type MonitorRunType = 'default' | 'byok' | 'weekly';
type MonitorRunStatus = 'running' | 'complete' | 'partial' | 'error';
export type MonitorBaselineAction = 'established' | 'reset_version' | 'reset_coverage' | 'compared';
type MonitorAlertStatus =
  | 'not_requested'
  | 'baseline'
  | 'suppressed'
  | 'no_change'
  | 'pending'
  | 'sent'
  | 'not_configured'
  | 'failed';

interface MonitorAlertPlan {
  status: MonitorAlertStatus;
  error_code: string | null;
  email: {
    to: string;
    subject: string;
    html: string;
  } | null;
}

interface MonitorRunRow {
  id: string;
  project_id: string;
  run_type: MonitorRunType;
  status: MonitorRunStatus;
  score_version: string | null;
  factual_score: number | null;
  factual_coverage: number | null;
  factual_confidence: number | null;
  baseline_action: MonitorBaselineAction | null;
  score_delta: number | null;
  snapshot_id: string | null;
  error_code: string | null;
  alert_status: MonitorAlertStatus | null;
  alert_error_code: string | null;
  created_at: number;
  completed_at: number | null;
}

interface MonitorHistoryRow extends MonitorRunRow {
  snapshot_version: string | null;
  evidence_json: string | null;
  answer_json: string | null;
}

interface BaselineDecision {
  action: MonitorBaselineAction;
  score_delta: number | null;
  comparable: boolean;
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function error(code: string, message: string, status: number, retryable = false): Response {
  return json({ error: { code, message, retryable } }, status);
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function randomSecret(prefix: string, bytes = 32): string {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return `${prefix}_${bytesToBase64Url(value)}`;
}

function hex(value: ArrayBuffer): string {
  return [...new Uint8Array(value)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

async function hashSecret(secret: string, pepper: string, purpose: string, version = TOKEN_VERSION): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${purpose}:v${version}:${secret}`),
  );
  return `v${version}:${hex(signature)}`;
}

export function generateManagementToken(): string {
  return randomSecret('gmt', 32);
}

export function managementTokenHint(token: string): string {
  return token.slice(-6);
}

export function hashManagementToken(token: string, pepper: string, version = TOKEN_VERSION): Promise<string> {
  return hashSecret(token, pepper, 'monitor-management', version);
}

export function hashEmailVerificationToken(
  token: string,
  pepper: string,
  version = TOKEN_VERSION,
): Promise<string> {
  return hashSecret(token, pepper, 'monitor-email', version);
}

export async function verifyManagementToken(
  token: string,
  expectedHash: string,
  pepper: string,
  version = TOKEN_VERSION,
): Promise<boolean> {
  if (!token || !expectedHash || !pepper) return false;
  return constantTimeEqual(await hashManagementToken(token, pepper, version), expectedHash);
}

function parseContext(value: unknown): AuditContext | null {
  const item = object(value);
  if (!item || typeof item.site_archetype !== 'string' || !isSiteArchetype(item.site_archetype) ||
      typeof item.root_domain !== 'string' || typeof item.locale !== 'string' ||
      !Array.isArray(item.page_types) || typeof item.confidence !== 'number' || !Array.isArray(item.evidence)) return null;
  return item as unknown as AuditContext;
}

function parseStoredAudit(raw: string, auditId: string): StoredMonitorAudit | null {
  try {
    const item = object(JSON.parse(raw));
    const context = parseContext(item?.audit_context);
    const summary = object(item?.score_summary);
    if (!item || item.audit_id !== auditId || typeof item.domain !== 'string' ||
        typeof item.score_version !== 'string' || !context || !summary ||
        typeof summary.score_version !== 'string' || !object(summary.overall)) return null;
    return {
      audit_id: auditId,
      domain: item.domain,
      score_version: item.score_version,
      audit_context: context,
      score_summary: item.score_summary as ScoreSummary,
    };
  } catch {
    return null;
  }
}

function parseBaseline(raw: string | null): MonitorScoreBaseline | null {
  if (!raw) return null;
  try {
    const item = object(JSON.parse(raw));
    if (!item || typeof item.score_version !== 'string' ||
        !(typeof item.score === 'number' || item.score === null) ||
        typeof item.coverage !== 'number' || typeof item.confidence !== 'number') return null;
    return {
      score_version: item.score_version,
      score: typeof item.score === 'number' ? item.score : null,
      coverage: item.coverage,
      confidence: item.confidence,
    };
  } catch {
    return null;
  }
}

export function evaluateMonitorBaseline(
  previous: MonitorScoreBaseline | null,
  current: MonitorScoreBaseline,
): BaselineDecision {
  if (!previous) return { action: 'established', score_delta: null, comparable: false };
  if (previous.score_version !== current.score_version) {
    return { action: 'reset_version', score_delta: null, comparable: false };
  }
  if (!canCompareMonitorBaseline(previous, current)) {
    return { action: 'reset_coverage', score_delta: null, comparable: false };
  }
  return {
    action: 'compared',
    score_delta: (current.score as number) - (previous.score as number),
    comparable: true,
  };
}

function managementTokenFromRequest(req: Request): string {
  const direct = req.headers.get('X-Project-Token')?.trim() ?? '';
  return direct || req.headers.get('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || '';
}

function monitorTokenPepper(env: Env): string | null {
  const pepper = env.MONITOR_TOKEN_PEPPER?.trim() ?? '';
  return pepper.length >= 32 ? pepper : null;
}

export function normalizeMonitorQueries(
  value: unknown,
  defaults: PlannedEvidenceQuery[] = [],
): MonitorQueryRow[] | null {
  const input = value === undefined ? defaults : value;
  if (!Array.isArray(input) || input.length < 1 || input.length > MAX_FREE_EVIDENCE_QUERIES) return null;
  const output: MonitorQueryRow[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < input.length; index += 1) {
    const item = input[index];
    const record = object(item);
    const rawQuery = typeof item === 'string' ? item : typeof record?.query === 'string' ? record.query : '';
    const query = rawQuery.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    if (query.length < 2 || query.length > 240) return null;
    const key = query.toLocaleLowerCase('en-US');
    if (seen.has(key)) return null;
    seen.add(key);
    const rawIntent = typeof record?.intent === 'string' ? record.intent : defaults[index]?.intent;
    output.push({
      position: index,
      query,
      intent: QUERY_INTENTS.has(rawIntent as EvidenceQueryIntent)
        ? rawIntent as EvidenceQueryIntent
        : 'informational',
    });
  }
  return output;
}

function planFromRows(context: AuditContext, rows: MonitorQueryRow[]): EvidenceQueryPlan {
  const base = planEvidenceQueries(context);
  return {
    ...base,
    queries: rows.map((row, index) => ({ id: `q${index + 1}-${row.intent}`, intent: row.intent, query: row.query })),
  };
}

async function loadProject(env: Env, projectId: string): Promise<MonitorProjectRow | null> {
  return env.DB.prepare(
    `SELECT id, root_domain, audit_id, context_json, token_version, token_hash, token_hint,
            baseline_json, email, email_verified, email_verify_hash, email_verify_expires_at,
            schedule, last_run_at, created_at, updated_at
     FROM monitor_projects WHERE id = ? LIMIT 1`,
  ).bind(projectId).first<MonitorProjectRow>();
}

async function loadQueries(env: Env, projectId: string): Promise<MonitorQueryRow[]> {
  const result = await env.DB.prepare(
    `SELECT position, query, intent FROM monitor_queries WHERE project_id = ? ORDER BY position`,
  ).bind(projectId).all<MonitorQueryRow>();
  return (result.results ?? []).slice(0, MAX_FREE_EVIDENCE_QUERIES);
}

async function loadLatestProjectAudit(env: Env, project: MonitorProjectRow): Promise<StoredMonitorAudit | null> {
  const latest = await env.DB.prepare(
    `SELECT candidate.id, candidate.full_json
     FROM audits origin
     JOIN audits candidate ON candidate.business_id = origin.business_id
     WHERE origin.id = ? AND candidate.status = 'complete' AND candidate.full_json IS NOT NULL
     ORDER BY COALESCE(candidate.completed_at, candidate.created_at) DESC,
              candidate.created_at DESC, candidate.id DESC
     LIMIT 1`,
  ).bind(project.audit_id).first<{ id: string; full_json: string | null }>();
  if (latest?.full_json) {
    const parsed = parseStoredAudit(latest.full_json, latest.id);
    if (parsed) return parsed;
  }
  const original = await env.DB.prepare(
    `SELECT id, full_json FROM audits WHERE id = ? AND status = 'complete' LIMIT 1`,
  ).bind(project.audit_id).first<{ id: string; full_json: string | null }>();
  return original?.full_json ? parseStoredAudit(original.full_json, original.id) : null;
}

async function authorizedProject(req: Request, env: Env, projectId: string): Promise<MonitorProjectRow | Response> {
  let project: MonitorProjectRow | null;
  try { project = await loadProject(env, projectId); }
  catch { return error('PROJECT_STORE_UNAVAILABLE', 'Monitoring storage is temporarily unavailable.', 503, true); }
  if (!project) return error('PROJECT_NOT_FOUND', 'Monitoring project not found.', 404);
  const pepper = monitorTokenPepper(env);
  if (!pepper) return error('MONITOR_CONFIG_MISSING', 'Monitoring token protection is not securely configured.', 503);
  const valid = await verifyManagementToken(
    managementTokenFromRequest(req),
    project.token_hash,
    pepper,
    project.token_version,
  );
  return valid ? project : error('PROJECT_TOKEN_INVALID', 'A valid project management token is required.', 401);
}

function publicProject(project: MonitorProjectRow, queries: MonitorQueryRow[]) {
  let context: AuditContext | null = null;
  try { context = parseContext(JSON.parse(project.context_json)); } catch { context = null; }
  return {
    id: project.id,
    root_domain: project.root_domain,
    audit_id: project.audit_id,
    site_archetype: context?.site_archetype ?? 'unknown',
    locale: context?.locale ?? 'en',
    token_hint: project.token_hint,
    schedule: project.schedule,
    email: project.email,
    email_verified: project.email_verified === 1,
    last_run_at: project.last_run_at,
    created_at: project.created_at,
    updated_at: project.updated_at,
    queries,
  };
}

async function sendVerificationEmail(
  env: Env,
  projectId: string,
  email: string,
  token: string,
): Promise<EmailDeliveryResult> {
  const url = `${publicAppUrl(env)}/?monitor_project=${encodeURIComponent(projectId)}&verify=${encodeURIComponent(token)}`;
  return sendEmail(
    env,
    email,
    'Verify your GeoScore monitoring email',
    `<p>Verify this address for GeoScore monitoring:</p><p><a href="${url}">Verify email</a></p><p>This link expires in 24 hours.</p>`,
    `geoscore-verify-${projectId}`,
  );
}

async function createProject(req: Request, env: Env): Promise<Response> {
  const pepper = monitorTokenPepper(env);
  if (!pepper) return error('MONITOR_CONFIG_MISSING', 'Monitoring token protection is not securely configured.', 503);
  let body: Record<string, unknown>;
  try { body = object(await req.json()) ?? {}; }
  catch { return error('INVALID_JSON', 'Request body must be valid JSON.', 400); }
  const auditId = typeof body.audit_id === 'string' ? body.audit_id.trim() : '';
  if (!/^[A-Za-z0-9_-]{10,80}$/.test(auditId)) return error('INVALID_AUDIT_ID', 'A completed audit_id is required.', 400);
  const emailAddress = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (emailAddress && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailAddress)) {
    return error('INVALID_EMAIL', 'Email address is invalid.', 400);
  }
  let auditRow: { full_json: string | null } | null;
  try {
    auditRow = await env.DB.prepare(`SELECT full_json FROM audits WHERE id = ? AND status = 'complete' LIMIT 1`)
      .bind(auditId).first<{ full_json: string | null }>();
  } catch {
    return error('AUDIT_STORE_UNAVAILABLE', 'Audit storage is temporarily unavailable.', 503, true);
  }
  if (!auditRow?.full_json) return error('AUDIT_NOT_FOUND', 'Completed audit not found.', 404);
  const audit = parseStoredAudit(auditRow.full_json, auditId);
  if (!audit) return error('AUDIT_VERSION_UNSUPPORTED', 'This audit cannot create a monitoring project.', 409);
  const defaultPlan = planEvidenceQueries(audit.audit_context);
  const queries = normalizeMonitorQueries(body.queries, defaultPlan.queries);
  if (!queries) return error('INVALID_QUERIES', 'Provide one to three unique bounded queries.', 400);

  const projectId = `mon_${ulid()}`;
  const managementToken = generateManagementToken();
  const managementHash = await hashManagementToken(managementToken, pepper);
  const emailToken = emailAddress ? randomSecret('gmv', 24) : '';
  const emailHash = emailToken ? await hashEmailVerificationToken(emailToken, pepper) : null;
  const emailExpiry = emailToken ? Math.floor(Date.now() / 1000) + 24 * 60 * 60 : null;
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO monitor_projects (
          id, root_domain, audit_id, context_json, token_version, token_hash, token_hint,
          email, email_verified, email_verify_hash, email_verify_expires_at, schedule
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'weekly')`,
      ).bind(
        projectId,
        audit.audit_context.root_domain,
        auditId,
        JSON.stringify(audit.audit_context),
        TOKEN_VERSION,
        managementHash,
        managementTokenHint(managementToken),
        emailAddress || null,
        emailHash,
        emailExpiry,
      ),
      ...queries.map(query => env.DB.prepare(
        `INSERT INTO monitor_queries (project_id, position, query, intent) VALUES (?, ?, ?, ?)`,
      ).bind(projectId, query.position, query.query, query.intent)),
    ]);
  } catch {
    return error('PROJECT_STORE_FAILED', 'The monitoring project could not be created.', 503, true);
  }

  let emailStatus: 'not_requested' | 'sent' | 'not_configured' | 'failed' = 'not_requested';
  if (emailAddress) {
    const delivery = await sendVerificationEmail(env, projectId, emailAddress, emailToken);
    emailStatus = delivery.ok
      ? 'sent'
      : delivery.error_code === 'EMAIL_PROVIDER_NOT_CONFIGURED' ? 'not_configured' : 'failed';
  }
  const stored = await loadProject(env, projectId).catch(() => null);
  return json({
    ok: true,
    project: stored ? publicProject(stored, queries) : {
      id: projectId,
      root_domain: audit.audit_context.root_domain,
      audit_id: auditId,
      queries,
    },
    management_token: managementToken,
    token_shown_once: true,
    email_status: emailStatus,
  }, 201);
}

async function updateQueries(req: Request, env: Env, project: MonitorProjectRow): Promise<Response> {
  let body: Record<string, unknown>;
  try { body = object(await req.json()) ?? {}; }
  catch { return error('INVALID_JSON', 'Request body must be valid JSON.', 400); }
  const queries = normalizeMonitorQueries(body.queries);
  if (!queries) return error('INVALID_QUERIES', 'Provide one to three unique bounded queries.', 400);
  try {
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM monitor_queries WHERE project_id = ?`).bind(project.id),
      ...queries.map(query => env.DB.prepare(
        `INSERT INTO monitor_queries (project_id, position, query, intent) VALUES (?, ?, ?, ?)`,
      ).bind(project.id, query.position, query.query, query.intent)),
      env.DB.prepare(`UPDATE monitor_projects SET baseline_json = NULL, updated_at = unixepoch() WHERE id = ?`).bind(project.id),
    ]);
    return json({ ok: true, queries, baseline_reset: true });
  } catch {
    return error('QUERY_UPDATE_FAILED', 'Queries could not be updated.', 503, true);
  }
}

async function rotateToken(env: Env, project: MonitorProjectRow): Promise<Response> {
  const pepper = monitorTokenPepper(env);
  if (!pepper) return error('MONITOR_CONFIG_MISSING', 'Monitoring token protection is not securely configured.', 503);
  const token = generateManagementToken();
  const version = project.token_version + 1;
  const hash = await hashManagementToken(token, pepper, version);
  try {
    await env.DB.prepare(
      `UPDATE monitor_projects SET token_version = ?, token_hash = ?, token_hint = ?, updated_at = unixepoch() WHERE id = ?`,
    ).bind(version, hash, managementTokenHint(token), project.id).run();
    return json({ ok: true, management_token: token, token_shown_once: true, token_hint: managementTokenHint(token) });
  } catch {
    return error('TOKEN_ROTATION_FAILED', 'The management token could not be rotated.', 503, true);
  }
}

async function verifyEmail(req: Request, env: Env, projectId: string): Promise<Response> {
  const pepper = monitorTokenPepper(env);
  if (!pepper) return error('MONITOR_CONFIG_MISSING', 'Monitoring token protection is not securely configured.', 503);
  let body: Record<string, unknown>;
  try { body = object(await req.json()) ?? {}; }
  catch { return error('INVALID_JSON', 'Request body must be valid JSON.', 400); }
  const token = typeof body.token === 'string' ? body.token.trim() : '';
  if (!token) return error('VERIFICATION_TOKEN_REQUIRED', 'Verification token is required.', 400);
  const project = await loadProject(env, projectId).catch(() => null);
  if (!project?.email_verify_hash) return error('VERIFICATION_NOT_FOUND', 'Email verification request not found.', 404);
  if (!project.email_verify_expires_at || project.email_verify_expires_at < Math.floor(Date.now() / 1000)) {
    return error('VERIFICATION_EXPIRED', 'Email verification token has expired.', 410);
  }
  const candidate = await hashEmailVerificationToken(token, pepper);
  if (!constantTimeEqual(candidate, project.email_verify_hash)) {
    return error('VERIFICATION_TOKEN_INVALID', 'Email verification token is invalid.', 401);
  }
  try {
    await env.DB.prepare(
      `UPDATE monitor_projects SET email_verified = 1, email_verify_hash = NULL,
        email_verify_expires_at = NULL, updated_at = unixepoch() WHERE id = ?`,
    ).bind(projectId).run();
    return json({ ok: true, email_verified: true });
  } catch {
    return error('EMAIL_VERIFICATION_FAILED', 'Email verification could not be stored.', 503, true);
  }
}

function parseJsonValue(raw: string | null): unknown {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function publicRun(row: MonitorHistoryRow) {
  return {
    id: row.id,
    project_id: row.project_id,
    run_type: row.run_type,
    status: row.status,
    score_version: row.score_version,
    factual_score: row.factual_score,
    factual_coverage: row.factual_coverage,
    factual_confidence: row.factual_confidence,
    baseline_action: row.baseline_action,
    score_delta: row.score_delta,
    snapshot_id: row.snapshot_id,
    snapshot_version: row.snapshot_version,
    evidence: parseJsonValue(row.evidence_json),
    answer: parseJsonValue(row.answer_json),
    error_code: row.error_code,
    alert_status: row.alert_status ?? 'not_requested',
    alert_error_code: row.alert_error_code,
    alert_retryable: ['pending', 'failed', 'not_configured'].includes(row.alert_status ?? ''),
    created_at: row.created_at,
    completed_at: row.completed_at,
  };
}

async function boundedRequestBody(req: Request): Promise<Record<string, unknown> | null> {
  const declaredLength = Number.parseInt(req.headers.get('Content-Length') ?? '', 10);
  if (Number.isFinite(declaredLength) && declaredLength > 4096) return null;
  const raw = await req.text();
  if (!raw.trim()) return {};
  if (raw.length > 4096) return null;
  try {
    return object(JSON.parse(raw));
  } catch {
    return null;
  }
}

function combinedRunStatus(
  evidence: Awaited<ReturnType<typeof requestEvidenceSearch>>,
  answer: Awaited<ReturnType<typeof requestAnswerSnapshots>>,
): Exclude<MonitorRunStatus, 'running'> {
  if (evidence.status === 'complete' && answer.status === 'complete') return 'complete';
  if (evidence.snapshot || answer.snapshot) return 'partial';
  return 'error';
}

function runErrorCode(
  evidence: Awaited<ReturnType<typeof requestEvidenceSearch>>,
  answer: Awaited<ReturnType<typeof requestAnswerSnapshots>>,
): string | null {
  if (evidence.snapshot || answer.snapshot) return null;
  return evidence.error?.code ?? answer.error?.code ?? 'MONITOR_SNAPSHOT_FAILED';
}

async function trimSnapshots(env: Env, projectId: string): Promise<void> {
  await env.DB.prepare(
    `DELETE FROM monitor_snapshots
     WHERE project_id = ? AND id NOT IN (
       SELECT id FROM monitor_snapshots WHERE project_id = ?
       ORDER BY created_at DESC, id DESC LIMIT ?
     )`,
  ).bind(projectId, projectId, MONITOR_RETENTION_LIMIT).run();
}

function planScoreAlert(
  project: MonitorProjectRow,
  audit: StoredMonitorAudit,
  decision: BaselineDecision,
): MonitorAlertPlan {
  if (decision.action === 'established') return { status: 'baseline', error_code: null, email: null };
  if (!decision.comparable) return { status: 'suppressed', error_code: null, email: null };
  if (decision.score_delta === 0) return { status: 'no_change', error_code: null, email: null };
  if (!project.email || project.email_verified !== 1) {
    return { status: 'not_requested', error_code: null, email: null };
  }
  return {
    status: 'pending',
    error_code: null,
    email: scoreAlertEmail(project, audit.score_summary.overall.score, decision.score_delta ?? 0),
  };
}

function scoreAlertEmail(
  project: MonitorProjectRow,
  currentScore: number | null,
  scoreDelta: number,
): NonNullable<MonitorAlertPlan['email']> {
  const direction = scoreDelta > 0 ? 'increased' : 'decreased';
  return {
    to: project.email as string,
    subject: `GeoScore changed for ${project.root_domain}`,
    html: `<p>The factual GeoScore for <strong>${project.root_domain}</strong> ${direction} by ${Math.abs(scoreDelta)} points.</p>
     <p>Current score: <strong>${currentScore === null ? 'insufficient evidence' : currentScore}</strong></p>
     <p>Open GeoScore to review the dated evidence snapshot and repair groups.</p>`,
  };
}

async function persistAlertResult(
  env: Env,
  runId: string,
  status: MonitorAlertStatus,
  errorCode: string | null,
): Promise<void> {
  await env.DB.prepare(
    `UPDATE monitor_runs SET alert_status = ?, alert_error_code = ? WHERE id = ?`,
  ).bind(status, errorCode, runId).run();
}

async function persistFailedRun(env: Env, runId: string, code: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE monitor_runs SET status = 'error', error_code = ?, alert_status = 'suppressed',
      completed_at = unixepoch() WHERE id = ?`,
  ).bind(code, runId).run();
}

async function executeMonitorRun(
  env: Env,
  project: MonitorProjectRow,
  runType: MonitorRunType,
  requestConfig: RequestScopedAnswerConfig | null = null,
): Promise<{ response: Response; run: ReturnType<typeof publicRun> | null }> {
  const runId = `mrun_${ulid()}`;
  try {
    await env.DB.prepare(
      `INSERT INTO monitor_runs (id, project_id, run_type, status, alert_status)
       VALUES (?, ?, ?, 'running', 'not_requested')`,
    ).bind(runId, project.id, runType).run();
  } catch {
    return { response: error('MONITOR_RUN_STORE_FAILED', 'The monitoring run could not be started.', 503, true), run: null };
  }

  let audit: StoredMonitorAudit | null;
  let queries: MonitorQueryRow[];
  try {
    [audit, queries] = await Promise.all([
      loadLatestProjectAudit(env, project),
      loadQueries(env, project.id),
    ]);
  } catch {
    await persistFailedRun(env, runId, 'MONITOR_CONTEXT_UNAVAILABLE').catch(() => undefined);
    return { response: error('MONITOR_CONTEXT_UNAVAILABLE', 'Monitoring context is temporarily unavailable.', 503, true), run: null };
  }
  if (!audit || audit.audit_context.root_domain !== project.root_domain) {
    await persistFailedRun(env, runId, 'MONITOR_AUDIT_UNAVAILABLE').catch(() => undefined);
    return { response: error('MONITOR_AUDIT_UNAVAILABLE', 'A compatible completed audit is required.', 409), run: null };
  }
  if (!queries.length) {
    await persistFailedRun(env, runId, 'MONITOR_QUERIES_MISSING').catch(() => undefined);
    return { response: error('MONITOR_QUERIES_MISSING', 'The monitoring project has no queries.', 409), run: null };
  }

  const plan = planFromRows(audit.audit_context, queries);
  const [evidence, answer] = await Promise.all([
    requestEvidenceSearch(env, plan),
    requestAnswerSnapshots(env, plan, requestConfig),
  ]);
  const status = combinedRunStatus(evidence, answer);
  const snapshotId = evidence.snapshot || answer.snapshot ? `msnap_${ulid()}` : null;
  const currentBaseline = monitorBaselineFromSummary(audit.score_summary);
  const decision = evaluateMonitorBaseline(parseBaseline(project.baseline_json), currentBaseline);
  const storedBaseline = snapshotId ? JSON.stringify(currentBaseline) : project.baseline_json;
  const alert = runType === 'weekly'
    ? status === 'error'
      ? { status: 'suppressed' as MonitorAlertStatus, error_code: 'MONITOR_SNAPSHOT_UNAVAILABLE', email: null }
      : planScoreAlert(project, audit, decision)
    : { status: 'not_requested' as MonitorAlertStatus, error_code: null, email: null };
  const evidenceEnvelope = {
    status: evidence.status,
    snapshot: evidence.snapshot,
    error: evidence.error,
    query_plan: plan,
    affects_score: false,
  };
  const answerEnvelope = {
    status: answer.status,
    snapshot: answer.snapshot,
    error: answer.error,
    affects_score: false,
  };
  try {
    const statements = [
      ...(snapshotId ? [env.DB.prepare(
        `INSERT INTO monitor_snapshots (
          id, project_id, run_id, snapshot_version, evidence_json, answer_json
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(
        snapshotId,
        project.id,
        runId,
        EVIDENCE_SNAPSHOT_VERSION,
        JSON.stringify(evidenceEnvelope),
        JSON.stringify(answerEnvelope),
      )] : []),
      env.DB.prepare(
        `UPDATE monitor_runs SET status = ?, score_version = ?, factual_score = ?,
          factual_coverage = ?, factual_confidence = ?, baseline_action = ?, score_delta = ?,
          snapshot_id = ?, error_code = ?, alert_status = ?, alert_error_code = ?, completed_at = unixepoch()
         WHERE id = ?`,
      ).bind(
        status,
        currentBaseline.score_version,
        currentBaseline.score,
        currentBaseline.coverage,
        currentBaseline.confidence,
        decision.action,
        decision.score_delta,
        snapshotId,
        runErrorCode(evidence, answer),
        alert.status,
        alert.error_code,
        runId,
      ),
      env.DB.prepare(
        `UPDATE monitor_projects SET audit_id = ?, context_json = ?, baseline_json = ?,
          last_run_at = unixepoch(), updated_at = unixepoch() WHERE id = ?`,
      ).bind(
        audit.audit_id,
        JSON.stringify(audit.audit_context),
        storedBaseline,
        project.id,
      ),
    ];
    await env.DB.batch(statements);
    if (snapshotId) await trimSnapshots(env, project.id);
  } catch {
    await persistFailedRun(env, runId, 'MONITOR_RUN_STORE_FAILED').catch(() => undefined);
    return { response: error('MONITOR_RUN_STORE_FAILED', 'The monitoring snapshot could not be stored.', 503, true), run: null };
  }

  let finalAlert = { status: alert.status, error_code: alert.error_code };
  if (alert.email) {
    const delivery = await sendEmail(
      env,
      alert.email.to,
      alert.email.subject,
      alert.email.html,
      `geoscore-monitor-${runId}`,
    );
    finalAlert = {
      status: delivery.ok ? 'sent' : delivery.error_code === 'EMAIL_PROVIDER_NOT_CONFIGURED' ? 'not_configured' : 'failed',
      error_code: delivery.error_code,
    };
    try {
      await persistAlertResult(env, runId, finalAlert.status, finalAlert.error_code);
    } catch {
      finalAlert = { status: 'pending', error_code: 'EMAIL_STATUS_STORE_FAILED' };
    }
  }

  const row: MonitorHistoryRow = {
    id: runId,
    project_id: project.id,
    run_type: runType,
    status,
    score_version: currentBaseline.score_version,
    factual_score: currentBaseline.score,
    factual_coverage: currentBaseline.coverage,
    factual_confidence: currentBaseline.confidence,
    baseline_action: decision.action,
    score_delta: decision.score_delta,
    snapshot_id: snapshotId,
    error_code: runErrorCode(evidence, answer),
    alert_status: finalAlert.status,
    alert_error_code: finalAlert.error_code,
    created_at: Math.floor(Date.now() / 1000),
    completed_at: Math.floor(Date.now() / 1000),
    snapshot_version: snapshotId ? EVIDENCE_SNAPSHOT_VERSION : null,
    evidence_json: JSON.stringify(evidenceEnvelope),
    answer_json: JSON.stringify(answerEnvelope),
  };
  const publicResult = publicRun(row);
  return {
    response: json({ ok: true, run: publicResult }, status === 'error' ? 207 : 200),
    run: publicResult,
  };
}

async function getProject(env: Env, project: MonitorProjectRow): Promise<Response> {
  try {
    const queries = await loadQueries(env, project.id);
    return json({ ok: true, project: publicProject(project, queries) });
  } catch {
    return error('PROJECT_STORE_UNAVAILABLE', 'Monitoring storage is temporarily unavailable.', 503, true);
  }
}

async function getRunHistory(env: Env, project: MonitorProjectRow): Promise<Response> {
  try {
    const result = await env.DB.prepare(
      `SELECT r.id, r.project_id, r.run_type, r.status, r.score_version, r.factual_score,
              r.factual_coverage, r.factual_confidence, r.baseline_action, r.score_delta,
              r.snapshot_id, r.error_code, r.alert_status, r.alert_error_code,
              r.created_at, r.completed_at, s.snapshot_version, s.evidence_json, s.answer_json
       FROM monitor_runs r
       LEFT JOIN monitor_snapshots s ON s.id = r.snapshot_id
       WHERE r.project_id = ?
       ORDER BY r.created_at DESC, r.id DESC LIMIT ?`,
    ).bind(project.id, MONITOR_RETENTION_LIMIT).all<MonitorHistoryRow>();
    return json({ ok: true, runs: (result.results ?? []).map(publicRun), retention_limit: MONITOR_RETENTION_LIMIT });
  } catch {
    return error('MONITOR_HISTORY_UNAVAILABLE', 'Monitoring history is temporarily unavailable.', 503, true);
  }
}

async function retryScoreAlert(
  env: Env,
  project: MonitorProjectRow,
  runId: string,
): Promise<Response> {
  if (!/^mrun_[A-Z0-9]{20,40}$/.test(runId)) {
    return error('INVALID_MONITOR_RUN_ID', 'Monitoring run id is invalid.', 400);
  }
  let run: MonitorRunRow | null;
  try {
    run = await env.DB.prepare(
      `SELECT id, project_id, run_type, status, score_version, factual_score,
              factual_coverage, factual_confidence, baseline_action, score_delta,
              snapshot_id, error_code, alert_status, alert_error_code, created_at, completed_at
       FROM monitor_runs WHERE id = ? AND project_id = ? LIMIT 1`,
    ).bind(runId, project.id).first<MonitorRunRow>();
  } catch {
    return error('MONITOR_HISTORY_UNAVAILABLE', 'Monitoring history is temporarily unavailable.', 503, true);
  }
  if (!run) return error('MONITOR_RUN_NOT_FOUND', 'Monitoring run not found.', 404);
  const canRetry = run.run_type === 'weekly' &&
    (run.status === 'complete' || run.status === 'partial') &&
    run.baseline_action === 'compared' &&
    typeof run.score_delta === 'number' && run.score_delta !== 0 &&
    ['pending', 'failed', 'not_configured'].includes(run.alert_status ?? '');
  if (!canRetry || !project.email || project.email_verified !== 1) {
    return error('ALERT_RETRY_NOT_AVAILABLE', 'This monitoring alert cannot be retried.', 409);
  }

  const email = scoreAlertEmail(project, run.factual_score, run.score_delta as number);
  const delivery = await sendEmail(
    env,
    email.to,
    email.subject,
    email.html,
    `geoscore-monitor-${runId}`,
  );
  const status: MonitorAlertStatus = delivery.ok
    ? 'sent'
    : delivery.error_code === 'EMAIL_PROVIDER_NOT_CONFIGURED' ? 'not_configured' : 'failed';
  try {
    await persistAlertResult(env, runId, status, delivery.error_code);
  } catch {
    return error('ALERT_STATUS_STORE_FAILED', 'Email delivery status could not be stored.', 503, true);
  }
  if (!delivery.ok) {
    return error(
      delivery.error_code ?? 'EMAIL_SEND_FAILED',
      'The monitoring alert could not be delivered.',
      503,
      delivery.retryable,
    );
  }
  return json({ ok: true, run_id: runId, alert_status: 'sent', alert_error_code: null, alert_retryable: false });
}

async function deleteProject(env: Env, project: MonitorProjectRow): Promise<Response> {
  try {
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM monitor_snapshots WHERE project_id = ?`).bind(project.id),
      env.DB.prepare(`DELETE FROM monitor_runs WHERE project_id = ?`).bind(project.id),
      env.DB.prepare(`DELETE FROM monitor_queries WHERE project_id = ?`).bind(project.id),
      env.DB.prepare(`DELETE FROM monitor_projects WHERE id = ?`).bind(project.id),
    ]);
    return json({ ok: true, deleted: true });
  } catch {
    return error('PROJECT_DELETE_FAILED', 'The monitoring project could not be deleted.', 503, true);
  }
}

export async function handleMonitorProjects(req: Request, env: Env): Promise<Response> {
  const pathname = new URL(req.url).pathname;
  if (pathname === '/api/monitor-projects') {
    return req.method === 'POST'
      ? createProject(req, env)
      : error('METHOD_NOT_ALLOWED', 'Method not allowed.', 405);
  }
  const match = pathname.match(/^\/api\/monitor-projects\/([^/]+)(?:\/(.+))?$/);
  if (!match) return error('MONITOR_ROUTE_NOT_FOUND', 'Monitoring route not found.', 404);
  const projectId = decodeURIComponent(match[1]);
  const action = match[2] ?? '';
  if (!/^mon_[A-Z0-9]{20,40}$/.test(projectId)) {
    return error('INVALID_PROJECT_ID', 'Monitoring project id is invalid.', 400);
  }
  if (action === 'email/verify' && req.method === 'POST') return verifyEmail(req, env, projectId);

  const authorized = await authorizedProject(req, env, projectId);
  if (authorized instanceof Response) return authorized;
  if (!action && req.method === 'GET') return getProject(env, authorized);
  if (!action && req.method === 'DELETE') return deleteProject(env, authorized);
  if (action === 'queries' && req.method === 'PATCH') return updateQueries(req, env, authorized);
  if (action === 'token/rotate' && req.method === 'POST') return rotateToken(env, authorized);
  if (action === 'runs' && req.method === 'GET') return getRunHistory(env, authorized);
  const alertRetry = action.match(/^runs\/([^/]+)\/alert\/retry$/);
  if (alertRetry && req.method === 'POST') {
    return retryScoreAlert(env, authorized, decodeURIComponent(alertRetry[1]));
  }
  if (action === 'runs' && req.method === 'POST') {
    const body = await boundedRequestBody(req);
    if (!body || Object.keys(body).length > 0) {
      return error('MONITOR_OPTIONS_FORBIDDEN', 'Provider, model, and endpoint settings are server-owned.', 400);
    }
    return (await executeMonitorRun(env, authorized, 'default')).response;
  }
  if (action === 'byok-runs' && req.method === 'POST') {
    const body = await boundedRequestBody(req);
    if (!body || Object.keys(body).some(key => key !== 'api_base_url' && key !== 'api_model')) {
      return error('CUSTOM_API_CONFIG_INVALID', 'Custom API configuration is invalid.', 400);
    }
    const validated = validateRequestScopedAnswerConfig(
      req.headers.get('X-API-Key'),
      body.api_base_url,
      body.api_model,
      true,
    );
    if (validated.ok === false) {
      return error(
        validated.code,
        validated.code === 'CUSTOM_API_CONFIG_INCOMPLETE'
          ? 'API key, HTTPS base URL, and model must be provided together.'
          : 'Custom API configuration is invalid.',
        400,
      );
    }
    return (await executeMonitorRun(env, authorized, 'byok', validated.config)).response;
  }
  return error('MONITOR_ROUTE_NOT_FOUND', 'Monitoring route not found.', 404);
}

export async function runWeeklyMonitorProjects(
  env: Env,
): Promise<{ attempted: number; completed: number; failed: number }> {
  let projects: MonitorProjectRow[];
  try {
    const result = await env.DB.prepare(
      `SELECT id, root_domain, audit_id, context_json, token_version, token_hash, token_hint,
              baseline_json, email, email_verified, email_verify_hash, email_verify_expires_at,
              schedule, last_run_at, created_at, updated_at
       FROM monitor_projects
       WHERE schedule = 'weekly' AND (last_run_at IS NULL OR last_run_at <= unixepoch() - ?)
       ORDER BY COALESCE(last_run_at, 0), created_at LIMIT 10`,
    ).bind(WEEK_SECONDS).all<MonitorProjectRow>();
    projects = result.results ?? [];
  } catch {
    return { attempted: 0, completed: 0, failed: 0 };
  }
  let completed = 0;
  let failed = 0;
  for (const project of projects) {
    try {
      const result = await executeMonitorRun(env, project, 'weekly');
      if (result.run) completed += 1;
      else failed += 1;
    } catch {
      failed += 1;
    }
  }
  return { attempted: projects.length, completed, failed };
}
