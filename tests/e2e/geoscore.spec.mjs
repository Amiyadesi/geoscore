import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { auditFixture, evidenceMapFixture } from './fixtures.mjs';

const UI_COPY = {
  en: {
    lang: 'en',
    title: 'Check verifiable SEO and GEO issues',
    rankingLimit: 'no score predicts or guarantees ranking',
    docsTitle: 'From audit to a verifiable repair',
    audit: 'Audit',
    customApi: 'Optional custom API',
  },
  zh: {
    lang: 'zh-CN',
    title: '检查网站中可验证的 SEO 与 GEO 问题',
    rankingLimit: '分数不预测也不保证排名',
    docsTitle: '从审查走到可以复验的修复',
    audit: '开始审查',
    customApi: '可选：自定义 API',
  },
  hant: {
    lang: 'zh-Hant',
    title: '檢查網站中可驗證的 SEO 與 GEO 問題',
    rankingLimit: '分數不預測也不保證排名',
    docsTitle: '從審查走到可以複驗的修復',
    audit: '開始審查',
    customApi: '可選：自定義 API',
  },
};

function languageForProject(projectName) {
  if (projectName.endsWith('-hant')) return 'hant';
  return projectName.endsWith('-zh') ? 'zh' : 'en';
}


async function waitForActiveSitePass(page) {
  await page.waitForFunction(() => window.GeoScoreSitePass?.isActive?.() === true);
}

async function mockLocale(page, locale = 'en') {
  await page.route('https://sayori.org/api/locale', route => route.fulfill({
    json: { locale },
    headers: {
      'Access-Control-Allow-Origin': route.request().headers().origin || 'http://127.0.0.1:4174',
      'Access-Control-Allow-Credentials': 'true',
    },
  }));
}

async function mockApi(page, locale = 'en') {
  await mockLocale(page, locale);
  await page.route('https://static.cloudflareinsights.com/**', route => route.fulfill({ status: 204, body: '' }));
  await page.route('https://www.google.com/s2/favicons**', route => route.fulfill({ status: 204, body: '' }));
  // Active Site Pass so download / monitoring create flows stay exercisable in browser CI.
  await page.route('https://pay.geo.sayori.org/**', route => {
    const url = new URL(route.request().url());
    const domain = url.searchParams.get('domain') || 'example.com';
    return route.fulfill({
      json: {
        active: true,
        domain,
        expires_at: Math.floor(Date.now() / 1000) + 86400,
        reruns_remaining: 10,
      },
    });
  });
  await page.route('http://127.0.0.1:8787/**', route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/api/audit/example.com') {
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'Cache-Control': 'no-cache' },
        body: `event: complete\ndata: ${JSON.stringify(auditFixture)}\n\n`,
      });
    }
    if (url.pathname === '/api/share/example.com') {
      return route.fulfill({ json: auditFixture });
    }
    if (url.pathname === '/api/meta') {
      return route.fulfill({
        json: {
          version: '2.4.8',
          score_version: '2.4.8',
          max_pages: 5,
          audit_modes: ['site', 'url'],
          checks: { scoring: 2, informational: 0, predicted: 1 },
          capabilities: { optional_modules_not_run: [] },
          rate_limit: { fresh_audits: 2, window_hours: 1 },
          license: 'MIT',
          source_url: 'https://github.com/Amiyadesi/geoscore',
        },
      });
    }
    if (url.pathname === '/api/businesses' || url.pathname === '/api/search') return route.fulfill({ json: [] });
    if (url.pathname === '/api/lighthouse') {
      return route.fulfill({
        json: {
          ok: true,
          data: {
            status: 'complete',
            mobile_score: 88,
            desktop_score: 94,
            lcp_ms: 1800,
            cls: 0.04,
            fcp_ms: 900,
            tbt_ms: 80,
            mobile: { strategy: 'mobile', status: 'complete', score: 88 },
            desktop: { strategy: 'desktop', status: 'complete', score: 94 },
          },
        },
      });
    }
    if (url.pathname === '/api/audits/audit_e2e_1/evidence-map') {
      return route.fulfill({ json: { ok: true, data: evidenceMapFixture } });
    }
    if (url.pathname === '/api/monitor-projects' && request.method() === 'POST') {
      return route.fulfill({
        json: {
          ok: true,
          project: { id: 'monitor_e2e_1', root_domain: 'example.com', schedule: 'weekly', queries: [] },
          management_token: 'gmt_e2e_management_token',
          token_shown_once: true,
        },
      });
    }
    return route.fulfill({ json: { ok: true } });
  });
}

