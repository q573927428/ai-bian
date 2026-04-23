// ==================== 多策略 AI 分析器 ====================

import type { StrategyId, AIPromptConfig, AIProvider } from '../../../types/strategy'
import type { AIAnalysis, RiskLevel, TechnicalIndicators, BotConfig, Direction } from '../../../types'
import type { TradeSignal } from '../../../types/signal'
import { BinanceService } from '../../utils/binance'
import { logger } from '../../utils/logger'
import fs from 'node:fs/promises'
import path from 'node:path'

/**
 * AI 提供商配置
 */
interface AIProviderConfig {
  apiKey: string;
  apiUrl: string;
  model: string;
}

/**
 * 获取 AI 提供商配置
 */
function getProviderConfig(provider: AIProvider, runtimeConfig: any): AIProviderConfig {
  switch (provider) {
    case 'deepseek':
      return {
        apiKey: runtimeConfig.deepseekApiKey,
        apiUrl: runtimeConfig.deepseekApiUrl,
        model: runtimeConfig.deepseekModel
      };
    case 'doubao':
      return {
        apiKey: runtimeConfig.doubaoApiKey,
        apiUrl: runtimeConfig.doubaoApiUrl,
        model: runtimeConfig.doubaoModel
      };
    case 'qwen':
      return {
        apiKey: runtimeConfig.qwenApiKey,
        apiUrl: runtimeConfig.qwenApiUrl,
        model: runtimeConfig.qwenModel
      };
    case 'openai':
      return {
        apiKey: runtimeConfig.openaiApiKey,
        apiUrl: runtimeConfig.openaiApiUrl,
        model: runtimeConfig.openaiModel
      };
    default:
      throw new Error(`不支持的 AI 提供商: ${provider}`);
  }
}

/**
 * AI 分析缓存
 */
interface MultiStrategyAICache {
  signal: TradeSignal;
  timestamp: number;
}

const aiCache = new Map<string, MultiStrategyAICache>()

/**
 * 多策略 AI 分析器
 * 
 * 职责：
 * 1. 支持每个策略自定义的 AI 提示词
 * 2. 统一的 AI 调用接口
 * 3. 智能缓存（相同市场数据不重复调用）
 * 4. 降级处理（API 失败时返回安全默认值）
 */
export class MultiStrategyAIAnalyzer {
  private binance: BinanceService
  private config: BotConfig

  constructor(binance: BinanceService, config: BotConfig) {
    this.binance = binance
    this.config = config
    // logger.info('MultiStrategyAIAnalyzer', '多策略 AI 分析器已初始化')
  }

  /**
   * 更新配置
   */
  updateConfig(config: BotConfig): void {
    this.config = config
  }

  /**
   * 获取AI缓存TTL（毫秒），最小值为10分钟
   */
  private getAiCacheTtl(): number {
    const configuredMinutes = this.config.aiCacheTtlMinutes ?? 10
    const ttl = Math.max(configuredMinutes, 10) * 60 * 1000
    return ttl
  }

