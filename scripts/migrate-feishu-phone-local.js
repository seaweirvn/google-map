import { config } from "../utils/config.js";
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

const extractTextValue = (value) => {
  if (!value) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(extractTextValue).filter(Boolean).join("");
  return value.text || value.link || "";
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

const updateRecordsBatch = async (records) => {
  const url = `${client.baseUrl}/bitable/v1/apps/${config.feishu.appToken}/tables/${config.feishu.tableId}/records/batch_update`;
  await request(url, {
    method: "POST",
    body: JSON.stringify({ records })
  });
};

const main = async () => {
  const phoneField = config.feishu.fields.phone;
  if (!phoneField) throw new Error("FEISHU_VN_FIELD_PHONE 未配置");

  const records = await listRecords();
  const updates = [];
  for (const record of records) {
    const rawPhone = extractTextValue(record.fields?.[phoneField]);
    const oldDigits = rawPhone.replace(/[^\d]/g, "");
    if (!oldDigits.startsWith("84")) continue;

    const normalized = normalizePhone(rawPhone);
    if (!normalized || normalized === oldDigits) continue;
    updates.push({
      record_id: record.record_id,
      fields: {
        [phoneField]: normalized
      }
    });
  }

  console.log(`FEISHU_PHONE_RECORDS=${records.length}`);
  console.log(`PHONE_UPDATES=${updates.length}`);

  let updated = 0;
  const batchSize = 100;
  for (let index = 0; index < updates.length; index += batchSize) {
    const batch = updates.slice(index, index + batchSize);
    await updateRecordsBatch(batch);
    updated += batch.length;
    console.log(`UPDATED=${updated}/${updates.length}`);
  }

  console.log(`FEISHU_PHONE_MIGRATION_DONE updated=${updated}`);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
