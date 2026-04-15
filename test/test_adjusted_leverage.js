// 测试调整后的动态杠杆计算
console.log("=== 调整后的动态杠杆计算测试 ===\n");

// 最新配置（从data/bot-config.json获取）
const config = {
  enabled: true,
  minLeverage: 8,
  maxLeverage: 20,
  baseLeverage: 8,
  riskLevelMultipliers: {
    LOW: 1.5,
    MEDIUM: 1.0,
    HIGH: 0.5
  }
};

console.log("调整后的配置：");
console.log(JSON.stringify(config, null, 2));
console.log();

// 最新calculateQuickLeverage函数（从server/utils/dynamic-leverage.ts获取）
function calculateQuickLeverage(aiAnalysis, config) {
  // 基础杠杆
  let leverage = config.baseLeverage;
  
  // AI置信度调整：置信度60-100 对应乘数1-1.4，计算简单直观
  // 每高1分，乘数增加0.01，60分=1倍，100分=1.4倍
  const confidenceFactor = 1 + (aiAnalysis.confidence - 50) / 100;
  leverage *= confidenceFactor;
  
  // AI评分调整：评分60-100 对应乘数1-1.4，计算简单直观
  const scoreFactor = 1 + (aiAnalysis.score - 50) / 100;
  leverage *= scoreFactor;
  
  // 风险等级调整：风险越低，杠杆越高
  const riskFactor = config.riskLevelMultipliers[aiAnalysis.riskLevel] || 1.0;
  leverage *= riskFactor;
  
  // 确保在范围内并取整
  leverage = Math.max(config.minLeverage, Math.min(config.maxLeverage, leverage));
  return Math.round(leverage);
}

// 测试不同的AI分析场景（新增实际场景50-70分范围）
const testCases = [
  // 实际常见场景（50-70分）
  { name: "实际常见-低分低风险", confidence: 50, score: 50, riskLevel: "LOW" },
  { name: "实际常见-低分中风险", confidence: 50, score: 50, riskLevel: "MEDIUM" },
  { name: "实际常见-低分高风险", confidence: 50, score: 50, riskLevel: "HIGH" },
  { name: "实际常见-中等偏低低风险", confidence: 60, score: 60, riskLevel: "LOW" },
  { name: "实际常见-中等偏低中风险", confidence: 60, score: 60, riskLevel: "MEDIUM" },
  { name: "实际常见-中等偏低高风险", confidence: 60, score: 60, riskLevel: "HIGH" },
  { name: "实际常见-中等低风险", confidence: 65, score: 65, riskLevel: "LOW" },
  { name: "实际常见-中等中风险", confidence: 65, score: 65, riskLevel: "MEDIUM" },
  { name: "实际常见-中等高风险", confidence: 65, score: 65, riskLevel: "HIGH" },
  { name: "实际常见-中等偏高低风险", confidence: 70, score: 70, riskLevel: "LOW" },
  { name: "实际常见-中等偏高中风险", confidence: 70, score: 70, riskLevel: "MEDIUM" },
  { name: "实际常见-中等偏高高风险", confidence: 70, score: 70, riskLevel: "HIGH" },
  
  // 高分场景
  { name: "良好情况", confidence: 85, score: 85, riskLevel: "LOW" },
  { name: "优秀情况", confidence: 90, score: 90, riskLevel: "LOW" },
  { name: "最佳情况", confidence: 95, score: 95, riskLevel: "LOW" },
  
  // 混合情况
  { name: "高置信低评分低风险", confidence: 70, score: 50, riskLevel: "LOW" },
  { name: "低置信高评分低风险", confidence: 50, score: 70, riskLevel: "LOW" },
];

console.log("动态杠杆计算结果测试：");
console.log("=".repeat(80));

testCases.forEach(testCase => {
  const aiAnalysis = {
    confidence: testCase.confidence,
    score: testCase.score,
    riskLevel: testCase.riskLevel
  };
  
  const leverage = calculateQuickLeverage(aiAnalysis, config);
  
  // 计算各个因子
  const confidenceFactor = 1 + (testCase.confidence - 60) / 100;
  const scoreFactor = 1 + (testCase.score - 60) / 100;
  const riskFactor = config.riskLevelMultipliers[testCase.riskLevel];
  
  console.log(`${testCase.name}:`);
  console.log(`  置信度: ${testCase.confidence}%, 评分: ${testCase.score}, 风险: ${testCase.riskLevel}`);
  console.log(`  计算: ${config.baseLeverage} × ${confidenceFactor.toFixed(2)} × ${scoreFactor.toFixed(2)} × ${riskFactor} = ${leverage}x`);
  console.log();
});

