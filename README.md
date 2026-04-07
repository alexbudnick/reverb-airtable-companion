# Reverb → Airtable companion app (status fix)

This patch fixes Reverb listing status parsing when Reverb returns status/state as an object instead of plain text.

## What changed
- correctly extracts status from:
  - state
  - status
  - state.name
  - state.slug
  - status.name
  - status.slug
- maps live/listed/active -> LISTED - WAREHOUSE
- keeps quantity support and safer order handling
