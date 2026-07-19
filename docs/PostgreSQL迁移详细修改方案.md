# PostgreSQL 迁移详细修改方案

> 文档用途：明确当前项目的核心持久化代码、受影响调用链、目标数据模型、代码改造步骤和生产上线/回滚链路。本文只描述迁移方案，不代表相关代码已经完成修改。
>
> 分析基线：2026-07-16 当前工作区代码与 `data/` 运行数据。

## 1. 结论与推荐路线

当前项目并不是单一的“本地 SQL”存储，而是三类本地持久化并存：

1. `sql.js`（SQLite/WASM）保存 K 线，数据库文件为 `data/kline.db`，当前约 35.6 MB。
2. JSON 文件保存策略、交易历史、活跃仓位、交易对锁、Bot 配置/状态、广场热度历史和交易复盘结果。
3. JSONL 保存 AI 分析明细，普通文本文件保存应用日志。

推荐使用 **PostgreSQL 16 + `pg` + `node-pg-migrate`**。项目现有持久化代码主要是手写 SQL 和 repository 风格，直接使用 `pg` 的参数化 SQL 比引入重量 ORM 更贴近现有代码，也能明确控制 K 线批量 upsert、事务和锁。迁移采用以下原则：

- 业务代码只依赖 repository，不直接依赖文件或 `pg`。
- PostgreSQL 驱动是异步 I/O，K 线存储调用链必须整体改为 `async/await`，不能只替换 SQL 方言。
- 活跃仓位和交易对锁必须在同一事务中更新，并由数据库唯一约束保证互斥。
- 生产切换使用“离线预迁移 + 短维护窗口最终迁移”，不长期双写交易状态。
- 第一版生产实例数保持 `1`；PostgreSQL 解决持久化和并发写问题，但当前定时任务、策略扫描和持仓监控仍是进程内单例，多副本会重复执行交易。
- `public/` 静态资源、Pine 脚本和普通运行日志不迁入 PostgreSQL。日志应继续写 stdout/文件并由日志系统采集。

## 2. 当前数据资产盘点

| 数据 | 当前位置 | 当前规模 | 写入特征 | 目标 |
|---|---|---:|---|---|
| K 线 | `data/kline.db` / `kline_data` | 约 35.6 MB | 高频批量 upsert、按交易对/周期查询 | `klines` |
| 策略 | `data/strategies/*.json` | 4 个策略 | CRUD、版本快照、激活状态 | `strategies`、`strategy_versions`、`strategy_sessions` |
| 交易历史 | `data/trade-history.json` | 75 条 | 平仓后追加、分页/统计读取 | `trade_history` |
| 活跃仓位 | `data/active-positions.json` | 当前 0 条 | 开平仓时覆盖全文件 | `active_positions` |
| 交易对锁 | `data/symbol-locks.json` | 当前 0 条 | 与仓位联动、互斥控制 | `symbol_locks` |
| Bot 配置 | `data/bot-config.json` | 1 份、17 个顶层字段 | 低频整份更新 | `app_settings` |
| Bot 状态 | `data/bot-state.json` | 1 份 | 状态变更时整份更新 | `bot_state` |
| 广场热度历史 | `data/square-heat-history.json` | 16 个资产 | 每资产最多 24 条 | `square_heat_history` |
| 交易复盘结果 | `data/trade-history-analysis.json` | 90 条 | 每日追加/读取最新 | `trade_history_analyses` |
| AI 分析明细 | `data/ai-analysis/*.json[l]` | 多个按日文件 | 高频追加、批量刷盘 | `ai_analyses`（可分阶段迁移） |
| 应用日志 | `logs/*.log` | 按日文件 | 高频追加 | 保持 stdout/文件，不进业务库 |

说明：`scripts/get-pine`、`scripts/generate-tv` 读取的是项目静态脚本/生成物，不属于业务数据库迁移范围；`scripts/download-binance-icons.mjs` 也不在范围内。

## 3. 核心代码与受影响链路

### 3.1 第一优先级：交易正确性链路