  /**
   * 分析市场（支持多策略）
   */
  async analyze(
    strategyId: string,
    symbol: string,
    promptConfig: AIPromptConfig,
    indicators: any,
    price: number,
    volume: number,
    candleProgress: number = 0.1
  ): Promise<TradeSignal | null> {
    try {
      // 1. 检查缓存
      const cacheKey = this.buildCacheKey(strategyId, symbol, indicators, price)
      const cached = aiCache.get(cacheKey)
      if (cached && (Date.now() - cached.timestamp < this.getAiCacheTtl())) {
        return cached.signal
      }

      // 2. 构建完整提示词
      const fullPrompt = this.buildFullPrompt(
        promptConfig,
        symbol,
        price,
        indicators,
        volume,
        candleProgress
      )

      // 3. 调用原有的 AI 分析函数
      const aiResult = await this.callAI(fullPrompt, symbol, price, indicators, volume, strategyId, promptConfig)


      // 即使是 IDLE 也返回完整信息，以便统一记录日志
      if (!aiResult) {
         return null
       }

      // 临时测试：针对不同策略和交易对强制返回信号
      // if (!aiResult) {
      //   return null
      // }
      // if (strategyId === 'strategy_001' && symbol === 'ETH/USDT') { 
      //   aiResult.direction = 'LONG'
      //   aiResult.confidence = 80 // 确保置信度足够
      // } else if (strategyId === 'strategy_002' && symbol === 'SOL/USDT') {
      //   aiResult.direction = 'LONG'
      //   aiResult.confidence = 80 // 确保置信度足够
      // } else {
      //   if (aiResult.direction === 'IDLE') {
      //     return null
      //   }
      // }

      // 4. 转换为标准交易信号（支持 IDLE 状态）
      const signal: TradeSignal = {
        strategyId,
        symbol,
        direction: aiResult.direction === 'LONG' ? 'long' : aiResult.direction === 'SHORT' ? 'short' : 'idle',
        action: aiResult.direction === 'IDLE' ? 'hold' : 'open',
        price,
        stopLoss: 0, // 后续计算
        confidence: aiResult.confidence,
        reasoning: aiResult.reasoning,
        indicators: {
          ema: {
            fast: indicators.emaList[0]?.value ?? 0,
            slow: indicators.emaList[indicators.emaList.length - 1]?.value ?? 0
          },
          rsi: aiResult.technicalData.rsi ?? 0,
          atr: indicators.atr
        },
        timestamp: new Date().toISOString()
      }

      // 5. 缓存结果
      aiCache.set(cacheKey, { signal, timestamp: Date.now() })

      return signal
    } catch (error: any) {
      logger.error('MultiStrategyAIAnalyzer', `AI 分析失败: ${error.message}`)
      return null
    }
  }

