import { CHECK_TITLES, type AuditContext, type AuditRecommendation, type NormalizedCheck } from './audit-contract';

const PRIORITIES: Record<string, number> = {
  'seo.page_fetch': 100, 'seo.indexability': 98, 'seo.robots': 96, 'seo.https_transport': 95,
  'geo.extractability': 94, 'seo.sitemap': 88, 'seo.mobile_viewport': 87,
  'seo.canonical': 86, 'seo.title': 85, 'seo.meta_description': 83, 'seo.h1': 82,
  'geo.entity_identity': 90, 'geo.entity_consistency': 84, 'geo.author_signal': 82,
  'geo.claim_source_support': 81, 'geo.statistic_provenance': 80,
  'seo.schema_fit': 84, 'seo.schema_presence': 82, 'seo.response_time': 80,
  'seo.cwv_lcp': 83, 'seo.cwv_cls': 83, 'seo.cwv_inp': 82,
  'seo.lab_performance': 81, 'seo.lab_lcp': 81, 'seo.lab_cls': 81,
  'seo.mobile_usability': 80, 'geo.cross_page_consistency': 78,
  'seo.html_conformance': 62, 'seo.open_graph': 60, 'seo.heading_hierarchy': 60,
  'seo.image_alt': 60, 'seo.title_length': 58, 'seo.meta_description_length': 57,
  'seo.html_compression': 56, 'seo.render_blocking': 55, 'seo.page_weight': 54,
  'seo.dom_size': 54, 'seo.form_labels': 54, 'seo.aria_landmarks': 53,
  'seo.descriptive_links': 52, 'seo.skip_navigation': 50, 'seo.internal_links': 50,
  'seo.image_dimensions': 49, 'seo.responsive_images': 49, 'seo.hreflang': 48,
  'seo.rss_feed': 45, 'geo.direct_answer': 58, 'geo.freshness': 52,
};

