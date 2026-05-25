import fs from "node:fs/promises";
import { GoogleMapsScraper } from "./scraper/googleMapsScraper.js";
import { CsvWriter, csvLineToShop, readCsvRows } from "./utils/csv.js";
import { config } from "./utils/config.js";
import { generateFiveDigitCustomerId } from "./utils/customerId.js";
import { DedupeStore } from "./utils/dedupe.js";
import { FeishuClient } from "./utils/feishu.js";
import { logger } from "./utils/logger.js";
import { ProgressStore } from "./utils/progress.js";
import { buildSearchTasks } from "./utils/searchTasks.js";
import { longPause } from "./utils/sleep.js";

const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8"));

const loadUsedCustomerIds = async () => {
  const rows = await readCsvRows();
  return new Set(rows.map((row) => csvLineToShop(row).customerId).filter(Boolean));
};

async function scrape() {
  await logger.init();
  const keywords = await readJson("keywords/industry-keywords.json");
  const provinces = await readJson("keywords/vietnam-provinces.json");
  const locations = await readJson(config.searchLocationsFile);
  const searchTasks = buildSearchTasks({ keywords, provinces, locations });
  const progress = new ProgressStore();
  const dedupe = new DedupeStore();
  const csvWriter = new CsvWriter();
  const feishu = new FeishuClient();

  await progress.load();
  await dedupe.load();
  await csvWriter.init();
  const usedCustomerIds = await loadUsedCustomerIds();
  await logger.info("搜索任务生成完成", {
    tasks: searchTasks.length,
    provinceLevel: provinces.length * keywords.length,
    cityLevel: (locations.cityLevel || []).length * keywords.length,
    coastalDistrictLevel: (locations.coastalDistrictLevel || []).length * keywords.length
  });

  const scraper = new GoogleMapsScraper();
  await scraper.start();

  let saved = 0;
  let skippedDuplicate = 0;
  let failedQueries = 0;
  let stopRequested = false;

  try {
    for (const task of searchTasks) {
      if (stopRequested) break;

      const queryKey = task.key;
      if (progress.isQueryCompleted(queryKey)) {
        await logger.info("跳过已完成搜索", task);
        continue;
      }

      await progress.setCurrentQuery(queryKey);

      for (let attempt = 1; attempt <= config.searchRetryLimit + 1; attempt += 1) {
        await logger.info("开始搜索组合", {
          ...task,
          attempt,
          previousFailures: progress.getQueryFailureCount(queryKey)
        });

        try {
          const shops = await scraper.scrapeQuery({ ...task, dedupe });
          for (const shop of shops) {
            if (config.scrapeLimit > 0 && saved >= config.scrapeLimit) {
              await logger.info("达到本次抓取数量限制，停止写入", { scrapeLimit: config.scrapeLimit });
              stopRequested = true;
              break;
            }

            if (dedupe.has(shop)) {
              skippedDuplicate += 1;
              dedupe.add(shop);
              await dedupe.save();
              await logger.info("跳过去重店铺", { name: shop.name, phone: shop.phone });
              continue;
            }

            shop.customerId ||= generateFiveDigitCustomerId(shop, usedCustomerIds);

            await csvWriter.append(shop);
            dedupe.add(shop);
            await dedupe.save();
            saved += 1;
            await progress.markShopSaved(shop, saved);

            // 飞书配置可选：配置完整时实时上传；未配置时只导出 CSV。
            if (feishu.isConfigured()) {
              try {
                const record = await feishu.createRecord(shop);
                await logger.info("飞书上传成功", { name: shop.name, recordId: record?.record_id });
              } catch (error) {
                await logger.error("飞书上传失败，已保留 CSV 数据", { name: shop.name, error: error.message });
              }
            }

            if (config.pauseEveryShops > 0 && saved % config.pauseEveryShops === 0) {
              await logger.info("达到批次暂停点，开始暂停", {
                saved,
                pauseEveryShops: config.pauseEveryShops,
                pauseMs: config.pauseMs
              });
              await longPause(config.pauseMs);
              await logger.info("批次暂停结束，继续抓取", { saved });
            }
          }

          if (!stopRequested) {
            await progress.markQueryCompleted(queryKey);
          }
          await logger.info("搜索组合完成", { ...task, shops: shops.length });
          break;
        } catch (error) {
          failedQueries += 1;
          await progress.markQueryFailed(queryKey, error);
          await logger.error("搜索组合失败，保留断点并按配置重试", {
            ...task,
            attempt,
            retryLimit: config.searchRetryLimit,
            error: error.message
          });
          if (error.message.includes("验证码") || error.message.includes("异常流量")) {
            await logger.error("检测到验证码，停止任务，等待人工处理后再断点续抓", task);
            stopRequested = true;
            break;
          }
          if (attempt <= config.searchRetryLimit) {
            await longPause(10000);
            continue;
          }
        }
      }

      if (config.scrapeLimit > 0 && saved >= config.scrapeLimit) {
        await logger.info("本次抓取数量限制已完成，结束任务", { scrapeLimit: config.scrapeLimit });
        stopRequested = true;
        break;
      }
    }
  } finally {
    await scraper.stop();
  }

  await logger.info("抓取任务完成", { saved, skippedDuplicate, failedQueries });
}

async function upload() {
  await logger.init();
  const feishu = new FeishuClient();
  if (!feishu.isConfigured()) {
    await logger.warn("飞书配置未填写，无法上传；请先配置 .env");
    return;
  }

  const rows = await readCsvRows();
  let uploaded = 0;
  let skipped = 0;
  const existing = await feishu.getExistingRecordKeys();
  const usedCustomerIds = new Set();
  for (const row of rows) {
    const shop = csvLineToShop(row);
    if (shop.customerId) {
      usedCustomerIds.add(shop.customerId);
    } else {
      shop.customerId = generateFiveDigitCustomerId(shop, usedCustomerIds);
    }
    if (feishu.isShopAlreadyUploaded(shop, existing)) {
      skipped += 1;
      continue;
    }
    await feishu.createRecord(shop);
    if (shop.mapsUrl) existing.mapsUrls.add(shop.mapsUrl);
    if (shop.phone) existing.phones.add(shop.phone);
    uploaded += 1;
    await logger.info("CSV 记录已上传飞书", { name: shop.name, phone: shop.phone });
  }
  await logger.info("CSV 上传完成", { uploaded, skipped });
}

async function main() {
  const command = process.argv[2] || "scrape";
  if (command === "scrape") {
    await scrape();
    return;
  }
  if (command === "upload") {
    await upload();
    return;
  }
  console.log("可用命令: node index.js scrape | node index.js upload");
}

main().catch(async (error) => {
  await logger.init().catch(() => {});
  await logger.error("程序异常退出", { error: error.stack || error.message });
  process.exitCode = 1;
});
