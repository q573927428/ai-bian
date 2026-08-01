// ==================== 交易因子分析脚本（按策略分组） ====================
// 用途：按策略分类后，对每个策略分别做 单因子 / 双因子 分析，找出"盈利因子"与"盈利密码"
// 输入：data/trade-history-20260703.json、data/trade-history-20260729.json、data/trade-history.json
// 输出：
//   data/trade-factor-analysis-report.md          （汇总报告）
//   data/trade-factor-analysis-report-001.md       （strategy_001 5m 报告）
//   data/trade-factor-analysis-report-002.md       （strategy_002 15m 报告）
//   data/trade-factor-analysis-report-003.md       （strategy_003 1h 报告）
//   data/trade-factor-analysis-report-004.md       （strategy_004 4h 报告）
//   data/trade-factor-analysis.json                （结构化汇总）
// 运行：node scripts/trade-factor-analysis.mjs
import fs from 'fs';
import path from 'path';

// ==================== 配置 ====================
const DATA_DIR = path.resolve('data');
const SOURCE_FILES = [
  'trade-history-20260703.json',
  'trade-history-20260729.json',
  'trade-history.json',
];
const REPORT_PATH = path.join(DATA_DIR, 'trade-factor-analysis-report.md');
const JSON_PATH = path.join(DATA_DIR, 'trade-factor-analysis.json');

// 策略元信息（周期）
const STRATEGY_META = {
  strategy_001: { tf: '5m', name: '策略01' },
  strategy_002: { tf: '15m', name: '策略02' },
  strategy_003: { tf: '1h', name: '策略03' },
  strategy_004: { tf: '4h', name: '策略04' },
};

// 单因子分桶配置
const SINGLE_BUCKETS = {
  ADX: [0, 20, 25, 30, 35, 40, Infinity],
  RSI: [0, 30, 40, 50, 60, 70, Infinity],
  ATRPct: [0, 0.3, 0.5, 0.8, 1, 1.5, 2, Infinity],
  emaDev50: [-Infinity, -2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2, Infinity],
  emaDev14: [-Infinity, -1, -0.6, -0.2, 0.2, 0.6, 1, Infinity],
  Volume: [0, 20, 40, 60, 80, 100],
  OI: [0, 20, 40, 60, 80, 100],
  confidence: [0, 60, 65, 70, 75, 80, Infinity],
  score: [0, 70, 75, 80, 85, 90, Infinity],
  holdingMinutes: [0, 60, 120, 240, 480, 720, 1440, Infinity],
};

const PERCENTILE_LABELS = ['低分位', '中低分位', '中分位', '中高分位', '高分位'];

const SINGLE_LABELS = {
  ADX: (v) => (v < 20 ? '<20' : v < 25 ? '20-25' : v < 30 ? '25-30' : v < 35 ? '30-35' : v < 40 ? '35-40' : '≥40'),
  RSI: (v) => (v < 30 ? '<30' : v < 40 ? '30-40' : v < 50 ? '40-50' : v < 60 ? '50-60' : v < 70 ? '60-70' : '≥70'),
  ATRPct: (v) => (v < 0.3 ? '<0.3' : v < 0.5 ? '0.3-0.5' : v < 0.8 ? '0.5-0.8' : v < 1 ? '0.8-1' : v < 1.5 ? '1-1.5' : v < 2 ? '1.5-2' : '≥2'),
  emaDev50: (v) => (v < -2 ? '<-2' : v < -1.5 ? '-2~-1.5' : v < -1 ? '-1.5~-1' : v < -0.5 ? '-1~-0.5' : v < 0 ? '-0.5~0' : v < 0.5 ? '0~0.5' : v < 1 ? '0.5~1' : v < 1.5 ? '1~1.5' : v < 2 ? '1.5~2' : '≥2'),
  emaDev14: (v) => (v < -1 ? '<-1' : v < -0.6 ? '-1~-0.6' : v < -0.2 ? '-0.6~-0.2' : v < 0.2 ? '-0.2~0.2' : v < 0.6 ? '0.2~0.6' : v < 1 ? '0.6~1' : '≥1'),
  Volume: (v) => PERCENTILE_LABELS[Math.min(4, Math.max(0, Math.floor(v / 20)))],
  OI: (v) => PERCENTILE_LABELS[Math.min(4, Math.max(0, Math.floor(v / 20)))],
  confidence: (v) => (v < 60 ? '<60' : v < 65 ? '60-65' : v < 70 ? '65-70' : v < 75 ? '70-75' : v < 80 ? '75-80' : '≥80'),
  score: (v) => (v < 70 ? '<70' : v < 75 ? '70-75' : v < 80 ? '75-80' : v < 85 ? '80-85' : v < 90 ? '85-90' : '≥90'),
  holdingMinutes: (v) => (v < 60 ? '<60' : v < 120 ? '60-120' : v < 240 ? '120-240' : v < 480 ? '240-480' : v < 720 ? '480-720' : v < 1440 ? '720-1440' : '≥1440'),
};