  /**
   * 构建完整提示词
   */
  private buildFullPrompt(
    promptConfig: AIPromptConfig,
    symbol: string,
    price: number,
    indicators: TechnicalIndicators,
    volume: number,
    candleProgress: number = 0.1
  ): string {
    // 构建技术指标部分的提示词（根据指标启用状态）
    const technicalIndicatorLines: string[] = []
    
    // 只在启用EMA时显示
    if (indicators.enabledIndicators?.ema && indicators.emaList.length > 0) {
      const dynamicEmaLines = indicators.emaList
        .map(item => `- ${item.name}: ${(item.value ?? 0).toFixed(4)}`)
        .join('\n')
      technicalIndicatorLines.push(dynamicEmaLines)
    }

    // 只在启用RSI时显示
    if (indicators.enabledIndicators?.rsi && indicators.rsi !== undefined) {
      technicalIndicatorLines.push(`- RSI(14): ${indicators.rsi.toFixed(2)}`)
    }

    // 只在启用MACD时显示
    if (indicators.enabledIndicators?.macd && indicators.macd) {
      technicalIndicatorLines.push(`- MACD(12,26,9): MACD=${indicators.macd.macd.toFixed(4)}, Signal=${indicators.macd.signal.toFixed(4)}, Histogram=${indicators.macd.histogram.toFixed(4)}`)
    }

    // 只在启用ATR时显示
    if (indicators.enabledIndicators?.atr && indicators.atr !== undefined) {
      technicalIndicatorLines.push(`- ATR(14): ${indicators.atr.toFixed(4)}`)
    }

    // 构建ADX显示行
    const adxLines: string[] = []
    if (indicators.enabledIndicators?.adx) {
      if (indicators.adx !== undefined) {
        adxLines.push(`- ADX(${indicators.adxPeriodLabel}): ${indicators.adx.toFixed(2)}`)
      }
      
      // ADX斜率
      if (indicators.adxSlope !== undefined) {
        adxLines.push(`- ADX斜率: ${indicators.adxSlope.toFixed(4)}`)
      }
    }

    // 只在启用OI时显示
    const oiLines: string[] = []
    if (indicators.enabledIndicators?.oi) {
      if (indicators.openInterest !== undefined) {
        oiLines.push(`- OI: ${indicators.openInterest.toFixed(2)}`)
      }
      if (indicators.openInterestChangePercent !== undefined) {
        oiLines.push(`- OI 变化: ${indicators.openInterestChangePercent.toFixed(2)}%`)
      }
      if (indicators.openInterestTrend) {
        oiLines.push(`- OI 趋势: ${indicators.openInterestTrend}`)
      }
    }

    // 构建启用的指标列表说明
    const enabledIndicatorsList = []
    if (indicators.enabledIndicators?.ema) enabledIndicatorsList.push('EMA')
    if (indicators.enabledIndicators?.rsi) enabledIndicatorsList.push('RSI')
    if (indicators.enabledIndicators?.macd) enabledIndicatorsList.push('MACD')
    if (indicators.enabledIndicators?.adx) enabledIndicatorsList.push('ADX')
    if (indicators.enabledIndicators?.atr) enabledIndicatorsList.push('ATR')
    if (indicators.enabledIndicators?.oi) enabledIndicatorsList.push('持仓量(OI)')
    if (indicators.enabledIndicators?.volume) enabledIndicatorsList.push('成交量')


    return `
## 一、当前市场真实数据（仅使用以下数据）
交易对：${symbol}
当前价格：${(price ?? 0).toFixed(5)} USDT
当前时间：${new Date().toISOString()}
K线完成进度：${(candleProgress * 100).toFixed(1)}%
${indicators.enabledIndicators?.volume ? `当前成交量：${(volume ?? 0).toFixed(2)}` : ''}
预计K线结束成交量：${(volume / candleProgress).toFixed(2)}（you must use this）

## 二、K线形态数据
${indicators.lastCandle ? `- 最新K线
  开盘：${indicators.lastCandle.open.toFixed(5)}
  最高：${indicators.lastCandle.high.toFixed(5)}
  最低：${indicators.lastCandle.low.toFixed(5)}
  收盘：${indicators.lastCandle.close.toFixed(5)}
  成交量：${indicators.lastCandle.volume.toFixed(2)}
  阴阳：${indicators.lastCandle.close > indicators.lastCandle.open ? '阳线' : '阴线'}` : ''}
${indicators.prevCandle ? `- 前一根K线
  开盘：${indicators.prevCandle.open.toFixed(5)}
  最高：${indicators.prevCandle.high.toFixed(5)}
  最低：${indicators.prevCandle.low.toFixed(5)}
  收盘：${indicators.prevCandle.close.toFixed(5)}
  成交量：${indicators.prevCandle.volume.toFixed(2)}
  阴阳：${indicators.prevCandle.close > indicators.prevCandle.open ? '阳线' : '阴线'}` : ''}

## 三、技术指标（仅启用的指标有效）
${technicalIndicatorLines.join('\n')}
${adxLines.length > 0 ? adxLines.join('\n') : ''}
${oiLines.length > 0 ? oiLines.join('\n') : ''}
${enabledIndicatorsList.length > 0 ? `本次分析仅使用：${enabledIndicatorsList.join(', ')}
未启用指标全部忽略` : ''}

--------------------------
## 四、用户策略（唯一有效）
----------------------------------------
${promptConfig.userPrompt}
----------------------------------------

--------------------------
## 五、动态评分模型（核心）
仅基于已启用指标进行分析与评分：
已启用指标：${enabledIndicatorsList.join(', ')}
⚠️ 未启用指标禁止参与任何分析

---

### 1️⃣ direction 判定
- 优先使用用户策略中的 direction
- 若未定义：
  - 短周期EMA > 长周期EMA → LONG
  - 短周期EMA < 长周期EMA → SHORT
⚠️ direction 表示"方向倾向"，不是是否触发

---

### 2️⃣ 原始评分（rawScore）
对每个启用指标逐项判断：
- 满足条件 → 得分
- 不满足 → 不得分
- 权重默认平均
rawScore ∈ [0,100]

---

### 3️⃣ 硬条件处理
定义：hardMatchRatio = 已满足硬条件数量 / 硬条件总数
最终置信度：confidence = rawScore × hardMatchRatio

---

### ❗强制限制（防止虚高）
- 若存在任意硬条件未满足：
  → confidence 必须显著下降  
  → 严禁接近高分区（≥${this.config.minConfidence ?? 60}）
- 最终上限限制：
  IF hardMatchRatio < 1：confidence ≤ ${this.config.minConfidence ?? 60}
  IF 计算结果超过上限：→ 强制截断为上限

---

### ❗禁止行为：
- ❌ 禁止直接输出 confidence = 0
- ❌ 禁止因为“多个条件不满足”就归零
- ❌ 禁止跳过评分过程直接给0

---

### ✅ 正确示例：
- 少量条件满足 → confidence 10~30
- 部分满足 → confidence 30~60
- 高匹配 → confidence 60+

---

### 4️⃣ 指标评分逻辑（仅启用时）
【EMA】- 顺向排列（多头或空头）→ 高分；- 混乱 → 低分
【RSI】- 在策略合理区间 → 高分；- 超买/超卖或不符合 → 低分
【成交量】（必须使用预测成交量）- 放大 → 高分；- 缩量 → 低分
【OI】- 与方向一致 → 高分；- 不一致 → 低分
【ADX】- 趋势强 → 高分；- 震荡 → 低分
【MACD】- 同方向 → 高分；- 背离/混乱 → 低分
【K线】- 动量明显 → 高分；- 无明显结构 → 低分

---

### 5️⃣ 一致性约束
- 多数指标偏多 → 禁止 SHORT
- 多数指标偏空 → 禁止 LONG

---

--------------------------
## 六、输出格式
最终输出json的时候，confidence 必须是与“计算结果”一致，严禁主观给值或直接输出固定数值。
{
  "direction": "LONG" | "SHORT" | "IDLE",
  "confidence": 0~100,
  "reasoning": "必须包含具体数值，示例：EMA50(4710) > EMA120(4700)，RSI(62.3)处于区间内，预计成交量（652.12 对比前k 未放大），OI(+0.12%)"
}

--------------------------
## 七、强制规则
- 禁止使用未启用指标
- 禁止主观判断
- 禁止模糊描述
- 必须引用具体数据`;
  }

