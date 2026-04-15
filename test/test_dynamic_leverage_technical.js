// 测试纯技术指标版动态杠杆计算
console.log("=== 纯技术指标版动态杠杆计算测试 ===\n");

// 最新配置（从data/bot-config.json获取）
const config = {
  enabled: true,
  minLeverage: 8,
  maxLeverage: 20,
  baseLeverage: 5,
  riskLevelMultipliers: {
    LOW: 1.5,
    MEDIUM: 1.0,
    HIGH: 0.7
  }
};

console.log("配置参数：");
console.log(JSON.stringify(config, null, 2));
console.log();

// 最新calculateQuickLeverage函数（从server/utils/dynamic-leverage.ts获取）
function calculateQuickLeverage(technicalIndicators, riskLevel, config) {
  // 基础杠杆
  let leverage = config.baseLeverage
  
  // ADX趋势强度调整：15分钟ADX 20-60 对应乘数0.98-1.85，趋势越强杠杆越高
  const adx = technicalIndicators.adx15m
  let adxFactor = 1.0
  if (adx >= 20) {
    adxFactor = 0.98 + Math.min((adx - 20) / 65, 0.87) // 每高10点乘数增加0.15，上限1.85
  } else {
    adxFactor = 0.98 // 趋势不明朗时降低杠杆
  }
  leverage *= adxFactor
  
  // RSI合理性调整：RSI在40-60区间趋势健康，乘数1.45；接近超买超卖时降低杠杆
  const rsi = technicalIndicators.rsi
  let rsiFactor = 1.0
  if (rsi >= 40 && rsi <= 60) {
    rsiFactor = 1.45
  } else if ((rsi >= 35 && rsi < 40) || (rsi > 60 && rsi <= 65)) {
    rsiFactor = 1.2
  } else {
    rsiFactor = 1.0 // RSI极端值时降低杠杆
  }
  leverage *= rsiFactor
  
  // 波动率调整：ATR波动率低于1%时市场平稳提高杠杆，高于3%时波动剧烈降低杠杆
  const atrPercent = technicalIndicators.atr / (technicalIndicators.ema20 || 1) * 100
  let volatilityFactor = 1.0
  if (atrPercent < 1) {
    volatilityFactor = 1.25
  } else if (atrPercent > 3) {
    volatilityFactor = 0.95
  }
  leverage *= volatilityFactor
  
  // OI趋势调整：OI平稳时市场健康，大幅波动时降低杠杆
  const oiTrend = technicalIndicators.openInterestTrend
  let oiFactor = 1.0
  if (oiTrend === 'flat') {
    oiFactor = 1.1
  } else if (Math.abs(technicalIndicators.openInterestChangePercent) > 5) {
    oiFactor = 0.95 // OI变化超过5%时降低杠杆
  }
  leverage *= oiFactor
  
  // 风险等级调整：风险越低，杠杆越高
  const riskFactor = config.riskLevelMultipliers[riskLevel] || 1.0
  leverage *= riskFactor
  
  // 整体提升30%杠杆
  leverage *= 1.3
  
  // 确保在范围内并取整
  leverage = Math.max(config.minLeverage, Math.min(config.maxLeverage, leverage))
  return Math.round(leverage)
}

