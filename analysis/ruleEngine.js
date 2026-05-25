import { normalizeText } from "../utils/normalize.js";

const keywordGroups = {
  reel: ["máy câu", "reel", "shimano", "daiwa", "spinning reel", "baitcasting"],
  line: ["dây câu", "pe", "fluorocarbon", "nylon line", "leader"],
  pe: ["pe", "dây pe", "pe line"],
  fluorocarbon: ["fluorocarbon", "carbon", "leader", "dây fluorocarbon"],
  seaFishing: ["câu biển", "offshore", "jigging"],
  lure: ["lure", "baitcasting", "spinning", "mồi giả", "lure fishing"],
  freshwater: ["hồ câu", "câu cá giải trí", "ao câu", "câu đài", "freshwater"]
};

const includesAny = (text, keywords) => keywords.some((keyword) => text.includes(keyword.toLowerCase()));

export const buildRuleText = (shop) => {
  const textParts = [
    shop.name,
    shop.description,
    shop.address,
    shop.website,
    shop.keyword,
    shop.province,
    ...(shop.categories || []),
    ...(shop.reviewSnippets || [])
  ];
  return normalizeText(textParts.filter(Boolean).join(" ")).toLowerCase();
};

export const analyzeShopByRules = (shop) => {
  const text = buildRuleText(shop);
  const matched = {};
  for (const [group, keywords] of Object.entries(keywordGroups)) {
    matched[group] = includesAny(text, keywords);
  }

  const fishingType = [];
  if (matched.seaFishing) fishingType.push("sea_fishing");
  if (matched.lure) fishingType.push("lure");
  if (matched.freshwater) fishingType.push("freshwater");

  const productTags = [];
  if (matched.reel) productTags.push("REEL");
  if (matched.line || matched.pe || matched.fluorocarbon) productTags.push("LINE");
  if (matched.freshwater) productTags.push("FRESH");

  const signalCount = Object.values(matched).filter(Boolean).length;
  const confidence = Math.min(0.95, signalCount * 0.18 + (shop.name ? 0.15 : 0));
  const needsAi =
    confidence < 0.45 ||
    !shop.description ||
    Number.parseInt(shop.reviewCount || "0", 10) < 3 ||
    productTags.length === 0;

  const shopSummary = buildRuleSummary({ shop, productTags, fishingType, confidence });

  return {
    has_reel: matched.reel,
    has_line: matched.line,
    has_pe: matched.pe,
    has_fluorocarbon: matched.fluorocarbon,
    fishing_type: fishingType,
    product_tags: productTags,
    shop_summary: shopSummary,
    analysis_source: "rules",
    analysis_confidence: Number(confidence.toFixed(2)),
    needs_ai: needsAi
  };
};

export const buildRuleSummary = ({ shop, productTags, fishingType, confidence }) => {
  const tags = productTags.length > 0 ? productTags.map(toChineseProductTag).join("、") : "渔具相关用品";
  const typeText = fishingType.length > 0 ? `，偏${fishingType.map(toChineseFishingType).join("、")}` : "";
  const suffix = confidence < 0.45 ? "，需后续AI补充确认。" : "。";
  return `${shop.name || "该店"}主营${tags}${typeText}${suffix}`;
};

const toChineseProductTag = (tag) => {
  if (tag === "REEL") return "渔轮";
  if (tag === "LINE") return "鱼线";
  if (tag === "FRESH") return "淡水钓";
  return tag;
};

const toChineseFishingType = (type) => {
  if (type === "sea_fishing") return "海钓";
  if (type === "lure") return "路亚";
  if (type === "freshwater") return "淡水";
  return type;
};