| 当前代码 | 职责 | 主要调用方 | 必须修改的原因 |
|---|---|---|---|
| `server/utils/storage.ts` | 交易历史、仓位、锁、Bot 配置/状态 JSON 读写 | `PositionManager`、`StrategyManager`、`trade-recorder`、Bot API | 当前整文件读改写只能保证单进程内串行，跨进程会丢更新 |
| `server/modules/position-manager/PositionManager.ts` | 进程内仓位和 symbol 锁 | 策略开仓、平仓、启动恢复 | `lockSymbol()`/`recordPosition()` 是同步方法且持久化是 100ms 防抖异步任务，数据库迁移后必须将关键写入纳入事务 |
| `server/modules/strategy-engine/helpers/trade-recorder.ts` | 平仓历史和 performance 更新 | 平仓链路 | 当前先追加全局 JSON，再绕过 `StrategyStore` 直接覆盖策略 JSON，存在并发覆盖和加密字段处理不一致风险 |
| `server/modules/strategy-store/StrategyStore.ts` | 策略 CRUD、版本、交易统计 | 策略 API、引擎和管理器 | 每策略一个 JSON；ID 通过扫描文件生成，并发创建时可能重复 |

必须优先保证以下原子操作：

```text
开仓：抢占 symbol lock -> 交易所下单 -> 记录 active position -> 确认/释放预占
平仓：更新/删除 active position -> 释放 symbol lock -> 插入 trade_history
策略更新：更新 strategies -> 插入 strategy_versions（同一事务）
```

交易所调用无法和 PostgreSQL 组成分布式事务，因此需要明确状态机（如 `RESERVED`、`OPENING`、`OPEN`、`CLOSING`）和幂等键（订单 ID/成交 ID）。数据库事务负责本地状态一致性，启动时仍以交易所真实仓位做 reconciliation（对账恢复）。

### 3.2 第二优先级：K 线和指标链路

核心文件：

- `server/utils/kline-simple-storage.ts`：`sql.js` 初始化、同步查询、事务、整库导出落盘。
- `server/modules/kline-simple-sync/index.ts`：增量同步、最后一根更新、批量追加、删除。
- `server/modules/indicators/IndicatorsHub.ts`：读取 OHLCV、检查数据是否存在、通过最后时间戳和 volume 识别更新。
- `server/api/kline-simple/index.ts`、`server/api/kline-simple/last-bar.get.ts`：K 线查询 API。
- `server/plugins/kline-sync.ts`：启动时初始化 SQLite、首轮同步，关闭时 flush/close。
- `server/modules/strategy-manager/index.ts`：再次调用 `initKLineDb()`，等待首轮同步后初始化指标和策略。

关键影响：`kline-simple-storage.ts` 的导出函数目前几乎都是同步返回值；`pg` 的查询全部返回 Promise。以下调用必须逐层 `await`：

- `getSimpleKLineData()`、`readSimpleKLineFile()`、`getSimpleStoredSymbols()`、`getSimpleLastKLineTimestamp()`、`getSimpleKLineCount()`。
- `getSimpleKLineAsOHLCV()`、`getKLineFileMTime()`、`hasKLineData()`。
- `appendSimpleKLineData()`、`writeSimpleKLineFile()`、`updateLastKLine()`、`deleteKLineFile()`、`cleanupAllData()`。
- `IndicatorsHub.loadKLineData()`、缓存刷新、初始化全量数据等上层方法。
- `KLineSimpleSyncService` 内所有读写 K 线的位置和两个 K 线 API handler。

`flushDb()`、`saveDb()` 和基于 `dirty/saveTimer` 的整库导出逻辑在 PostgreSQL 下删除；`closeKLineDb()` 替换为释放连接池。

### 3.3 第三优先级：分析和辅助数据

| 当前代码 | 改造目标 |
|---|---|
| `server/utils/trade-history-analyzer.ts` | 从 `trade_history` 查询输入，将结果写入 `trade_history_analyses` |
| `server/utils/jsonl-batch-writer.ts` | 新增 `AIAnalysisRepository`，按批次 insert；保留 JSONL 作为可选归档而非主存储 |
| `server/utils/square-heat.ts` | `historyStore` 可保留为缓存，历史落库改为 upsert/insert，并定期删除每资产 24 条之外的数据 |
| `server/api/bot/history.get.ts` | 删除 mtime/size 文件缓存，改为数据库 `ORDER BY close_time DESC LIMIT/OFFSET` 和 `COUNT(*)` |
| `scripts/import-trade-history.mjs` | 废弃旧用途或改为 PostgreSQL 数据修复脚本，不能再覆盖策略 JSON |

### 3.4 不迁移的数据

- `server/utils/logger.ts` 和 `logs/`：应用日志不建议占用交易主库连接和存储；生产改为 stdout + 日志采集。
- `public/scripts/*.pine`、图标等静态资源。
- 前端 Pinia 状态：仍通过服务端 API 获取，不直接连接数据库。

