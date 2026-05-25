import { config } from "./config.js";
import { logger } from "./logger.js";
import { normalizePhone } from "./normalize.js";

export class FeishuClient {
  constructor(feishuConfig = config.feishu) {
    this.config = feishuConfig;
    this.baseUrl = "https://open.feishu.cn/open-apis";
    this.tenantAccessToken = "";
    this.fieldMeta = null;
  }

  isConfigured() {
    return Boolean(
      this.config.appId &&
        this.config.appSecret &&
        this.config.appToken &&
        this.config.tableId &&
        !this.config.appId.startsWith("your_")
    );
  }

  async getTenantAccessToken({ forceRefresh = false } = {}) {
    if (!forceRefresh && this.tenantAccessToken) return this.tenantAccessToken;

    const response = await fetch(`${this.baseUrl}/auth/v3/tenant_access_token/internal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        app_id: this.config.appId,
        app_secret: this.config.appSecret
      })
    });
    const payload = await response.json();
    if (!response.ok || payload.code !== 0) {
      throw new Error(`获取飞书 tenant_access_token 失败: ${JSON.stringify(payload)}`);
    }
    this.tenantAccessToken = payload.tenant_access_token;
    return this.tenantAccessToken;
  }

  isInvalidTokenError(payload) {
    return payload?.code === 99991663 || String(payload?.msg || "").toLowerCase().includes("invalid access token");
  }

  isFieldSchemaError(payload) {
    return payload?.code === 1254045 || String(payload?.msg || "").toLowerCase().includes("fieldnamenotfound");
  }

  async getFieldMeta() {
    if (this.fieldMeta) return this.fieldMeta;

    const token = await this.getTenantAccessToken();
    const url = `${this.baseUrl}/bitable/v1/apps/${this.config.appToken}/tables/${this.config.tableId}/fields?page_size=100`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const payload = await response.json();
    if (this.isInvalidTokenError(payload)) {
      this.tenantAccessToken = "";
      this.fieldMeta = null;
      return this.getFieldMeta();
    }
    if (!response.ok || payload.code !== 0) {
      throw new Error(`获取飞书字段失败: ${JSON.stringify(payload)}`);
    }

    this.fieldMeta = new Map(
      (payload.data?.items || []).map((field) => [
        field.field_name,
        { type: field.type, uiType: field.ui_type }
      ])
    );
    return this.fieldMeta;
  }

  async toFeishuFields(shop) {
    const fields = this.config.fields;
    const mappings = {
      customerId: shop.customerId || "",
      name: shop.name || "",
      phone: shop.phone || "",
      address: shop.address || "",
      website: shop.website || "",
      mapsUrl: shop.mapsUrl || "",
      rating: shop.rating || "",
      reviewCount: shop.reviewCount || "",
      keyword: shop.keyword || "",
      province: shop.province || ""
    };

    const fieldMeta = await this.getFieldMeta();
    const payload = {};
    for (const [key, value] of Object.entries(mappings)) {
      const fieldName = fields[key];
      if (!fieldName || !fieldMeta.has(fieldName) || value === "" || (Array.isArray(value) && value.length === 0)) {
        continue;
      }

      const meta = fieldMeta.get(fieldName);
      payload[fieldName] = this.formatFieldValue({ key, value, meta, shop });
    }
    return payload;
  }

  formatFieldValue({ key, value, meta, shop }) {
    if (meta?.uiType === "Url") {
      return { link: value, text: key === "mapsUrl" ? shop.name || "Google Maps" : value };
    }
    if (meta?.uiType === "MultiSelect") {
      return Array.isArray(value) ? value : String(value).split(/[,|]/).map((item) => item.trim()).filter(Boolean);
    }
    if (meta?.uiType === "SingleSelect") {
      return Array.isArray(value) ? value[0] || "" : value;
    }
    return Array.isArray(value) ? value.join(", ") : value;
  }

  async createRecord(shop, { retryOnInvalidToken = true, retryOnFieldSchema = true } = {}) {
    const token = await this.getTenantAccessToken();
    const url = `${this.baseUrl}/bitable/v1/apps/${this.config.appToken}/tables/${this.config.tableId}/records`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ fields: await this.toFeishuFields(shop) })
    });
    const payload = await response.json();
    if (retryOnInvalidToken && this.isInvalidTokenError(payload)) {
      await logger.warn("飞书 token 已失效，刷新后重试上传", { name: shop.name });
      this.tenantAccessToken = "";
      await this.getTenantAccessToken({ forceRefresh: true });
      return this.createRecord(shop, { retryOnInvalidToken: false, retryOnFieldSchema });
    }
    if (retryOnFieldSchema && this.isFieldSchemaError(payload)) {
      await logger.warn("飞书字段结构已变化，刷新字段后重试上传", { name: shop.name });
      this.fieldMeta = null;
      return this.createRecord(shop, { retryOnInvalidToken, retryOnFieldSchema: false });
    }
    if (!response.ok || payload.code !== 0) {
      throw new Error(`上传飞书失败: ${JSON.stringify(payload)}`);
    }
    return payload.data?.record;
  }

  extractUrlValue(value) {
    if (!value) return "";
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return this.extractUrlValue(value[0]);
    return value.link || value.text || "";
  }

  makeRecordKeys(fields) {
    const mapsUrl = this.extractUrlValue(fields[this.config.fields.mapsUrl]);
    const phone = normalizePhone(fields[this.config.fields.phone]);
    return {
      mapsUrl,
      phone
    };
  }

  async getExistingRecordKeys() {
    const existing = {
      mapsUrls: new Set(),
      phones: new Set()
    };
    let pageToken = "";

    do {
      const token = await this.getTenantAccessToken();
      const url = new URL(`${this.baseUrl}/bitable/v1/apps/${this.config.appToken}/tables/${this.config.tableId}/records`);
      url.searchParams.set("page_size", "500");
      if (pageToken) url.searchParams.set("page_token", pageToken);

      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const payload = await response.json();
      if (this.isInvalidTokenError(payload)) {
        this.tenantAccessToken = "";
        await this.getTenantAccessToken({ forceRefresh: true });
        continue;
      }
      if (!response.ok || payload.code !== 0) {
        throw new Error(`获取飞书已有记录失败: ${JSON.stringify(payload)}`);
      }

      for (const item of payload.data?.items || []) {
        const keys = this.makeRecordKeys(item.fields || {});
        if (keys.mapsUrl) existing.mapsUrls.add(keys.mapsUrl);
        if (keys.phone) existing.phones.add(keys.phone);
      }

      pageToken = payload.data?.has_more ? payload.data?.page_token || "" : "";
    } while (pageToken);

    return existing;
  }

  isShopAlreadyUploaded(shop, existing) {
    const phone = normalizePhone(shop.phone);
    return Boolean((phone && existing.phones.has(phone)) || (shop.mapsUrl && existing.mapsUrls.has(shop.mapsUrl)));
  }

  async uploadShops(shops) {
    if (!this.isConfigured()) {
      await logger.warn("飞书配置未填写，跳过上传");
      return { uploaded: 0, skipped: shops.length };
    }

    let uploaded = 0;
    for (const shop of shops) {
      await this.createRecord(shop);
      uploaded += 1;
      await logger.info("已上传飞书", { name: shop.name, phone: shop.phone });
    }
    return { uploaded, skipped: 0 };
  }
}
