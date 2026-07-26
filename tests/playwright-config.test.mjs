import assert from 'node:assert/strict';
import test from 'node:test';

import config from '../playwright.config.mjs';

test('Playwright starts the GeoScore frontend instead of reusing an arbitrary local server', () => {
  const baseUrl = new URL(config.use.baseURL);

  assert.equal(config.webServer.reuseExistingServer, false);
  assert.equal(config.webServer.url, config.use.baseURL);
  assert.equal(config.webServer.env.PORT, baseUrl.port);
  assert.notEqual(baseUrl.port, '4173');
});
