# AI 提示词查询与量化记录

## 实际开仓的长期决策档案

AI 请求成功后冻结实际 system/user 消息、模型、厂商适配后的有效参数、原始返回和程序处理后的分析结果，随内部信号及分析缓存传递，不依赖下述短期调试缓存。

通过最终开仓检查、提交市价单之前，原子保存到 `data/trade-decisions/YYYY-MM/<analysisId>.json`；月份固定采用 AI 请求时间的北京时间月份，归档失败则中止本次下单。活跃仓位和历史订单保存 `entryAnalysisId`、`entryAnalysisMonth`，不会把全文重复写入月度订单文件。缓存复用沿用相同 ID 和月份，跨月平仓不改变引用。手动开仓和旧订单不伪造或补算提示词。

历史订单详情提供用户提示词、系统提示词与完整决策记录链接。接口：`GET /api/ai/trade-decision?analysisId=<UUID>&month=2026-10`；追加 `&format=text&role=user` 可读取原始 `buildFullPrompt()` 正文，`role=system` 读取系统提示词。查询不会重新调用 AI 或下单。新档案按月份直接定位，不扫描全部目录；省略 month 只读取旧根目录文件，指定月份未找到时也兼容回退旧根目录。旧文件不自动迁移；月份无效返回400，文件损坏不回退其他目录。

备份订单必须同时备份 `data/trade-decisions`。档案内分析可能引用 `rulesHash`，若需读取独立规则文件仍需备份 `data/ai-rules`；完整用户提示词本身已经包含当时的规则正文。现有扫描图层及 AI 分析 JSONL 的开关和保存方式保持原样。

下单失败或成交后保护性退出时可能留下决策文件；暂不自动清理，以免误删已成交但本地确认异常的复盘依据，可凭交易决策关联日志核对订单 ID。此版本不承诺自动恢复异常成交的订单历史，也不补录旧订单。

## 扫描请求的短期调试查询

不提供前端展示入口，需要时直接调用以下只读接口。

`GET /api/ai/prompts` 返回 `{ success: true, serverTime, data: [{ strategyId, symbol, timestamp, expiresAt, bytes }] }`，不包含正文。可先查询该目录再按时间戳读取完整请求；两次请求之间可能发生过期或容量淘汰，正文接口会返回404，不回退其他分析记录。

`GET /api/ai/prompt?strategyId=strategy_001&symbol=BTCUSDT&timestamp=1793032293613`

- `strategyId`、`symbol` 必填，交易对兼容 `BTCUSDT` 和 `BTC/USDT`。
- `timestamp` 可选，使用 AI 分析记录的毫秒时间戳。提供时严格匹配，省略时取该策略与交易对最新一条。
- 成功返回 `{ success: true, data: { strategyId, symbol, timestamp, messages } }`。`messages` 包含实际请求的 `system` 和 `user` 消息；用户消息即 `buildFullPrompt()` 的结果。
- 此接口只读，不重新计算、不调用 AI、不下单。无效参数返回 400，未命中返回 404，响应禁止浏览器缓存。

在完整请求接口追加 `&format=text&role=user`，直接返回用户消息正文（即 fullPrompt），保留原始换行；`role=system` 返回系统消息正文。纯文本模式省略 role 时默认 user，省略 format 时仍返回原来的完整 JSON。format 仅允许 json/text，role 仅允许 user/system，其他值返回400。缓存限制及精确时间戳匹配规则不变。

完整提示词仅在真实 AI 分析成功解析后缓存于当前服务进程内，不写入 AI JSONL。保留最长 30 分钟、最多 100 条、总计 4 MiB；超限淘汰较早记录，单条大于总预算不缓存。服务重启、开发热重载或淘汰后不可恢复，旧记录不可追溯。多进程部署须访问产生该分析的进程。

新增 AI 文件记录保留 `technicalData` 的 DI、成交量复算字段和精简的 `strategySnapshot`，但不包含 `fullPrompt`、系统提示词或 API 连接配置。

从快照版本5开始，`strategySnapshot.rulesHash` 替代逐条重复的 `userPrompt`。规则按精确正文的 SHA-256 保存到 `data/ai-rules/<rulesHash>.json`，相同正文跨策略只保存一份，任何空格或换行变化也产生新哈希。规则文件原子写入成功后，才会把引用它的分析记录交给 JSONL 写入器；规则文件损坏时报告错误，不写出悬空引用。

通过 `GET /api/ai/rules?rulesHash=<64位哈希>` 获取 `{ success: true, data: { schemaVersion, rulesHash, userPrompt } }`。参数无效返回400、文件不存在返回404、读取或完整性校验失败返回500。该规则文件持久化保存，不受完整提示词内存缓存有效期影响。备份分析记录时须同时备份 `data/ai-rules`；旧记录不自动迁移或改写，旧版内联 `userPrompt` 仍可读取。

记录仍受现有 `aiAnalysisConfig.enabled`、`saveIdle`、`minConfidence` 设置控制；预筛未进入 AI、命中分析缓存而未重新请求 AI等情况不会产生新的实际请求快照。

浏览器直接查看用户策略规则正文：`GET /api/ai/rules?rulesHash=<64位哈希>&format=text`。返回 UTF-8 纯文本，保留原始换行；省略 `format` 或指定 `format=json` 仍返回原来的 JSON。其他格式参数返回400。这里的正文仅为独立保存的 `userPrompt` 策略规则，不包含行情数据或系统提示词。
