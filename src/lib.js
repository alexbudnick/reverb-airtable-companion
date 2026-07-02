import dotenv from "dotenv";
import { log } from "./common.js";

dotenv.config();

function parseCsvSet(value, fallback) {
  const src = String(value || fallback || "");
  return new Set(src.split(",").map(s => s.trim().toLowerCase()).filter(Boolean));
}

export const CFG = {
  logLevel: process.env.LOG_LEVEL || "info",
  dryRun: String(process.env.DRY_RUN || "false").toLowerCase() === "true",
  triggerSecret: process.env.SYNC_TRIGGER_SECRET || "",
  decrementStatuses: parseCsvSet(process.env.REVERB_DECREMENT_ORDER_STATUSES, "paid,shipped,completed,delivered"),
  ignoreStatuses: parseCsvSet(process.env.REVERB_IGNORE_ORDER_STATUSES, "pending,cancelled,canceled,refunded,failed,voided"),
  reverb: {
    apiBase: process.env.REVERB_API_BASE || "https://api.reverb.com/api",
    token: process.env.REVERB_PERSONAL_TOKEN || "",
    ordersPath: process.env.REVERB_ORDERS_PATH || "/my/orders/selling/all",
    listingsPath: process.env.REVERB_LISTINGS_PATH || "/my/listings",
    pageSize: Number(process.env.REVERB_PAGE_SIZE || 50),
    maxPages: Number(process.env.REVERB_MAX_PAGES || 50),
    maxRetries: Number(process.env.REVERB_MAX_RETRIES || 4),
    retryBaseMs: Number(process.env.REVERB_RETRY_BASE_MS || 750),
  },
  airtable: {
    pat: process.env.AIRTABLE_PAT || "",
    baseId: process.env.AIRTABLE_BASE_ID || "",
    tableName: process.env.AIRTABLE_TABLE_NAME || "Inventory",
    skuField: process.env.AIRTABLE_SKU_FIELD || "SKU",
    statusField: process.env.AIRTABLE_STATUS_FIELD || "Status",
    qtyField: process.env.AIRTABLE_QTY_FIELD || "Qty On Hand",
    priceField: process.env.AIRTABLE_PRICE_FIELD || "Price",
    channelField: process.env.AIRTABLE_CHANNEL_FIELD || "Channel",
    listedField: process.env.AIRTABLE_LISTED_FIELD || "Listed",
    reverbListingIdField: process.env.AIRTABLE_REVERB_LISTING_ID_FIELD || "Reverb Listing ID",
    reverbOrderIdField: process.env.AIRTABLE_REVERB_ORDER_ID_FIELD || "Reverb Order ID",
    reverbStatusField: process.env.AIRTABLE_REVERB_STATUS_FIELD || "Reverb Status",
    lastSyncSourceField: process.env.AIRTABLE_LAST_SYNC_SOURCE_FIELD || "Last Sync Source",
    lastSyncAtField: process.env.AIRTABLE_LAST_SYNC_AT_FIELD || "Last Sync At",
    soldChannelField: process.env.AIRTABLE_SOLD_CHANNEL_FIELD || "Sold Channel",
    soldDateField: process.env.AIRTABLE_SOLD_DATE_FIELD || "Sold Date",
    attentionField: process.env.AIRTABLE_ATTENTION_FIELD || "Needs Attention",
  },
  values: {
    channelWarehouse: process.env.CHANNEL_WAREHOUSE || "WAREHOUSE",
    listedWarehouse: process.env.STATUS_LISTED_WAREHOUSE || "LISTED - WAREHOUSE",
    notListedWarehouse: process.env.STATUS_NOT_LISTED_WAREHOUSE || "NOT LISTED - WAREHOUSE",
    sold: process.env.STATUS_SOLD || "SOLD",
    soldChannelReverbWarehouse: process.env.SOLD_CHANNEL_REVERB_WAREHOUSE || "REVERB WAREHOUSE",
  }
};

export function logger(level, msg, meta) {
  return log(level, CFG.logLevel, msg, meta);
}