## 4. 目标代码结构

建议新增以下文件。新建源码文件需按项目规范添加文件用途头注释，新增 `interface`、`class` 和重要函数需写职责注释。

```text
server/
├── database/
│   ├── pool.ts                    # pg Pool 单例、连接参数、事务助手
│   ├── health.ts                  # SELECT 1/readiness 检查
│   └── repositories/
│       ├── SettingsRepository.ts
│       ├── StrategyRepository.ts
│       ├── TradeHistoryRepository.ts
│       ├── PositionRepository.ts
│       ├── KlineRepository.ts
│       ├── AnalysisRepository.ts
│       └── SquareHeatRepository.ts
├── plugins/
│   └── 00-database.ts             # 启动连库、运行兼容性检查、关闭连接池
database/
├── migrations/                    # node-pg-migrate 版本化迁移
└── seeds/                         # 仅开发环境初始数据
scripts/
├── migrate-local-data-to-pg.mjs   # JSON/JSONL/SQLite 一次性导入
├── verify-pg-migration.mjs        # 数量、主键、抽样 hash 校验
└── rollback-export-from-pg.mjs    # 必要时导出兼容 JSON（应急工具）
```

保留现有对外类名能降低改造面：例如 `StrategyStore` 可以暂时改成 `StrategyRepository` 的 facade；`storage.ts` 第一阶段可以保留函数签名，内部委托 repository。迁移完成并稳定后再清理兼容层。

## 5. PostgreSQL 表设计

### 5.1 设计约定

- 所有时间统一使用 `timestamptz`；仅 K 线保留 Binance 秒级 epoch 为 `bigint`，避免调用链一次性改变时间语义。
- 金额、价格、数量和手续费使用 `numeric(30, 12)`；K 线/指标计算当前本来使用 JavaScript `number`，K 线 OHLCV 可使用 `double precision` 兼顾吞吐。
- 可检索和约束的业务字段使用独立列；结构变化频繁的策略配置、AI 推理、指标快照使用 `jsonb`。
- 数据库列返回的 `numeric`/`bigint` 默认是字符串。repository 必须显式转换，或给 `pg` 配置受范围约束的 parser，不能让 API 返回类型悄悄变化。
- 所有写操作使用参数化 SQL，禁止拼接用户输入。

### 5.2 核心表与约束

#### `app_settings`

```sql
CREATE TABLE app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

用 `key='bot_config'` 保存整份配置。更新使用乐观锁：`WHERE key = $1 AND version = $2`，避免两个管理请求互相覆盖。AI/Binance 密钥继续来自环境变量；策略内自定义 `apiKey` 延续现有 `encrypt()/decrypt()` 处理，不写明文。

#### `strategies`、`strategy_versions`、`strategy_sessions`

```sql
CREATE SEQUENCE strategy_number_seq;

