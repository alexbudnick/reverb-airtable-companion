import test from "node:test";
import assert from "node:assert/strict";
import { missingTrackedListings } from "../src/reconcile_listings.js";

const record = id => ({ fields: { "Reverb Listing ID": id } });

test("fetches the exact missing ended listing, without refetching live listings", async () => {
  const fetched = [];
  const result = await missingTrackedListings([{ id: 1 }], [record("1"), record("91334745"), record("91334745")], {
    idField: "Reverb Listing ID",
    fetchListing: async id => { fetched.push(id); return { id: Number(id), sku: "C07202357W", state: { slug: "ended" }, inventory: 0 }; },
    warn: () => assert.fail("Unexpected warning"),
  });
  assert.deepEqual(fetched, ["91334745"]);
  assert.equal(result[0].sku, "C07202357W");
  assert.equal(result[0].inventory, 0);
});

test("lookup failure or wrong response never implies zero stock and does not block the next item", async () => {
  const warnings = [];
  const result = await missingTrackedListings([], [record("1"), record("2"), record("3")], {
    idField: "Reverb Listing ID",
    fetchListing: async id => {
      if (id === "1") throw new Error("404");
      return { id: id === "2" ? "wrong" : id, inventory: 2 };
    },
    warn: (...args) => warnings.push(args),
  });
  assert.equal(warnings.length, 2);
  assert.deepEqual(result, [{ id: "3", inventory: 2 }]);
});
