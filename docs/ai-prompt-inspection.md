# AI 提示词查询与量化记录

不提供前端展示入口，需要时直接调用以下只读接口。

`GET /api/ai/prompts` 返回 `{ success: true, serverTime, data: [{ strategyId, symbol, timestamp, expiresAt, bytes }] }`，不包含正文。可先查询该目录再按时间戳读取完整请求；两次请求之间可能发生过期或容量淘汰，正文接口会返回404，不回退其他分析记录。

`GET /api/ai/prompt?strategyId=strategy_001&symbol=BTCUSDT&timestamp=1793032293613`

- `strategyId`、`symbol` 必填，交易对兼容 `BTCUSDT` 和 `BTC/USDT`。
- `timestamp` 可选，使用 AI 分析记录的毫秒时间戳。提供时严格匹配，省略时取该策略与交易对最新一条。
- 成功返回 `{ success: true, data: { strategyId, symbol, timestamp, messages } }`。`messages` 包含实际请求的 `system` 和 `user` 消息；用户消息即 `buildFullPrompt()` 的结果。
- 此接口只读，不重新计算、不调用 AI、不下单。无效参数返回 400，未命中返回 404，响应禁止浏览器缓存。

完整提示词仅在真实 AI 分析成功解析后缓存于当前服务进程内，不写入 AI JSONL。保留最长 30 分钟、最多 100 条、总计 4 MiB；超限淘汰较早记录，单条大于总预算不缓存。服务重启、开发热重载或淘汰后不可恢复，旧记录不可追溯。多进程部署须访问产生该分析的进程。

新增 AI 文件记录保留 `technicalData` 的 DI、成交量复算字段和精简的 `strategySnapshot`，但不包含 `fullPrompt`、系统提示词或 API 连接配置。

从快照版本5开始，`strategySnapshot.rulesHash` 替代逐条重复的 `userPrompt`。规则按精确正文的 SHA-256 保存到 `data/ai-rules/<rulesHash>.json`，相同正文跨策略只保存一份，任何空格或换行变化也产生新哈希。规则文件原子写入成功后，才会把引用它的分析记录交给 JSONL 写入器；规则文件损坏时报告错误，不写出悬空引用。

通过 `GET /api/ai/rules?rulesHash=<64位哈希>` 获取 `{ success: true, data: { schemaVersion, rulesHash, userPrompt } }`。参数无效返回400、文件不存在返回404、读取或完整性校验失败返回500。该规则文件持久化保存，不受完整提示词内存缓存有效期影响。备份分析记录时须同时备份 `data/ai-rules`；旧记录不自动迁移或改写，旧版内联 `userPrompt` 仍可读取。

记录仍受现有 `aiAnalysisConfig.enabled`、`saveIdle`、`minConfidence` 设置控制；预筛未进入 AI、命中分析缓存而未重新请求 AI等情况不会产生新的实际请求快照。

浏览器直接查看用户策略规则正文：`GET /api/ai/rules?rulesHash=<64位哈希>&format=text`。返回 UTF-8 纯文本，保留原始换行；省略 `format` 或指定 `format=json` 仍返回原来的 JSON。其他格式参数返回400。这里的正文仅为独立保存的 `userPrompt` 策略规则，不包含行情数据或系统提示词。
