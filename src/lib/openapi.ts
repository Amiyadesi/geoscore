interface OpenApiOptions {
  apiUrl: string;
  productVersion: string;
  scoreVersion: string;
}

const jsonContent = (schema: Record<string, unknown>, example?: unknown) => ({
  'application/json': {
    schema,
    ...(example === undefined ? {} : { example }),
  },
});

const errorResponse = (description: string) => ({
  description,
  content: jsonContent({ $ref: '#/components/schemas/ErrorResponse' }),
});

export function buildOpenApiSpec(options: OpenApiOptions): Record<string, unknown> {
  const serverUrl = options.apiUrl.replace(/\/+$/, '');
  return {
    openapi: '3.1.0',
    info: {
      title: 'GeoScore Public API',
      version: options.productVersion,
      description: [
        'Stable public endpoints for evidence-first SEO/GEO audits, PageSpeed evidence, Evidence Map snapshots, FixPacks, and accountless monitoring.',
        'Predicted or API-answer observations have zero scoring weight and do not prove citations in consumer AI products.',
        'Request-scoped API keys are never returned and must not be placed in URLs.',
      ].join(' '),
      license: { name: 'MIT', identifier: 'MIT' },
      contact: { url: 'https://github.com/Amiyadesi/geoscore/issues' },
    },
    servers: [{ url: serverUrl }],
    externalDocs: { description: 'GeoScore guides', url: 'https://geo.sayori.org/docs' },
    tags: [
      { name: 'Product', description: 'Runtime product facts and API discovery.' },
      { name: 'Audit', description: 'Factual site and URL audits.' },
      { name: 'Evidence', description: 'Dated query and API-answer snapshots with zero scoring weight.' },
      { name: 'Monitoring', description: 'Accountless weekly evidence projects managed by a one-time token.' },
    ],
    paths: {
      '/api/meta': {
        get: {
          tags: ['Product'],
          summary: 'Get deployed product facts',
          operationId: 'getProductMeta',
          responses: {
            200: {
              description: 'Current version, score policy, registry counts, limits, and source URL.',
              content: jsonContent({ type: 'object', additionalProperties: true }),
            },
          },
        },
      },
      '/api/audit/{domain}': {
        get: {
          tags: ['Audit'],
          summary: 'Run or load an audit',
          description: 'Returns a Server-Sent Events stream. Site mode samples up to five HTML pages. Cached results do not consume the fresh-audit quota.',
          operationId: 'runAudit',
          parameters: [
            { name: 'domain', in: 'path', required: true, schema: { type: 'string', example: 'example.com' } },
            { name: 'mode', in: 'query', schema: { type: 'string', enum: ['site', 'url'], default: 'site' } },
            { name: 'url', in: 'query', description: 'Required in URL mode and restricted to the submitted registrable domain.', schema: { type: 'string', format: 'uri' } },
            { name: 'archetype_hint', in: 'query', description: 'Request-local site type hint. It does not create a global override.', schema: { $ref: '#/components/schemas/SiteArchetype' } },
            { name: 'fresh', in: 'query', description: 'Set to 1 to bypass the matching cached audit.', schema: { type: 'string', enum: ['1'] } },
          ],
          responses: {
            200: { description: 'SSE audit progress and final result.', content: { 'text/event-stream': { schema: { type: 'string' } } } },
            400: errorResponse('Invalid public domain, mode, URL, or archetype hint.'),
            429: errorResponse('Fresh-audit quota exceeded.'),
          },
        },
      },
      '/api/lighthouse': {
        get: {
          tags: ['Audit'],
          summary: 'Run PageSpeed mobile and desktop evidence',
          operationId: 'runLighthouse',
          parameters: [
            { name: 'domain', in: 'query', required: true, schema: { type: 'string', example: 'example.com' } },
            { name: 'audit_id', in: 'query', description: 'When supplied, successful evidence is merged into the stored audit.', schema: { type: 'string' } },
          ],
          responses: {
            200: { description: 'Complete or partial PageSpeed result.', content: jsonContent({ type: 'object', additionalProperties: true }) },
            400: errorResponse('Invalid domain or audit ID.'),
            502: errorResponse('PageSpeed rejected or failed the request.'),
            503: errorResponse('PageSpeed is unavailable or not configured.'),
          },
        },
      },
      '/api/answer-models': {
        post: {
          tags: ['Evidence'],
          summary: 'List models from a request-scoped API',
          description: 'The API key and Base URL are used only for this request. The Base URL may be a provider root, /v1 root, /models endpoint, or /chat/completions endpoint.',
          operationId: 'listAnswerModels',
          security: [{ RequestApiKey: [] }],
          requestBody: {
            required: true,
            content: jsonContent({
              type: 'object',
              required: ['api_base_url'],
              properties: { api_base_url: { type: 'string', format: 'uri', example: 'https://api.example.com' } },
            }),
          },
          responses: {
            200: { description: 'Bounded model list.', content: jsonContent({ type: 'object', properties: { models: { type: 'array', maxItems: 50, items: { type: 'string' } } } }) },
            400: errorResponse('Invalid or blocked Base URL.'),
            401: errorResponse('The request-scoped API key was rejected.'),
            429: errorResponse('The upstream API rate limit was reached.'),
            502: errorResponse('The upstream API returned an invalid response.'),
          },
        },
      },
      '/api/audits/{audit_id}/evidence-map': {
        post: {
          tags: ['Evidence'],
          summary: 'Generate a dated Evidence Map',
          description: 'Optional X-API-Key and API configuration add one request-scoped answer snapshot. Search and answer observations never affect the factual score.',
          operationId: 'createEvidenceMap',
          parameters: [{ name: 'audit_id', in: 'path', required: true, schema: { type: 'string' } }],
          security: [{}, { RequestApiKey: [] }],
          requestBody: {
            required: false,
            content: jsonContent({
              type: 'object',
              properties: {
                api_base_url: { type: 'string', format: 'uri' },
                api_model: { type: 'string', maxLength: 160 },
              },
            }),
          },
          responses: {
            200: { description: 'Evidence Map and optional answer snapshot.', content: jsonContent({ type: 'object', additionalProperties: true }) },
            400: errorResponse('Invalid audit or incomplete request-scoped API configuration.'),
            404: errorResponse('Stored audit not found.'),
            502: errorResponse('An optional evidence provider failed.'),
          },
        },
      },
      '/api/fix': {
        post: {
          tags: ['Audit'],
          summary: 'Generate a FixPack for one stored failure',
          description: 'Only an applicable fail recommendation already stored in the audit can be expanded. GeoScore does not modify or publish the target site.',
          operationId: 'createFixPack',
          requestBody: {
            required: true,
            content: jsonContent({
              type: 'object',
              required: ['audit_id', 'recommendation_id', 'language', 'output'],
              properties: {
                audit_id: { type: 'string' },
                recommendation_id: { type: 'string' },
                language: { type: 'string', enum: ['en', 'zh'] },
                output: { type: 'string', enum: ['full', 'code', 'copy', 'handoff_prompt'] },
              },
            }),
          },
          responses: {
            200: { description: 'Evidence-constrained FixPack.', content: jsonContent({ type: 'object', additionalProperties: true }) },
            400: errorResponse('Invalid request or recommendation state.'),
            404: errorResponse('Audit or recommendation not found.'),
            503: errorResponse('AI expansion is unavailable.'),
          },
        },
      },
      '/api/monitor-projects': {
        post: {
          tags: ['Monitoring'],
          summary: 'Create an accountless monitoring project',
          description: 'The management token is returned once. The service stores only a versioned peppered hash. Email is optional and must be verified before alerts are sent.',
          operationId: 'createMonitorProject',
          requestBody: {
            required: true,
            content: jsonContent({
              type: 'object',
              required: ['audit_id'],
              properties: { audit_id: { type: 'string' }, email: { type: 'string', format: 'email' } },
            }),
          },
          responses: {
            201: { description: 'Project plus one-time management token.', content: jsonContent({ type: 'object', additionalProperties: true }) },
            400: errorResponse('Invalid audit ID or email address.'),
            503: errorResponse('Monitoring storage or token protection is unavailable.'),
          },
        },
      },
      '/api/monitor-projects/{project_id}': {
        get: {
          tags: ['Monitoring'], summary: 'Load a monitoring project', operationId: 'getMonitorProject', security: [{ ProjectToken: [] }],
          parameters: [{ $ref: '#/components/parameters/ProjectId' }],
          responses: { 200: { description: 'Project configuration.', content: jsonContent({ type: 'object', additionalProperties: true }) }, 401: errorResponse('Invalid management token.'), 404: errorResponse('Project not found.') },
        },
        delete: {
          tags: ['Monitoring'], summary: 'Delete a monitoring project and its snapshots', operationId: 'deleteMonitorProject', security: [{ ProjectToken: [] }],
          parameters: [{ $ref: '#/components/parameters/ProjectId' }],
          responses: { 200: { description: 'Project deleted.', content: jsonContent({ type: 'object', properties: { ok: { type: 'boolean' } } }) }, 401: errorResponse('Invalid management token.'), 404: errorResponse('Project not found.') },
        },
      },
      '/api/monitor-projects/{project_id}/queries': {
        patch: {
          tags: ['Monitoring'], summary: 'Replace bounded monitoring queries', operationId: 'updateMonitorQueries', security: [{ ProjectToken: [] }],
          parameters: [{ $ref: '#/components/parameters/ProjectId' }],
          requestBody: { required: true, content: jsonContent({ type: 'object', required: ['queries'], properties: { queries: { type: 'array', maxItems: 3, items: { $ref: '#/components/schemas/MonitorQuery' } } } }) },
          responses: { 200: { description: 'Queries saved and baseline reset.', content: jsonContent({ type: 'object', additionalProperties: true }) }, 400: errorResponse('Invalid queries.'), 401: errorResponse('Invalid management token.') },
        },
      },
      '/api/monitor-projects/{project_id}/runs': {
        get: {
          tags: ['Monitoring'], summary: 'List retained monitoring snapshots', operationId: 'listMonitorRuns', security: [{ ProjectToken: [] }],
          parameters: [{ $ref: '#/components/parameters/ProjectId' }],
          responses: { 200: { description: 'Newest first, up to the runtime retention limit.', content: jsonContent({ type: 'object', additionalProperties: true }) }, 401: errorResponse('Invalid management token.') },
        },
        post: {
          tags: ['Monitoring'], summary: 'Run a snapshot with the hosted API', operationId: 'runMonitorProject', security: [{ ProjectToken: [] }],
          parameters: [{ $ref: '#/components/parameters/ProjectId' }],
          responses: { 200: { description: 'Completed snapshot.', content: jsonContent({ type: 'object', additionalProperties: true }) }, 207: { description: 'Snapshot stored with partial provider failure.', content: jsonContent({ type: 'object', additionalProperties: true }) }, 401: errorResponse('Invalid management token.') },
        },
      },
      '/api/monitor-projects/{project_id}/byok-runs': {
        post: {
          tags: ['Monitoring'], summary: 'Run one snapshot with a request-scoped API key', operationId: 'runMonitorProjectByok', security: [{ ProjectToken: [], RequestApiKey: [] }],
          parameters: [{ $ref: '#/components/parameters/ProjectId' }],
          requestBody: { required: true, content: jsonContent({ type: 'object', required: ['api_base_url', 'api_model'], properties: { api_base_url: { type: 'string', format: 'uri' }, api_model: { type: 'string', maxLength: 160 } } }) },
          responses: { 200: { description: 'Snapshot completed. The key and Base URL are not stored or returned.', content: jsonContent({ type: 'object', additionalProperties: true }) }, 400: errorResponse('Incomplete or blocked request-scoped API configuration.'), 401: errorResponse('Project or request-scoped API authentication failed.') },
        },
      },
      '/api/monitor-projects/{project_id}/token/rotate': {
        post: {
          tags: ['Monitoring'], summary: 'Rotate the management token', operationId: 'rotateMonitorToken', security: [{ ProjectToken: [] }],
          parameters: [{ $ref: '#/components/parameters/ProjectId' }],
          responses: { 200: { description: 'A new one-time token. The old token is immediately invalid.', content: jsonContent({ type: 'object', additionalProperties: true }) }, 401: errorResponse('Invalid management token.') },
        },
      },
      '/api/monitor-projects/{project_id}/email/verify': {
        post: {
          tags: ['Monitoring'], summary: 'Verify a monitoring email link', operationId: 'verifyMonitorEmail',
          parameters: [{ $ref: '#/components/parameters/ProjectId' }],
          requestBody: { required: true, content: jsonContent({ type: 'object', required: ['token'], properties: { token: { type: 'string' } } }) },
          responses: { 200: { description: 'Email verified.', content: jsonContent({ type: 'object', properties: { ok: { type: 'boolean' }, email_verified: { type: 'boolean' } } }) }, 401: errorResponse('Verification token invalid.'), 410: errorResponse('Verification token expired.') },
        },
      },
      '/api/monitor-projects/{project_id}/runs/{run_id}/alert/retry': {
        post: {
          tags: ['Monitoring'], summary: 'Retry an eligible failed weekly alert', operationId: 'retryMonitorAlert', security: [{ ProjectToken: [] }],
          parameters: [{ $ref: '#/components/parameters/ProjectId' }, { name: 'run_id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'Alert sent.', content: jsonContent({ type: 'object', additionalProperties: true }) }, 409: errorResponse('The run is not eligible for alert retry.'), 503: errorResponse('Email delivery failed.') },
        },
      },
    },
    components: {
      securitySchemes: {
        ProjectToken: { type: 'apiKey', in: 'header', name: 'X-Project-Token', description: 'One-time management token returned when the project is created or rotated.' },
        RequestApiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key', description: 'Request-scoped upstream API key. Never place it in a URL.' },
      },
      parameters: {
        ProjectId: { name: 'project_id', in: 'path', required: true, schema: { type: 'string', example: 'mon_01JGEOSCOREPROJECT' } },
      },
      schemas: {
        ErrorResponse: {
          type: 'object',
          properties: {
            ok: { type: 'boolean', const: false },
            error: {
              oneOf: [
                { type: 'string' },
                { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' }, retryable: { type: 'boolean' } } },
              ],
            },
            code: { type: 'string' },
            message: { type: 'string' },
            retryable: { type: 'boolean' },
          },
          additionalProperties: true,
        },
        SiteArchetype: {
          type: 'string',
          enum: ['personal_blog', 'editorial', 'news_media', 'documentation', 'saas', 'ecommerce', 'local_business', 'professional_services', 'portfolio', 'community', 'nonprofit', 'other', 'unknown'],
        },
        MonitorQuery: {
          type: 'object',
          required: ['query', 'intent'],
          properties: {
            query: { type: 'string', minLength: 2, maxLength: 240 },
            intent: { type: 'string', enum: ['branded', 'informational', 'task', 'comparison', 'local', 'navigational'] },
          },
        },
      },
    },
    'x-geoscore-score-version': options.scoreVersion,
  };
}
