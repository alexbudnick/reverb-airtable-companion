import { CFG, logger, reverbRequest, findAirtableRecordBySku, findAirtableRecordByListingId, updateAirtableRecord, createAirtableRecord, extractReverbSku, extractReverbQuantity, extractReverbPrice, nowIso, buildListingStateFields } from "./lib.js";

async function fetchListings() {
  const params = new URLSearchParams({ per_page: String(CFG.reverb.pageSize) });
  const data = await reverbRequest(`${CFG.reverb.listingsPath}?${params.toString()}`);
  return Array.isArray(data?.listings) ? data.listings : (Array.isArray(data) ? data : []);
}

async function main() {
  const listings = await fetchListings();
  let updated = 0;
  let created = 0;

  for (const listing of listings) {
    const sku = extractReverbSku(listing);
    if (!sku) {
      logger("warn", "Skipping Reverb listing without SKU", { listingId: listing?.id });
      continue;
    }

    const listingId = String(listing?.id || "");
    const record = await findAirtableRecordBySku(sku) || await findAirtableRecordByListingId(listingId);

    const price = extractReverbPrice(listing);
    const qty = extractReverbQuantity(listing) ?? 0;
    const rawState = String(listing?.state || listing?.status || "");
    const mapped = buildListingStateFields(rawState, qty);

    const fields = {
      [CFG.airtable.reverbListingIdField]: listingId,
      [CFG.airtable.reverbStatusField]: rawState,
      [CFG.airtable.channelField]: CFG.values.channelWarehouse,
      [CFG.airtable.lastSyncSourceField]: "Reverb",
      [CFG.airtable.lastSyncAtField]: nowIso(),
      [CFG.airtable.attentionField]: mapped.attention ?? null,
      [CFG.airtable.listedField]: mapped.listed ?? false,
      [CFG.airtable.statusField]: mapped.status ?? CFG.values.notListedWarehouse,
      [CFG.airtable.qtyField]: qty,
    };

    if (price !== null) fields[CFG.airtable.priceField] = price;

    if (record) {
      await updateAirtableRecord(record.id, fields);
      updated += 1;
      logger("info", "Updated Airtable from Reverb listing", { sku, listingId, rawState, qty, price });
    } else {
      await createAirtableRecord({
        [CFG.airtable.skuField]: sku,
        ...fields
      });
      created += 1;
      logger("info", "Created Airtable record from Reverb listing", { sku, listingId, rawState, qty, price });
    }
  }

  console.log(JSON.stringify({ ok: true, listingsScanned: listings.length, recordsUpdated: updated, recordsCreated: created }, null, 2));
}

main().catch(err => {
  logger("error", "sync-listings failed", err.message);
  process.exit(1);
});