  /**
   * 构建系统提示词（包含历史学习经验）
   */
  private async buildSystemPrompt(): Promise<string> {
    return `
你是一个量化交易"策略执行引擎"。

--------------------------
【核心原则】
1. 只执行用户策略
2. 只使用提供的数据
3. 仅使用已启用指标
4. 输出必须为JSON
6. reasoning 必须是“结果描述”，不是“推理过程”

--------------------------
【执行逻辑】
1. direction：
   - 优先使用策略定义
   - 未定义 → EMA判断
   - 仅表示方向倾向

---

2. 评分机制：
   confidence = rawScore × hardMatchRatio
   说明：
   - rawScore：指标匹配程度（0~100）
   - hardMatchRatio：硬条件满足比例（0~1）

---

3. 硬条件规则（关键）
   - 若存在未满足硬条件：
     → 必须降低confidence  
     → 严禁 ≥ ${this.config.minConfidence ?? 60} 
   - 同时：
     confidence ≤ ${this.config.minConfidence ?? 60}

---

4. 指标限制：
   - 仅允许使用启用指标
   - 未启用指标：❌ 禁止使用；❌ 禁止推理；❌ 禁止出现在结果中

---

5. 一致性约束：
   - 多数指标偏多 → 禁止 SHORT
   - 多数指标偏空 → 禁止 LONG

---

6. IDLE规则：
   - 仅在策略要求或无方向时使用
   - 不得因低匹配强制IDLE

--------------------------
【输出格式】
{
  "direction": "LONG" | "SHORT" | "IDLE",
  "confidence": 0~100,
  "reasoning": "必须引用具体数值（EMA/RSI/价格/OI等），说明各指标满足情况，禁止使用英文描述，必须要清晰流畅，禁止输出任何计算过程或规则推导"
}

--------------------------
【禁止行为】
- 禁止忽略策略
- 禁止使用未提供数据
- 禁止输出模糊结论`;
  }

  /**
   * 获取AI分析保存配置（带默认值）
   */
  private getAiAnalysisSaveConfig() {
    const config = this.config.aiAnalysisConfig
    return {
      enabled: config?.enabled ?? true,
      maxRecords: config?.maxRecords ?? 1000,
      saveIdle: config?.saveIdle ?? false
    }
  }

