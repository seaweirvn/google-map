import { config } from "../utils/config.js";
import { logger } from "../utils/logger.js";

export const buildCompactAiInput = (shop, ruleResult) => {
  const keywords = [
    ...(ruleResult.product_tags || []),
    ...(ruleResult.fishing_type || []),
    shop.keyword,
    shop.name
  ].filter(Boolean);

  return {
    shop_id: shop.mapsUrl || shop.name,
    keywords: [...new Set(keywords)].slice(0, 20),
    description: shop.description || "",
    reviews: (shop.reviewSnippets || []).slice(0, 10)
  };
};

export class AiEnhancer {
  constructor(options = config.analysis) {
    this.options = options;
  }

  isEnabled() {
    if (!this.options.aiEnabled) return false;
    if (this.options.aiProvider === "gemini") {
      return Boolean(this.options.geminiApiKey && this.options.geminiModel);
    }
    return Boolean(this.options.aiEndpoint && this.options.aiApiKey && this.options.aiModel);
  }

  async enhanceBatch(items) {
    if (!this.isEnabled() || items.length === 0) {
      return [];
    }

    if (this.options.aiProvider === "gemini") {
      return this.enhanceBatchWithGemini(items);
    }
    return this.enhanceBatchWithOpenAiCompatible(items);
  }

  buildPrompt(items) {
    return [
      "You enrich fishing tackle shop data at low token cost.",
      "Use only the compact JSON input. Do not assume details beyond provided keywords, description, and reviews.",
      "Return JSON only. Preferred format: {\"items\":[{shop_id, shop_summary, shop_tier, product_tags}]} or a bare array with the same items.",
      "product_tags must only contain REEL, LINE, FRESH. Omit unrelated tags.",
      "shop_summary must be one short Chinese sentence.",
      JSON.stringify(items)
    ].join("\n");
  }

  async enhanceBatchWithGemini(items) {
    const endpoint = `${this.options.geminiEndpoint}/models/${this.options.geminiModel}:generateContent?key=${this.options.geminiApiKey}`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: this.buildPrompt(items) }]
          }
        ],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json"
        }
      })
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(`Gemini Flash 增强失败: ${JSON.stringify(payload)}`);
    }

    const content = payload.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "[]";
    return this.parseJsonArray(content);
  }

  async enhanceBatchWithOpenAiCompatible(items) {
    const providerName = this.options.aiProvider === "volcano_engine" ? "火山引擎方舟" : "AI";
    const response = await fetch(this.options.aiEndpoint, {
      method: "POST",
      signal: AbortSignal.timeout(120000),
      headers: {
        Authorization: `Bearer ${this.options.aiApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: this.options.aiModel,
        messages: [
          {
            role: "system",
            content:
              "You enrich fishing tackle shop data. Return compact JSON only. Preferred format: {\"items\":[{shop_id, shop_summary, shop_tier, product_tags}]}. product_tags must only use REEL, LINE, FRESH."
          },
          {
            role: "user",
            content: this.buildPrompt(items)
          }
        ],
        temperature: 0.1,
        max_tokens: 1200,
        response_format: { type: "json_object" }
      })
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(`${providerName}增强失败: ${JSON.stringify(payload)}`);
    }

    const content = payload.choices?.[0]?.message?.content || "[]";
    return this.parseJsonArray(content);
  }

  parseJsonArray(content) {
    const clean = String(content)
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```$/i, "")
      .trim();
    try {
      const parsed = JSON.parse(clean);
      if (Array.isArray(parsed?.items)) return parsed.items;
      if (Array.isArray(parsed?.results)) return parsed.results;
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      logger.warn("AI返回不是有效JSON，跳过本批增强", { error: error.message }).catch(() => {});
      return [];
    }
  }
}