CREATE TABLE strategies (
  id text PRIMARY KEY,
  name text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  is_active boolean NOT NULL DEFAULT false,
  config jsonb NOT NULL,
  performance jsonb NOT NULL DEFAULT '{}'::jsonb,
  current_session_id text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE INDEX idx_strategies_active ON strategies (is_active) WHERE is_active;

CREATE TABLE strategy_versions (
  strategy_id text NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
  version integer NOT NULL,
  changes text NOT NULL,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (strategy_id, version)
);

CREATE TABLE strategy_sessions (
  id text PRIMARY KEY,
  strategy_id text NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
  strategy_version integer NOT NULL,
  status text NOT NULL CHECK (status IN ('running', 'stopped', 'error')),
  total_signals integer NOT NULL DEFAULT 0,
  total_trades integer NOT NULL DEFAULT 0,
  session_profit numeric(30, 12) NOT NULL DEFAULT 0,
  error_message text,
  started_at timestamptz NOT NULL,
  ended_at timestamptz
);
```

策略 ID 保持现有 `strategy_001` 格式以兼容 UI 和历史数据，但新 ID 必须由 sequence 生成，不能再扫描目录。创建策略、初始版本快照在一个事务中完成。删除建议先增加 `deleted_at` 做软删除；若保持当前硬删除语义，版本/会话可级联，交易历史不可级联删除。

#### `trade_history`

```sql
CREATE TABLE trade_history (
  id text PRIMARY KEY,
  strategy_id text,
  symbol text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('LONG', 'SHORT', 'IDLE')),
  entry_price numeric(30, 12) NOT NULL,
  exit_price numeric(30, 12) NOT NULL,
  quantity numeric(30, 12) NOT NULL,
  leverage numeric(12, 4) NOT NULL,
  pnl numeric(30, 12) NOT NULL,
  pnl_percentage numeric(20, 8) NOT NULL,
  total_commission numeric(30, 12),
  opened_at timestamptz NOT NULL,
  closed_at timestamptz NOT NULL,
  reason text NOT NULL,
  close_category text,
  entry_confidence numeric(10, 6),
  entry_score numeric(10, 6),
  entry_risk_level text,
  stop_loss_price numeric(30, 12),
  take_profit1_price numeric(30, 12),
  take_profit2_price numeric(30, 12),
  entry_indicators jsonb,
  ai_reasoning text,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_trade_history_closed ON trade_history (closed_at DESC);
CREATE INDEX idx_trade_history_strategy_closed ON trade_history (strategy_id, closed_at DESC);
CREATE INDEX idx_trade_history_symbol_closed ON trade_history (symbol, closed_at DESC);
```

`id` 插入使用 `ON CONFLICT (id) DO NOTHING`，让迁移重跑和平仓重试具备幂等性。后续最好将 Binance 成交/订单 ID 增加为唯一业务键，当前基于 `Date.now()` 的 ID 只能作为兼容键。

#### `active_positions`、`symbol_locks`、`bot_state`

```sql
CREATE TABLE active_positions (
  account_id text NOT NULL DEFAULT 'default',
  symbol text NOT NULL,
  strategy_id text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('long', 'short', 'idle')),
  status text NOT NULL DEFAULT 'OPEN',
  entry_price numeric(30, 12) NOT NULL,
  quantity numeric(30, 12) NOT NULL,
  leverage numeric(12, 4) NOT NULL,
  opened_at timestamptz NOT NULL,
  exchange_order_id text,
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, symbol)
);

CREATE TABLE symbol_locks (
  account_id text NOT NULL DEFAULT 'default',
  symbol text NOT NULL,
  strategy_id text NOT NULL,
  state text NOT NULL DEFAULT 'HELD',
  locked_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  PRIMARY KEY (account_id, symbol)
);

CREATE TABLE bot_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  state jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

抢锁使用一次 SQL：

```sql
INSERT INTO symbol_locks (account_id, symbol, strategy_id, state, expires_at)
VALUES ($1, $2, $3, 'HELD', now() + interval '2 minutes')
ON CONFLICT (account_id, symbol) DO NOTHING
RETURNING strategy_id;
```

只有返回一行才表示抢锁成功。不能保留“先查询 `canOpenPosition()` 再写锁”的 check-then-act 方式。`PositionManager` 的内存 Map 可继续作为读缓存，但 PostgreSQL 是事实来源；每次关键写成功后再更新内存。

#### `klines`

```sql
CREATE TABLE klines (
  symbol text NOT NULL,
  timeframe text NOT NULL,
  open_time bigint NOT NULL,
  open double precision NOT NULL,
  high double precision NOT NULL,
  low double precision NOT NULL,
  close double precision NOT NULL,
  volume double precision NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (symbol, timeframe, open_time)
);

CREATE INDEX idx_klines_latest
  ON klines (symbol, timeframe, open_time DESC);
```

批量写入不要逐条 `await INSERT`。使用单条多 values/`unnest` 的 `INSERT ... ON CONFLICT ... DO UPDATE`，每批建议 500～2000 条。保留每组最近 2233 根时，使用基于边界时间的删除，避免 SQLite 代码中的大范围 `NOT IN`：先查询第 2233 根的 `open_time`，再删除更旧记录。

当前规模不需要立即分区。只有 K 线增长到千万级且不再限制 2233 根时，再按时间范围分区或评估 TimescaleDB；第一阶段不要增加额外运维复杂度。

#### 分析表

- `trade_history_analyses(id bigserial, analyzed_at timestamptz, summary jsonb, source_max_closed_at timestamptz, UNIQUE(analyzed_at))`。
- `ai_analyses(id bigserial, analyzed_at timestamptz, strategy_id text, symbol text, direction text, confidence numeric, risk_level text, payload jsonb)`，索引 `(strategy_id, analyzed_at DESC)` 和 `(symbol, analyzed_at DESC)`。
- `square_heat_history(symbol text, observed_at timestamptz, post_count integer, payload jsonb, PRIMARY KEY(symbol, observed_at))`。

