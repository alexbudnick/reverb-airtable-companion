# Reverb → Airtable companion app (pagination patch)

This patch adds pagination so the sync processes all Reverb listings and orders, not just the first page.

## What changed
- fetches all pages for listings
- fetches all pages for orders
- keeps status parsing fix
- keeps quantity support and safer order handling

## New env var
- REVERB_MAX_PAGES=50

You can raise or lower that if needed.


## 0.3.3 Resilient Server Patch

This patch is intended for Railway services that were repeatedly "crashing" because the
service start command was running the one-time sync job directly.

### Required Railway setting

Set the service Start Command to:

```text
npm start
```

Do not use this as the Start Command:

```text
npm run sync-orders
```

The sync commands should run only through the web endpoints or Railway cron calls.

### Endpoints

```text
GET /health
POST /jobs/reverb/orders-sync?secret=...
POST /jobs/reverb/listings-sync?secret=...
```

### Changes

- Adds versioned `/` and `/health` responses.
- Adds an in-memory job lock so overlapping Reverb syncs cannot run in the same instance.
- Adds retry/backoff for temporary Reverb API failures: 429, 502, 503, and 504.
- Reduces ignored cancelled/refunded order logs from `info` to `debug`.

### Optional retry variables

```env
REVERB_MAX_RETRIES=4
REVERB_RETRY_BASE_MS=750
```
