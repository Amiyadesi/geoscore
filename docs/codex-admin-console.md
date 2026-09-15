# Codex brief: GitHub owner admin console

Status on branch `feat/github-admin-console`: **partial**.
This file is the remaining work list. Implement everything below on this branch,
keep the public site accountless, and only allow GitHub login `Amiyadesi`
(override with `ADMIN_GITHUB_LOGINS`).

## Goal

Add a private backend at `https://geo.sayori.org/admin.html`.

After the owner signs in with their own GitHub account:

- they can use the full public product without Site Pass or public rate limits
- they can see how many sites/people have used GeoScore
- they can see remaining daily budgets (Browser Run seconds, public audit cap)

Do **not** add a public “Sign in” button on the homepage.

## Already committed on this branch

- `frontend/admin-session.js` — wraps `fetch` with `credentials: 'include'` for `geo-api.sayori.org` and loads `/api/admin/session`
- `frontend/site-pass.js` — `onOwnerSession()` treats owner as an active Site Pass
- `src/lib/security.ts` — CORS `Access-Control-Allow-Credentials: true`; `isAdminRequest` is async and also accepts the `gs_admin` cookie
- `wrangler.jsonc` — `ADMIN_GITHUB_LOGINS=Amiyadesi`
- `docs/codex-admin-console.md` — this brief

`security.ts` currently imports `./admin-auth`, so the branch **does not compile** until that file exists.

## Files still missing (create these)

### 1. `src/lib/admin-auth.ts`

HMAC-signed cookie session + GitHub allowlist.

Required exports:

- `ADMIN_COOKIE = 'gs_admin'`
- `ADMIN_SESSION_TTL_SECONDS = 14 days`
- `adminAllowlist(env)` default `['Amiyadesi']` from `ADMIN_GITHUB_LOGINS` (comma-separated)
- `isAllowedAdminLogin(login, env)` case-insensitive
- `sessionSecret(env)` = `ADMIN_SESSION_SECRET || ADMIN_TOKEN || GITHUB_CLIENT_SECRET`
- `githubOAuthConfigured(env)` both client id and secret present
- `signAdminSession` / `readAdminSession` using WebCrypto HMAC-SHA256 over base64url JSON `{login,iat,exp}`
- `readCookie`, `adminSessionFromRequest`
- `adminCookieHeader` / `clearAdminCookieHeader`
  - `Path=/; HttpOnly; Secure; SameSite=Lax`
  - `Domain=.sayori.org` derived from `PUBLIC_APP_URL` host
- `oauthCallbackUrl` = `${PUBLIC_API_URL}/api/admin/github/callback`
- `safeNextUrl` only allows `geo.sayori.org`, `geo-api.sayori.org`, local `4173`, and path `/admin.html` or `/admin` or `/`

Do not import `./security` from this file (avoid a cycle). Duplicate the two URL helpers locally.

### 2. `src/routes/admin.ts`

Export `handleAdmin(req, env): Promise<Response | null>`.

Return `null` when path is not `/api/admin*`.

| Method | Path | Auth | Behavior |
|---|---|---|---|
| GET | `/api/admin/github/login?next=` | public | 302 to GitHub OAuth `read:user`, store `next` in `BUDGET_KV` as `admin:oauth:${state}` TTL 600s |
| GET | `/api/admin/github/callback` | public | exchange code, load GitHub user, reject if login not allowlisted, set cookie, 302 back to `next` |
| GET | `/api/admin/session` | public | `{authenticated, login, github_oauth, allowlist, full_access}` |
| GET/POST | `/api/admin/logout` | public | clear cookie |
| GET | `/api/admin/overview` | `requireAdmin` | usage + quotas + recent 25 audits |

Overview SQL against existing D1:

- totals: audits by status, businesses, distinct `business_id`
- today / this UTC week counts
- recent audits joined to `businesses.domain`
- `SELECT COUNT(*) FROM monitor_projects` (catch if table missing)
- KV `browser:YYYY-MM-DD` vs `DAILY_BROWSER_BUDGET_SECONDS` (default 540)
- KV `ai:YYYY-MM-DD` informational only

GitHub token exchange:

```
POST https://github.com/login/oauth/access_token
Accept: application/json
{client_id, client_secret, code, redirect_uri}

GET https://api.github.com/user
Authorization: Bearer <access_token>
User-Agent: sayori-geoscore-admin
```

OAuth authorize URL:

```
https://github.com/login/oauth/authorize
  client_id, redirect_uri, scope=read:user, state, allow_signup=false
```