// 双因子分桶配置
const PAIR_BUCKETS = {
  ADX: [0, 25, 30, 35, Infinity],
  RSI: [0, 30, 45, 60, Infinity],
  emaDev50: [-Infinity, -1.5, -0.5, 0.5, Infinity],
  emaDev14: [-Infinity, -0.8, 0, 0.8, Infinity],
  Volume: [0, 20, 40, 60, 80, 100],
  OI: [0, 20, 40, 60, 80, 100],
  confidence: [0, 65, 70, 75, Infinity],
  score: [0, 80, 85, 90, Infinity],
};
const PAIR_LABELS = {
  ADX: (v) => (v < 25 ? '<25' : v < 30 ? '25-30' : v < 35 ? '30-35' : '≥35'),
  RSI: (v) => (v < 30 ? '<30' : v < 45 ? '30-45' : v < 60 ? '45-60' : '≥60'),
  emaDev50: (v) => (v < -1.5 ? '<-1.5' : v < -0.5 ? '-1.5~-0.5' : v < 0.5 ? '-0.5~0.5' : '≥0.5'),
  emaDev14: (v) => (v < -0.8 ? '<-0.8' : v < 0 ? '-0.8~0' : v < 0.8 ? '0~0.8' : '≥0.8'),
  Volume: (v) => PERCENTILE_LABELS[Math.min(4, Math.max(0, Math.floor(v / 20)))],
  OI: (v) => PERCENTILE_LABELS[Math.min(4, Math.max(0, Math.floor(v / 20)))],
  confidence: (v) => (v < 65 ? '<65' : v < 70 ? '65-70' : v < 75 ? '70-75' : '≥75'),
  score: (v) => (v < 80 ? '<80' : v < 85 ? '80-85' : v < 90 ? '85-90' : '≥90'),
};

// 双因子组合列表
const PAIR_COMBOS = [
  ['ADX', 'OI'],
  ['ADX', 'RSI'],
  ['Volume', 'OI'],
  ['emaDev50', 'OI'],
  ['emaDev14', 'OI'],
  ['ADX', 'Volume'],
  ['RSI', 'OI'],
  ['score', 'ADX'],
  ['confidence', 'ADX'],
  ['direction', 'ADX'],
  ['direction', 'RSI'],
  ['direction', 'OI'],
];

// 因子标题映射
const FACTOR_TITLES = {
  ADX: 'ADX',
  RSI: 'RSI',
  ATRPct: 'ATR%',
  emaDev50: 'EMA50 偏离',
  emaDev14: 'EMA14 偏离',
  Volume: '成交量分位',
  OI: 'OI 分位',
  confidence: '置信度',
  score: '评分',
  holdingMinutes: '持仓时长',
  direction: '方向',
  entryRiskLevel: '风险等级',
  closeCategory: '平仓类别',
};

// ==================== 数据加载 ====================
function loadTrades() {
  let all = [];
  for (const f of SOURCE_FILES) {
    const p = path.join(DATA_DIR, f);
    if (!fs.existsSync(p)) {
      console.warn(`[跳过] 文件不存在: ${f}`);
      continue;
    }
    const arr = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (Array.isArray(arr)) all = all.concat(arr.map((t) => ({ source: f, ...t })));
  }
  return all;
}