AI 明细如果只用于审计归档而不查询，也可继续 JSONL + 对象存储；不应为了“全部入库”让主库承担无查询价值的大 JSON。建议先迁最近 30～90 天，历史文件冷归档。

## 6. 具体代码修改步骤

### Step 1：加入依赖和配置

修改 `package.json`：

```text
dependencies: pg
devDependencies: @types/pg, node-pg-migrate
scripts:
  db:migrate
  db:migrate:down
  db:status
  db:import-local
  db:verify
```

修改 `.env.example` 和 `nuxt.config.ts`，服务端增加：

```dotenv
DATABASE_URL=postgresql://ai_bian:change_me@127.0.0.1:5432/ai_bian
DATABASE_SSL=false
DATABASE_POOL_MAX=10
DATABASE_CONNECTION_TIMEOUT_MS=5000
DATABASE_STATEMENT_TIMEOUT_MS=30000
DATABASE_APPLICATION_NAME=ai-bian
STORAGE_DRIVER=postgres
```

生产密码通过部署平台 secret 注入，不提交 `.env`。生产环境 `DATABASE_SSL` 应按云数据库要求设置，并校验证书；不要简单使用 `rejectUnauthorized: false`。

### Step 2：建立连接池、事务和健康检查

`server/database/pool.ts` 提供：

- `getPool()`：进程内唯一 `pg.Pool`，避免热更新/模块重复加载创建多个池。
- `withTransaction(callback)`：自动 `BEGIN/COMMIT/ROLLBACK`，确保 client 在 `finally` 中 release。
- `closePool()`：Nitro `close` hook 调用。
- 慢查询和 pool error 日志；日志中不得打印 `DATABASE_URL`。

新增 `server/plugins/00-database.ts`，启动时执行 `SELECT 1` 和 schema version 检查。生产环境连接失败必须让进程启动失败，由服务管理器重启；不能像当前 K 线插件一样只 catch 后继续运行一个无持久化能力的交易服务。

增加 `/api/health/live`（只表示进程存活）和 `/api/health/ready`（数据库可用、迁移版本匹配、核心初始化完成）。部署流量只发送到 ready 实例。

### Step 3：先迁移配置和策略 repository

1. 将 `storage.ts` 的 Bot 配置/状态方法改为 `SettingsRepository`。
2. `server/plugins/kline-sync.ts#getSyncConfig()` 不再直接读 `data/bot-config.json`，统一调用 `getBotConfig()`。
3. `StrategyStore` 的 public API 暂时不变，内部改为 `StrategyRepository`。
4. `createStrategy()` 使用 sequence 生成 ID，并在事务中写策略和版本 1。
5. `updateStrategy()` 使用 `SELECT ... FOR UPDATE` 或 `UPDATE ... WHERE version=$expectedVersion`，同时插入版本快照。
6. `getActiveStrategies()` 直接查询 `WHERE is_active=true`，不再扫描全部文件。
7. `trade-recorder.ts#updateStrategyPerformance()` 删除直接 `writeFile()`，performance 若保留物化值，只能通过 repository 更新。更推荐查询时从 `trade_history` 聚合，或由事务后异步刷新物化统计。

### Step 4：迁移仓位与锁

这是风险最高的改造，需单独评审和测试：

1. 将 `lockSymbol()`、`unlockSymbol()`、`recordPosition()`、`clearPosition()`、`updatePosition()` 改为异步。
2. 修改所有上层调用，确保关键链路 `await`，禁止继续使用 `this._persistState().catch()` 静默丢弃错误。
3. `reserveSymbol()` 通过唯一主键原子抢锁，返回明确结果；持锁策略重复请求应幂等成功，其他策略返回冲突。
4. 交易所开单成功后，在事务中 upsert `active_positions` 并把锁状态改为 `OPEN`；开单失败释放预占锁。
5. 平仓记录使用交易所订单/成交 ID 做幂等。先确认交易所结果，再在一个本地事务中删除仓位、释放锁、插入交易历史。
6. 启动时读取数据库状态并向 Binance 查询真实仓位，对差异进行修复和告警；不能无条件用任意一侧覆盖另一侧。

为防止同一套 API key 的两个应用实例同时交易，第一版部署 `replicas=1`，并在数据库连接后申请 session advisory lock：

