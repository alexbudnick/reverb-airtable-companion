# Reverb → Airtable companion app (tightened)

This version is production-safer for Flash Flood Warehouse Deals Reverb.

## What changed
- reads and stores raw Reverb listing/order status
- maps listing states:
  - live -> LISTED - WAREHOUSE
  - draft -> NOT LISTED - WAREHOUSE
  - ended/inactive -> NOT LISTED - WAREHOUSE or SOLD if qty is 0
- supports quantity > 1
- order sync only decrements quantity for approved statuses
- ignored statuses (pending/cancelled/refunded/etc.) do not reduce inventory
- adds optional `Needs Attention` field for unusual statuses

## Railway usage
- keep `npm start` as the Start Command
- use Railway cron jobs or manual POST calls to:
  - /jobs/reverb/orders-sync
  - /jobs/reverb/listings-sync

## Recommended Airtable field
Add this field if you want attention flags:
- Needs Attention
