import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";

export const csvColumns = [
  "客户ID",
  "店铺名称",
  "电话",
  "地址",
  "网站",
  "Google Maps链接",
  "评分",
  "评论数",
  "搜索关键词",
  "省市",
  "店铺简介",
  "产品标签",
  "是否卖渔轮",
  "是否卖鱼线",
  "是否卖PE",
  "是否卖碳线",
  "钓法类型",
  "分析来源",
  "分析置信度",
  "抓取时间"
];

const escapeCsvValue = (value) => {
  const text = String(value ?? "");
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
};

const toRow = (shop) => [
  shop.customerId,
  shop.name,
  shop.phone,
  shop.address,
  shop.website,
  shop.mapsUrl,
  shop.rating,
  shop.reviewCount,
  shop.keyword,
  shop.province,
  shop.shopSummary,
  listToText(shop.productTags),
  boolToText(shop.hasReel),
  boolToText(shop.hasLine),
  boolToText(shop.hasPe),
  boolToText(shop.hasFluorocarbon),
  listToText(shop.fishingType),
  shop.analysisSource,
  shop.analysisConfidence,
  shop.scrapedAt
];

const listToText = (value) => (Array.isArray(value) ? value.join("|") : value || "");
const boolToText = (value) => (value === true ? "true" : value === false ? "false" : "");

export class CsvWriter {
  constructor(filePath = config.outputCsv) {
    this.filePath = filePath;
  }

  async init() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      await fs.access(this.filePath);
      await this.ensureHeader();
    } catch {
      await fs.writeFile(this.filePath, `${csvColumns.map(escapeCsvValue).join(",")}\n`, "utf8");
    }
  }

  async ensureHeader() {
    const raw = await fs.readFile(this.filePath, "utf8");
    const [header, ...rows] = raw.split(/\r?\n/);
    const currentColumns = parseCsvLine(header || "");
    const hasAllColumns = csvColumns.every((column) => currentColumns.includes(column));
    if (hasAllColumns) return;

    const mergedColumns = [...currentColumns];
    for (const column of csvColumns) {
      if (!mergedColumns.includes(column)) mergedColumns.push(column);
    }
    await fs.writeFile(this.filePath, `${mergedColumns.map(escapeCsvValue).join(",")}\n${rows.join("\n")}`, "utf8");
  }

  async append(shop) {
    const line = `${toRow(shop).map(escapeCsvValue).join(",")}\n`;
    await fs.appendFile(this.filePath, line, "utf8");
  }
}

export const readCsvRows = async (filePath = config.outputCsv) => {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return raw.split(/\r?\n/).filter(Boolean).slice(1);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
};

export const parseCsvLine = (line) => {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];
    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  values.push(current);
  return values;
};

export const csvLineToShop = (line) => {
  const values = parseCsvLine(line);
  if (values.length <= 10) {
    return {
      name: values[0] || "",
      phone: values[1] || "",
      address: values[2] || "",
      website: values[3] || "",
      mapsUrl: values[4] || "",
      rating: values[5] || "",
      reviewCount: values[6] || "",
      keyword: values[7] || "",
      province: values[8] || "",
      scrapedAt: values[9] || ""
    };
  }

  if (values[0] && /^\d{5}$/.test(values[0])) {
    return {
      customerId: values[0] || "",
      name: values[1] || "",
      phone: values[2] || "",
      address: values[3] || "",
      website: values[4] || "",
      mapsUrl: values[5] || "",
      rating: values[6] || "",
      reviewCount: values[7] || "",
      keyword: values[8] || "",
      province: values[9] || "",
      shopSummary: values[10] || "",
      productTags: textToList(values[11]),
      hasReel: textToBool(values[12]),
      hasLine: textToBool(values[13]),
      hasPe: textToBool(values[14]),
      hasFluorocarbon: textToBool(values[15]),
      fishingType: textToList(values[16]),
      analysisSource: values[17] || "",
      analysisConfidence: values[18] || "",
      scrapedAt: values[19] || ""
    };
  }

  return {
    name: values[0] || "",
    phone: values[1] || "",
    address: values[2] || "",
    website: values[3] || "",
    mapsUrl: values[4] || "",
    rating: values[5] || "",
    reviewCount: values[6] || "",
    keyword: values[7] || "",
    province: values[8] || "",
    shopSummary: values[9] || "",
    productTags: textToList(values[10]),
    hasReel: textToBool(values[11]),
    hasLine: textToBool(values[12]),
    hasPe: textToBool(values[13]),
    hasFluorocarbon: textToBool(values[14]),
    fishingType: textToList(values[15]),
    analysisSource: values[16] || "",
    analysisConfidence: values[17] || "",
    scrapedAt: values[18] || values[9] || ""
  };
};

const textToList = (value) => (value ? String(value).split("|").filter(Boolean) : []);
const textToBool = (value) => (value === "true" ? true : value === "false" ? false : "");