```sql
SELECT pg_try_advisory_lock(hashtext('ai-bian:trading-engine'));
```

未取得锁的实例只能提供只读/不就绪状态，不能启动调度器。注意 advisory lock 必须占用专用 client，不能从 pool 借出后 release。

### Step 5：迁移交易历史、分页和分析

1. `addTradeHistory()` 改为幂等 insert，错误必须抛给调用方，不能只打印后吞掉。
2. `getTradeHistory(limit)` 改为有界查询；必须给无 limit 调用设置合理上限，避免未来全表加载。
3. `server/api/bot/history.get.ts` 使用数据库分页，并限制 `pageSize`（建议 1～100）。数据量大后可改 keyset pagination：`closed_at < cursor`。
4. `StrategyStore#getTradeRecords()` 直接按 `strategy_id` 查询，不再先加载全部历史再过滤。
5. performance 统计用 SQL 聚合基础指标；最大回撤/连续盈亏可以先保留 TypeScript 计算，但输入只查询目标策略并按时间排序。
6. `trade-history-analyzer.ts` 使用 repository 读交易和写分析结果，`checkDailyAnalysis()` 用数据库唯一键或 advisory lock 防止多次每日分析。

### Step 6：迁移 K 线并异步化调用链

建议先保持 `server/utils/kline-simple-storage.ts` 导出名称，内部改为调用 `KlineRepository`，以减少 import 改动；所有返回值改为 Promise。

重点修改：

- SQL 占位符由 `?` 改为 `$1...$n`。
- `INSERT OR REPLACE` 改为 `INSERT ... ON CONFLICT (...) DO UPDATE SET ...`。
- 手写 `BEGIN/COMMIT` 改为 `withTransaction()`。
- 删除 WASM 定位、`db.export()`、临时文件 rename、dirty timer 和 flush。
- 所有调用点补 `await`，并保证定时循环不会在上一次查询未结束时重入。
- `getKLineFileMTime()` 重命名为更符合语义的 `getKLineRevision()`；仍可返回 `max(open_time)_latest_volume` 以兼容缓存判断。
- `IndicatorsHub` 应继续缓存 OHLCV，避免每次指标计算都访问 PostgreSQL。

K 线同步批次应在一个事务中 upsert，成功后再发出 `klineUpdated` 事件，防止指标中心读到半批数据。

### Step 7：迁移辅助数据并清理文件依赖

1. 将广场热度写入改成异步 repository，调用方已经是 async，改造面较小。
2. 将 AI JSONL writer 替换为数据库 batch writer；实现批次失败重试和最大缓冲，进程关闭时 flush。
3. 历史 JSONL 是否全量导入由保留策略决定；推荐热数据入库、旧文件归档。
4. `rg` 检查业务目录中不再存在对 `data/*.json`、`kline.db` 的直接读写。
5. 稳定运行一个发布周期后删除 `sql.js`、`@types/sql.js` 和 `KLINE_DATA_DIR`。

## 7. 本地数据迁移脚本设计

`scripts/migrate-local-data-to-pg.mjs` 必须可重跑、可审计，建议参数：

```text
--source-dir ./data
--database-url-env DATABASE_URL
--include ai-analyses
--dry-run
--batch-size 1000
```

执行顺序：

1. 校验目标 schema 版本和数据库是否为空/是否允许 upsert。
2. 导入 `bot-config.json`、`bot-state.json`。
3. 导入策略基础数据，再拆分 `versionHistory` 和 `sessions`。
4. 导入 `trade-history.json`，按 ID 幂等。
5. 导入活跃仓位和锁；此步骤只能在交易进程停止后做最终导入。
6. 用 `sql.js` 只读打开 `kline.db`，按主键顺序分页读取并批量 upsert 到 `klines`。
7. 导入复盘、热度和可选 AI JSON/JSONL；坏行记录到独立错误报告，不默默跳过。
8. 更新 `strategy_number_seq` 到现有最大策略编号之后。
9. 输出每类数据的读取数、插入数、冲突数、失败数和耗时，不输出密钥/完整 AI 内容。

时间转换规则必须固定：

- `TradeHistory.openTime/closeTime` 是毫秒 epoch，使用 `new Date(value)` 转 `timestamptz`。
- `kline_data.timestamp` 是秒 epoch，原值写入 `open_time bigint`。
- 策略 `createdAt/updatedAt` 是 ISO 字符串。
- JSON 内的 `Infinity`、`NaN`、`undefined` 入库前需规范化，否则 `jsonb` 不接受非标准 JSON。