async function mockAdminApi(page, { storageReady = true } = {}) {
  await page.route('http://127.0.0.1:8787/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/admin/session') {
      return route.fulfill({ json: { authenticated: true, login: 'Amiyadesi', github_oauth: true, full_access: true } });
    }
    if (url.pathname === '/api/admin/overview') {
      return route.fulfill({ json: {
        totals: { unique_sites: 3, audits_by_status: { complete: 5 } },
        today: { audits: 2 },
        this_week: { audits: 4 },
        quotas: {
          browser_run: { used_seconds: 40, budget_seconds: 540, remaining_seconds: 500 },
          public_audit: { limit_per_hour: 2, today_audits: 2 },
        },
        monitor_projects: 1,
        recent_audits: [],
      } });
    }
    if (url.pathname === '/api/admin/gsc/status') {
      return route.fulfill({ json: {
        configured: false,
        connected: false,
        storage_ready: storageReady,
        callback_url: 'https://geo-api.sayori.org/api/admin/gsc/callback',
      } });
    }
    return route.fulfill({ status: 404, json: { error: 'not found' } });
  });
}

test('homepage follows browser language and fits the viewport', async ({ page }, testInfo) => {
  const language = languageForProject(testInfo.project.name);
  const copy = UI_COPY[language];
  const runtimeErrors = [];
  page.on('pageerror', error => runtimeErrors.push(error.message));
  await mockApi(page, language === 'zh' ? 'zh-Hans' : language === 'hant' ? 'zh-Hant' : 'en');

  await page.goto('/', { waitUntil: 'domcontentloaded' });

  await expect(page.locator('html')).toHaveAttribute('lang', copy.lang);
  await expect(page.locator('h1')).toHaveText(copy.title);
  await expect(page.locator('#hero-description')).toContainText(copy.rankingLimit);
  await expect(page.locator('#audit-btn')).toContainText(copy.audit);
  await expect(page.locator('#ui-language-select option')).toHaveText(['简体中文', '繁體中文', 'English']);
  await expect(page.locator('#custom-api-panel > summary')).toContainText(copy.customApi);
  await expect(page.locator('#custom-api-panel')).not.toHaveAttribute('open', '');
  await expect(page.locator('.feature-chip')).toHaveCount(0);
  await expect(page.locator('#meta-facts')).toHaveCount(0);
  await expect(page.locator('#homepage-info > details')).not.toHaveAttribute('open', '');
  await page.locator('#homepage-info > details > summary').click();
  await expect(page.locator('[data-i18n="scope.ranking"]')).toBeVisible();
  await page.locator('#custom-api-panel > summary').click();
  await expect(page.locator('#custom-api-key')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  expect(runtimeErrors).toEqual([]);
});

test('docs follow browser language and fit the viewport', async ({ page }, testInfo) => {
  const language = languageForProject(testInfo.project.name);
  const copy = UI_COPY[language];
  const runtimeErrors = [];
  page.on('pageerror', error => runtimeErrors.push(error.message));
  await mockLocale(page, language === 'zh' ? 'zh-Hans' : language === 'hant' ? 'zh-Hant' : 'en');

  await page.goto('/docs/index.html', { waitUntil: 'domcontentloaded' });

  await expect(page.locator('html')).toHaveAttribute('lang', copy.lang);
  await expect(page.locator('main article:not([hidden]) h1')).toHaveText(copy.docsTitle);
  await expect(page.locator('.language-switch button')).toHaveText(['简体中文', '繁體中文', 'English']);
  const activeTaskNav = page.locator('#task-nav nav:not([hidden])');
  await expect(activeTaskNav).toHaveCount(1);
  if (testInfo.project.name.startsWith('mobile-')) {
    const menu = page.locator('#docs-menu');
    await expect(menu).toBeVisible();
    await menu.click();
    await expect(menu).toHaveAttribute('aria-expanded', 'true');
    await expect(activeTaskNav).toBeVisible();
  } else {
    await expect(activeTaskNav).toBeVisible();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  expect(runtimeErrors).toEqual([]);
});

test('owner console shows bounded Search Console setup and fits the viewport', async ({ page }) => {
  const runtimeErrors = [];
  page.on('pageerror', error => runtimeErrors.push(error.message));
  await mockAdminApi(page);
  await page.goto('/admin.html', { waitUntil: 'domcontentloaded' });

  await expect(page.locator('#admin-dashboard')).toBeVisible();
  await expect(page.locator('#gsc-unconfigured')).toBeVisible();
  await expect(page.locator('#gsc-callback-url')).toHaveText('https://geo-api.sayori.org/api/admin/gsc/callback');
  await expect(page.locator('#gsc-status')).toHaveText('待配置');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  expect(runtimeErrors).toEqual([]);
});

test('owner console distinguishes a missing Search Console migration', async ({ page }) => {
  const runtimeErrors = [];
  page.on('pageerror', error => runtimeErrors.push(error.message));
  await mockAdminApi(page, { storageReady: false });
  await page.goto('/admin.html', { waitUntil: 'domcontentloaded' });

  await expect(page.locator('#gsc-migration-needed')).toBeVisible();
  await expect(page.locator('#gsc-status')).toHaveText('需迁移');
  await expect(page.locator('#gsc-connect')).toBeHidden();
  expect(runtimeErrors).toEqual([]);
});

test('audit renders deterministic evidence and extracted controllers remain interactive', async ({ page }, testInfo) => {
  const runtimeErrors = [];
  page.on('pageerror', error => runtimeErrors.push(error.message));
  await mockApi(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  await page.locator('#search-input').fill('example.com');
  await page.locator('#audit-btn').click();

  await expect(page.locator('#audit')).toBeVisible();
  await expect(page.locator('#domain-name')).toHaveText('example.com');
  await expect(page.locator('#overall-score')).toHaveText('49');
  await expect(page.locator('#evidence-summary')).toBeVisible();
  await expect(page.locator('#evidence-map-section')).toBeVisible();
  await expect(page.locator('#monitoring-section')).toBeVisible();
  await page.locator('[data-action="run-evidence-map"]').click();
  await expect(page.locator('#evidence-map-section')).toContainText('search-api-a');

  if (testInfo.project.name === 'desktop-en') {
    await waitForActiveSitePass(page);
    await page.locator('[data-monitor-form="create"] button[type="submit"]').click();
    await expect(page.locator('#monitor-management-token')).toHaveText('gmt_e2e_management_token');
    await page.locator('[data-action="dismiss-monitor-token"]').click();
    await expect(page.locator('#monitor-management-token')).toHaveCount(0);
  }

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  expect(runtimeErrors).toEqual([]);
});

test('shared audit reveals the report and primary Markdown download', async ({ page }) => {
  const runtimeErrors = [];
  page.on('pageerror', error => runtimeErrors.push(error.message));
  await mockApi(page);

  await page.goto('/?share=example.com', { waitUntil: 'domcontentloaded' });

  await expect(page.locator('#audit')).toBeVisible();
  await expect(page.locator('#domain-name')).toHaveText('example.com');
  await expect(page.locator('#agent-btn')).toBeVisible();
  await waitForActiveSitePass(page);
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#agent-btn').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('GEOSCORE-REPAIR-example.com.md');
  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();
  const markdown = await readFile(downloadPath, 'utf8');
  expect(markdown).toContain('geo.author_attribution');
  expect(markdown).toContain('Content AI brief');
  expect(markdown).toContain('Developer AI brief');
  expect(runtimeErrors).toEqual([]);
});