  /**
   * 保存AI分析结果到每日JSON文件
   */
  private async saveAIAnalysisToFile(analysis: AIAnalysis): Promise<void> {
    try {
      const saveConfig = this.getAiAnalysisSaveConfig()
      
      // 检查是否启用保存
      if (!saveConfig.enabled) {
        return
      }
      
      // 检查是否需要保存IDLE状态
      if (analysis.direction === 'IDLE' && !saveConfig.saveIdle) {
        return
      }
      
      // 确保目录存在
      const saveDir = path.join(process.cwd(), 'data', 'ai-analysis')
      await fs.mkdir(saveDir, { recursive: true })
      
       // 生成当天文件名（使用本地时区）
       const date = new Date()
       const year = date.getFullYear()
       const month = String(date.getMonth() + 1).padStart(2, '0')
       const day = String(date.getDate()).padStart(2, '0')
       const dateStr = `${year}-${month}-${day}`
      const fileName = `ai-analysis-${dateStr}.json`
      const filePath = path.join(saveDir, fileName)
      
       // 读取现有内容或创建新数组
       let records: AIAnalysis[] = []
       try {
         const fileContent = await fs.readFile(filePath, 'utf-8')
         // 处理空文件或无效JSON
         if (fileContent.trim()) {
           records = JSON.parse(fileContent)
           // 确保解析结果是数组
           if (!Array.isArray(records)) {
             records = []
           }
         }
       } catch (error: any) {
         // 文件不存在、内容为空或解析失败，使用空数组
         if (error.code !== 'ENOENT') {
           logger.error('MultiStrategyAIAnalyzer', '读取AI分析历史文件失败:', error.message)
         }
         records = []
       }
       
      // 添加新记录
      records.push(analysis)
      
      // 如果超过最大数量限制，删除最早的记录
      if (records.length > saveConfig.maxRecords) {
        const excessCount = records.length - saveConfig.maxRecords
        records = records.slice(excessCount)
      }
      
      // 写入文件
      await fs.writeFile(filePath, JSON.stringify(records, null, 2), 'utf-8')
    } catch (error: any) {
      logger.error('MultiStrategyAIAnalyzer', '保存AI分析结果失败:', error.message)
    }
  }

