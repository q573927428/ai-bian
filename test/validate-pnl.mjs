/**
 * 验证全部月度交易历史中 pnl 和 pnlPercentage 数值是否正确
 * 
 * 行业标准：pnlPercentage 应基于保证金（含杠杆）计算
 * pnlPercentage = pnl / (entryPrice * quantity / leverage) * 100
 */

import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { listTradeHistoryFiles, readTradeHistoryFiles } from '../server/utils/trade-history-files.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const trades = readTradeHistoryFiles(listTradeHistoryFiles(resolve(__dirname, '../data')));

let pnlErrors = [];
let pctErrors = [];
let checkedCount = 0;

let basedOnMargin = [];   // 基于保证金（正确）
let basedOnPrincipal = []; // 基于本金（错误）
let unclear = [];

for (const trade of trades) {
  const { id, symbol, direction, entryPrice, exitPrice, quantity, leverage, pnl, pnlPercentage, totalCommission, fundingFee = 0 } = trade;

  let rawPnl;
  if (direction === 'LONG') {
    rawPnl = (exitPrice - entryPrice) * quantity;
  } else if (direction === 'SHORT') {
    rawPnl = (entryPrice - exitPrice) * quantity;
  } else {
    continue;
  }

  const expectedPnl = rawPnl - totalCommission + fundingFee;
  const principal = entryPrice * quantity;
  const margin = principal / leverage;

  // 基于保证金的 pnl%（含杠杆，行业标准）
  const pctBasedOnMargin = (expectedPnl / margin) * 100;
  // 基于本金的 pnl%（不含杠杆）
  const pctBasedOnPrincipal = (expectedPnl / principal) * 100;

  const diffMargin = Math.abs(pnlPercentage - pctBasedOnMargin);
  const diffPrincipal = Math.abs(pnlPercentage - pctBasedOnPrincipal);

  checkedCount++;

  // 检查 pnl
  if (Math.abs(pnl - expectedPnl) > 0.0001) {
    pnlErrors.push(`[${id}] ${symbol} ${direction} pnl 错误: 期望 ${expectedPnl.toFixed(8)}, 实际 ${pnl}`);
  }

  // 判断 pnlPercentage 基于什么
  if (diffMargin < 0.001) {
    basedOnMargin.push({ id, symbol, direction, leverage, pnlPercentage, expected: pctBasedOnMargin });
  } else if (diffPrincipal < 0.001) {
    basedOnPrincipal.push({ id, symbol, direction, leverage, pnlPercentage, expected: pctBasedOnPrincipal });
  } else {
    unclear.push({ id, symbol, direction, leverage, pnlPercentage, pctBasedOnMargin, pctBasedOnPrincipal, diffMargin, diffPrincipal });
  }
}

console.log(`\n========== pnl 验证结果 ==========`);
console.log(`pnl 错误数: ${pnlErrors.length}`);
pnlErrors.forEach(e => console.log(`  ${e}`));

console.log(`\n========== pnlPercentage 验证（基于保证金=含杠杆）==========`);
console.log(`基于【保证金】✅ 正确的记录: ${basedOnMargin.length} 条`);
console.log(`基于【本金】❌ 错误的记录: ${basedOnPrincipal.length} 条`);
console.log(`无法判断: ${unclear.length} 条`);

if (basedOnPrincipal.length > 0) {
  console.log(`\n--- ❌ 需要修复的记录（基于本金，缺少杠杆） ---`);
  basedOnPrincipal.forEach(r => {
    const leverage = r.leverage;
    console.log(`  [${r.id}] ${r.symbol} ${r.direction}`);
    console.log(`    当前值: ${r.pnlPercentage}%`);
    console.log(`    正确值: ${r.expected.toFixed(8)}%（基于保证金，含${leverage}x杠杆）`);
    console.log(`    差值: ×${leverage}倍`);
  });
}

console.log(`\n========== 结论 ==========`);
if (pnlErrors.length === 0) {
  console.log(`✅ pnl 全部正确（已扣除手续费并计入资金费）`);
}
console.log(`✅ 基于保证金（含杠杆）正确的记录: ${basedOnMargin.length}/${checkedCount}`);
console.log(`❌ 基于本金（缺少杠杆）错误的记录: ${basedOnPrincipal.length}/${checkedCount}`);
if (basedOnPrincipal.length > 0) {
  console.log(`\n需要将这 ${basedOnPrincipal.length} 条记录的 pnlPercentage 乘以杠杆倍数修复。`);
}
