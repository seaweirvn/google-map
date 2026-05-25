# 越南 Google Maps 渔具店采集系统

这是一个真实可运行的 Node.js + Playwright 自动化采集项目，用于批量抓取越南 Google Maps 上的渔具店信息，导出 CSV，并可同步到飞书多维表格。

## 功能

- 自动打开 Google Maps
- 自动按“省级 + 城市级 + 重点海边区县”组合搜索
- 自动滚动 Google Maps 店铺列表
- 自动打开店铺详情页
- 自动提取店铺名称、电话、地址、网站、Google Maps 链接、评分、评论数
- 自动导出 CSV
- 飞书 Bitable 实时上传
- 按电话或 Google Maps 链接去重，避免空电话店铺重复入库
- 自动保存抓取进度，支持断点续爬
- 随机等待、防固定节奏、防封基础策略
- 自动写入 logs 日志

## 目录结构

```text
seaweir-maps/
  project/                 # 项目扩展资料目录
  keywords/                # 行业关键词、省市列表和城市/区县库
  scraper/                 # Playwright Google Maps 抓取逻辑
  analysis/                # 规则引擎、AI增强、AI缓存
  output/                  # CSV 输出目录
  logs/                    # 日志目录
  utils/                   # 配置、日志、CSV、进度、去重、飞书工具
  data/                    # 断点进度和去重数据
  index.js                 # 主入口
  package.json
  .env.example
```

## 安装

当前机器需要 Node.js 20+ 和 npm。

```powershell
cd "c:\workspace\seaweir-maps"
npm install
npm run playwright:install
```

如果 `npm` 命令不可用，请重新安装 Node.js LTS，并勾选 npm。

## 配置

复制 `.env.example` 为 `.env`：

```powershell
copy .env.example .env
```

常用配置：

```env
HEADLESS=false
MAX_RESULTS_PER_QUERY=0
MAX_SCROLL_ROUNDS=120
OUTPUT_CSV=output/shops.csv
PROGRESS_FILE=data/progress.json
DEDUPE_FILE=data/dedupe.json
LOG_FILE=logs/app.log
SEARCH_LOCATIONS_FILE=keywords/vietnam-locations.json
SEARCH_RETRY_LIMIT=2
```

## 搜索策略

系统不再只跑“省 + 关键词”，而是自动读取 `keywords/vietnam-locations.json` 生成三级任务：

- 省级覆盖：所有省份都跑一遍基础关键词。
- 市级主抓取：重点城市、直辖市区、工业/人口集中区域做主抓取。
- 重点海边区县补漏：海钓、港口、沿海城市和岛屿区域做补充。

关键词位于 `keywords/industry-keywords.json`，当前包含 `đồ câu cá`、`máy câu`、`dây câu`、`câu biển`、`lure` 等，已去掉 `thiết bị câu cá`。

## 低 Token 分析架构

系统采用“规则引擎优先 + AI 补充分析”：

- 默认不调用 AI，90% 以上店铺通过本地关键词规则分析。
- 本地规则会判断渔轮、鱼线、PE、碳线、海钓、路亚、淡水等标签。
- 只有开启 `AI_ANALYSIS_ENABLED=true` 且规则置信度低时，才进入批量 AI 增强。
- 第二层默认使用 Gemini Flash 做低成本文本增强，只负责一句简介、店铺档次、补充 `REEL/LINE/FRESH` 标签。
- 第三层 GPT-4o 只作为复杂店铺或图片识别备用，不参与常规批量文本分析。
- AI 输入只包含压缩后的关键词、简介和前 10 条评论片段，不发送 HTML 或完整页面。
- AI 增强支持批量处理，默认 `AI_BATCH_SIZE=50`。
- AI 结果按 `shop_id + hash` 缓存在 `data/ai-analysis-cache.json`，同店不重复消耗 Token。

AI 配置默认关闭：

```env
AI_ANALYSIS_ENABLED=false
AI_PROVIDER=gemini
AI_BATCH_SIZE=50
AI_CACHE_FILE=data/ai-analysis-cache.json
GEMINI_API_KEY=
GEMINI_MODEL=gemini-1.5-flash
VISION_ANALYSIS_ENABLED=false
GPT4O_API_KEY=
GPT4O_MODEL=gpt-4o
AI_ENDPOINT=
AI_API_KEY=
AI_MODEL=
```

## 飞书配置教程

1. 打开飞书开放平台，创建企业自建应用。
2. 记录 `App ID` 和 `App Secret`，填入 `.env`：

```env
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
```

3. 在权限管理中添加多维表格相关权限，并发布应用版本。
4. 打开目标多维表格，从 URL 中获取 `app_token` 和 `table_id`：

```env
FEISHU_BITABLE_APP_TOKEN=xxx
FEISHU_TABLE_ID=tblxxx
```

5. 建议飞书表字段名：

```text
店铺名称
电话
地址
网站
Google Maps链接
评分
评论数
搜索关键词
省市
店铺简介
分类
```

字段名如果不一样，可以在 `.env` 里修改 `FEISHU_FIELD_*`。

## 运行

开始抓取：

```powershell
npm run scrape
```

等价命令：

```powershell
node index.js scrape
```

只上传已有 CSV 到飞书：

```powershell
npm run upload
```

## 断点续爬

系统会把完成过的“层级 + 省份 + 城市/区县 + 关键词”写入：

```text
data/progress.json
```

中途关闭后，再次运行 `npm run scrape` 会自动跳过已经完成的组合。单个搜索失败会记录在 `failedQueries`，并按 `SEARCH_RETRY_LIMIT` 自动重试。

## 去重规则

系统会把去重数据写入：

```text
data/dedupe.json
```

入库去重按电话或 Google Maps 链接；电话为空时使用 Maps 链接兜底。

## 输出文件

CSV 输出：

```text
output/shops.csv
```

日志输出：

```text
logs/app.log
```

## 错误处理

- 单个店铺详情抓取失败：记录日志，继续下一个店铺。
- 单个搜索组合失败：记录日志，保留断点，下次继续。
- 飞书上传失败：CSV 已保留本地数据，日志记录失败原因。
- Google Maps 页面结构变化：日志会显示具体失败店铺或搜索组合，便于调整选择器。

## 防封策略

- 使用越南地区语言和时区。
- 每次搜索、滚动、点击、打开详情页都随机等待。
- 限制每个搜索组合最大结果数。
- 支持可视化模式，降低异常行为。
- 默认不并发抓取，避免请求过密。

## 注意

Google Maps 页面结构会变化，采集速度和成功率受网络、账号、地区和 Google 风控影响。建议先小范围运行，确认输出和飞书字段无误后，再扩大抓取规模。
