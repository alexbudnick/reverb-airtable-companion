import { logger, fetchAllReverbPages, findAirtableRecordBySku, updateAirtableRecord, extractReverbSku, extractReverbQuantity, extractReverbState, nowIso, shouldDecrementOrder, isIgnoredOrder, CFG } from "./lib.js";

// One Reverb selling-order object normally represents one item. Some API versions
// include line_items, so support both shapes without processing an order twice.
export function orderItems(order) {
  return Array.isArray(order?.line_items) && order.line_items.length ? order.line_items : [order];
}

export function orderKey(order, item, index) {
  const id = order?.order_number || order?.id || order?.uuid;
  if (!id) return null;
  return `${id}:${item?.id || item?.listing?.id || item?.sku || index}`;
}

async function main() {
  if (!CFG.ordersFrom || !Number.isFinite(Date.parse(CFG.ordersFrom))) {
    throw new Error("REVERB_ORDERS_FROM must be a valid ISO date; refusing to replay historical orders");
  }
  const orders = await fetchAllReverbPages(CFG.reverb.ordersPath, "orders");
  let updated = 0;
  let skipped = 0;

  for (const order of orders) {
    const saleTime = Date.parse(order?.paid_at || order?.created_at || "");
    if (!Number.isFinite(saleTime) || saleTime < Date.parse(CFG.ordersFrom)) {
      skipped += 1;
      continue;
    }
    const rawOrderStatus = order?.status;
    const orderStatus = extractReverbState({ status: rawOrderStatus }) || String(rawOrderStatus || "");
    const lineItems = orderItems(order);

    if (isIgnoredOrder(orderStatus)) {
      logger("debug", "Ignoring Reverb order status", {
        orderId: order?.id || order?.order_id || order?.order_number || order?.uuid || "",
        orderStatus
      });
      skipped += lineItems.length;
      continue;
    }

    const decrement = shouldDecrementOrder(orderStatus);

    for (const [index, item] of lineItems.entries()) {
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
        [CFG.airtable.reverbOrderIdField]: String(order?.order_number || order?.id || ""),
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

      const key = orderKey(order, item, index);
      if (!key) {
        logger("warn", "Order has no durable ID; skipping inventory change", { sku });
        skipped += 1;
        continue;
      }
      const processed = new Set(String(record.fields?.[CFG.airtable.processedOrdersField] || "").split("\n").filter(Boolean));
      if (processed.has(key)) {
        skipped += 1;
        continue;
      }

      const quantityOrdered = Number(item?.quantity ?? 1);
      if (!Number.isInteger(quantityOrdered) || quantityOrdered < 1) {
        logger("warn", "Invalid ordered quantity; skipping", { sku, key, quantityOrdered });
        skipped += 1;
        continue;
      }
      const currentQty = Number(record.fields?.[CFG.airtable.qtyField] ?? 0);
      if (currentQty < quantityOrdered) {
        logger("warn", "Order requires inventory review; quantity is insufficient", { sku, key, currentQty, quantityOrdered });
        skipped += 1;
        continue;
      }
      const newQty = Math.max(0, currentQty - quantityOrdered);

      fields[CFG.airtable.qtyField] = newQty;
      fields[CFG.airtable.processedOrdersField] = [...processed, key].join("\n");
      fields[CFG.airtable.soldChannelField] = CFG.values.soldChannelReverbWarehouse;
      fields[CFG.airtable.soldDateField] = String(order?.created_at || nowIso()).slice(0, 10);
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