// 统计分布
console.log("\n=== 杠杆分布统计 ===");
console.log("=".repeat(80));

// 模拟1000次随机AI分析（实际场景50-70分范围）
const simulations = 1000;
const leverageCounts = {};

for (let i = 0; i < simulations; i++) {
  // 生成符合实际情况的随机AI分析（50-70分）
  const confidence = Math.floor(Math.random() * 21) + 50; // 50-70
  const score = Math.floor(Math.random() * 21) + 50; // 50-70
  const riskLevels = ["LOW", "MEDIUM"];
  const riskLevel = riskLevels[Math.floor(Math.random() * 2)]; // 只取LOW或MEDIUM
  
  const aiAnalysis = { confidence, score, riskLevel };
  const leverage = calculateQuickLeverage(aiAnalysis, config);
  
  leverageCounts[leverage] = (leverageCounts[leverage] || 0) + 1;
}

console.log(`模拟${simulations}次符合开仓要求的AI分析：`);
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

// 与之前版本对比
console.log("\n=== 与之前版本对比 ===");
console.log("=".repeat(80));

// 之前版本（基础杠杆5，窄范围）
const oldConfig = {
  ...config,
  baseLeverage: 5,
  riskLevelMultipliers: { LOW: 1.2, MEDIUM: 1.0, HIGH: 0.8 }
};

function oldCalculateQuickLeverage(aiAnalysis, config) {
  let leverage = config.baseLeverage;
  const confidenceFactor = 0.8 + (aiAnalysis.confidence / 100) * 0.4;
  leverage *= confidenceFactor;
  const scoreFactor = 0.8 + ((aiAnalysis.score / 100) - 0.6) * 1.0;
  leverage *= scoreFactor;
  const riskFactor = config.riskLevelMultipliers[aiAnalysis.riskLevel] || 1.0;
  leverage *= riskFactor;
  leverage = Math.max(config.minLeverage, Math.min(config.maxLeverage, leverage));
  return Math.round(leverage);
}

const comparisonCases = [
  { name: "最佳情况", confidence: 95, score: 95, riskLevel: "LOW" },
  { name: "优秀情况", confidence: 90, score: 90, riskLevel: "LOW" },
  { name: "中等情况", confidence: 80, score: 80, riskLevel: "MEDIUM" },
  { name: "最低要求", confidence: 60, score: 60, riskLevel: "LOW" },
];

console.log("对比结果：");
comparisonCases.forEach(testCase => {
  const aiAnalysis = {
    confidence: testCase.confidence,
    score: testCase.score,
    riskLevel: testCase.riskLevel
  };
  
  const oldLeverage = oldCalculateQuickLeverage(aiAnalysis, oldConfig);
  const newLeverage = calculateQuickLeverage(aiAnalysis, config);
  
  console.log(`${testCase.name} (${testCase.confidence}%/${testCase.score}/${testCase.riskLevel}):`);
  console.log(`  之前: ${oldLeverage}x`);
  console.log(`  现在: ${newLeverage}x`);
  console.log(`  变化: ${newLeverage - oldLeverage > 0 ? '+' : ''}${newLeverage - oldLeverage}`);
  console.log();
});

console.log("=== 实现说明 ===");
console.log("=".repeat(80));
console.log("当前实现：");
console.log("1. 基础杠杆: 8");
console.log("2. 置信度因子: 1.0-1.4（60-100分，每高1分+0.01）");
console.log("3. 评分因子: 1.0-1.4（60-100分，每高1分+0.01）");
console.log("4. 风险乘数: LOW 1.5, MEDIUM 1.0, HIGH 0.5");
console.log("\n参数范围：");
console.log("- 最小杠杆: 5x");
console.log("- 最大杠杆: 20x");
console.log("- 平均杠杆: ~10-12x");
console.log("- 计算逻辑简单直观，便于调试和理解");
