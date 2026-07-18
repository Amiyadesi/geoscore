import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geoscore-site-archetypes-'));
fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"type":"commonjs"}\n');
fs.symlinkSync(path.resolve('node_modules'), path.join(tmpDir, 'node_modules'), 'junction');

execFileSync(
  process.execPath,
  [
    path.join('node_modules', 'typescript', 'bin', 'tsc'),
    '--target', 'ES2022',
    '--module', 'CommonJS',
    '--moduleResolution', 'node',
    '--esModuleInterop',
    '--lib', 'ES2022',
    '--types', '@cloudflare/workers-types',
    '--skipLibCheck',
    '--rootDir', 'src',
    '--outDir', tmpDir,
    'src/lib/audit-core.ts',
    'src/lib/audit-pages.ts',
    'src/lib/security.ts',
  ],
  { stdio: 'inherit' },
);

const require = createRequire(import.meta.url);
const core = require(path.join(tmpDir, 'lib', 'audit-core.js'));

function fixture(name) {
  return fs.readFileSync(path.join(here, 'fixtures', `${name}.html`), 'utf8');
}

function page(domain, html, pathName = '/', pageType = 'home') {
  return {
    url: `https://${domain}${pathName}`,
    final_url: `https://${domain}${pathName}`,
    page_type: pageType,
    source: 'requested',
    status: 'complete',
    title: 'Fixture',
    locale: html.match(/<html[^>]+lang="([^"]+)"/i)?.[1],
    html,
    headers: new Headers(),
    response_ms: 1,
    status_code: 200,
  };
}

