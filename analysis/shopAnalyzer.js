import { config } from "../utils/config.js";
import { AnalysisCache } from "./analysisCache.js";
import { AiEnhancer, buildCompactAiInput } from "./aiEnhancer.js";
import { analyzeShopByRules } from "./ruleEngine.js";

export class ShopAnalyzer {
  constructor() {
    this.cache = new AnalysisCache();
    this.ai = new AiEnhancer();
  }

  async init() {
    await this.cache.load();
  }

  async analyzeWithRules(shop) {
    const ruleResult = analyzeShopByRules(shop);
    return this.mergeAnalysis(shop, ruleResult);
  }

  mergeAnalysis(shop, analysis) {
    const ruleSummary = analysis.shop_summary || shop.shopSummary || "";
    return {
      ...shop,
      shopSummary: ruleSummary,
      productTags: analysis.product_tags || shop.productTags || [],
      hasReel: analysis.has_reel,
      hasLine: analysis.has_line,
      hasPe: analysis.has_pe,
      hasFluorocarbon: analysis.has_fluorocarbon,
      fishingType: analysis.fishing_type || [],
      analysisSource: analysis.analysis_source || "rules",
      analysisConfidence: analysis.analysis_confidence ?? ""
    };
  }

  async enhanceBatchIfNeeded(shops) {
    if (!config.analysis.aiEnabled) return shops;

    const candidates = [];
    for (const shop of shops) {
      const ruleResult = analyzeShopByRules(shop);
      if (!ruleResult.needs_ai) continue;

      const input = buildCompactAiInput(shop, ruleResult);
      const cached = this.cache.get(shop, input);
      if (cached?.result) {
        candidates.push({ shop, input, ruleResult, cached: cached.result });
        continue;
      }
      candidates.push({ shop, input, ruleResult });
    }

    const uncached = candidates.filter((item) => !item.cached).slice(0, config.analysis.aiBatchSize);
    const aiResults = await this.ai.enhanceBatch(uncached.map((item) => item.input));
    const aiById = new Map(aiResults.map((item) => [item.shop_id, item]));

    for (const item of uncached) {
      const result = aiById.get(item.input.shop_id);
      if (result) this.cache.set(item.shop, item.input, result);
    }
    await this.cache.save();

    const cachedByShopId = new Map();
    for (const item of candidates) {
      const result = item.cached || this.cache.get(item.shop, item.input)?.result;
      if (result) cachedByShopId.set(item.input.shop_id, result);
    }

    return shops.map((shop) => {
      const result = cachedByShopId.get(shop.mapsUrl || shop.name);
      if (!result) return shop;
      return {
        ...shop,
        shopSummary: result.shop_summary || shop.shopSummary,
        productTags: normalizeProductTags([...(shop.productTags || []), ...(result.product_tags || [])]),
        shopTier: result.shop_tier || shop.shopTier,
        analysisSource: "rules+ai",
        aiFlag: "AI"
      };
    });
  }
}

const normalizeProductTags = (tags) => {
  const normalized = [];
  for (const tag of tags || []) {
    const text = String(tag).toUpperCase();
    if (text.includes("REEL") || text.includes("渔轮")) normalized.push("REEL");
    if (text.includes("LINE") || text.includes("PE") || text.includes("鱼线") || text.includes("碳线")) normalized.push("LINE");
    if (text.includes("FRESH") || text.includes("淡水")) normalized.push("FRESH");
  }
  return [...new Set(normalized)];
};