  /**
   * 调用 AI API（支持多提供商）
   */
  private async callAI(
    prompt: string,
    symbol: string,
    price: number,
    indicators: TechnicalIndicators,
    volume: number = 0,
    strategyId: StrategyId,
    promptConfig?: AIPromptConfig
  ): Promise<AIAnalysis | null> {
    try {
      const emaEntries = indicators.emaList
      const runtimeConfig = useRuntimeConfig()

      // 获取 AI 提供商配置（优先使用策略配置，否则使用默认配置）
      const provider = promptConfig?.provider || (runtimeConfig.aiProvider as AIProvider) || 'deepseek'
      const providerConfig = getProviderConfig(provider, runtimeConfig)
      
      // 检查 API Key 是否配置
      if (!providerConfig.apiKey) {
        throw new Error(`${provider} API Key 未配置`)
      }

      // 构建系统提示词
      const systemPrompt = await this.buildSystemPrompt()
      
      // 选择模型（优先使用策略配置，否则使用提供商默认）
      const model = promptConfig?.model || providerConfig.model
      
      // 调用 AI API（OpenAI 兼容格式）
      const response = await fetch(`${providerConfig.apiUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${providerConfig.apiKey}`,
        },
        body: JSON.stringify({
          model: model,
          messages: [
            {
              role: 'system',
              content: systemPrompt,
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          temperature: promptConfig?.temperature ?? 0.5,
          max_tokens: promptConfig?.maxTokens ?? 1000,
          response_format: { type: "json_object" }
        }),
      })

      if (!response.ok) {
        throw new Error(`${provider} API请求失败: ${response.statusText}`)
      }

      const result = await response.json()
      const content = result.choices?.[0]?.message?.content || '{}'

      // 提取JSON内容（可能包含markdown代码块）
      let jsonContent = content
      const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/```\s*([\s\S]*?)\s*```/)
      if (jsonMatch) {
        jsonContent = jsonMatch[1]
      }

      const aiResult = JSON.parse(jsonContent)

      const direction = (aiResult.direction || 'IDLE') as Direction
      
      // 构建分析理由，限制总长度不超过150字
      let reasoning = aiResult.reasoning || '无分析理由'
      reasoning = reasoning
      
      const analysis: AIAnalysis = {
        symbol,
        timestamp: Date.now(),
        strategyId,
        direction: direction,
        confidence: aiResult.confidence,
        riskLevel: (aiResult.riskLevel || 'MEDIUM') as RiskLevel,
        isBullish: direction === 'LONG',
        reasoning: reasoning,
        technicalData: {
          price,
          ...Object.fromEntries(emaEntries.map(item => [item.name, item.value])),
          ...(indicators.emaMap || {}),
          rsi: indicators.rsi ?? 0,
          macd: indicators.macd?.macd,
          macdSignal: indicators.macd?.signal,
          macdHistogram: indicators.macd?.histogram,
          volume,
          openInterest: indicators.enabledIndicators?.oi ? indicators.openInterest : undefined,
          openInterestChangePercent: indicators.enabledIndicators?.oi ? indicators.openInterestChangePercent : undefined,
          openInterestTrend: indicators.enabledIndicators?.oi ? indicators.openInterestTrend : undefined,
          adx: indicators?.adx ?? 0,
          adxPeriodLabel: indicators?.adxPeriodLabel,
          adxSlope: indicators?.adxSlope,
          support: aiResult.support,
          resistance: aiResult.resistance,
        },
      }

      // 异步保存到文件，不阻塞主流程（是否保存由配置控制）
      this.saveAIAnalysisToFile(analysis).catch(() => {})

      // 日志统一在 StrategyEngine 中处理，避免重复
      return analysis
    } catch (error: any) {
      logger.error('MultiStrategyAIAnalyzer', `AI API 调用失败: ${error.message}`)
      
      // 返回默认分析结果（降级处理）
      const fallbackAnalysis: AIAnalysis = {
        symbol,
        timestamp: Date.now(),
        strategyId,
        direction: 'IDLE',
        confidence: 5,
        riskLevel: 'HIGH',
        isBullish: false,
        reasoning: `AI分析暂时不可用: ${error.message}`,
        technicalData: {
          price,
          ...Object.fromEntries(indicators.emaList.map(item => [item.name, item.value])),
          rsi: indicators.rsi ?? 0,
          volume,
        },
      }

      // 降级处理的结果通常是IDLE，不保存到文件

      return fallbackAnalysis
    }
  }

  /**
   * 构建缓存键
   */
  private buildCacheKey(
    strategyId: StrategyId,
    symbol: string,
    indicators: TechnicalIndicators,
    price: number
  ): string {
    // 基于关键指标值构建唯一键
const indicatorHash = [
  indicators.emaList.map(item => `${item.name}:${(item.value ?? 0).toFixed(2)}`).join('|'),
  (indicators.rsi ?? 0).toFixed(2),
  `${(indicators.macd?.macd ?? 0).toFixed(4)}|${(indicators.macd?.signal ?? 0).toFixed(4)}|${(indicators.macd?.histogram ?? 0).toFixed(4)}`,
  (indicators.atr ?? 0).toFixed(2),
  (price ?? 0).toFixed(2)
].join('_')

    // 简化键（避免过长）
    const hash = Buffer.from(indicatorHash).toString('base64').substring(0, 32)
    return `${strategyId}_${symbol}_${hash}`
  }

  /**
   * 清理缓存
   */
  clearCache(): void {
    aiCache.clear()
    logger.info('MultiStrategyAIAnalyzer', 'AI 缓存已清理')
  }

  /**
   * 清理过期缓存
   */
  cleanExpiredCache(): void {
    const now = Date.now()
    const ttl = this.getAiCacheTtl()
    for (const [key, value] of aiCache) {
      if (now - value.timestamp >= ttl) {
        aiCache.delete(key)
      }
    }
  }

  /**
   * 获取缓存状态
   */
  getCacheStatus(): { size: number; ttl: number } {
    return {
      size: aiCache.size,
      ttl: this.getAiCacheTtl()
    }
  }
}
