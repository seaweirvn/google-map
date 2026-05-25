import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { normalizePhone, normalizeText } from "./normalize.js";

const emptyState = {
  phones: [],
  mapsUrls: [],
  namesWithAddress: []
};

export class DedupeStore {
  constructor(filePath = config.dedupeFile) {
    this.filePath = filePath;
    this.state = { ...emptyState };
  }

  async load() {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      this.state = { ...emptyState, ...JSON.parse(raw) };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      this.state = { ...emptyState };
    }
  }

  async save() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(this.state, null, 2), "utf8");
  }

  makeFallbackKey(shop) {
    return normalizeText(`${shop.name}|${shop.address}`).toLowerCase();
  }

  has(shop) {
    const phone = normalizePhone(shop.phone);
    if (phone && this.state.phones.includes(phone)) return true;
    if (shop.mapsUrl && this.state.mapsUrls.includes(shop.mapsUrl)) return true;
    return false;
  }

  hasMapsUrl(mapsUrl) {
    return Boolean(mapsUrl && this.state.mapsUrls.includes(mapsUrl));
  }

  add(shop) {
    const phone = normalizePhone(shop.phone);
    if (phone && !this.state.phones.includes(phone)) this.state.phones.push(phone);
    if (shop.mapsUrl && !this.state.mapsUrls.includes(shop.mapsUrl)) this.state.mapsUrls.push(shop.mapsUrl);
    const fallbackKey = this.makeFallbackKey(shop);
    if (fallbackKey && !this.state.namesWithAddress.includes(fallbackKey)) {
      this.state.namesWithAddress.push(fallbackKey);
    }
  }
}
