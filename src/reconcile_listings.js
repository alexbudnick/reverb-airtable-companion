// Absence from /my/listings is not proof of zero stock. Read the exact listing
// before changing a tracked record that has disappeared from the feed.
export async function missingTrackedListings(listings, records, { idField, fetchListing, warn }) {
  const seen = new Set(listings.map(listing => String(listing.id)));
  const missing = [];
  for (const record of records) {
    const id = String(record.fields?.[idField] || "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    try {
      const listing = await fetchListing(id);
      if (String(listing?.id) !== id) throw new Error("Listing response ID mismatch");
      missing.push(listing);
    } catch (error) {
      warn("Could not verify missing warehouse listing; inventory unchanged", { listingId: id, error: error.message });
    }
  }
  return missing;
}
