# Smartbase Email Platform — controls update

New in this version
1. **Sign-in options** – default Google app, your own Google app (Client ID/Secret), and a **custom sign-in domain** (Google redirects through `https://your-domain/__smartbase/...`).
2. **Users & storage** – store users in the platform default, in **your Smartbase database** (empty-database template or a custom table + `smartbase-data.js` SDK), or send them to **your own server** through a signed gateway.
3. **Account control** – "one account, one device": *Monitor* (count only, no duplicates) or *Enforce* (a device can only use one account).
4. **Database copy** (offline HTML viewer) and **Broadcasts** (test emails + mass email with sent/opened tracking and unsubscribe).

## Deploy
```
# 1. create the new tables (safe to run twice)
npx wrangler d1 execute smartbase-db --remote --file=migrations/0002_controls.sql

# 2. secrets that must already exist: CREDENTIAL_KEY (64 hex chars) and the Gmail ones.
#    SMARTBASE_URL is set in wrangler.jsonc (your Smartbase platform address).

# 3. deploy (or git push if Cloudflare builds from GitHub)
npx wrangler deploy
```

## How the Smartbase database is used
The platform calls your Smartbase `/apiv1` API with a **write key** and a **read key** (dashboard → Users & storage → connect). One request is made per sign-in. Smartbase API limits (20 requests/minute, 2,000/day per account) therefore also limit sign-ins per minute for projects using this storage.

## SDK files (served from /public)
- `smartbase.js` – sign-in button; now also sends a stable device id and supports `baseUrl: 'https://your-domain/__smartbase'`.
- `smartbase-data.js` – server-side SDK to define how users are written to a custom table.

## Sign-in error codes returned to your site
`device_limit` (device already used by another account), `device_required` (enforce mode but no device id; update smartbase.js), plus the existing ones.

## Limits
Broadcasts: up to 500 recipients each (`BROADCAST_MAX_RECIPIENTS`), 400 emails per project per 24 h (`BROADCAST_DAILY_LIMIT`), sent from the platform Gmail account.
