# 设计说明

## 采集流程

1. 读取 `keywords/industry-keywords.json` 和 `keywords/vietnam-provinces.json`。
2. 组合成 Google Maps 搜索词，例如 `shop câu cá Hà Nội`。
3. 打开 Google Maps 并搜索。
4. 滚动左侧结果列表，收集店铺详情链接。
5. 逐个打开详情页，提取名称、电话、地址、网站、评分、评论数。
6. 本地去重后写入 CSV。
7. 如果 `.env` 已配置飞书，则实时上传到 Bitable。
8. 每个搜索组合完成后写入断点文件。

## 去重策略

优先级：

1. 电话
2. Google Maps 链接
3. 店铺名称 + 地址

## 防封策略

- 非并发抓取
- 随机等待
- 固定最大滚动轮次和最大结果数量
- 越南语言、时区、常见浏览器 UA
- 默认可视化浏览器模式

## 可扩展点

- 在 `scraper/googleMapsScraper.js` 中调整 Google Maps 选择器。
- 在 `utils/feishu.js` 中增加批量上传。
- 在 `utils/dedupe.js` 中接入数据库去重。
- 在 `keywords/*.json` 中调整行业和城市覆盖范围。
