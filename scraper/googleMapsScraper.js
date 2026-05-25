import { chromium } from "playwright";
import { config } from "../utils/config.js";
import { logger } from "../utils/logger.js";
import { normalizeText, normalizePhone, parseRating, parseReviewCount } from "../utils/normalize.js";
import { randomWait } from "../utils/sleep.js";

const googleMapsUrl = "https://www.google.com/maps?hl=vi";

export class GoogleMapsScraper {
  constructor(options = {}) {
    this.config = { ...config, ...options };
    this.context = null;
    this.page = null;
  }

  async start() {
    this.context = await chromium.launchPersistentContext(this.config.userDataDir, {
      headless: this.config.headless,
      channel: this.config.browserChannel || undefined,
      slowMo: this.config.slowMoMs,
      viewport: null,
      args: [
        "--start-maximized"
      ]
    });

    this.page = this.context.pages()[0] || await this.context.newPage();
    this.page.setDefaultTimeout(this.config.detailTimeoutMs);
    this.page.setDefaultNavigationTimeout(this.config.navigationTimeoutMs);
    await logger.info("已启动持久化 Chrome", { userDataDir: this.config.userDataDir });
  }

  async stop() {
    await this.context?.close().catch(() => {});
  }

  async search(query) {
    await logger.info("打开 Google Maps", { query });
    await this.page.goto(googleMapsUrl, { waitUntil: "commit", timeout: this.config.navigationTimeoutMs });
    await this.assertNoCaptcha("打开 Google Maps");
    await this.acceptConsentIfVisible();

    const searchBox = this.page.locator("#searchboxinput, input[name='q']").first();
    try {
      await searchBox.waitFor({ state: "visible", timeout: this.config.navigationTimeoutMs });
      await searchBox.click();
      await searchBox.fill(query);
      await randomWait(400, 1200);
      await this.submitSearch(query);
    } catch (error) {
      const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}?hl=vi`;
      await logger.warn("搜索框不可用，改用搜索 URL", { query, error: error.message });
      await this.page.goto(searchUrl, { waitUntil: "commit", timeout: this.config.navigationTimeoutMs });
    }

    await this.waitForSearchResults();
    await this.assertNoCaptcha("搜索结果页");
  }

  async submitSearch(query) {
    const searchButton = this.page
      .locator('#searchbox-searchbutton, button[aria-label="Tìm kiếm"], button[aria-label="Search"]')
      .first();
    if (await searchButton.isVisible().catch(() => false)) {
      await searchButton.click();
      await logger.info("已点击搜索按钮", { query });
      return;
    }

    await this.page.locator("#searchboxinput, input[name='q']").first().press("Enter");
    await logger.info("搜索按钮不可见，已用 Enter 提交", { query });
  }

  async waitForSearchResults() {
    await this.page
      .locator('div[role="feed"], a[href*="/maps/place/"]')
      .first()
      .waitFor({ state: "visible", timeout: this.config.navigationTimeoutMs });
    await randomWait(2500, 5000);
  }

  async assertNoCaptcha(stage) {
    const currentUrl = this.page.url();
    const hasSorryUrl = currentUrl.includes("/sorry/") || currentUrl.includes("sorry/index");
    const hasVisibleCaptcha = await this.page
      .locator('iframe[src*="recaptcha"], input[name="captcha"], form[action*="sorry"]')
      .first()
      .isVisible({ timeout: 2000 })
      .catch(() => false);

    if (hasSorryUrl || hasVisibleCaptcha) {
      throw new Error(`检测到 Google 验证码或异常流量页面，阶段=${stage}`);
    }
  }

  async acceptConsentIfVisible() {
    // Google 偶尔会显示同意按钮；找不到就忽略。
    const candidates = [
      "button:has-text('Accept all')",
      "button:has-text('I agree')",
      "button:has-text('Đồng ý')",
      "button:has-text('Chấp nhận tất cả')"
    ];
    for (const selector of candidates) {
      const button = this.page.locator(selector).first();
      if (await button.isVisible().catch(() => false)) {
        await button.click();
        await randomWait();
        return;
      }
    }
  }

  async collectResultUrls() {
    const urls = new Set();
    let stableRounds = 0;
    let lastCount = 0;
    const hasResultLimit = this.config.maxResultsPerQuery > 0;

    for (let round = 1; round <= this.config.maxScrollRounds; round += 1) {
      const roundUrls = await this.extractVisibleResultUrls();
      for (const url of roundUrls) urls.add(url);

      await logger.info("滚动搜索结果", {
        round,
        collected: urls.size,
        max: hasResultLimit ? this.config.maxResultsPerQuery : "不限"
      });

      if (hasResultLimit && urls.size >= this.config.maxResultsPerQuery) break;
      stableRounds = urls.size === lastCount ? stableRounds + 1 : 0;
      if (stableRounds >= 4) break;
      lastCount = urls.size;

      await this.scrollResultsPanel();
      await randomWait(1800, 4200);
    }

    const collectedUrls = [...urls];
    return hasResultLimit ? collectedUrls.slice(0, this.config.maxResultsPerQuery) : collectedUrls;
  }

  async extractVisibleResultUrls() {
    return this.page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll('a[href*="/maps/place/"], a[href*="google.com/maps/place"]'));
      return anchors
        .map((anchor) => anchor.href)
        .filter(Boolean)
        .map((href) => href.split("&ved=")[0]);
    });
  }

  async scrollResultsPanel() {
    const scrolled = await this.page.evaluate(() => {
      const feed = document.querySelector('div[role="feed"]');
      if (feed) {
        feed.scrollBy(0, feed.scrollHeight);
        return true;
      }
      const panels = Array.from(document.querySelectorAll("div"));
      const scrollable = panels.find((node) => node.scrollHeight > node.clientHeight + 500);
      if (scrollable) {
        scrollable.scrollBy(0, scrollable.scrollHeight);
        return true;
      }
      return false;
    });

    if (!scrolled) {
      await this.page.mouse.wheel(0, 1800);
    }
  }

  async scrapeQuery({ keyword, province, location, level, query, dedupe }) {
    const searchQuery = query || `${location || province} ${keyword}`;
    await this.search(searchQuery);
    const resultUrls = await this.collectResultUrls();
    await this.assertNoCaptcha("结果列表滚动");
    await logger.info("搜索结果收集完成", { query: searchQuery, count: resultUrls.length });

    const shops = [];
    const seenUrls = new Set();
    for (const mapsUrl of resultUrls) {
      if (seenUrls.has(mapsUrl)) {
        await logger.info("跳过本轮重复地图链接", { mapsUrl });
        continue;
      }
      seenUrls.add(mapsUrl);

      if (dedupe?.hasMapsUrl(mapsUrl)) {
        await logger.info("打开详情前跳过已抓地图链接", { mapsUrl });
        continue;
      }

      try {
        await randomWait();
        const shop = await this.scrapePlaceDetail(mapsUrl, { keyword, province, location, level });
        if (shop.name) shops.push(shop);
      } catch (error) {
        await logger.error("店铺详情抓取失败", { mapsUrl, error: error.message });
      }
    }
    return shops;
  }

  async scrapePlaceDetail(mapsUrl, context) {
    await logger.info("打开店铺详情", { mapsUrl });
    await this.page.goto(mapsUrl, { waitUntil: "commit", timeout: this.config.navigationTimeoutMs });
    await this.assertNoCaptcha("店铺详情页");
    await this.page.locator("h1").first().waitFor({ state: "visible", timeout: this.config.detailTimeoutMs }).catch(() => {});
    await randomWait(1200, 2600);

    const name = await this.getName();
    const rating = await this.getRating();
    const reviewCount = await this.getReviewCount();
    const address = await this.getButtonTextByDataItemId("address");
    const website = await this.getWebsite();
    const phone = await this.getPhone();
    const categories = await this.getCategories();
    const description = await this.getDescription();
    const reviewSnippets = await this.getVisibleReviewSnippets();
    await logger.info("店铺详情已提取", { name, phone, address, rating, reviewCount });

    return {
      name,
      phone: normalizePhone(phone),
      address,
      website,
      mapsUrl,
      rating,
      reviewCount,
      description,
      categories,
      reviewSnippets,
      keyword: context.keyword,
      province: context.location || context.province,
      scrapedAt: new Date().toISOString()
    };
  }

  async getName() {
    const text = await this.page.evaluate(() => document.querySelector("h1")?.textContent || "");
    return normalizeText(text);
  }

  async getRating() {
    const text = await this.page.evaluate(() => {
      const node = Array.from(document.querySelectorAll("span[aria-label]")).find((item) => {
        const label = item.getAttribute("aria-label") || "";
        return label.includes("sao") || label.toLowerCase().includes("star");
      });
      return node?.getAttribute("aria-label") || "";
    });
    return parseRating(text);
  }

  async getReviewCount() {
    const text = await this.page.evaluate(() => {
      const node = Array.from(document.querySelectorAll("button[aria-label], span[aria-label]")).find((item) => {
        const label = item.getAttribute("aria-label") || "";
        return label.includes("bài đánh giá") || label.toLowerCase().includes("reviews");
      });
      return node?.getAttribute("aria-label") || "";
    });
    return parseReviewCount(text);
  }

  async getButtonTextByDataItemId(partialId) {
    const text = await this.page.evaluate((id) => {
      const node = document.querySelector(`button[data-item-id*="${id}"], a[data-item-id*="${id}"]`);
      return node?.getAttribute("aria-label") || node?.textContent || "";
    }, partialId);
    const normalized = normalizeText(text);
    return normalized.replace(/^(Địa chỉ|Address):?\s*/i, "");
  }

  async getWebsite() {
    const href = await this.page.evaluate(() => {
      const node = document.querySelector('a[data-item-id="authority"], a[aria-label*="Trang web"], a[aria-label*="Website"]');
      return node?.getAttribute("href") || "";
    });
    return href || "";
  }

  async getPhone() {
    const byDataId = await this.getButtonTextByDataItemId("phone:tel");
    if (byDataId) return byDataId.replace(/^(Điện thoại|Phone):?\s*/i, "");

    // 兜底：从页面可见文本里提取越南电话号码。
    const bodyText = await this.page.locator("body").textContent().catch(() => "");
    const match = bodyText.match(/(\+?84|0)([\s.-]?\d){8,10}/);
    return match ? match[0] : "";
  }

  async getCategories() {
    const categories = await this.page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll("button[jsaction], button[aria-label]"));
      return buttons
        .map((button) => button.textContent?.trim() || "")
        .filter((text) => text.length > 2 && text.length < 60)
        .slice(0, 5);
    });
    return [...new Set(categories.map(normalizeText))].filter(Boolean);
  }

  async getDescription() {
    const text = await this.page.evaluate(() => {
      const candidates = Array.from(document.querySelectorAll("div, span"))
        .map((node) => node.textContent?.trim() || "")
        .filter((value) => value.length > 30 && value.length < 260);
      return candidates.find((value) => /câu|fishing|lure|reel|shimano|daiwa|dây|máy/i.test(value)) || "";
    });
    return normalizeText(text);
  }

  async getVisibleReviewSnippets() {
    const snippets = await this.page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll('span[jsinstance], div[role="article"] span, div[aria-label*="review"]'));
      return nodes
        .map((node) => node.textContent?.trim() || "")
        .filter((text) => text.length > 20 && text.length < 300)
        .slice(0, 10);
    });
    return [...new Set(snippets.map(normalizeText))].filter(Boolean).slice(0, 10);
  }
}
