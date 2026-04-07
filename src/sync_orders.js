import { CFG, logger, reverbRequest, findAirtableRecordBySku, updateAirtableRecord, extractReverbSku, extractReverbQuantity, extractReverbState, nowIso, shouldDecrementOrder, isIgnoredOrder } from "./lib.js";

async function fetchOrders() {
  const params = new URLSearchParams({ per_page: String(CFG.reverb.pageSize) });
  const data = await reverbRequest(`${CFG.reverb.ordersPath}?${params.toString()}`);
  return Array.isArray(data?.orders) ? data.orders : (Array.isArray(data) ? data : []);
}

async function main() {
  const orders = await fetchOrders();
  let updated = 0;
  let skipped = 0;

  for (const order of orders) {
    const rawOrderStatus = order?.status;
    const orderStatus = extractReverbState({ status: rawOrderStatus }) || String(rawOrderStatus || "");
    const lineItems = Array.isArray(order?.line_items) ? order.line_items : [];

    if (isIgnoredOrder(orderStatus)) {
      logger("info", "Ignoring Reverb order status", { orderId: order?.id, orderStatus });
      skipped += lineItems.length;
      continue;
    }

    const decrement = shouldDecrementOrder(orderStatus);

    for (const item of lineItems) {
      const sku = extractReverbSku(item);
      if (!sku) {
        logger("warn", "Skipping Reverb line without SKU", { orderId: order?.id });
        skipped += 1;
        continue;
      }

      const record = await findAirtableRecordBySku(sku);
      if (!record) {
        logger("warn", "No Airtable record found for Reverb order SKU", { sku, orderId: order?.id });
        skipped += 1;
        continue;
      }

      const fields = {
        [CFG.airtable.channelField]: CFG.values.channelWarehouse,
        [CFG.airtable.reverbOrderIdField]: String(order?.id || ""),
        [CFG.airtable.reverbStatusField]: orderStatus,
        [CFG.airtable.lastSyncSourceField]: "Reverb",
        [CFG.airtable.lastSyncAtField]: nowIso(),
      };

      if (!decrement) {
        fields[CFG.airtable.attentionField] = `Review Reverb order status: ${orderStatus}`;
        await updateAirtableRecord(record.id, fields);
        updated += 1;
        logger("info", "Flagged Airtable record for non-decrement Reverb order", { sku, orderId: order?.id, orderStatus });
        continue;
      }

      const quantityOrdered = extractReverbQuantity(item) ?? 1;
      const currentQty = Number(record.fields?.[CFG.airtable.qtyField] ?? 0);
      const newQty = Math.max(0, currentQty - quantityOrdered);

      fields[CFG.airtable.qtyField] = newQty;
      fields[CFG.airtable.soldChannelField] = CFG.values.soldChannelReverbWarehouse;
      fields[CFG.airtable.soldDateField] = nowIso();
      fields[CFG.airtable.attentionField] = null;

      if (newQty <= 0) {
        fields[CFG.airtable.statusField] = CFG.values.sold;
        fields[CFG.airtable.listedField] = false;
      } else {
        fields[CFG.airtable.statusField] = CFG.values.listedWarehouse;
        fields[CFG.airtable.listedField] = true;
      }

      await updateAirtableRecord(record.id, fields);
      updated += 1;
      logger("info", "Updated Airtable from Reverb order", { sku, orderId: order?.id, orderStatus, quantityOrdered, newQty });
    }
  }

  console.log(JSON.stringify({ ok: true, ordersScanned: orders.length, recordsUpdated: updated, recordsSkipped: skipped }, null, 2));
}

main().catch(err => {
  logger("error", "sync-orders failed", err.message);
  process.exit(1);
});
