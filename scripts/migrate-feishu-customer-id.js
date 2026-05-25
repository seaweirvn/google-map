import { config } from "../utils/config.js";
import { csvLineToShop, readCsvRows } from "../utils/csv.js";
import { generateFiveDigitCustomerId } from "../utils/customerId.js";
import { FeishuClient } from "../utils/feishu.js";
import { normalizePhone } from "../utils/normalize.js";

const client = new FeishuClient();

const request = async (url, options = {}) => {
  const token = await client.getTenantAccessToken();
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const payload = await response.json();
  if (!response.ok || payload.code !== 0) {
    throw new Error(`${options.method || "GET"} ${url} failed: ${JSON.stringify(payload)}`);
  }
  return payload;
};

const listFields = async () => {
  const url = `${client.baseUrl}/bitable/v1/apps/${config.feishu.appToken}/tables/${config.feishu.tableId}/fields?page_size=100`;
  const payload = await request(url);
  return payload.data?.items || [];
};

const updateFieldName = async (field, fieldName) => {
  const fieldId = field.field_id;
  const url = `${client.baseUrl}/bitable/v1/apps/${config.feishu.appToken}/tables/${config.feishu.tableId}/fields/${fieldId}`;
  await request(url, {
    method: "PUT",
    body: JSON.stringify({ field_name: fieldName, type: field.type })
  });
};

const createTextField = async (fieldName) => {
  const url = `${client.baseUrl}/bitable/v1/apps/${config.feishu.appToken}/tables/${config.feishu.tableId}/fields`;
  await request(url, {
    method: "POST",
    body: JSON.stringify({ field_name: fieldName, type: 1 })
  });
};

const ensureFields = async () => {
  let fields = await listFields();
  const byName = new Map(fields.map((field) => [field.field_name, field]));
  const oldShopNameField = byName.get("Shop Name") || byName.get("客户ID");
  if (!byName.has("Store Name") && oldShopNameField) {
    await updateFieldName(oldShopNameField, "Store Name");
  }

  fields = await listFields();
  const names = new Set(fields.map((field) => field.field_name));
  for (const fieldName of ["Clients ID", "Store Name"]) {
    if (!names.has(fieldName)) {
      await createTextField(fieldName);
    }
  }
};

const extractUrlValue = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return extractUrlValue(value[0]);
  return value.link || value.text || "";
};

const pickField = (fields, names) => {
  for (const name of names) {
    if (fields[name] !== undefined && fields[name] !== "") return fields[name];
  }
  return "";
};

const listRecords = async () => {
  const records = [];
  let pageToken = "";
  do {
    const url = new URL(`${client.baseUrl}/bitable/v1/apps/${config.feishu.appToken}/tables/${config.feishu.tableId}/records`);
    url.searchParams.set("page_size", "500");
    if (pageToken) url.searchParams.set("page_token", pageToken);
    const payload = await request(url);
    records.push(...(payload.data?.items || []));
    pageToken = payload.data?.has_more ? payload.data?.page_token || "" : "";
  } while (pageToken);
  return records;
};

const buildCsvIndexes = async () => {
  const byMapsUrl = new Map();
  const byPhone = new Map();
  for (const row of await readCsvRows()) {
    const shop = csvLineToShop(row);
    if (shop.mapsUrl) byMapsUrl.set(shop.mapsUrl, shop);
    const phone = normalizePhone(shop.phone);
    if (phone) byPhone.set(phone, shop);
  }
  return { byMapsUrl, byPhone };
};

const recordToShop = (record, csvIndexes) => {
  const fields = record.fields || {};
  const mapsUrl = extractUrlValue(pickField(fields, ["Google Maps", "地图链接"]));
  const phone = normalizePhone(pickField(fields, ["Phone", "电话"]));
  const csvShop = csvIndexes.byMapsUrl.get(mapsUrl) || csvIndexes.byPhone.get(phone);
  return {
    name: csvShop?.name || pickField(fields, ["Store Name", "店铺名称", "Shop Name", "Clients ID", "ID"]) || "",
    phone: csvShop?.phone || phone || "",
    address: csvShop?.address || pickField(fields, ["地址", "Adress", "店铺地址"]) || "",
    website: csvShop?.website || extractUrlValue(pickField(fields, ["Site", "Facebook"])),
    mapsUrl: csvShop?.mapsUrl || mapsUrl,
    rating: csvShop?.rating || "",
    reviewCount: csvShop?.reviewCount || "",
    keyword: csvShop?.keyword || "",
    province: csvShop?.province || pickField(fields, ["City", "城市"]) || "",
    scrapedAt: csvShop?.scrapedAt || ""
  };
};

const updateRecord = async (recordId, fields) => {
  const url = `${client.baseUrl}/bitable/v1/apps/${config.feishu.appToken}/tables/${config.feishu.tableId}/records/${recordId}`;
  await request(url, {
    method: "PUT",
    body: JSON.stringify({ fields })
  });
};

const updateRecordsBatch = async (records) => {
  const url = `${client.baseUrl}/bitable/v1/apps/${config.feishu.appToken}/tables/${config.feishu.tableId}/records/batch_update`;
  await request(url, {
    method: "POST",
    body: JSON.stringify({ records })
  });
};

const main = async () => {
  await ensureFields();
  const csvIndexes = await buildCsvIndexes();
  const records = await listRecords();
  console.log(`FEISHU_RECORDS=${records.length}`);
  const usedCustomerIds = new Set(
    records
      .map((record) => String(record.fields?.["Clients ID"] || record.fields?.["客户ID"] || ""))
      .filter((value) => /^\d{5}$/.test(value))
  );
  const missingIdRecords = records.filter((record) => {
    const currentId = String(record.fields?.["Clients ID"] || record.fields?.["客户ID"] || "");
    return !/^\d{5}$/.test(currentId);
  });
  console.log(`MISSING_CLIENT_IDS=${missingIdRecords.length}`);

  let updated = 0;
  const batchSize = 100;
  for (let index = 0; index < missingIdRecords.length; index += batchSize) {
    const batch = missingIdRecords.slice(index, index + batchSize);
    const updates = [];

    for (let offset = 0; offset < batch.length; offset += 1) {
      const record = batch[offset];
      const shop = recordToShop(record, csvIndexes);
      const customerId = generateFiveDigitCustomerId(shop, usedCustomerIds);
      updates.push({
        record_id: record.record_id,
        fields: {
          "Clients ID": customerId
        }
      });
    }

    if (updates.length > 0) {
      await updateRecordsBatch(updates);
      updated += updates.length;
    }

    for (let offset = 0; offset < updates.length; offset += 10) {
      const current = Math.min(updated - updates.length + offset + 10, updated);
      if (current > 0) {
        console.log(`UPDATED=${current}/${missingIdRecords.length}`);
      }
    }
    if (updated === missingIdRecords.length && updated % 10 !== 0) {
      console.log(`UPDATED=${updated}/${missingIdRecords.length}`);
    }
  }

  console.log(`FEISHU_MIGRATION_DONE updated=${updated} skipped=${records.length - missingIdRecords.length}`);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
