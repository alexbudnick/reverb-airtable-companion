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