function recommendationCopy(checkItem: NormalizedCheck, zh: boolean) {
  const generic = zh
    ? { why: '该检查基于当前页面的可验证证据失败，会影响搜索引擎或 AI 系统理解页面。', fix: '根据检测证据修复对应页面，并保持内容与结构化数据一致。', verify: '重新审计该 URL，确认检查状态变为 pass。' }
    : { why: 'This check failed on verifiable page evidence and can reduce search or AI understanding.', fix: 'Correct the affected page using the observed evidence and keep visible content aligned with structured data.', verify: 'Re-audit the URL and confirm this check changes to pass.' };
  const copies: Record<string, { title: string; why: string; fix: string; verify: string }> = {
    'seo.indexability': zh
      ? { title: '移除意外的 noindex', why: '目标页明确声明 noindex，搜索引擎不会将它纳入正常索引。', fix: '如果页面应公开收录，移除 meta robots 或响应头中的 noindex；若本来就应隐藏，则无需修改。', verify: '检查页面源码和响应头，再用 URL Inspection 复验。' }
      : { title: 'Remove the unintended noindex directive', why: 'The target page explicitly asks search engines not to index it.', fix: 'If the page should be public, remove noindex from meta robots or response headers.', verify: 'Inspect source and headers, then re-test with URL Inspection.' },
    'seo.robots': zh
      ? { title: '修复 robots.txt 的抓取限制', why: 'robots.txt 的可验证规则阻止了站点或 Googlebot 抓取公开页面。', fix: '删除面向 User-agent: * 或 Googlebot 的意外 Disallow: /；只保留确实需要阻止的私有路径。', verify: '直接访问 robots.txt，用 Google robots.txt Tester 或重新审计确认公开页面不再被阻止。' }
      : { title: 'Remove the blocking robots.txt rule', why: 'A verified robots.txt rule prevents the site or Googlebot from crawling public pages.', fix: 'Remove unintended Disallow: / rules for User-agent: * or Googlebot, keeping only paths that should remain private.', verify: 'Open robots.txt and re-test until public pages are no longer blocked.' },
    'seo.sitemap': zh
      ? { title: '发布并声明 XML sitemap', why: '未能验证站点地图，代表页面的发现和更新信号会更弱。', fix: '生成包含 canonical URL 的 sitemap.xml，并在 robots.txt 中添加 Sitemap 指令。', verify: '访问 sitemap URL，确认返回有效 XML 后重新审计。' }
      : { title: 'Publish and declare an XML sitemap', why: 'No sitemap could be verified, weakening page discovery and update signals.', fix: 'Publish sitemap.xml with canonical URLs and reference it from robots.txt.', verify: 'Open the sitemap URL, validate its XML, and re-run the audit.' },
    'seo.canonical': zh
      ? { title: '为目标页添加 canonical', why: '页面没有声明首选 URL，重复内容信号可能被拆分。', fix: '在 head 中添加指向最终公开 URL 的 rel="canonical"。', verify: '查看渲染后的 head，并重新审计该 URL。' }
      : { title: 'Add a canonical URL to the target page', why: 'The page does not declare its preferred URL, so duplicate signals may be split.', fix: 'Add rel="canonical" in head pointing to the final public URL.', verify: 'Inspect the rendered head and re-audit this URL.' },
    'seo.title': zh
      ? { title: '为目标页添加唯一标题', why: '页面源码中没有可验证的 title，搜索结果和浏览器无法获得稳定的页面名称。', fix: '在 head 中添加简洁、唯一且与可见内容一致的 title；不要堆砌关键词。', verify: '查看页面源码中的 title，并重新审计该 URL。' }
      : { title: 'Add a unique page title', why: 'No verifiable title was found in the page source, leaving search results without a stable page name.', fix: 'Add a concise, unique title aligned with the visible content and avoid keyword stuffing.', verify: 'Inspect the title in page source and re-audit this URL.' },
    'seo.meta_description': zh
      ? { title: '补充 Meta description', why: '该页面缺少可供搜索结果和 AI 摘要使用的简洁描述。', fix: '添加与页面内容一致、具体且不虚构业务信息的 meta description。', verify: '查看页面源码中的 description，再重新审计。' }
      : { title: 'Add a specific meta description', why: 'The page lacks a concise description for search snippets and AI summaries.', fix: 'Add a factual meta description aligned with the visible page content.', verify: 'Inspect the description in page source and re-run the audit.' },
    'seo.h1': zh
      ? { title: '修复页面主标题结构', why: '页面没有且仅有一个可验证的 H1，主主题层级不清晰。', fix: '让每个页面保留一个描述该页核心主题的 H1，并将其他章节标题改为 H2/H3。', verify: '检查渲染后的标题层级，确认只有一个 H1 后重新审计。' }
      : { title: 'Fix the primary heading structure', why: 'The page does not have exactly one verifiable H1, making its main topic ambiguous.', fix: 'Keep one H1 that describes the page topic and use H2/H3 for subordinate sections.', verify: 'Inspect the rendered heading outline and re-audit after exactly one H1 remains.' },
    'seo.schema_fit': zh
      ? { title: '补齐与站点类型匹配的结构化数据', why: '页面已有结构化数据，但缺少证据中列出的适用类型，搜索和 AI 系统无法完整理解站点身份或页面关系。', fix: '只补充证据中列出的缺失 JSON-LD 类型和页面已经公开的真实字段，不添加与站点类型或可见内容无关的标记。', verify: '使用 Schema.org Validator 验证，并重新审计确认 schema fit 变为 pass。' }
      : { title: 'Complete the structured data for this site archetype', why: 'Structured data exists, but applicable types listed in the evidence are missing, leaving the site identity or page relationships incomplete.', fix: 'Add only the missing JSON-LD types listed in the evidence and fields supported by visible content.', verify: 'Validate with Schema.org Validator and re-audit until schema fit passes.' },
    'seo.html_conformance': zh
      ? { title: '修复已验证的 HTML 错误', why: 'W3C Nu 在目标页源码中发现了具体的 HTML 错误，可能妨碍解析器稳定理解页面结构。', fix: '按证据中的行号和错误信息修复源码；警告本身不视为失败。', verify: '重新运行 W3C Nu 检查并确认错误数为 0，再重新审计。' }
      : { title: 'Fix the validated HTML errors', why: 'W3C Nu found concrete HTML errors in the target source that can make document structure less reliable to parsers.', fix: 'Correct the source at the reported lines; warnings alone are not treated as failures.', verify: 'Re-run W3C Nu until the error count is zero, then re-audit.' },
    'geo.entity_identity': zh
      ? { title: '用可信 schema 明确站点实体', why: '没有找到可验证的 Person、Organization 或适用实体名称。', fix: '按站点类型添加 Person 或 Organization JSON-LD，名称和 URL 必须与页面可见信息一致。', verify: '使用 Schema.org Validator 验证，再重新审计。' }
      : { title: 'Define the site entity with trusted schema', why: 'No verifiable Person, Organization, or applicable entity name was found.', fix: 'Add Person or Organization JSON-LD appropriate to the site, matching visible names and URLs.', verify: 'Validate with Schema.org Validator and re-run the audit.' },
    'geo.author_signal': zh
      ? { title: '补充作者归属信息', why: '当前内容没有可靠的作者实体或文章作者元数据。', fix: '在文章可见区域标明作者，并用 Person 与 Article author JSON-LD 连接。', verify: '验证 Article.author 指向 Person，并重新审计代表文章。' }
      : { title: 'Add explicit author attribution', why: 'The content lacks a reliable author entity or article author metadata.', fix: 'Show the author visibly and connect Article.author to Person JSON-LD.', verify: 'Validate Article.author and re-audit a representative article.' },
    'geo.extractability': zh
      ? { title: '让核心内容可直接提取', why: '抓取到的正文证据不足，搜索和 AI 系统可能只看到空壳。', fix: '将标题、摘要和核心正文输出到服务端 HTML，并使用清晰的 H1/H2 结构。', verify: '禁用 JavaScript 查看页面源码，确认核心正文仍存在后重新审计。' }
      : { title: 'Make core content directly extractable', why: 'Too little body evidence was fetched, so search and AI systems may see an empty shell.', fix: 'Render the title, summary, and core copy in server HTML with clear H1/H2 structure.', verify: 'Disable JavaScript, inspect source, and re-run the audit.' },
  };
  const language = zh ? 'zh' : 'en';
  const fallbackTitle = checkItem.localized_title?.[language]
    ?? CHECK_TITLES[checkItem.id]?.[language]
    ?? checkItem.title;
  if (copies[checkItem.id]) return copies[checkItem.id];

  const metadataQuality = new Set([
    'seo.title_length', 'seo.meta_description_length', 'seo.open_graph', 'seo.hreflang',
  ]);
  const mobileQuality = new Set(['seo.mobile_viewport', 'seo.mobile_usability']);
  const structureQuality = new Set(['seo.heading_hierarchy', 'seo.internal_links']);
  const imageQuality = new Set(['seo.image_alt', 'seo.image_dimensions', 'seo.responsive_images']);
  const accessibilityQuality = new Set(['seo.form_labels', 'seo.aria_landmarks', 'seo.descriptive_links', 'seo.skip_navigation']);
  const deliveryQuality = new Set(['seo.response_time', 'seo.render_blocking', 'seo.html_compression', 'seo.page_weight', 'seo.dom_size']);
  const performanceQuality = new Set([
    'seo.cwv_lcp', 'seo.cwv_cls', 'seo.cwv_inp', 'seo.cwv_fcp', 'seo.cwv_ttfb',
    'seo.lab_performance', 'seo.lab_lcp', 'seo.lab_cls', 'seo.lab_tbt',
  ]);
  const sourceQuality = new Set(['geo.claim_source_support', 'geo.statistic_provenance']);

  if (checkItem.id === 'seo.https_transport') {
    return zh
      ? { title: '为公开页面启用完整 HTTPS', why: '目标页没有通过 HTTPS 提供，属于抓取、信任与浏览器安全的基础故障。', fix: '配置有效证书，并将 HTTP 永久重定向到同一 HTTPS canonical URL；同时修复混合内容。', verify: '分别请求 HTTP 与 HTTPS URL，确认最终为 HTTPS 200 且无混合内容后重新审计。' }
      : { title: 'Serve the public page entirely over HTTPS', why: 'The target page is not available over HTTPS, which is a foundational crawl, trust, and browser-security failure.', fix: 'Install a valid certificate, permanently redirect HTTP to the matching HTTPS canonical URL, and remove mixed content.', verify: 'Request both HTTP and HTTPS, confirm the final response is HTTPS 200 with no mixed content, then re-audit.' };
  }
  if (metadataQuality.has(checkItem.id)) {
    return zh
      ? { title: `修复${fallbackTitle}`, why: '当前 metadata 的长度、完整性或语言映射没有满足已验证条件，可能导致搜索摘要截断或页面关系不清晰。', fix: '只修改证据指向的字段：标题保持唯一且简洁，description 与可见内容一致，Open Graph 补齐核心字段，多语言页添加互相对应的 hreflang。', verify: '检查最终 HTML head 中的对应标签和值，并重新审计目标页。' }
      : { title: `Fix ${fallbackTitle}`, why: 'The verified metadata length, completeness, or language mapping does not meet the check, which can produce truncated snippets or ambiguous page relationships.', fix: 'Change only the evidenced field: keep titles unique and concise, align descriptions with visible copy, complete core Open Graph fields, and add reciprocal hreflang only for verified language variants.', verify: 'Inspect the final HTML head for the exact tags and values, then re-audit the target page.' };
  }
  if (mobileQuality.has(checkItem.id)) {
    return zh
      ? { title: `修复${fallbackTitle}`, why: '页面的 viewport、字体或点击目标证据表明基础移动端体验不可靠。', fix: '添加正确的 width=device-width viewport，移除过小的正文文字，并让交互控件具备足够可点击尺寸和间距。', verify: '在窄屏真实浏览器中检查布局和交互，再运行移动端审查。' }
      : { title: `Fix ${fallbackTitle}`, why: 'Viewport, font-size, or tap-target evidence shows that the basic mobile experience is unreliable.', fix: 'Add a correct width=device-width viewport, remove undersized body text, and give interactive controls adequate target size and spacing.', verify: 'Inspect the page in a narrow real browser viewport and re-run the mobile audit.' };
  }
  if (structureQuality.has(checkItem.id)) {
    return zh
      ? { title: `改进${fallbackTitle}`, why: '当前页面结构让主题层级或站内关系难以被稳定解析。', fix: '按 H1→H2→H3 顺序组织标题，并从正文中加入指向真实相关页面的描述性内部链接。', verify: '检查渲染后的 heading outline 和内部链接目标，再重新审计。' }
      : { title: `Improve ${fallbackTitle}`, why: 'The current document structure makes topic hierarchy or internal page relationships harder to parse reliably.', fix: 'Use an H1→H2→H3 heading order and add descriptive internal links to genuinely related pages from the visible content.', verify: 'Inspect the rendered heading outline and internal destinations, then re-audit.' };
  }
  if (imageQuality.has(checkItem.id)) {
    return zh
      ? { title: `修复${fallbackTitle}`, why: '已发现图片缺少替代文本、稳定尺寸或响应式候选，影响可访问性与加载稳定性。', fix: '为信息型图片写与内容一致的 alt，为装饰图使用空 alt；声明 width/height，并为大图提供 srcset/sizes。', verify: '检查证据列出的 img 元素，确认属性已输出到最终 HTML 后重新审计。' }
      : { title: `Fix ${fallbackTitle}`, why: 'Verified images lack alternative text, stable dimensions, or responsive candidates, affecting accessibility and loading stability.', fix: 'Write factual alt text for informative images and empty alt for decorative ones; declare width/height and provide srcset/sizes for large images.', verify: 'Inspect the evidenced img elements in final HTML and re-run the audit.' };
  }
  if (accessibilityQuality.has(checkItem.id)) {
    return zh
      ? { title: `修复${fallbackTitle}`, why: 'WCAG 结构证据显示表单、地标、链接文本或键盘跳转信息不完整。', fix: '为输入控件关联 label/ARIA 标签，使用 main/nav 地标，替换“点击这里”等泛化链接文字，并添加可聚焦的跳过导航链接。', verify: '用键盘遍历页面并检查可访问性树，确认对应规则通过后重新审计。' }
      : { title: `Fix ${fallbackTitle}`, why: 'WCAG structure evidence shows incomplete form labels, landmarks, link text, or keyboard navigation.', fix: 'Associate inputs with labels or ARIA names, use main/nav landmarks, replace generic link text, and add a focusable skip-navigation link.', verify: 'Keyboard-test the page and inspect the accessibility tree, then re-audit until the rule passes.' };
  }
  if (deliveryQuality.has(checkItem.id)) {
    return zh
      ? { title: `优化${fallbackTitle}`, why: '服务器响应或 HTML 交付证据超过了本检查的明确阈值。', fix: '根据证据处理对应瓶颈：缓存或优化后端、为脚本添加 defer/async、启用 Brotli/Gzip、缩减初始 HTML 与不必要 DOM。', verify: '重新抓取最终响应并比较响应时间、编码、文档体积、DOM 数或阻塞脚本数量。' }
      : { title: `Improve ${fallbackTitle}`, why: 'Server-response or HTML-delivery evidence exceeds the explicit threshold for this check.', fix: 'Address the evidenced bottleneck: cache or optimize backend work, defer non-critical scripts, enable Brotli/Gzip, and reduce initial HTML or unnecessary DOM.', verify: 'Fetch the final response again and compare latency, encoding, document size, DOM count, or blocking scripts.' };
  }
  if (performanceQuality.has(checkItem.id)) {
    return zh
      ? { title: `改善${fallbackTitle}`, why: 'CrUX 现场数据或 PageSpeed 实验室数据超过了良好体验阈值。', fix: '以证据中的具体指标为目标：优化首屏关键资源与 LCP 元素，预留媒体尺寸减少 CLS，拆分长任务并降低主线程阻塞。', verify: '重新运行 PageSpeed，并在有足够真实流量后复查 CrUX p75；确认该指标进入良好阈值。' }
      : { title: `Improve ${fallbackTitle}`, why: 'CrUX field data or PageSpeed lab evidence is outside the good-experience threshold.', fix: 'Target the evidenced metric: optimize critical resources and the LCP element, reserve media space to reduce CLS, and split long tasks to reduce main-thread blocking.', verify: 'Re-run PageSpeed and later review CrUX p75 after sufficient traffic; confirm the metric reaches the good threshold.' };
  }
  if (checkItem.id === 'seo.rss_feed') {
    return zh
      ? { title: '发布可发现的 RSS 或 Atom feed', why: '这是内容发布型站点，但首页没有声明可验证的订阅源。', fix: '生成包含真实 canonical 文章 URL 的 RSS/Atom feed，并在 head 中添加 alternate feed link。', verify: '访问 feed URL，验证 XML 并确认首页 head 能发现它后重新审计。' }
      : { title: 'Publish a discoverable RSS or Atom feed', why: 'This is a publishing-oriented site, but the homepage does not declare a verifiable feed.', fix: 'Generate an RSS/Atom feed containing real canonical article URLs and link it from the homepage head.', verify: 'Open and validate the feed XML, confirm discovery from the homepage head, and re-audit.' };
  }
  if (checkItem.id === 'seo.schema_presence') {
    return zh
      ? { title: '添加与页面事实一致的基础结构化数据', why: '目标页没有发现可验证的 JSON-LD 实体或页面类型。', fix: '按已识别的站点类型添加最小的 Person、Organization、WebSite、Article 或其他适用 schema，只填写页面公开支持的字段。', verify: '用 Schema.org Validator 验证 JSON-LD，并重新审计确认 schema presence 通过。' }
      : { title: 'Add baseline structured data grounded in page facts', why: 'No verifiable JSON-LD entity or page type was found on the target page.', fix: 'Add the minimum Person, Organization, WebSite, Article, or other schema appropriate to the detected archetype, using only publicly supported fields.', verify: 'Validate the JSON-LD with Schema.org Validator and re-audit until schema presence passes.' };
  }
  if (checkItem.id === 'geo.entity_consistency' || checkItem.id === 'geo.cross_page_consistency') {
    return zh
      ? { title: `统一${fallbackTitle}`, why: '抽样页面对站点或实体名称给出了互相冲突的可验证信号。', fix: '确定一个公开主名称，并在 title、站点名称、JSON-LD name/url 和作者/发布者关系中保持一致；不要把文章作者当作站点品牌。', verify: '检查所有证据页面的 metadata 与 JSON-LD，再进行整站重新审计。' }
      : { title: `Align ${fallbackTitle}`, why: 'Sampled pages expose conflicting verifiable names for the site or entity.', fix: 'Choose one public primary name and keep title, site name, JSON-LD name/url, and author/publisher relationships consistent; do not treat an article author as the site brand.', verify: 'Inspect metadata and JSON-LD on every evidenced page, then re-run the site audit.' };
  }
  if (checkItem.id === 'geo.direct_answer') {
    return zh
      ? { title: '在适用页面增加直接回答段落', why: '该页面类型需要回答明确问题，但开头没有可独立提取的简洁答案。', fix: '在主标题后先用一段话直接回答核心问题，再展开背景、步骤和限制；不得为了分数制造 FAQ。', verify: '读取禁用 JavaScript 后的正文开头，确认答案完整可理解，再重新审计。' }
      : { title: 'Add a direct answer paragraph where applicable', why: 'This page type addresses a clear question, but its opening lacks a concise answer that stands on its own.', fix: 'Answer the core question in one paragraph immediately after the main heading, then expand with context, steps, and limitations; do not manufacture an FAQ.', verify: 'Read the opening with JavaScript disabled, confirm it is independently understandable, and re-audit.' };
  }
  if (sourceQuality.has(checkItem.id)) {
    return zh
      ? { title: `补齐${fallbackTitle}`, why: '检测到的主张或统计数字没有与可验证来源建立足够关联。', fix: '在相应句子附近链接原始资料、数据集或可信一手来源，并写明日期、口径和适用范围。', verify: '逐条检查证据中的主张或数字，确认相邻来源可访问且支持原文后重新审计。' }
      : { title: `Complete ${fallbackTitle}`, why: 'Detected claims or statistics are not sufficiently connected to verifiable sources.', fix: 'Link the relevant sentence to primary material, datasets, or reliable first-party sources and state the date, methodology, and scope.', verify: 'Review each evidenced claim or number, confirm the adjacent source is accessible and supports it, then re-audit.' };
  }
  if (checkItem.id === 'geo.freshness') {
    return zh
      ? { title: '为文章或文档补充发布日期与更新时间', why: '适用的内容页没有公开可验证的 published/modified 时间信号。', fix: '在可见页面和 Article/TechArticle metadata 中提供真实发布日期；只有内容实质更新时才修改 updated 时间。', verify: '检查最终 HTML 与 JSON-LD 的日期一致且可解析，再重新审计代表页。' }
      : { title: 'Add publication and update dates to the content page', why: 'An applicable article or documentation page lacks a public, verifiable published/modified signal.', fix: 'Expose the real publication date in visible copy and Article/TechArticle metadata; change the updated date only after a substantive edit.', verify: 'Confirm final HTML and JSON-LD dates agree and parse correctly, then re-audit the representative page.' };
  }
  return { title: fallbackTitle, ...generic };
}