迁移脚本不得在应用运行时读取正在变化的文件作为最终数据。预迁移可以在线执行，最终迁移必须在停止交易进程、完成交易所状态确认后执行。

## 8. 验证与测试方案

### 8.1 repository 测试

使用独立测试数据库，每个测试事务回滚或清库：

- 策略 CRUD、版本递增、回滚、并发创建 ID。
- 同一 `(account_id, symbol)` 两个策略并发抢锁，必须只有一个成功。
- 重复记录同一交易 ID，只产生一条历史。
- 仓位写入与锁状态在异常时一起回滚。
- K 线重复 upsert、最后一根更新、时间范围/limit、2233 根保留策略。
- Bot 配置乐观锁冲突。
- 数值和时间在数据库往返后类型/精度不变。

### 8.2 迁移校验

`scripts/verify-pg-migration.mjs` 至少验证：

- 每张表记录数与源文件/SQLite 一致。
- 策略 ID 集合、版本数和激活状态一致。
- 交易历史按 `id` 做集合比对，并抽样比较关键金额字段。
- K 线按 `(symbol,timeframe)` 比较 count、min/max timestamp，并对首尾各 10 条做规范化 hash。
- 活跃仓位和锁逐项一致；最终还要与 Binance 实际仓位对账。
- API 契约对比：策略列表、Bot 配置、交易历史分页、K 线查询返回结构不变。

### 8.3 构建和回归

至少执行：

```bash
pnpm db:migrate
pnpm db:import-local -- --dry-run
pnpm db:verify
pnpm exec nuxi typecheck
pnpm build
```

交易相关回归必须在 Binance Testnet 或完全 mock 的交易所接口上执行，覆盖重启恢复、重复回调、数据库短暂断连、开单成功但本地提交失败、平仓成功但历史插入重试等故障场景。

## 9. 生产上线链路

仓库当前没有 Docker/Compose、PM2、`systemd` 或 CI 部署描述，现有生产命令仅为 `pnpm build` 后运行 `.output/server/index.mjs`。因此 PostgreSQL 上线需要补齐以下链路。

### 9.1 上线前准备

1. 创建 PostgreSQL 16 实例、数据库和最小权限应用用户；迁移用户可单独持有 DDL 权限。
2. 配置自动备份、PITR（时间点恢复）、磁盘/连接数/慢查询监控。
3. 注入 `DATABASE_URL` 等 secret，验证应用服务器到数据库的 TLS 和网络连通性。
4. 在生产数据副本上至少完成一次全量 dry run，记录迁移耗时和最终维护窗口预算。
5. 先部署包含 repository 和 PostgreSQL 支持、但仍可通过 `STORAGE_DRIVER=local` 运行的兼容版本，完成业务回归。
6. 数据库迁移脚本应由一次性 release job 执行，不能由每个应用副本启动时自动并发执行。

### 9.2 正式切换步骤

```text
宣布维护 -> 禁止新开仓 -> 等待/人工处理活跃仓位
-> 停止旧应用进程和所有定时同步脚本
-> 备份 data/、kline.db 和 PostgreSQL
-> 执行 schema migration
-> 执行最终本地数据导入
-> 执行自动校验 + Binance 仓位对账
-> 以 STORAGE_DRIVER=postgres 启动单实例
-> readiness 通过但暂不恢复自动交易
-> 验证只读 API、策略、K 线和配置
-> 小范围恢复同步和一个策略
-> 观察后恢复全部策略
```

启动顺序应调整为：

```text
连接 PostgreSQL
-> 检查 schema version
-> 获取 trading-engine advisory lock
-> 加载 Bot 配置/仓位/策略
-> K 线缺口同步
-> 指标预计算
-> readiness=true
-> 启动 K 线定时器、策略扫描和持仓监控
```

关闭顺序：先将 readiness 置为 false，停止新扫描和定时任务，等待正在执行的交易任务结束，flush AI batch，释放 advisory lock，最后关闭 pool。Kubernetes/进程管理器应提供足够的 termination grace period。

### 9.3 灰度策略

本项目会真实交易，不适合让 local 和 PostgreSQL 两个实例同时运行策略进行传统流量灰度。建议：