// 归一化每笔交易，补充派生因子
function normalizeTrade(t) {
  const ind = t.entryIndicators || {};
  const price = t.entryPrice;
  const pnlPct = t.pnlPercentage != null
    ? t.pnlPercentage
    : price && t.quantity
      ? (t.pnl / (price * t.quantity)) * 100
      : null;

  const emaDev14 = ind.EMAEMA14 && price ? ((price - ind.EMAEMA14) / ind.EMAEMA14) * 100 : null;
  const emaDev50 = ind.EMAEMA50 && price ? ((price - ind.EMAEMA50) / ind.EMAEMA50) * 100 : null;
  const atrPct = ind.ATR && price ? (ind.ATR / price) * 100 : null;

  return {
    ...t,
    _pnlPct: pnlPct,
    _win: pnlPct > 0,
    _emaDev14: emaDev14,
    _emaDev50: emaDev50,
    _atrPct: atrPct,
    _holdingMinutes: t.holdingMinutes ?? (t.openTime && t.closeTime ? Math.round((t.closeTime - t.openTime) / 60000) : null),
  };
}

// ==================== 因子取值 ====================
function getFactorValue(t, factor) {
  const ind = t.entryIndicators || {};
  switch (factor) {
    case 'ADX': return ind.ADX ?? null;
    case 'RSI': return ind.RSI ?? null;
    case 'ATR': return ind.ATR ?? null;
    case 'OI': return ind.OI ?? null;
    case 'Volume': return ind.Volume ?? null;
    case 'emaDev14': return t._emaDev14 ?? null;
    case 'emaDev50': return t._emaDev50 ?? null;
    case 'ATRPct': return t._atrPct ?? null;
    case 'confidence': return t.entryConfidence ?? null;
    case 'score': return t.entryScore ?? null;
    case 'holdingMinutes': return t._holdingMinutes ?? null;
    case 'direction': return t.direction ?? null;
    case 'entryRiskLevel': return t.entryRiskLevel ?? null;
    case 'closeCategory': return t.closeCategory ?? null;
    default: return t[factor] ?? null;
  }
}

// ==================== 统计工具 ====================
function round(v, d = 2) {
  if (v == null || !isFinite(v)) return '-';
  return Number(v.toFixed(d));
}

function bucketLabel(value, edges, labelFn) {
  if (value == null || !isFinite(value)) return 'N/A';
  for (let i = 0; i < edges.length - 1; i++) {
    if (value >= edges[i] && value < edges[i + 1]) return labelFn(value);
  }
  return labelFn(value);
}

function computeStats(trades) {
  const n = trades.length;
  if (n === 0) return null;
  const wins = trades.filter((t) => t._win);
  const losses = trades.filter((t) => !t._win);
  const winRate = (wins.length / n) * 100;
  const sumPct = trades.reduce((s, t) => s + (t._pnlPct ?? 0), 0);
  const avgPct = sumPct / n;
  const avgWin = wins.length ? wins.reduce((s, t) => s + t._pnlPct, 0) / wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((s, t) => s + t._pnlPct, 0) / losses.length : 0;
  const profitFactor = Math.abs(avgLoss) > 1e-9 ? Math.abs(avgWin / avgLoss) : wins.length ? Infinity : 0;
  const sorted = trades.map((t) => t._pnlPct ?? 0).sort((a, b) => a - b);
  const median = sorted.length % 2
    ? sorted[(sorted.length - 1) / 2]
    : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  return { n, winRate, avgPct, sumPct, avgWin, avgLoss, profitFactor, median, wins: wins.length, losses: losses.length };
}

// ==================== 品种内分位 ====================
function computeSymbolPercentiles(trades) {
  const bySymbol = new Map();
  for (const t of trades) {
    if (!bySymbol.has(t.symbol)) bySymbol.set(t.symbol, []);
    bySymbol.get(t.symbol).push(t);
  }
  const oiPct = new Map();
  const volPct = new Map();
  for (const [sym, list] of bySymbol) {
    const ois = list.map((t) => t.entryIndicators?.OI).filter((v) => v != null).sort((a, b) => a - b);
    const vols = list.map((t) => t.entryIndicators?.Volume).filter((v) => v != null).sort((a, b) => a - b);
    for (const t of list) {
      oiPct.set(t.id, percentileRank(ois, t.entryIndicators?.OI));
      volPct.set(t.id, percentileRank(vols, t.entryIndicators?.Volume));
    }
  }
  return { oiPct, volPct };
}