export function buildRecommendations(context: AuditContext, checks: NormalizedCheck[]): AuditRecommendation[] {
  const zh = context.locale.toLowerCase().startsWith('zh');
  return checks
    // Zero-weight checks are informational/provider probes. They remain in the
    // report as evidence, but must not create a repair task with no score impact.
    .filter(item => item.status === 'fail' && !item.predicted && item.weight > 0)
    .map(item => {
      const localized = {
        en: recommendationCopy(item, false),
        zh: recommendationCopy(item, true),
      };
      const copy = localized[zh ? 'zh' : 'en'];
      const severityBase = { critical: 90, major: 72, minor: 45, info: 0 }[item.severity];
      const priority = PRIORITIES[item.id] ?? severityBase + Math.round(item.weight * item.confidence * 3);
      const evidence = item.evidence.join('; ') || (zh ? '该页面未满足检查条件' : 'The page did not satisfy this check');
      const impact: AuditRecommendation['impact'] = priority >= 80 ? 'high' : priority >= 55 ? 'medium' : 'low';
      const effort: AuditRecommendation['effort'] = priority >= 90 ? 'medium' : 'low';
      return {
        id: item.id,
        template_id: item.id,
        category: item.category,
        severity: item.severity,
        priority,
        title: copy.title,
        page_url: item.page_url,
        evidence,
        source: item.source,
        confidence: item.confidence,
        why: copy.why,
        fix: copy.fix,
        verify: copy.verify,
        what_to_do: copy.fix,
        validation: copy.verify,
        impact,
        effort,
        localized,
      };
    })
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
}