describe('golden site archetype fixtures', () => {
  const cases = [
    ['saas', 'app.example.com', 'saas', 'Orbit Notes', 'Organization'],
    ['ecommerce', 'shop.example.com', 'ecommerce', 'Northwind Tea', 'Brand'],
    ['local-business', 'dentist.example.com', 'local_business', 'Harbour Dental Clinic', 'Dentist'],
    ['news-media', 'news.example.com', 'news_media', 'River City Dispatch', 'NewsMediaOrganization'],
    ['chinese-personal-blog', 'blog.example.com', 'personal_blog', '小林', 'Person'],
    ['unknown', 'unknown.example.com', 'unknown', null, null],
  ];

  for (const [name, domain, expectedArchetype, expectedEntity, expectedEntityType] of cases) {
    it(`classifies ${name} from strong site evidence`, () => {
      const html = fixture(name);
      const context = core.buildAuditContext({
        domain,
        pages: [page(domain, html)],
        industryVertical: name === 'chinese-personal-blog' ? 'cloudflare' : 'artificial_intelligence',
      });

      assert.equal(context.site_archetype, expectedArchetype);
      assert.equal(context.entity?.name ?? null, expectedEntity);
      assert.equal(context.entity?.type ?? null, expectedEntityType);
      assert.equal(context.root_domain, 'example.com');
      assert.equal(context.industry_vertical, name === 'chinese-personal-blog' ? 'cloudflare' : 'artificial_intelligence');
      if (name === 'chinese-personal-blog') assert.equal(context.locale, 'zh-CN');
      if (name === 'unknown') assert.ok(context.confidence < 0.3);
    });
  }

  it('keeps request-local hints isolated from the underlying evidence', () => {
    const html = fixture('saas');
    const hinted = core.buildAuditContext({
      domain: 'app.example.com',
      pages: [page('app.example.com', html)],
      archetypeHint: 'documentation',
    });
    const unhinted = core.buildAuditContext({
      domain: 'app.example.com',
      pages: [page('app.example.com', html)],
    });

    assert.equal(hinted.site_archetype, 'documentation');
    assert.equal(unhinted.site_archetype, 'saas');
    assert.match(hinted.evidence[0]?.value ?? '', /archetype_hint=documentation/);
  });

  it('keeps homepage Blog and Person evidence ahead of weak words from sampled pages', () => {
    const domain = 'blog.sayori.org';
    const home = `<!doctype html><html lang="zh-CN"><head><title>Amiya的书桌</title>
      <script type="application/ld+json">{"@context":"https://schema.org","@graph":[
        {"@type":"WebSite","name":"Amiya的书桌","url":"https://blog.sayori.org/"},
        {"@type":"Blog","name":"Amiya的书桌","url":"https://blog.sayori.org/"},
        {"@type":"Person","name":"Amiya_desi","url":"https://sayori.org/"},
        {"@type":"Organization","name":"Amiya的书桌","url":"https://blog.sayori.org/"}
      ]}</script></head><body><h1>Amiya的书桌</h1></body></html>`;
    const sampledPages = [
      page(domain, home),
      page(domain, '<html lang="zh-CN"><body><h1>关于我</h1><p>我也参与开源 community 的讨论。</p></body></html>', '/about/', 'about'),
      page(domain, '<html lang="zh-CN"><body><article><h1>社区观察</h1><p>An article about community building.</p></article></body></html>', '/posts/community-notes/', 'article'),
      page(domain, '<html lang="zh-CN"><body><h1>文章归档</h1><a href="/posts/community-notes/">归档文章</a></body></html>', '/archives/', 'archive'),
      page(domain, '<html lang="zh-CN"><body><h1>第 2 页</h1><p>More writing and community links.</p></body></html>', '/page/2/', 'listing'),
    ];

    const context = core.buildAuditContext({ domain, pages: sampledPages });

    assert.equal(context.site_archetype, 'personal_blog');
    assert.equal(context.entity?.name, 'Amiya_desi');
    assert.equal(context.entity?.type, 'Person');
    assert.match(context.evidence[0]?.value ?? '', /Blog and Person JSON-LD/);
  });

  it('keeps a product platform identity ahead of sampled article and author schema', () => {
    const domain = 'stripe.com';
    const context = core.buildAuditContext({
      domain,
      pages: [
        page(domain, fixture('stripe-home')),
        page(domain, fixture('stripe-blog'), '/blog/introducing-agentic-commerce', 'article'),
        page(domain, fixture('stripe-docs'), '/docs/api', 'documentation'),
      ],
      industryVertical: 'finance',
    });

    assert.equal(context.site_archetype, 'saas');
    assert.equal(context.entity?.name, 'Stripe');
    assert.notEqual(context.entity?.name, 'Patrick Collison');
    assert.equal(context.business_model, 'software');
    assert.equal(context.industry_vertical, 'finance');
    assert.match(context.evidence[0]?.value ?? '', /product|platform|pricing|application/i);
  });

  it('does not turn a personal weblog into a community because an article mentions one', () => {
    const domain = 'writer.example.com';
    const html = `<!doctype html><html lang="en"><head><title>Sam Rivera's Weblog</title></head><body>
      <header><h1>Sam Rivera's Weblog</h1><nav><a href="/about/">About</a></nav></header>
      <main><article><h2>Notes from a community migration</h2>
        <p>I reviewed a community project and its moderation model.</p>
        <a href="/topics/sqlite/">Read the related topic</a>
      </article></main>
    </body></html>`;

    const context = core.buildAuditContext({ domain, pages: [page(domain, html)] });

    assert.equal(context.site_archetype, 'personal_blog');
    assert.match(context.evidence[0]?.value ?? '', /weblog|personal blog/i);
  });

  it('recognizes a news publisher without letting article words imply a restaurant', () => {
    const domain = 'npr.example.com';
    const html = `<!doctype html><html lang="en"><head>
      <title>NPR - Breaking News, Analysis, Music &amp; Podcasts</title>
      <meta name="description" content="Independent journalism and the latest news.">
    </head><body><nav>
      <a href="/sections/news/">News</a><a href="/sections/world/">World</a>
      <a href="/sections/book-reviews/">Book Reviews</a>
    </nav><main><h1>Top stories</h1>
      <p>A report about a restaurant appears in today's headlines.</p>
    </main></body></html>`;

    const context = core.buildAuditContext({ domain, pages: [page(domain, html)] });

    assert.equal(context.site_archetype, 'news_media');
    assert.match(context.evidence[0]?.value ?? '', /news identity/i);
  });

  it('does not classify an organization as news media from description copy alone', () => {
    const domain = 'nasa.example.com';
    const html = `<!doctype html><html lang="en"><head>
      <title>NASA</title>
      <meta name="description" content="The latest news, images and videos from America's space agency.">
      <script type="application/ld+json">{"@context":"https://schema.org","@graph":[
        {"@type":"Organization","name":"NASA"},
        {"@type":"Article","headline":"Mission update"}
      ]}</script>
    </head><body><nav>
      <a href="/news/">News &amp; Events</a><a href="/about/">About NASA</a>
    </nav><main><h1>Exploring the universe</h1></main></body></html>`;

    const context = core.buildAuditContext({ domain, pages: [page(domain, html)] });

    assert.equal(context.site_archetype, 'other');
    assert.equal(context.entity?.name, 'NASA');
  });

  it('keeps a documentation product ahead of a community navigation link', () => {
    const domain = 'kubernetes.example.com';
    const html = `<!doctype html><html lang="en"><head><title>Kubernetes</title>
      <meta property="og:description" content="Kubernetes is built by a worldwide open-source community.">
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Kubernetes"}</script>
    </head><body><nav>
      <a href="/docs/">Documentation</a><a href="/blog/">Blog</a>
      <a href="/community/">Community</a><a href="/versions/">Versions</a>
    </nav><main><h1>Production-Grade Container Orchestration</h1></main></body></html>`;

    const context = core.buildAuditContext({ domain, pages: [page(domain, html)] });

    assert.equal(context.site_archetype, 'documentation');
  });

  it('keeps a community product with pricing ahead of generic community wording', () => {
    const domain = 'discourse.example.com';
    const html = `<!doctype html><html lang="en"><head><title>Discourse | Where Tech Companies Build Communities</title>
      <meta name="description" content="The customizable community platform powering thousands of communities.">
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Discourse"}</script>
    </head><body><nav>
      <a href="/features">Features</a><a href="/pricing">Pricing</a>
      <a href="/enterprise">Enterprise</a><a href="https://meta.example.net/">Join the community</a>
    </nav><main><h1>Where tech companies build communities</h1></main></body></html>`;

    const context = core.buildAuditContext({ domain, pages: [page(domain, html)] });

    assert.equal(context.site_archetype, 'saas');
  });

  it('recognizes a blog identified as written by a named author', () => {
    const domain = 'overreacted.example.com';
    const html = `<!doctype html><html lang="en"><head>
      <title>overreacted — A blog by Dan Abramov</title>
      <meta name="description" content="A blog by Dan Abramov">
    </head><body><main><h1>Things I Don’t Know</h1>
      <p>Notes about software and learning.</p>
    </main></body></html>`;

    const context = core.buildAuditContext({ domain, pages: [page(domain, html)] });

    assert.equal(context.site_archetype, 'personal_blog');
  });

  it('does not mistake a personal blog archive category for a community forum', () => {
    const domain = 'jvns.example.com';
    const html = `<!doctype html><html lang="en"><head><title>Julia Evans</title></head><body>
      <nav><a href="/about">About</a><a href="/talks">Talks</a><a href="/projects/">Projects</a>
        <a href="/categories/favorite/">Favorites</a><a href="/til/">TIL</a><a href="/atom.xml">RSS</a></nav>
      <main><h1>Julia Evans</h1><p>Notes and blog posts about programming.</p>
        <a href="/blog/2026/one/">One post</a><a href="/blog/2025/two/">Two posts</a><a href="/blog/2024/three/">Three posts</a>
        <p>The wider community is welcome to read along.</p>
      </main></body></html>`;

    const context = core.buildAuditContext({ domain, pages: [page(domain, html)] });

    assert.equal(context.site_archetype, 'personal_blog');
    assert.match(context.evidence[0]?.value ?? '', /blog archive/i);
  });

  it('keeps commerce navigation ahead of community wording in footer copy', () => {
    const domain = 'shoes.example.com';
    const html = `<!doctype html><html lang="en"><head><title>Northwind Shoes</title></head><body>
      <nav><a href="/collections/new/">New arrivals</a><a href="/products/runner/">Runner</a></nav>
      <main><h1>Comfortable shoes</h1><a href="/topics/materials/">Materials story</a></main>
      <footer><a href="/pages/community-offers/">Community offers</a></footer>
    </body></html>`;

    const context = core.buildAuditContext({ domain, pages: [page(domain, html)] });

    assert.equal(context.site_archetype, 'ecommerce');
    assert.match(context.evidence[0]?.value ?? '', /commerce navigation/i);
  });

  it('keeps commerce navigation ahead of sampled editorial schema', () => {
    const domain = 'allbirds.example.com';
    const home = `<!doctype html><html lang="en"><head><title>Allbirds Shoes and Apparel</title></head><body>
      <nav><a href="/collections/new-arrivals">New arrivals</a><a href="/collections/shop-all">Shop all</a></nav>
      <main><h1>Comfortable shoes and apparel</h1></main></body></html>`;
    const article = `<!doctype html><html><head><script type="application/ld+json">{
      "@context":"https://schema.org","@type":"Article","headline":"Materials journal"
    }</script></head><body><article><h1>Materials journal</h1></article></body></html>`;

    const context = core.buildAuditContext({
      domain,
      pages: [page(domain, home), page(domain, article, '/blogs/materials/', 'article')],
    });

    assert.equal(context.site_archetype, 'ecommerce');
    assert.match(context.evidence[0]?.value ?? '', /commerce navigation/i);
  });

  it('does not let Store schema on a sampled page override site-level commerce identity', () => {
    const domain = 'retail.example.com';
    const home = `<!doctype html><html lang="en"><head><title>Northwind Home Furnishings</title>
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Northwind"}</script>
      </head><body><nav><a href="/products/chair">Products</a><a href="/collections/new">Collections</a></nav>
      <main><h1>Furniture for every home</h1></main></body></html>`;
    const store = `<!doctype html><html><head><script type="application/ld+json">{
      "@context":"https://schema.org","@type":"FurnitureStore","name":"Northwind City Store"
    }</script></head><body><h1>City store</h1></body></html>`;

    const context = core.buildAuditContext({
      domain,
      pages: [page(domain, home), page(domain, store, '/city-store/', 'other')],
    });

    assert.equal(context.site_archetype, 'ecommerce');
  });

  it('recognizes a restaurant from menu and reservation structure without schema', () => {
    const domain = 'restaurant.example.com';
    const html = `<!doctype html><html lang="en"><head><title>Northwind Restaurant</title></head><body>
      <nav><a href="/menu/">Menu</a><a href="/reservations/">Reservations</a><a href="/contact/">Contact</a>
        <a href="/shop/">Gift shop</a></nav>
      <main><h1>Northwind</h1><p>Seasonal restaurant dining.</p>
        <p>Our unrelated research project is a non-profit initiative.</p></main></body></html>`;

    const context = core.buildAuditContext({ domain, pages: [page(domain, html)] });

    assert.equal(context.site_archetype, 'local_business');
    assert.match(context.evidence[0]?.value ?? '', /restaurant|reservation|local/i);
  });

  it('recognizes a restaurant with an external reservation provider before an external shop', () => {
    const domain = 'restaurant.example.com';
    const html = `<!doctype html><html lang="en"><head><title>Northern Table</title></head><body>
      <nav><a href="https://booking.example.net/northern-table">Reservations</a>
        <a href="https://shop.example.net/products/sauce">Shop flavors</a></nav>
      <main><h1>Northern Table</h1><p>Our restaurant is rooted in the seasons and local landscape.</p></main>
    </body></html>`;

    const context = core.buildAuditContext({ domain, pages: [page(domain, html)] });

    assert.equal(context.site_archetype, 'local_business');
    assert.match(context.evidence[0]?.value ?? '', /local venue|booking|reservation/i);
  });

  it('keeps homepage local-business schema ahead of product schema on a sampled shop page', () => {
    const domain = 'restaurant.example.com';
    const home = `<!doctype html><html><head><title>Northwind Restaurant</title>
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"Restaurant","name":"Northwind"}</script>
      </head><body><h1>Northwind Restaurant</h1></body></html>`;
    const shop = `<!doctype html><html><head><title>Northwind Gift Shop</title>
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Cookbook"}</script>
      </head><body><h1>Cookbook</h1></body></html>`;

    const context = core.buildAuditContext({
      domain,
      pages: [page(domain, home), page(domain, shop, '/shop/cookbook/', 'product')],
    });

    assert.equal(context.site_archetype, 'local_business');
  });

  it('keeps a documentation site ahead of nonprofit footer wording', () => {
    const domain = 'docs.python.example.com';
    const html = `<!doctype html><html lang="en"><head><title>Python 3 Documentation</title></head><body>
      <nav><a href="/3/reference/">Language reference</a><a href="/3/library/">Library</a></nav>
      <main><h1>Python documentation</h1><p>Technical reference and guides.</p></main>
      <footer>The Python Software Foundation is a non-profit organization. <a href="/donate/">Donate</a></footer>
    </body></html>`;

    const context = core.buildAuditContext({ domain, pages: [page(domain, html)] });

    assert.equal(context.site_archetype, 'documentation');
  });

  it('keeps direct documentation navigation ahead of external community links', () => {
    const domain = 'framework.example.com';
    const html = `<!doctype html><html lang="en"><head><title>Northwind - The Progressive JavaScript Framework</title></head><body>
      <nav><a href="/guide/introduction">Guide</a><a href="/api/">API</a>
        <a href="https://github.com/northwind/core/discussions">GitHub Discussions</a>
        <a href="/about/community-guide">Community Guide</a></nav>
      <main><h1>The Progressive JavaScript Framework</h1><p>Learn from the community and build applications.</p></main>
    </body></html>`;

    const context = core.buildAuditContext({ domain, pages: [page(domain, html)] });

    assert.equal(context.site_archetype, 'documentation');
  });

  it('keeps a question-and-answer community ahead of its commercial product links', () => {
    const domain = 'questions.example.com';
    const html = `<!doctype html><html lang="en"><head><title>Newest Questions - Northwind Overflow</title>
      <script type="application/ld+json">{"@context":"https://schema.org","@type":["Organization","WebSite"],"name":"Northwind Overflow"}</script>
      </head><body><nav><a href="/questions">Questions</a><a href="/tags">Tags</a>
        <a href="/users/signup">Sign up</a><a href="https://company.example.net/platform">Enterprise platform</a></nav>
      <main><h1>Newest Questions</h1><p>A community for developers to ask and answer technical questions.</p></main>
    </body></html>`;

    const context = core.buildAuditContext({ domain, pages: [page(domain, html)] });

    assert.equal(context.site_archetype, 'community');
  });

  it('does not classify a generic page from one documentation word in body copy', () => {
    const domain = 'example.com';
    const html = `<!doctype html><html lang="en"><head><title>Example Domain</title></head><body>
      <h1>Example Domain</h1><p>This domain is for use in documentation examples without needing permission.</p>
    </body></html>`;

    const context = core.buildAuditContext({ domain, pages: [page(domain, html)] });

    assert.equal(context.site_archetype, 'unknown');
  });

  it('does not turn a nonprofit into a community because it is member-supported', () => {
    const domain = 'rights.example.com';
    const html = `<!doctype html><html lang="en"><head>
      <title>Digital Rights Foundation</title></head><body>
      <main><h1>Defending rights in the digital world</h1>
        <p>We are a nonprofit powered by members and the wider community.</p>
        <a href="/donate/">Donate</a><a href="/shop/">Supporter shop</a>
      </main>
    </body></html>`;

    const context = core.buildAuditContext({ domain, pages: [page(domain, html)] });

    assert.equal(context.site_archetype, 'nonprofit');
    assert.match(context.evidence[0]?.value ?? '', /nonprofit/i);
  });

  it('recognizes a single-page personal portfolio without requiring JSON-LD', () => {
    const domain = 'designer.example.com';
    const html = `<!doctype html><html lang="en"><head><title>Britt Rivera</title></head><body>
      <header><h1>Britt Rivera</h1><nav>
        <a href="#about">About</a><a href="#experience">Experience</a><a href="#projects">Projects</a>
      </nav></header>
      <main><section id="about"><p>I build accessible digital products.</p></section>
        <section id="projects"><h2>Selected projects</h2><p>A community website and design system.</p></section>
      </main>
    </body></html>`;

    const context = core.buildAuditContext({ domain, pages: [page(domain, html)] });

    assert.equal(context.site_archetype, 'portfolio');
    assert.match(context.evidence[0]?.value ?? '', /portfolio|profile/i);
  });

  it('keeps an explicit forum identity ahead of weak product words embedded in scripts', () => {
    const domain = 'nodeloc.example.com';
    const html = `<!doctype html><html lang="zh-CN"><head>
      <title>NodeLoc - 自由、平等、友好、开放、有趣的交流社区</title>
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"WebSite","name":"NodeLoc"}</script>
      <script>window.__APP__ = { html: '<a href="/docs">API platform software</a>' };</script>
    </head><body>
      <header><h1>NodeLoc 交流社区</h1></header>
      <nav><a href="/login">登录</a><a href="/categories">分类</a><a href="/latest">最新主题</a></nav>
      <main><p>自由、平等、友好、开放、有趣的交流社区</p></main>
    </body></html>`;

    const context = core.buildAuditContext({ domain, pages: [page(domain, html)] });

    assert.equal(context.site_archetype, 'community');
    assert.equal(context.business_model, 'community');
    assert.match(context.evidence[0]?.value ?? '', /community|forum/i);
  });

  it('reads unquoted JSON-LD and uses a prominent same-site docs link', () => {
    const domain = 'kubernetes.example.com';
    const html = `<!doctype html><html lang="en"><head><title>Kubernetes</title>
      <script type=application/ld+json>{"@context":"https://schema.org","@type":"Organization","url":"https://${domain}"}</script>
      </head><body><header><a class=nav-link href=/docs/home/><span>Documentation</span></a></header>
      <main><h1>Production-Grade Container Orchestration</h1></main></body></html>`;

    const context = core.buildAuditContext({ domain, pages: [page(domain, html)] });

    assert.equal(context.site_archetype, 'documentation');
    assert.match(context.evidence[0]?.value ?? '', /documentation/i);
  });

  it('does not let a featured homepage article redefine an organization site or its entity', () => {
    const domain = 'space.example.com';
    const html = `<!doctype html><html lang="en"><head><title>Space Agency</title>
      <script type="application/ld+json">{"@context":"https://schema.org","@graph":[
        {"@type":"Organization","name":"Space Agency","url":"https://${domain}/"},
        {"@type":"WebSite","name":"Space Agency","url":"https://${domain}/"},
        {"@type":"Person","@id":"https://${domain}/#author","name":"Feature Author","worksFor":{"@id":"https://${domain}/#organization"}},
        {"@type":"Article","headline":"Mission update","author":{"@id":"https://${domain}/#author","name":"Feature Author"}}
      ]}</script></head><body><main><h1>Space Agency</h1></main></body></html>`;

    const context = core.buildAuditContext({
      domain,
      pages: [
        page(domain, html),
        page(domain, '<html><body><main><h1>Projects</h1><p>Research projects and mission updates.</p></main></body></html>', '/projects/', 'other'),
      ],
    });

    assert.equal(context.site_archetype, 'other');
    assert.equal(context.entity?.name, 'Space Agency');
    assert.equal(context.entity?.type, 'Organization');
  });

  it('recognizes a schema-backed personal portfolio even when the person also uses Organization', () => {
    const domain = 'designer.example.com';
    const html = `<!doctype html><html lang="en"><head>
      <title>Adham Example | Product designer &amp; front end developer</title>
      <script type="application/ld+json">{"@context":"https://schema.org","@graph":[
        {"@type":"WebSite","@id":"https://${domain}/#website","url":"https://${domain}/","name":"Adham Example"},
        {"@type":["Person","Organization"],"@id":"https://${domain}/#/schema/person/profile-id","name":"Adham Example"}
      ]}</script></head><body>
      <nav><a href="/about/">About</a><a href="/portfolio/">Portfolio</a><a href="/blog/">Blog</a></nav>
      <main><h1>designer &lt; coder &gt;</h1><p>Selected projects and product design work.</p></main>
    </body></html>`;

    const context = core.buildAuditContext({ domain, pages: [page(domain, html)] });

    assert.equal(context.site_archetype, 'portfolio');
    assert.equal(context.entity?.name, 'Adham Example');
    assert.equal(context.entity?.type, 'Person');
    assert.match(context.evidence[0]?.value ?? '', /portfolio/i);
  });

  it('recognizes a named personal publication from its about and blog structure', () => {
    const domain = 'author.example.com';
    const html = `<!doctype html><html lang="en"><head>
      <title>Josh W. Example</title>
      <meta name="description" content="Friendly articles and tutorials for front-end developers.">
    </head><body><nav><a href="/about-josh/">About Josh</a><a href="/blog/">Blog</a></nav>
      <main><h1>Josh W Example homepage</h1><a href="/blog/an-article/">Read the latest article</a></main>
    </body></html>`;

    const context = core.buildAuditContext({ domain, pages: [page(domain, html)] });

    assert.equal(context.site_archetype, 'personal_blog');
    assert.match(context.evidence[0]?.value ?? '', /personal|author|publication/i);
  });

  it('recognizes a discussion community from Open Graph identity and discussion navigation', () => {
    const domain = 'links.example.com';
    const html = `<!doctype html><html lang="en"><head><title>Lobsters</title>
      <meta property="og:description" content="A computing-focused community centered around link aggregation and discussion.">
    </head><body><nav><a href="/active">Active</a><a href="/recent">Recent</a><a href="/comments">Comments</a></nav>
      <main><h1>Stories</h1><a href="/s/example/story">12 comments</a></main>
    </body></html>`;

    const context = core.buildAuditContext({ domain, pages: [page(domain, html)] });

    assert.equal(context.site_archetype, 'community');
    assert.match(context.evidence[0]?.value ?? '', /community|forum/i);
  });

  it('recognizes a visible magazine identity with primary article navigation', () => {
    const domain = 'magazine.example.com';
    const html = `<!doctype html><html lang="en"><head>
      <title>Smashing Magazine - For Web Designers And Developers</title>
    </head><body><nav><a href="/articles/">Articles</a><a href="/topics/">Topics</a>
      <a href="/newsletter/">Newsletter</a></nav><main><h1>Smashing Magazine</h1></main></body></html>`;

    const context = core.buildAuditContext({ domain, pages: [page(domain, html)] });

    assert.equal(context.site_archetype, 'editorial');
    assert.match(context.evidence[0]?.value ?? '', /editorial|publication|magazine/i);
  });

  it('does not treat a single product catalogue link as ecommerce when nonprofit identity is explicit', () => {
    const domain = 'mozilla.example.com';
    const html = `<!doctype html><html lang="en"><head><title>Mozilla - Internet for people, not profit</title></head><body>
      <nav><a href="/products/">Products</a><a href="/about/">About us</a><a href="/contribute/">Get involved</a></nav>
      <main><h1>Welcome to Mozilla</h1></main></body></html>`;

    const context = core.buildAuditContext({ domain, pages: [page(domain, html)] });

    assert.equal(context.site_archetype, 'nonprofit');
  });

  it('recognizes commerce from a same-site cart subdomain without a cart path', () => {
    const domain = 'market.example.com';
    const html = `<!doctype html><html lang="en"><head><title>Market - Electronics, Fashion and Collectibles</title></head><body>
      <nav><a href="https://signin.example.com/">Sign in</a><a href="https://cart.example.com/" aria-label="Cart"></a>
        <a href="/sell/">Sell</a><a href="/purchase-history/">Purchase history</a></nav>
      <main><h1>Shop millions of items</h1></main></body></html>`;

    const context = core.buildAuditContext({ domain, pages: [page(domain, html)] });

    assert.equal(context.site_archetype, 'ecommerce');
  });

  it('recognizes professional services from services and industries navigation', () => {
    const domain = 'advisory.example.com';
    const html = `<!doctype html><html lang="en"><head><title>Reinvent your business | Northwind Advisory</title></head><body>
      <nav><a href="/industries/">Industries</a><a href="/services/">Services</a>
        <a href="/services/audit-assurance/">Audit and assurance</a><a href="/services/consulting/">Consulting</a></nav>
      <main><h1>Seize tomorrow's technology to reinvent your business</h1></main></body></html>`;

    const context = core.buildAuditContext({ domain, pages: [page(domain, html)] });

    assert.equal(context.site_archetype, 'professional_services');
  });
});