function percentileRank(sortedArr, v) {
  if (v == null || sortedArr.length <= 1) return null;
  const below = sortedArr.filter((x) => x < v).length;
  return (below / (sortedArr.length - 1)) * 100;
}

// ==================== 单因子分析 ====================
function analyzeSingleFactor(trades, factor, edges, labelFn) {
  const groups = new Map();
  for (const t of trades) {
    const label = bucketLabel(getFactorValue(t, factor), edges, labelFn);
    if (label === 'N/A') continue;
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(t);
  }
  const rows = [];
  for (const [label, group] of groups) {
    const st = computeStats(group);
    if (!st) continue;
    rows.push({ label, ...st });
  }
  const order = edges.slice(0, -1);
  rows.sort((a, b) => {
    const ia = order.findIndex((e) => a.label === labelFn(e));
    const ib = order.findIndex((e) => b.label === labelFn(e));
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });
  return rows;
}

function analyzeCategorical(trades, factor) {
  const groups = new Map();
  for (const t of trades) {
    const v = getFactorValue(t, factor);
    const label = v == null ? 'N/A' : String(v);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(t);
  }
  return [...groups.entries()]
    .map(([label, group]) => ({ label, ...computeStats(group) }))
    .sort((a, b) => b.n - a.n);
}

// ==================== 双因子分析 ====================
function analyzePair(trades, factorA, factorB, oiPct, volPct) {
  const cells = new Map();
  for (const t of trades) {
    let labelA;
    if (factorA === 'direction') {
      labelA = t.direction;
    } else if (factorA === 'OI' || factorA === 'Volume') {
      const pct = factorA === 'OI' ? oiPct.get(t.id) : volPct.get(t.id);
      labelA = bucketLabel(pct, PAIR_BUCKETS[factorA], PAIR_LABELS[factorA]);
    } else {
      labelA = bucketLabel(getFactorValue(t, factorA), PAIR_BUCKETS[factorA], PAIR_LABELS[factorA]);
    }
    let labelB;
    if (factorB === 'direction') {
      labelB = t.direction;
    } else if (factorB === 'OI' || factorB === 'Volume') {
      const pct = factorB === 'OI' ? oiPct.get(t.id) : volPct.get(t.id);
      labelB = bucketLabel(pct, PAIR_BUCKETS[factorB], PAIR_LABELS[factorB]);
    } else {
      labelB = bucketLabel(getFactorValue(t, factorB), PAIR_BUCKETS[factorB], PAIR_LABELS[factorB]);
    }

    if (!labelA || labelA === 'N/A' || !labelB || labelB === 'N/A') continue;
    const key = `${labelA} | ${labelB}`;
    if (!cells.has(key)) cells.set(key, { a: labelA, b: labelB, trades: [] });
    cells.get(key).trades.push(t);
  }
  const rows = [];
  for (const cell of cells.values()) {
    const st = computeStats(cell.trades);
    if (!st) continue;
    rows.push({ a: cell.a, b: cell.b, ...st });
  }
  return rows;
}

// ==================== 报告生成 ====================
function markdownTable(columns, rows) {
  const lines = [`| ${columns.map((c) => c.header).join(' | ')} |`, `| ${columns.map(() => '---').join(' | ')} |`];
  for (const r of rows) {
    lines.push(`| ${columns.map((c) => (c.fmt ? c.fmt(r[c.field]) : r[c.field] ?? '-')).join(' | ')} |`);
  }
  return lines.join('\n');
}

const STAT_COLUMNS = [
  { header: '交易数', field: 'n' },
  { header: '胜率', field: 'winRate', fmt: (v) => `${round(v, 1)}%` },
  { header: '平均盈亏%', field: 'avgPct', fmt: (v) => round(v) },
  { header: '总盈亏%', field: 'sumPct', fmt: (v) => round(v) },
  { header: '盈亏比', field: 'profitFactor', fmt: (v) => (v === Infinity ? '∞' : round(v)) },
  { header: '平均盈利%', field: 'avgWin', fmt: (v) => round(v) },
  { header: '平均亏损%', field: 'avgLoss', fmt: (v) => round(v) },
];

