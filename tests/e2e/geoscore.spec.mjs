import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { auditFixture, evidenceMapFixture } from './fixtures.mjs';

const UI_COPY = {
  en: {
    lang: 'en',
    title: 'Make your website easier for search and AI to understand',
    docsTitle: 'From audit to a verifiable repair',
    audit: 'Audit',
    customApi: 'Custom API',
  },
  zh: {
    lang: 'zh-CN',
    title: '让搜索引擎和 AI 更容易理解你的网站',
    docsTitle: '从审查走到可以复验的修复',
    audit: '开始审查',
    customApi: '自定义 API',
  },
};

function languageForProject(projectName) {
  return projectName.endsWith('-zh') ? 'zh' : 'en';
}

async function mockApi(page) {
  await page.route('https://static.cloudflareinsights.com/**', route => route.fulfill({ status: 204, body: '' }));
  await page.route('https://www.google.com/s2/favicons**', route => route.fulfill({ status: 204, body: '' }));
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
          version: '2.4.5',
          score_version: '2.4.2',
          max_pages: 5,
          audit_modes: ['site', 'url'],
          checks: { scoring: 2, informational: 0, predicted: 1 },
          capabilities: { optional_modules_not_run: [] },
          rate_limit: { fresh_audits: 5, window_hours: 24 },
          license: 'MIT',
          source_url: 'https://github.com/Amiyadesi/geoscore',
        },
      });
    }
    if (url.pathname === '/api/stats') return route.fulfill({ json: { audits: 1200 } });
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

test('homepage follows browser language and fits the viewport', async ({ page }, testInfo) => {
  const language = languageForProject(testInfo.project.name);
  const copy = UI_COPY[language];
  const runtimeErrors = [];
  page.on('pageerror', error => runtimeErrors.push(error.message));
  await mockApi(page);

  await page.goto('/');

  await expect(page.locator('html')).toHaveAttribute('lang', copy.lang);
  await expect(page.locator('h1')).toHaveText(copy.title);
  await expect(page.locator('#audit-btn')).toContainText(copy.audit);
  await expect(page.locator('#custom-api-panel > summary')).toContainText(copy.customApi);
  await expect(page.locator('#custom-api-panel')).not.toHaveAttribute('open', '');
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

  await page.goto('/docs/index.html');

  await expect(page.locator('html')).toHaveAttribute('lang', copy.lang);
  await expect(page.locator('main article:not([hidden]) h1')).toHaveText(copy.docsTitle);
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

test('audit renders deterministic evidence and extracted controllers remain interactive', async ({ page }, testInfo) => {
  const runtimeErrors = [];
  page.on('pageerror', error => runtimeErrors.push(error.message));
  await mockApi(page);
  await page.goto('/');

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

  await page.goto('/?share=example.com');

  await expect(page.locator('#audit')).toBeVisible();
  await expect(page.locator('#domain-name')).toHaveText('example.com');
  await expect(page.locator('#agent-btn')).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#agent-btn').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('GEOSCORE-REPAIR-example.com.md');
  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();
  const markdown = await readFile(downloadPath, 'utf8');
  expect(markdown).toContain('geo.author_attribution');
  expect(markdown).toContain('Unified handoff prompt');
  expect(runtimeErrors).toEqual([]);
});