export function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function shouldRetryHttpStatus(status) {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

export async function reverbRequest(path, options = {}) {
  const url = `${CFG.reverb.apiBase}${path}`;
  let lastError = null;

  for (let attempt = 1; attempt <= CFG.reverb.maxRetries + 1; attempt += 1) {
    try {
      const res = await fetch(url, {
        ...options,
        headers: {
          "Authorization": `Bearer ${CFG.reverb.token}`,
          "Accept-Version": "3.0",
          "Content-Type": "application/json",
          ...(options.headers || {})
        }
      });

      const bodyText = await res.text();

      if (res.ok) {
        if (!bodyText) return {};
        return JSON.parse(bodyText);
      }

      const retryable = shouldRetryHttpStatus(res.status);
      const message = `Reverb request failed ${res.status}: ${bodyText || "{}"}`;

      if (!retryable || attempt > CFG.reverb.maxRetries) {
        throw new Error(message);
      }

      const retryAfter = Number(res.headers.get("retry-after") || 0);
      const delayMs = retryAfter > 0
        ? retryAfter * 1000
        : CFG.reverb.retryBaseMs * Math.pow(2, attempt - 1);

      logger("warn", "Retrying Reverb request after temporary failure", {
        status: res.status,
        attempt,
        maxRetries: CFG.reverb.maxRetries,
        delayMs,
        path
      });

      await sleep(delayMs);
    } catch (error) {
      lastError = error;

      if (attempt > CFG.reverb.maxRetries) {
        throw error;
      }

      const delayMs = CFG.reverb.retryBaseMs * Math.pow(2, attempt - 1);

      logger("warn", "Retrying Reverb request after network/error failure", {
        attempt,
        maxRetries: CFG.reverb.maxRetries,
        delayMs,
        path,
        error: error.message
      });

      await sleep(delayMs);
    }
  }

  throw lastError || new Error("Unknown Reverb request failure");
}

export async function fetchAllReverbPages(basePath, collectionKey) {
  let page = 1;
  let allItems = [];
  while (page <= CFG.reverb.maxPages) {
    const params = new URLSearchParams({
      per_page: String(CFG.reverb.pageSize),
      page: String(page),
    });
    const data = await reverbRequest(`${basePath}?${params.toString()}`);
    const items = Array.isArray(data?.[collectionKey]) ? data[collectionKey] : (Array.isArray(data) ? data : []);
    allItems = allItems.concat(items);
    logger("info", "Fetched Reverb page", { collectionKey, page, items: items.length, totalSoFar: allItems.length });
    if (items.length < CFG.reverb.pageSize) break;
    page += 1;
  }
  return allItems;
}

export async function airtableRequest(path = "", options = {}) {
  const url = `https://api.airtable.com/v0/${CFG.airtable.baseId}/${encodeURIComponent(CFG.airtable.tableName)}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "Authorization": `Bearer ${CFG.airtable.pat}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  if (!res.ok) throw new Error(`Airtable request failed ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function findAirtableRecordBySku(sku) {
  const formula = `{${CFG.airtable.skuField}}="${String(sku).replace(/"/g, '\\"')}"`;
  const payload = await airtableRequest(`?filterByFormula=${encodeURIComponent(formula)}&maxRecords=1`);
  return payload.records?.[0] || null;
}

export async function findAirtableRecordByListingId(listingId) {
  const formula = `{${CFG.airtable.reverbListingIdField}}="${String(listingId).replace(/"/g, '\\"')}"`;
  const payload = await airtableRequest(`?filterByFormula=${encodeURIComponent(formula)}&maxRecords=1`);
  return payload.records?.[0] || null;
}

export async function updateAirtableRecord(recordId, fields) {
  if (CFG.dryRun) {
    logger("info", "DRY_RUN enabled; would update Airtable record", { recordId, fields });
    return { dryRun: true };
  }
  return airtableRequest("", {
    method: "PATCH",
    body: JSON.stringify({ records: [{ id: recordId, fields }] })
  });
}

export async function createAirtableRecord(fields) {
  if (CFG.dryRun) {
    logger("info", "DRY_RUN enabled; would create Airtable record", fields);
    return { dryRun: true };
  }
  return airtableRequest("", {
    method: "POST",
    body: JSON.stringify({ records: [{ fields }] })
  });
}

export function extractReverbSku(obj) {
  return obj?.sku || obj?.inventory?.sku || obj?.listing?.sku || obj?.product?.sku || null;
}

export function extractReverbQuantity(obj) {
  const candidates = [
    obj?.inventory,
    obj?.quantity,
    obj?.available_quantity,
    obj?.inventory_count,
    obj?.stock,
    obj?.listing?.inventory,
    obj?.listing?.quantity,
    obj?.listing?.available_quantity,
    obj?.listing?.inventory_count,
    obj?.product?.inventory,
    obj?.product?.quantity
  ];
  for (const value of candidates) {
    if (typeof value === "number" && Number.isFinite(value)) return Number(value);
    if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) return Number(value);
  }
  return null;
}

export function extractReverbPrice(obj) {
  const value = obj?.price?.amount ?? obj?.price;
  if (typeof value === "number" && Number.isFinite(value)) return Number(value);
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) return Number(value);
  return null;
}

export function extractReverbState(obj) {
  const candidates = [
    obj?.state,
    obj?.status,
    obj?.state?.name,
    obj?.state?.slug,
    obj?.status?.name,
    obj?.status?.slug,
    obj?.state?.display_name,
    obj?.status?.display_name,
    obj?.listing?.state,
    obj?.listing?.status,
    obj?.listing?.state?.name,
    obj?.listing?.state?.slug,
    obj?.listing?.status?.name,
    obj?.listing?.status?.slug,
    obj?.listing?.state?.display_name,
    obj?.listing?.status?.display_name,
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim() !== "") {
      return value.trim().toLowerCase();
    }
  }
  return "";
}

export function buildListingStateFields(rawState, qty) {
  const state = extractReverbState({ state: rawState });
  const fields = {};
  if (state === "live" || state === "listed" || state === "active") {
    fields.status = CFG.values.listedWarehouse;
    fields.listed = true;
  } else if (state === "draft" || state === "ended" || state === "inactive") {
    fields.status = qty > 0 ? CFG.values.notListedWarehouse : CFG.values.sold;
    fields.listed = false;
  } else if (state) {
    fields.status = qty > 0 ? CFG.values.notListedWarehouse : CFG.values.sold;
    fields.listed = false;
    fields.attention = `Unmapped Reverb listing state: ${rawState}`;
  } else {
    fields.status = qty > 0 ? CFG.values.notListedWarehouse : CFG.values.sold;
    fields.listed = false;
    fields.attention = "Missing Reverb listing state";
  }
  return fields;
}

export function shouldDecrementOrder(rawStatus) {
  const status = extractReverbState({ status: rawStatus });
  if (CFG.ignoreStatuses.has(status)) return false;
  if (CFG.decrementStatuses.has(status)) return true;
  return false;
}

export function isIgnoredOrder(rawStatus) {
  return CFG.ignoreStatuses.has(extractReverbState({ status: rawStatus }));
}