function singleFactorSection(title, desc, rows) {
  const parts = [`### ${title}`, '', desc, ''];
  if (!rows.length) {
    parts.push('（无有效数据）', '');
    return parts.join('\n');
  }
  parts.push(
    markdownTable([{ header: '分桶', field: 'label' }, ...STAT_COLUMNS], rows),
    ''
  );
  const good = rows.filter((r) => r.n >= 5 && r.winRate >= 55 && r.avgPct > 0);
  if (good.length) {
    parts.push(`**✅ 有效区间**：${good.map((r) => `${r.label}（样本${r.n}，胜率${round(r.winRate, 1)}%，平均${round(r.avgPct)}%）`).join('；')}`, '');
  }
  const bad = rows.filter((r) => r.n >= 5 && r.avgPct < 0);
  if (bad.length) {
    parts.push(`**⚠️ 危险区间**：${bad.map((r) => `${r.label}（样本${r.n}，胜率${round(r.winRate, 1)}%，平均${round(r.avgPct)}%）`).join('；')}`, '');
  }
  return parts.join('\n');
}

// ==================== 单策略分析 ====================
function analyzeStrategy(trades, strategyId) {
  const meta = STRATEGY_META[strategyId] || { tf: '?', name: strategyId };
  const valid = trades.filter((t) => t._pnlPct != null && t.entryIndicators);
  const { oiPct, volPct } = computeSymbolPercentiles(valid);

  // 单因子
  const singleResults = {};
  const singleSections = [];
  const singleOrder = [
    ['ADX', '趋势强度指标，越高代表趋势越明确'],
    ['RSI', '相对强弱指标，反映超买超卖'],
    ['ATRPct', `ATR/入场价，${meta.tf} 周期实际波动率水平`],
    ['emaDev50', '价格偏离 EMA50 百分比，反映中期乖离'],
    ['emaDev14', '价格偏离 EMA14 百分比，反映短期乖离'],
    ['Volume', '成交量品种内相对分位（percentile rank）'],
    ['OI', '未平仓合约量品种内相对分位'],
    ['confidence', 'AI 入场置信度'],
    ['score', '综合入场评分'],
    ['holdingMinutes', '持仓时长（分钟）'],
  ];
  for (const [factor, desc] of singleOrder) {
    const rows = analyzeSingleFactor(valid, factor, SINGLE_BUCKETS[factor], SINGLE_LABELS[factor]);
    singleResults[factor] = rows;
    singleSections.push(singleFactorSection(FACTOR_TITLES[factor], desc, rows));
  }

  // 类别因子
  const catResults = {};
  const catSections = [];
  const catOrder = ['direction', 'entryRiskLevel', 'closeCategory'];
  for (const factor of catOrder) {
    const rows = analyzeCategorical(valid, factor);
    catResults[factor] = rows;
    catSections.push(singleFactorSection(FACTOR_TITLES[factor], '', rows));
  }

  // 双因子
  const pairResults = [];
  const pairSections = [];
  const pairSummaries = [];
  for (const [a, b] of PAIR_COMBOS) {
    const rows = analyzePair(valid, a, b, oiPct, volPct);
    pairResults.push({ a, b, rows });
    const good = rows
      .filter((r) => r.n >= 5 && r.winRate >= 55 && r.avgPct > 0)
      .sort((x, y) => y.winRate * Math.log(y.n + 1) - x.winRate * Math.log(x.n + 1));
    pairSummaries.push({ a, b, good });
    const parts = [`### ${FACTOR_TITLES[a] || a} × ${FACTOR_TITLES[b] || b}`, ''];
    if (!rows.length) {
      parts.push('（无有效数据）', '');
      pairSections.push(parts.join('\n'));
      continue;
    }
    const sorted = [...rows].sort((x, y) => y.winRate - x.winRate);
    parts.push(
      markdownTable(
        [{ header: '组合', field: 'label', fmt: (v) => v }, ...STAT_COLUMNS],
        sorted.map((r) => ({ ...r, label: `${r.a} + ${r.b}` }))
      ),
      ''
    );
    if (good.length) {
      parts.push('**🔑 盈利密码**：');
      for (const g of good.slice(0, 8)) {
        parts.push(`- **${g.a} + ${g.b}**：样本 ${g.n}，胜率 ${round(g.winRate, 1)}%，平均盈亏 ${round(g.avgPct)}%，总盈亏 ${round(g.sumPct)}%，盈亏比 ${g.profitFactor === Infinity ? '∞' : round(g.profitFactor)}`);
      }
      parts.push('');
    }
    pairSections.push(parts.join('\n'));
  }

  // Top 盈利密码汇总
  const allGoodCells = [];
  for (const { a, b, rows } of pairResults) {
    for (const r of rows) {
      if (r.n >= 5 && r.winRate >= 55 && r.avgPct > 0) {
        allGoodCells.push({ combo: `${FACTOR_TITLES[a] || a} × ${FACTOR_TITLES[b] || b}`, cell: `${r.a} + ${r.b}`, ...r });
      }
    }
  }
  const topCells = allGoodCells
    .sort((x, y) => y.winRate * Math.log(y.n + 1) - x.winRate * Math.log(x.n + 1))
    .slice(0, 30);

  return { valid, meta, singleResults, singleSections, catResults, catSections, pairResults, pairSections, pairSummaries, topCells, overall: computeStats(valid) };
}

