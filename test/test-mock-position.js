// 模拟持仓数据测试脚本
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('开始创建模拟持仓数据...\n');

// 1. 暂停机器人扫描
const botStatePath = path.join(__dirname, 'data/bot-state.json');
let botState = JSON.parse(fs.readFileSync(botStatePath, 'utf8'));

// 暂停机器人
botState.isRunning = false;
botState.status = 'STOPPED';
console.log('✅ 机器人已暂停');

// 2. 创建模拟持仓数据（测试移动止损已触发的情况）
const mockPosition = {
  symbol: 'BTC/USDT',
  direction: 'LONG',
  entryPrice: 65000.00,
  quantity: 0.1,
  leverage: 5,
  stopLoss: 64800.00,         // 移动止损后的价格（比初始止损高）
  initialStopLoss: 64500.00,  // 初始止损价格
  takeProfit1: 65500.00,
  takeProfit2: 66000.00,
  openTime: Date.now(),
  currentPrice: 65250.00,     // 当前价格（高于入场价，显示盈利）
  currentPnL: 125.00,
  currentPnLPercentage: 1.92
};

// 添加模拟持仓到状态
botState.currentPosition = mockPosition;
botState.currentPrice = mockPosition.currentPrice;
botState.currentPnL = mockPosition.currentPnL;
botState.currentPnLPercentage = mockPosition.currentPnLPercentage;

// 保存更新后的状态
fs.writeFileSync(botStatePath, JSON.stringify(botState, null, 2));
console.log('✅ 模拟持仓数据已创建');
console.log('\n📊 模拟持仓详情:');
console.log('- 交易对:', mockPosition.symbol);
console.log('- 方向:', mockPosition.direction);
console.log('- 入场价格:', mockPosition.entryPrice);
console.log('- 初始止损:', mockPosition.initialStopLoss);
console.log('- 移动止损:', mockPosition.stopLoss);
console.log('- TP1:', mockPosition.takeProfit1);
console.log('- TP2:', mockPosition.takeProfit2);
console.log('- 当前价格:', mockPosition.currentPrice);
console.log('- 当前盈亏:', mockPosition.currentPnL, 'U');
console.log('- 盈亏百分比:', mockPosition.currentPnLPercentage + '%');

// 3. 计算价格范围（测试修复逻辑）
console.log('\n🔧 测试价格范围计算:');
const prices = [
  mockPosition.initialStopLoss,
  mockPosition.stopLoss,
  mockPosition.entryPrice,
  mockPosition.takeProfit1,
  mockPosition.takeProfit2
];

const min = Math.min(...prices);
const max = Math.max(...prices);
const range = max - min;

// 添加缓冲
const buffer = Math.max(range * 0.1, (max * 0.001) || 0.0001);
const bufferedMin = min - buffer;
const bufferedMax = max + buffer;

console.log('- 最小价格:', min.toFixed(4));
console.log('- 最大价格:', max.toFixed(4));
console.log('- 价格范围:', range.toFixed(4));
console.log('- 缓冲后最小:', bufferedMin.toFixed(4));
console.log('- 缓冲后最大:', bufferedMax.toFixed(4));
console.log('- 缓冲后范围:', (bufferedMax - bufferedMin).toFixed(4));

// 4. 计算各个价格点的位置百分比
function calculatePosition(price) {
  const normalizedPrice = Math.max(bufferedMin, Math.min(bufferedMax, price));
  return ((normalizedPrice - bufferedMin) / (bufferedMax - bufferedMin)) * 100;
}

console.log('\n📍 各个价格点位置百分比:');
console.log('- 初始止损:', calculatePosition(mockPosition.initialStopLoss).toFixed(2) + '%');
console.log('- 移动止损:', calculatePosition(mockPosition.stopLoss).toFixed(2) + '%');
console.log('- 入场价格:', calculatePosition(mockPosition.entryPrice).toFixed(2) + '%');
console.log('- 当前价格:', calculatePosition(mockPosition.currentPrice).toFixed(2) + '%');
console.log('- TP1:', calculatePosition(mockPosition.takeProfit1).toFixed(2) + '%');
console.log('- TP2:', calculatePosition(mockPosition.takeProfit2).toFixed(2) + '%');

// 5. 检查移动止损是否触发
const hasTrailingStop = mockPosition.initialStopLoss !== undefined && 
                       mockPosition.initialStopLoss !== mockPosition.stopLoss;

console.log('\n🚨 移动止损状态:');
console.log('- 是否触发:', hasTrailingStop ? '✅ 已触发' : '❌ 未触发');
console.log('- 初始止损 ≠ 当前止损:', mockPosition.initialStopLoss !== mockPosition.stopLoss);
console.log('- 差值:', Math.abs(mockPosition.initialStopLoss - mockPosition.stopLoss).toFixed(4));

console.log('\n🎯 预期显示效果:');
if (hasTrailingStop) {
  console.log('1. 📌 初始止损标记（橙色，虚线边框）');
  console.log('2. 🛑 移动止损标记（红色，实线边框）');
  console.log('3. 🛑 移动止损下方显示（红色标签和数值）');
  console.log('4. 🚀 入场价格标记（蓝色）');
  console.log('5. ▲ 当前价格标记（根据盈亏状态显示颜色）');
  console.log('6. 🎯 TP1标记（绿色）');
  console.log('7. 🏆 TP2标记（深绿色）');
} else {
  console.log('1. 🛑 止损标记（红色）');
  console.log('2. 🚀 入场价格标记（蓝色）');
  console.log('3. ▲ 当前价格标记（根据盈亏状态显示颜色）');
  console.log('4. 🎯 TP1标记（绿色）');
  console.log('5. 🏆 TP2标记（深绿色）');
}

console.log('\n✅ 模拟数据准备完成！');
console.log('现在可以启动开发服务器查看效果：');
console.log('1. 运行: npm run dev');
console.log('2. 打开浏览器访问: http://localhost:3000');
console.log('3. 查看"当前持仓"卡片中的价格区间进度条');