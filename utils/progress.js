import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";

const defaultProgress = {
  completedQueries: [],
  failedQueries: {},
  currentQuery: null,
  savedCount: 0,
  lastShop: null,
  updatedAt: null
};

export class ProgressStore {
  constructor(filePath = config.progressFile) {
    this.filePath = filePath;
    this.data = { ...defaultProgress };
  }

  async load() {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      this.data = { ...defaultProgress, ...JSON.parse(raw) };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      this.data = { ...defaultProgress };
    }
  }

  async save() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    this.data.updatedAt = new Date().toISOString();
    await fs.writeFile(this.filePath, JSON.stringify(this.data, null, 2), "utf8");
  }

  isQueryCompleted(queryKey) {
    return this.data.completedQueries.includes(queryKey);
  }

  async setCurrentQuery(queryKey) {
    this.data.currentQuery = queryKey;
    await this.save();
  }

  async markQueryCompleted(queryKey) {
    if (!this.data.completedQueries.includes(queryKey)) {
      this.data.completedQueries.push(queryKey);
    }
    delete this.data.failedQueries[queryKey];
    this.data.currentQuery = null;
    await this.save();
  }

  getQueryFailureCount(queryKey) {
    return this.data.failedQueries?.[queryKey]?.count || 0;
  }

  async markQueryFailed(queryKey, error) {
    this.data.failedQueries ||= {};
    const current = this.data.failedQueries[queryKey] || { count: 0, lastError: "", updatedAt: null };
    this.data.failedQueries[queryKey] = {
      count: current.count + 1,
      lastError: error?.message || String(error || ""),
      updatedAt: new Date().toISOString()
    };
    await this.save();
  }

  async markShopSaved(shop, savedCount) {
    this.data.savedCount = savedCount;
    this.data.lastShop = {
      name: shop.name || "",
      phone: shop.phone || "",
      province: shop.province || "",
      mapsUrl: shop.mapsUrl || ""
    };
    await this.save();
  }
}