// ==================== 生成单策略报告 ====================
function buildStrategyReport(result, strategyId) {
  const { valid, meta, singleSections, catSections, pairSections, topCells, overall } = result;
  const lines = [];
  lines.push(`# ${meta.name}（${strategyId}）交易因子分析报告`, '');
  lines.push(`> 周期：${meta.tf}`, '');
  lines.push(`> 生成时间：${new Date().toLocaleString('zh-CN')}`, '');
  lines.push(`> 有效交易样本：${valid.length} 笔`, '');
  lines.push('', '## 总体统计', '');
  lines.push(markdownTable(
    [{ header: '交易数', field: 'n' }, { header: '胜率', field: 'winRate', fmt: (v) => `${round(v, 1)}%` }, { header: '平均盈亏%', field: 'avgPct', fmt: (v) => round(v) }, { header: '总盈亏%', field: 'sumPct', fmt: (v) => round(v) }, { header: '盈亏比', field: 'profitFactor', fmt: (v) => (v === Infinity ? '∞' : round(v)) }, { header: '平均盈利%', field: 'avgWin', fmt: (v) => round(v) }, { header: '平均亏损%', field: 'avgLoss', fmt: (v) => round(v) }, { header: '中位盈亏%', field: 'median', fmt: (v) => round(v) }],
    [overall]
  ), '');
  lines.push('## 数据说明', '');
  lines.push('- OI / Volume 使用**品种内相对分位**（0-100），消除跨品种量纲差异', '');
  lines.push('- emaDev14 / emaDev50 为入场价相对 EMA 的偏离百分比', '');
  lines.push('- ATR% = ATR / 入场价 × 100', '');
  lines.push('', '---', '', '## 第一层：单因子分析', '');
  lines.push(...singleSections);
  lines.push('---', '', '## 类别因子分析', '');
  lines.push(...catSections);
  lines.push('---', '', '## 第二层：双因子分析（寻找盈利密码）', '');
  lines.push(...pairSections);
  lines.push('---', '', '## 🏆 Top 盈利密码汇总', '');
  if (topCells.length) {
    lines.push(markdownTable(
      [{ header: '组合', field: 'combo' }, { header: '条件', field: 'cell' }, ...STAT_COLUMNS],
      topCells
    ), '');
  } else {
    lines.push('（未发现样本>=5 且胜率>=55% 的稳定盈利组合）', '');
  }
  lines.push('', '> 注：盈利密码为历史统计结果，需结合样本量与实盘验证，不构成投资建议。', '');
  return lines.join('\n');
}