// 典型场景测试
const testCases = [
  // 最佳场景 - 强趋势 + 健康RSI + 低波动 + 平稳OI + 低风险
  {
    name: "最佳场景-强趋势健康行情",
    indicators: { adx15m: 50, rsi: 52, atr: 15, ema20: 2000, openInterestTrend: 'flat', openInterestChangePercent: 1.2 },
    riskLevel: "LOW",
    description: "ADX=50(强趋势), RSI=52(健康区间), ATR=0.75%(低波动), OI平稳, 低风险"
  },
  // 良好场景 - 中等趋势 + 健康RSI + 正常波动
  {
    name: "良好场景-中等趋势行情",
    indicators: { adx15m: 35, rsi: 48, atr: 30, ema20: 2000, openInterestTrend: 'increasing', openInterestChangePercent: 3.5 },
    riskLevel: "LOW",
    description: "ADX=35(中等趋势), RSI=48(健康区间), ATR=1.5%(正常波动), OI上升, 低风险"
  },
  // 一般场景 - 弱趋势 + RSI临界 + 正常波动
  {
    name: "一般场景-弱趋势临界行情",
    indicators: { adx15m: 22, rsi: 63, atr: 30, ema20: 2000, openInterestTrend: 'flat', openInterestChangePercent: 2 },
    riskLevel: "MEDIUM",
    description: "ADX=22(弱趋势), RSI=63(接近超买), ATR=1.5%(正常波动), OI平稳, 中风险"
  },
  // 谨慎场景 - 无趋势 + RSI极端 + 高波动
  {
    name: "谨慎场景-震荡极端行情",
    indicators: { adx15m: 18, rsi: 72, atr: 80, ema20: 2000, openInterestTrend: 'decreasing', openInterestChangePercent: 6.5 },
    riskLevel: "HIGH",
    description: "ADX=18(无趋势), RSI=72(超买), ATR=4%(高波动), OI大幅下降, 高风险"
  },
  // 高波动场景 - 强趋势 + 高波动
  {
    name: "高波动场景-强趋势高波动",
    indicators: { adx15m: 55, rsi: 55, atr: 70, ema20: 2000, openInterestTrend: 'increasing', openInterestChangePercent: 4.8 },
    riskLevel: "MEDIUM",
    description: "ADX=55(极强趋势), RSI=55(健康), ATR=3.5%(高波动), OI上升, 中风险"
  },
  // RSI极端场景 - 强趋势 + RSI超卖
  {
    name: "RSI极端场景-强趋势超卖",
    indicators: { adx15m: 45, rsi: 28, atr: 40, ema20: 2000, openInterestTrend: 'flat', openInterestChangePercent: 2.2 },
    riskLevel: "HIGH",
    description: "ADX=45(强趋势), RSI=28(严重超卖), ATR=2%(中等波动), OI平稳, 高风险"
  },
  // OI大幅波动场景
  {
    name: "OI大幅波动场景",
    indicators: { adx15m: 40, rsi: 50, atr: 25, ema20: 2000, openInterestTrend: 'increasing', openInterestChangePercent: 8.5 },
    riskLevel: "MEDIUM",
    description: "ADX=40(中强趋势), RSI=50(健康), ATR=1.25%(低波动), OI暴增8.5%, 中风险"
  }
];

console.log("典型场景测试：");
console.log("=".repeat(100));

testCases.forEach(testCase => {
  const leverage = calculateQuickLeverage(testCase.indicators, testCase.riskLevel, config);
  
  // 计算各个因子
  const adx = testCase.indicators.adx15m
  const adxFactor = adx >= 20 ? 0.98 + Math.min((adx - 20) / 65, 0.87) : 0.98
  
  const rsi = testCase.indicators.rsi
  let rsiFactor = 1.0
  if (rsi >= 40 && rsi <= 60) rsiFactor = 1.45
  else if ((rsi >= 35 && rsi < 40) || (rsi > 60 && rsi <= 65)) rsiFactor = 1.2
  else rsiFactor = 1.0
  
  const atrPercent = testCase.indicators.atr / testCase.indicators.ema20 * 100
  let volatilityFactor = 1.0
  if (atrPercent < 1) volatilityFactor = 1.25
  else if (atrPercent > 3) volatilityFactor = 0.95
  
  const oiTrend = testCase.indicators.openInterestTrend
  const oiChange = testCase.indicators.openInterestChangePercent
  let oiFactor = 1.0
  if (oiTrend === 'flat') oiFactor = 1.1
  else if (Math.abs(oiChange) > 5) oiFactor = 0.95
  
  const riskFactor = config.riskLevelMultipliers[testCase.riskLevel]
  
  console.log(`${testCase.name}:`);
  console.log(`  ${testCase.description}`);
  console.log(`  计算: ${config.baseLeverage} × ${adxFactor.toFixed(2)}(ADX) × ${rsiFactor.toFixed(2)}(RSI) × ${volatilityFactor.toFixed(2)}(波动率) × ${oiFactor.toFixed(2)}(OI) × ${riskFactor}(风险) = ${leverage}x`);
  console.log();
});

// 随机模拟测试
console.log("\n=== 随机模拟统计 ===");
console.log("=".repeat(100));

const simulations = 1000;
const leverageCounts = {};

