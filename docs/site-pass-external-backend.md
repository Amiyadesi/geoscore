# Site Pass external backend (no Worker, no browser admin)

Fulfillment is server-to-server. Customers still pay in a browser. You do not need Dashboard clicks, Playwright, or a Cloudflare Worker to unlock a pass.

## Already collecting money

Live Payment Link on `acct_1U4zQQRg3Xb3gxxt`:

https://buy.stripe.com/7sY28t61t9OE3WA9ah38400

- Product: `geoscore_site_pass`
- Price: `price_1UAACYRg3Xb3gxxtFoApW9iv` HKD 49
- Required custom field: `domain`
- Success: `https://geo.sayori.org/?pass=1&session_id={CHECKOUT_SESSION_ID}`

Money can land without a backend. Automatic pass unlock cannot.

## Recommended shape

Payment Link -> Stripe Checkout -> webhook `checkout.session.completed` -> your server `POST /api/site-pass/webhook` -> JSON/SQLite -> frontend claim/status.

Run:

```
node server/site-pass-server.mjs
```

Node 18+, no extra npm packages. Default store: `server/data/site-passes.json`.

When you have a public URL:

1. Stripe Dashboard -> Developers -> Webhooks -> `https://YOUR_HOST/api/site-pass/webhook`
2. Event: `checkout.session.completed` only
3. Put `whsec_...` and a restricted key in env

Restricted key: Checkout Sessions read. Add write only if you use `POST /api/site-pass/checkout`.

Do not deploy the Worker until this host is chosen. Do not use GMC account `acct_1U7pDyJUBi9fO7CM`.