### 3. `frontend/admin.html`

Private page, `noindex`. Tailwind from `tailwind.css`. No public nav link required.

- unauthenticated: “使用 GitHub 登录” → `${API}/api/admin/github/login?next=<this page>`
- if OAuth secrets missing, show setup instructions instead of pretending login works
- authenticated: cards for 独立站点 / 完成审查 / 今日审查 / 监控项目
- remaining Browser Run seconds bar
- recent audit table
- logout via `POST /api/admin/logout` with credentials
- link back to `/` for full product use
- API is `https://geo-api.sayori.org` (or `http://127.0.0.1:8787` on localhost)

### 4. Wire `src/index.ts`

```ts
import { handleAdmin } from './routes/admin';
import { isAdminRequest, requireAdmin, ... } from './lib/security';
```

Inside `routeRequest`, after reading `pathname`:

```ts
const admin = await isAdminRequest(req, env);
const adminRoute = await handleAdmin(req, env);
if (adminRoute) return adminRoute;
```

Then:

- every `requireAdmin(req, env)` must be `await requireAdmin(req, env)` (it is now async)
- skip `searchRateLimit` / `auditRateLimit` when `admin` is true
- replace the old Bearer-only audit bypass:

```ts
const adminBypass = !!env.ADMIN_TOKEN && req.headers.get('Authorization') === `Bearer ${env.ADMIN_TOKEN}`;
```

with `if (!cached && !admin) { auditRateLimit(...) }`.

Affected routes: `/api/search`, `/api/page-meta`, `/api/answer-models`, evidence-map POST, monitor-projects writes, `/api/audit/:domain`, `/api/compare`, `/api/llm-test`, DELETE audit cache, `/api/feedback`, `/api/learning`.

### 5. `src/lib/types.ts`

Add optional env fields:

```ts
ADMIN_SESSION_SECRET?: string;
ADMIN_GITHUB_LOGINS?: string;
GITHUB_CLIENT_ID?: string;
GITHUB_CLIENT_SECRET?: string;
```

### 6. Frontend glue

- `frontend/index.html`: include `<script src="admin-session.js"></script>` **before** `site-pass.js`
- `frontend/audit-runner.js`: `new EventSourceRef(endpoint, { withCredentials: true })`
- `frontend/i18n.js` both locales:

```
audit.sitePass.owner
  en: Owner session: full product access, no Site Pass needed.
  zh: 已用站长账号登录：完整功能可用，无需 Site Pass。
```

Keep EN/ZH key parity or `frontend-i18n` tests fail.

### 7. Tests

- `tests/security.test.mjs`: compile `src/lib/admin-auth.ts` next to `security.ts`
- new `tests/admin-auth.test.mjs`: allowlist, signed session round-trip, `safeNextUrl` rejects other origins
- `tests/frontend-controllers.test.mjs`: FakeEventSource can ignore the 2nd constructor arg

### 8. Docs / deploy

Update `docs/manual-service-actions.md` and `wrangler.toml.example` secrets:

```
GITHUB_CLIENT_ID
GITHUB_CLIENT_SECRET
ADMIN_SESSION_SECRET
ADMIN_TOKEN          # existing script fallback, keep working
```

OAuth App settings the owner must create:

- Homepage: `https://geo.sayori.org`
- Callback: `https://geo-api.sayori.org/api/admin/github/callback`

Then:

```
wrangler secret put GITHUB_CLIENT_ID --config wrangler.generated.jsonc
wrangler secret put GITHUB_CLIENT_SECRET --config wrangler.generated.jsonc
wrangler secret put ADMIN_SESSION_SECRET --config wrangler.generated.jsonc
```

Deploy both the API worker and Pages (`frontend/`, including `admin.html` + `admin-session.js`).

## Out of scope / do not do

- Public user accounts
- Stripe webhook changes
- Changing free-tier product copy on the homepage
- Cloudflare dashboard neuron quota API (no token in this repo; show local KV counters + a note)
- Site Pass data from `pay.geo.sayori.org` unless that API already accepts the owner cookie

## Acceptance

- `npm test` and `npm run check` pass
- unauthenticated `/admin.html` cannot call `/api/admin/overview`
- GitHub user other than allowlist gets `?error=forbidden`
- Amiyadesi cookie on `.sayori.org` makes `/api/audit/...` skip the hourly cap
- homepage Site Pass card says owner session after login
- EventSource audits still stream with `withCredentials: true`
- CORS continues to echo an allowed origin (never `*` while credentials are true)
