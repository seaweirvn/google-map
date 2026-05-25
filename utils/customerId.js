import crypto from "node:crypto";

const MIN_ID = 10000;
const ID_RANGE = 90000;

export const makeCustomerIdSeed = (shop) =>
  [shop.mapsUrl, shop.phone, shop.name, shop.address].filter(Boolean).join("|");

export const generateFiveDigitCustomerId = (shop, usedIds = new Set()) => {
  const seed = makeCustomerIdSeed(shop) || JSON.stringify(shop);
  const hash = crypto.createHash("sha256").update(seed).digest("hex");
  let base = Number.parseInt(hash.slice(0, 8), 16) % ID_RANGE;

  for (let offset = 0; offset < ID_RANGE; offset += 1) {
    const candidate = String(MIN_ID + ((base + offset) % ID_RANGE));
    if (!usedIds.has(candidate)) {
      usedIds.add(candidate);
      return candidate;
    }
  }

  throw new Error("五位数客户ID已用尽");
};