- 只读 API 可先做 shadow read，对同一请求比较本地和 PostgreSQL 结果。
- 写链路在测试环境和 Testnet 验证。
- 正式环境始终只有一个交易引擎持有 advisory lock。
- 恢复交易时先启用一个低风险策略/少量 symbols，确认一个完整扫描周期后逐步放开。

## 10. 回滚方案

### 10.1 允许回滚的窗口

切换后若尚未恢复自动交易，直接停止新应用、切回 `STORAGE_DRIVER=local` 并启动旧版本即可。原始 `data/` 必须只读保留，不得被迁移脚本改写。

### 10.2 已产生新写入后的回滚

一旦 PostgreSQL 中产生新的仓位/成交写入，不能直接启用旧 JSON 数据，否则会回到过期状态。必须：

1. 先停止自动交易并查询 Binance 实际仓位。
2. 使用 `rollback-export-from-pg.mjs` 导出兼容的配置、策略、交易历史和状态文件。
3. 校验导出数据并再次与 Binance 对账。
4. 再启动旧版本，并监控是否重复记录成交或重复开仓。

因此最佳回滚方式是修复 PostgreSQL 版本并前滚；文件回滚只是应急预案。数据库 schema 的 destructive down migration 不应在事故现场执行，优先恢复应用版本并保留向后兼容的 schema。

## 11. 运维基线

- 应用池大小先设 10。总连接数约为 `应用副本数 × pool max + migration/admin`，必须小于数据库连接上限并留余量。
- 设置 `connectionTimeoutMillis`、`statement_timeout`、idle client error handler；交易事务保持短小，事务期间不能调用 Binance/AI API。
- 监控 pool waiting、连接错误、事务回滚、锁冲突、查询 P95/P99、数据库空间、复制/备份状态。
- 每日验证备份，定期做恢复演练。仅有“备份成功”记录不等于可恢复。
- PostgreSQL 和应用统一使用 UTC 存储，界面展示时再转 `Asia/Shanghai`。
- migration、应用用户和只读运维用户分权；应用用户不授予建库、建角色等权限。
- 日志必须脱敏 `DATABASE_URL`、策略 API key、Binance/AI secret 和完整请求 payload。

## 12. 分阶段实施清单与工期建议

| 阶段 | 内容 | 主要产物 | 建议验收点 |
|---|---|---|---|
| P0 | 建库、连接层、migration、健康检查 | `pool.ts`、首批 migrations | 断连时 fail-fast，迁移可重复部署 |
| P1 | 配置、策略、版本 | Settings/Strategy repository | API 契约不变，版本事务正确 |
| P2 | 交易历史、仓位、锁 | Position/Trade repository | 并发抢锁和幂等交易测试通过 |
| P3 | K 线和异步调用链 | Kline repository、Hub/Sync 改造 | 初始/增量同步及指标结果一致 |
| P4 | 分析/热度/AI 明细 | Analysis repositories | 定时任务幂等、批量写稳定 |
| P5 | 导入、校验、演练 | import/verify/rollback scripts | 生产副本全量演练通过 |
| P6 | 维护窗口切换 | 发布记录和对账报告 | 单实例稳定运行后逐步恢复策略 |

预计工作量不应按“换一个数据库驱动”估算。核心风险集中在 P2 的交易并发语义和 P3 的全链路异步化；建议分别做独立 PR 和故障注入测试。

## 13. 完成定义（Definition of Done）

- [ ] 业务运行不再依赖 `data/*.json` 和 `data/kline.db` 写入。
- [ ] 所有数据库变更均有版本化 migration，应用启动会检查 schema 兼容性。
- [ ] 仓位与 symbol 锁由数据库唯一约束和事务保证，不依赖进程内文件锁。
- [ ] 交易历史写入具备稳定幂等键，错误不被静默吞掉。
- [ ] K 线读写调用链已正确异步化，批量 upsert 无逐条网络往返。
- [ ] 本地数据全量导入和校验脚本可重跑，并输出审计报告。
- [ ] PostgreSQL 数据与源 JSON/SQLite 数量、主键和抽样内容一致。
- [ ] 与 Binance 实际仓位完成上线前后两次对账。
- [ ] `typecheck`、`build`、repository 测试和 Testnet 交易回归通过。
- [ ] 生产只有一个持有 advisory lock 的交易引擎，readiness/优雅关闭可用。
- [ ] 已验证备份恢复和切换后新写入场景的回滚步骤。
- [ ] 稳定运行一个发布周期后，才删除 local driver、`sql.js` 和旧数据文件依赖。

