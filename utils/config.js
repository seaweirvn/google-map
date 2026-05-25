import "dotenv/config";
import path from "node:path";

const toBool = (value, fallback) => {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "y"].includes(String(value).toLowerCase());
};

const toInt = (value, fallback) => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const resolveProjectPath = (value) => path.resolve(process.cwd(), value);
const envOrDefault = (name, fallback) => (process.env[name] === undefined ? fallback : process.env[name]);
const defaultAiEndpoint = (provider) => {
  if (provider === "volcano_engine") {
    return "https://ark.cn-beijing.volces.com/api/v3/chat/completions";
  }
  return "";
};
const parseProxy = (value) => {
  if (!value) return null;

  if (value.startsWith("http://") || value.startsWith("https://")) {
    const url = new URL(value);
    return {
      server: `${url.protocol}//${url.hostname}:${url.port}`,
      username: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password)
    };
  }

  const [host, port, username, ...passwordParts] = value.split(":");
  if (!host || !port) return null;
  return {
    server: `http://${host}:${port}`,
    username: expandProxyUsername(username || ""),
    password: passwordParts.join(":") || undefined
  };
};

const expandProxyUsername = (username) => {
  if (!username.includes("{session}")) return username || undefined;
  const session = Math.floor(1000000000 + Math.random() * 9000000000);
  return username.replaceAll("{session}", String(session));
};

// 集中管理所有运行配置，方便后续扩展命令行参数或配置中心。
export const config = {
  headless: toBool(process.env.HEADLESS, false),
  browserChannel: process.env.BROWSER_CHANNEL || "",
  userDataDir: resolveProjectPath(process.env.USER_DATA_DIR || "chrome-profile"),
  slowMoMs: toInt(process.env.SLOW_MO_MS, 80),
  maxResultsPerQuery: toInt(process.env.MAX_RESULTS_PER_QUERY, 80),
  scrapeLimit: toInt(process.env.SCRAPE_LIMIT, 0),
  maxScrollRounds: toInt(process.env.MAX_SCROLL_ROUNDS, 30),
  pauseEveryShops: toInt(process.env.PAUSE_EVERY_SHOPS, 20),
  pauseMs: toInt(process.env.PAUSE_MS, 60000),
  minWaitMs: toInt(process.env.MIN_WAIT_MS, 1200),
  maxWaitMs: toInt(process.env.MAX_WAIT_MS, 3500),
  navigationTimeoutMs: toInt(process.env.NAVIGATION_TIMEOUT_MS, 60000),
  detailTimeoutMs: toInt(process.env.DETAIL_TIMEOUT_MS, 20000),
  proxy: parseProxy(process.env.PROXY_URL || ""),
  outputCsv: resolveProjectPath(process.env.OUTPUT_CSV || "output/shops.csv"),
  progressFile: resolveProjectPath(process.env.PROGRESS_FILE || "data/progress.json"),
  dedupeFile: resolveProjectPath(process.env.DEDUPE_FILE || "data/dedupe.json"),
  logFile: resolveProjectPath(process.env.LOG_FILE || "logs/app.log"),
  searchLocationsFile: process.env.SEARCH_LOCATIONS_FILE || "keywords/vietnam-locations.json",
  searchRetryLimit: toInt(process.env.SEARCH_RETRY_LIMIT, 2),
  feishu: {
    appId: process.env.FEISHU_APP_ID || "",
    appSecret: process.env.FEISHU_APP_SECRET || "",
    appToken: process.env.FEISHU_BITABLE_APP_TOKEN || "",
    tableId: process.env.FEISHU_TABLE_ID || "",
    fields: {
      name: envOrDefault("FEISHU_FIELD_NAME", "店铺名称"),
      customerId: envOrDefault("FEISHU_FIELD_CUSTOMER_ID", "客户ID"),
      phone: envOrDefault("FEISHU_FIELD_PHONE", "电话"),
      address: envOrDefault("FEISHU_FIELD_ADDRESS", "地址"),
      website: envOrDefault("FEISHU_FIELD_WEBSITE", "网站"),
      mapsUrl: envOrDefault("FEISHU_FIELD_MAPS_URL", "Google Maps链接"),
      rating: envOrDefault("FEISHU_FIELD_RATING", "评分"),
      reviewCount: envOrDefault("FEISHU_FIELD_REVIEW_COUNT", "评论数"),
      keyword: envOrDefault("FEISHU_FIELD_KEYWORD", "搜索关键词"),
      province: envOrDefault("FEISHU_FIELD_PROVINCE", "省市"),
      shopSummary: envOrDefault("FEISHU_FIELD_SHOP_SUMMARY", ""),
      productTags: envOrDefault("FEISHU_FIELD_PRODUCT_TAGS", ""),
      fishingType: envOrDefault("FEISHU_FIELD_FISHING_TYPE", ""),
      analysisSource: envOrDefault("FEISHU_FIELD_ANALYSIS_SOURCE", ""),
      analysisConfidence: envOrDefault("FEISHU_FIELD_ANALYSIS_CONFIDENCE", ""),
      aiFlag: envOrDefault("FEISHU_FIELD_AI_FLAG", "")
    }
  },
  analysis: {
    aiEnabled: toBool(process.env.AI_ANALYSIS_ENABLED, false),
    aiProvider: process.env.AI_PROVIDER || "gemini",
    aiBatchSize: toInt(process.env.AI_BATCH_SIZE, 50),
    aiCacheFile: resolveProjectPath(process.env.AI_CACHE_FILE || "data/ai-analysis-cache.json"),
    aiEndpoint: process.env.AI_ENDPOINT || defaultAiEndpoint(process.env.AI_PROVIDER || "gemini"),
    aiApiKey: process.env.AI_API_KEY || "",
    aiModel: process.env.AI_MODEL || "",
    geminiApiKey: process.env.GEMINI_API_KEY || "",
    geminiModel: process.env.GEMINI_MODEL || "gemini-1.5-flash",
    geminiEndpoint: process.env.GEMINI_ENDPOINT || "https://generativelanguage.googleapis.com/v1beta",
    gpt4oApiKey: process.env.GPT4O_API_KEY || "",
    gpt4oModel: process.env.GPT4O_MODEL || "gpt-4o",
    gpt4oEndpoint: process.env.GPT4O_ENDPOINT || "https://api.openai.com/v1/chat/completions",
    visionAnalysisEnabled: toBool(process.env.VISION_ANALYSIS_ENABLED, false)
  }
};
