# GeoScore 2.5.0 Site Pass

Not deployed. Branch: `feature/site-pass`.

## Stripe (already live)

- Account: `acct_1U4zQQRg3Xb3gxxt` (self-controlled, not the GMC account)
- Product: `geoscore_site_pass`
- Price: `price_1UAACYRg3Xb3gxxtFoApW9iv` · HK$49
- Payment Link: https://buy.stripe.com/7sY28t61t9OE3WA9ah38400
- Success URL: `https://geo.sayori.org/?pass=1&session_id={CHECKOUT_SESSION_ID}`

## What a pass includes

One domain, 30 days:

- full repair pack
- shareable / printable report
- 3 re-audits

No ranking promise. No hands-on edits.

## Routes (Worker or standalone server)

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/site-pass/webhook` | Stripe event, no browser |
| GET | `/api/site-pass?domain=` | Is this domain paid? |
| POST | `/api/site-pass/checkout` | Create Checkout Session from backend |
| POST | `/api/site-pass/claim` | Exchange `session_id` after redirect |
| POST | `/api/site-pass/rerun` | Consume one re-audit |

## Two backends, same API

1. Cloudflare Worker: `src/routes/site-pass.ts` + D1 `migrations/0006_site_passes.sql`
2. Your own server: `server/site-pass-server.mjs` — see `docs/site-pass-external-backend.md`

Do not deploy the Worker until you pick one and the webhook is pointed at it.

## Secrets — do not commit

Worker:

```
npx wrangler secret put STRIPE_SECRET_KEY --config wrangler.generated.jsonc
npx wrangler secret put STRIPE_WEBHOOK_SECRET --config wrangler.generated.jsonc
```

Standalone server: export the same names. Restricted key only.