// ==================== 主流程 ====================
function main() {
  const rawTrades = loadTrades();
  const trades = rawTrades.map(normalizeTrade);
  console.log(`加载交易总数: ${rawTrades.length}`);

  // 按策略分组
  const byStrategy = {};
  for (const t of trades) {
    const sid = t.strategyId || 'unknown';
    if (!byStrategy[sid]) byStrategy[sid] = [];
    byStrategy[sid].push(t);
  }

  const strategyResults = {};
  const summaryRows = [];
  for (const [sid, list] of Object.entries(byStrategy)) {
    const meta = STRATEGY_META[sid] || { tf: '?', name: sid };
    const valid = list.filter((t) => t._pnlPct != null && t.entryIndicators);
    console.log(`[${sid}] (${meta.tf}) 共 ${list.length} 笔，有效 ${valid.length} 笔`);
    const result = analyzeStrategy(list, sid);
    strategyResults[sid] = result;
    // 写入单策略报告
    const reportPath = path.join(DATA_DIR, `trade-factor-analysis-report-${sid.split('_')[1] || sid}.md`);
    fs.writeFileSync(reportPath, buildStrategyReport(result, sid), 'utf8');
    console.log(`  ✅ 报告: ${reportPath}`);
    // 汇总行
    const o = result.overall || {};
    const goodCells = result.topCells.slice(0, 3).map((c) => `${c.cell}(${round(c.winRate, 0)}%)`).join('；');
    summaryRows.push({
      strategyId: sid,
      tf: meta.tf,
      name: meta.name,
      n: o.n || 0,
      winRate: o.winRate ?? 0,
      avgPct: o.avgPct ?? 0,
      sumPct: o.sumPct ?? 0,
      profitFactor: o.profitFactor ?? 0,
      topCells: goodCells,
    });
  }

  // ===== 汇总报告 =====
  const lines = [];
  lines.push('# 交易因子分析汇总报告（按策略分类）', '');
  lines.push(`> 生成时间：${new Date().toLocaleString('zh-CN')}`, '');
  lines.push(`> 数据来源：${SOURCE_FILES.join('、')}`, '');
  lines.push('', '## 各策略总体对比', '');
  lines.push(markdownTable(
    [{ header: '策略', field: 'strategyId' }, { header: '周期', field: 'tf' }, { header: '交易数', field: 'n' }, { header: '胜率', field: 'winRate', fmt: (v) => `${round(v, 1)}%` }, { header: '平均盈亏%', field: 'avgPct', fmt: (v) => round(v) }, { header: '总盈亏%', field: 'sumPct', fmt: (v) => round(v) }, { header: '盈亏比', field: 'profitFactor', fmt: (v) => (v === Infinity ? '∞' : round(v)) }, { header: 'Top盈利密码', field: 'topCells' }],
    summaryRows
  ), '');
  lines.push('', '## 各策略详细报告', '');
  for (const [sid, result] of Object.entries(strategyResults)) {
    const meta = STRATEGY_META[sid] || { tf: '?', name: sid };
    lines.push(`### ${meta.name}（${sid}，${meta.tf}）`, '');
    lines.push(`> 详细报告见 \`data/trade-factor-analysis-report-${sid.split('_')[1] || sid}.md\``, '');
    // 单策略 Top 盈利密码
    if (result.topCells.length) {
      lines.push('**盈利密码**：');
      for (const c of result.topCells.slice(0, 10)) {
        lines.push(`- **${c.cell}**（${c.combo}）：样本 ${c.n}，胜率 ${round(c.winRate, 1)}%，平均 ${round(c.avgPct)}%，盈亏比 ${c.profitFactor === Infinity ? '∞' : round(c.profitFactor)}`);
      }
    } else {
      lines.push('（未发现稳定盈利组合）');
    }
    lines.push('');
  }
  lines.push('', '> 注：各策略周期不同（5m/15m/1h/4h），因子分布与盈利密码存在显著差异，请按对应周期报告参考。', '');
  fs.writeFileSync(REPORT_PATH, lines.join('\n'), 'utf8');
  console.log(`✅ 汇总报告已生成: ${REPORT_PATH}`);

  // 结构化 JSON
  fs.writeFileSync(JSON_PATH, JSON.stringify({
    generatedAt: new Date().toISOString(),
    sampleCount: trades.length,
    strategies: Object.fromEntries(
      Object.entries(strategyResults).map(([sid, r]) => [sid, {
        tf: r.meta.tf,
        name: r.meta.name,
        overall: r.overall,
        singleFactors: r.singleResults,
        categorical: r.catResults,
        pairFactors: r.pairResults.map(({ a, b, rows }) => ({ a, b, rows })),
        topProfitCells: r.topCells,
      }])
    ),
  }, null, 2), 'utf8');
  console.log(`✅ 结构化数据已生成: ${JSON_PATH}`);
}

main();