import test from "node:test";
import assert from "node:assert/strict";
import { buildListingStateFields, extractReverbState, fetchTrackedWarehouseRecords, CFG } from "../src/lib.js";

test("ended listing is unlisted without being classified as a sale", () => {
  const state = extractReverbState({ state: { slug: "ended" } });
  assert.deepEqual(buildListingStateFields(state, 0), { status: CFG.values.notListedWarehouse, listed: false });
});

test("tracked warehouse lookup retains every page and filters out unrelated inventory", async () => {
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async url => {
    requests.push(new URL(url));
    return { ok: true, json: async () => requests.length === 1 ? { records: [{ id: "one" }], offset: "next" } : { records: [{ id: "two" }] } };
  };
  try {
    assert.deepEqual(await fetchTrackedWarehouseRecords(), [{ id: "one" }, { id: "two" }]);
    assert.equal(requests[1].searchParams.get("offset"), "next");
    const formula = requests[0].searchParams.get("filterByFormula");
    assert.ok(formula.includes(`{${CFG.airtable.channelField}}="${CFG.values.channelWarehouse}"`));
    assert.ok(formula.includes(`{${CFG.airtable.reverbListingIdField}}!=""`));
  } finally { globalThis.fetch = original; }
});