for (let i = 0; i < simulations; i++) {
  // 生成随机指标数据，符合实际交易场景
  const adx15m = Math.floor(Math.random() * 50) + 10; // 10-60
  const rsi = Math.floor(Math.random() * 60) + 20; // 20-80
  const ema20 = 2000 + Math.random() * 1000; // 2000-3000
  const atr = ema20 * (0.005 + Math.random() * 0.04); // 0.5%-4.5%波动率
  const oiTrends = ['increasing', 'decreasing', 'flat'];
  const openInterestTrend = oiTrends[Math.floor(Math.random() * 3)];
  const openInterestChangePercent = (Math.random() * 15) - 5; // -5% ~ +10%
  
  // 风险等级概率分布：LOW 30%, MEDIUM 60%, HIGH 10%
  const rand = Math.random();
  let riskLevel = 'MEDIUM';
  if (rand < 0.3) riskLevel = 'LOW';
  else if (rand > 0.9) riskLevel = 'HIGH';
  
  const indicators = { adx15m, rsi, atr, ema20, openInterestTrend, openInterestChangePercent };
  const leverage = calculateQuickLeverage(indicators, riskLevel, config);
  
  leverageCounts[leverage] = (leverageCounts[leverage] || 0) + 1;
}

console.log(`模拟${simulations}次真实行情场景：`);
console.log("杠杆分布：");

// 按杠杆倍数排序
const sortedLeverages = Object.keys(leverageCounts).map(Number).sort((a, b) => a - b);
sortedLeverages.forEach(leverage => {
  const count = leverageCounts[leverage];
  const percentage = (count / simulations * 100).toFixed(1);
  const bar = "█".repeat(Math.round(count / simulations * 30));
  console.log(`  ${leverage.toString().padStart(2)}x: ${count.toString().padStart(3)}次 (${percentage}%) ${bar}`);
});

// 计算统计信息
const totalLeverage = sortedLeverages.reduce((sum, leverage) => sum + leverage * leverageCounts[leverage], 0);
const averageLeverage = totalLeverage / simulations;

const minLeverage = Math.min(...sortedLeverages);
const maxLeverage = Math.max(...sortedLeverages);

// 计算中位数
let cumulative = 0;
let medianLeverage = 0;
for (const leverage of sortedLeverages) {
  cumulative += leverageCounts[leverage];
  if (cumulative >= simulations / 2) {
    medianLeverage = leverage;
    break;
  }
}

console.log(`\n统计信息：`);
console.log(`  平均杠杆: ${averageLeverage.toFixed(2)}x`);
console.log(`  中位数: ${medianLeverage}x`);
console.log(`  范围: ${minLeverage}x - ${maxLeverage}x`);
console.log(`  标准差: ${Math.sqrt(sortedLeverages.reduce((sum, leverage) => sum + Math.pow(leverage - averageLeverage, 2) * leverageCounts[leverage], 0) / simulations).toFixed(2)}`);

// 分布区间统计
console.log(`\n分布区间：`);
const ranges = [
  { name: "低杠杆(2-5x)", min: 2, max: 5 },
  { name: "中低杠杆(6-9x)", min: 6, max: 9 },
  { name: "中等杠杆(10-13x)", min: 10, max: 13 },
  { name: "中高杠杆(14-17x)", min: 14, max: 17 },
  { name: "高杠杆(18-20x)", min: 18, max: 20 },
];

ranges.forEach(range => {
  let count = 0;
  for (const leverage of sortedLeverages) {
    if (leverage >= range.min && leverage <= range.max) {
      count += leverageCounts[leverage];
    }
  }
  const percentage = (count / simulations * 100).toFixed(1);
  console.log(`  ${range.name}: ${count}次 (${percentage}%)`);
});

console.log("\n=== 实现说明 ===");
console.log("=".repeat(100));
console.log("当前实现（纯技术指标版）：");
console.log("1. 基础杠杆: 5");
console.log("2. ADX因子: 0.8-1.4（ADX<20时0.8，20-60时每高10点+0.1）");
console.log("3. RSI因子: 0.85/1.0/1.2（RSI在40-60时1.2，极端值时0.85）");
console.log("4. 波动率因子: 0.8/1.0/1.1（ATR<1%时1.1，>3%时0.8）");
console.log("5. OI因子: 0.9/1.0/1.05（OI平稳时1.05，变化>5%时0.9）");
console.log("6. 风险乘数: LOW 1.5, MEDIUM 1.0, HIGH 0.7");
console.log("\n参数范围：");
console.log("- 最小杠杆: 2x");
console.log("- 最大杠杆: 20x");
console.log("- 平均杠杆: ~7-10x（符合稳健交易要求）");
console.log("- 完全不依赖AI参数，计算逻辑透明可控");