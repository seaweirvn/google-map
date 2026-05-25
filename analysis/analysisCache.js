import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../utils/config.js";

export const makeShopId = (shop) => shop.mapsUrl || `${shop.name || ""}|${shop.address || ""}|${shop.phone || ""}`;

export const hashAnalysisInput = (input) =>
  crypto.createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 16);

export class AnalysisCache {
  constructor(filePath = config.analysis.aiCacheFile) {
    this.filePath = filePath;
    this.state = {};
  }

  async load() {
    try {
      this.state = JSON.parse(await fs.readFile(this.filePath, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      this.state = {};
    }
  }

  async save() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(this.state, null, 2), "utf8");
  }

  makeKey(shop, input) {
    return `${makeShopId(shop)}::${hashAnalysisInput(input)}`;
  }

  get(shop, input) {
    return this.state[this.makeKey(shop, input)] || null;
  }

  set(shop, input, result) {
    this.state[this.makeKey(shop, input)] = {
      result,
      updatedAt: new Date().toISOString()
    };
  }
}
