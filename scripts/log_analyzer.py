#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Binance Futures Bot 日志预处理器
将每日日志文件转换为结构化JSON格式
"""

import re
import json
import os
import sys
from datetime import datetime
from typing import Dict, List, Any, Optional, Tuple
from dataclasses import dataclass, asdict
from enum import Enum


class LogLevel(Enum):
    """日志级别枚举"""
    INFO = "INFO"
    SUCCESS = "SUCCESS"
    WARN = "WARN"
    ERROR = "ERROR"


class LogCategory(Enum):
    """日志分类枚举"""
    SYSTEM = "系统"
    CIRCUIT_BREAKER = "熔断"
    PRICE_SERVICE = "价格服务"
    SCANNER = "扫描"
    ANALYSIS_RESULT = "分析结果"
    SIGNAL = "信号"
    POSITION_OPEN = "开仓"
    ACCOUNT = "账户"
    DYNAMIC_LEVERAGE = "动态杠杆"
    POSITION_MODE = "持仓模式"
    POSITION_CONFIRM = "持仓确认"
    STOP_LOSS = "止损"
    POSITION = "持仓"
    POSITION_MONITOR = "持仓监控"
    STATUS_SYNC = "状态同步"
    COMPENSATION_CLOSE = "补偿平仓"
    CONFIG = "配置"
    COOLDOWN = "冷却"
    TAKE_PROFIT = "止盈"
    POSITION_CLOSE = "平仓"
    TRADE_COMPLETE = "交易完成"
    TRAILING_STOP = "移动止损"
    STRATEGY_ANALYSIS = "策略分析"


@dataclass
class LogEntry:
    """日志条目数据结构"""
    timestamp: str  # 时间戳，格式: HH:MM:SS
    level: str  # 日志级别: INFO, SUCCESS, WARN, ERROR
    category: str  # 日志分类
    message: str  # 日志消息
    data: Optional[Dict[str, Any]] = None  # 附加的JSON数据
    raw_line: str = ""  # 原始日志行
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        result = {
            "timestamp": self.timestamp,
            "level": self.level,
            "category": self.category,
            "message": self.message
        }
        if self.data:
            result["data"] = self.data
        if self.raw_line:
            result["raw_line"] = self.raw_line
        return result


@dataclass
class TradeSignal:
    """交易信号数据结构"""
    timestamp: str
    symbol: str
    direction: str  # LONG, SHORT
    price: float
    confidence: int
    reason: str
    raw_data: Dict[str, Any]
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "timestamp": self.timestamp,
            "symbol": self.symbol,
            "direction": self.direction,
            "price": self.price,
            "confidence": self.confidence,
            "reason": self.reason,
            "raw_data": self.raw_data
        }


@dataclass
class PositionOpen:
    """开仓数据结构"""
    timestamp: str
    symbol: str
    direction: str
    entry_price: float
    quantity: float
    leverage: int
    stop_loss: float
    initial_stop_loss: float
    take_profit1: float
    take_profit2: float
    order_id: str
    stop_loss_order_id: str
    raw_data: Dict[str, Any]
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "timestamp": self.timestamp,
            "symbol": self.symbol,
            "direction": self.direction,
            "entry_price": self.entry_price,
            "quantity": self.quantity,
            "leverage": self.leverage,
            "stop_loss": self.stop_loss,
            "initial_stop_loss": self.initial_stop_loss,
            "take_profit1": self.take_profit1,
            "take_profit2": self.take_profit2,
            "order_id": self.order_id,
            "stop_loss_order_id": self.stop_loss_order_id,
            "raw_data": self.raw_data
        }


@dataclass
class PositionMonitor:
    """持仓监控数据结构"""
    timestamp: str
    symbol: str
    direction: str
    entry_price: float
    current_price: float
    pnl_usdt: float
    pnl_percent: float
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "timestamp": self.timestamp,
            "symbol": self.symbol,
            "direction": self.direction,
            "entry_price": self.entry_price,
            "current_price": self.current_price,
            "pnl_usdt": self.pnl_usdt,
            "pnl_percent": self.pnl_percent
        }


@dataclass
class TradeComplete:
    """交易完成数据结构"""
    timestamp: str
    pnl_usdt: float
    reason: Optional[str] = None
    symbol: Optional[str] = None
    direction: Optional[str] = None
    
    def to_dict(self) -> Dict[str, Any]:
        result = {
            "timestamp": self.timestamp,
            "pnl_usdt": self.pnl_usdt
        }
        if self.reason:
            result["reason"] = self.reason
        if self.symbol:
            result["symbol"] = self.symbol
        if self.direction:
            result["direction"] = self.direction
        return result


@dataclass
class AnalysisResult:
    """分析结果数据结构"""
    timestamp: str
    symbol: str
    passed: bool
    reason: str
    raw_data: Optional[Dict[str, Any]] = None
    
    def to_dict(self) -> Dict[str, Any]:
        result = {
            "timestamp": self.timestamp,
            "symbol": self.symbol,
            "passed": self.passed,
            "reason": self.reason
        }
        if self.raw_data:
            result["raw_data"] = self.raw_data
        return result


@dataclass
class DailySummary:
    """每日汇总数据结构"""
    date: str
    total_trades: int
    total_pnl_usdt: float
    winning_trades: int
    losing_trades: int
    win_rate: float
    avg_win: float
    avg_loss: float
    max_win: float
    max_loss: float
    symbols_traded: List[str]
    trade_signals: List[TradeSignal]
    positions_opened: List[PositionOpen]
    positions_closed: List[TradeComplete]
    analysis_results: List[AnalysisResult]
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "date": self.date,
            "total_trades": self.total_trades,
            "total_pnl_usdt": self.total_pnl_usdt,
            "winning_trades": self.winning_trades,
            "losing_trades": self.losing_trades,
            "win_rate": self.win_rate,
            "avg_win": self.avg_win,
            "avg_loss": self.avg_loss,
            "max_win": self.max_win,
            "max_loss": self.max_loss,
            "symbols_traded": self.symbols_traded,
            "trade_signals": [signal.to_dict() for signal in self.trade_signals],
            "positions_opened": [pos.to_dict() for pos in self.positions_opened],
            "positions_closed": [trade.to_dict() for trade in self.positions_closed],
            "analysis_results": [analysis.to_dict() for analysis in self.analysis_results]
        }


class LogParser:
    """日志解析器"""
    
    # 日志行正则表达式
    LOG_PATTERN = re.compile(r'\[(\d{2}:\d{2}:\d{2})\] \[(\w+)\] \[([^\]]+)\] (.+)')
    
    # JSON数据正则表达式
    JSON_PATTERN = re.compile(r'\|\s*(\{.*\})$')
    
    # 交易信号正则表达式
    SIGNAL_PATTERN = re.compile(r'发现交易信号:\s*(\w+/\w+)\s+(\w+)\s*\|\s*(\{.*\})$')
    
    # 开仓正则表达式
    POSITION_OPEN_PATTERN = re.compile(r'开仓订单已提交\s*\|\s*(\{.*\})$')
    POSITION_COMPLETE_PATTERN = re.compile(r'持仓建立完成\s*\|\s*(\{.*\})$')
    
    # 持仓监控正则表达式
    POSITION_MONITOR_PATTERN = re.compile(
        r'(\w+/\w+)\s+(\w+)\s+入场价:\s*([\d.]+)\s+当前价:\s*([\d.]+)\s+盈亏:\s*([-\d.]+)\s+USDT\s+\(([-\d.]+)%\)'
    )
    
    # 交易完成正则表达式
    TRADE_COMPLETE_PATTERN = re.compile(r'交易完成\]\s+盈亏:\s*([-\d.]+)\s+USDT')
    
    # 交易完成带百分比的正则表达式（旧格式）
    TRADE_COMPLETE_WITH_PERCENT_PATTERN = re.compile(r'交易完成\]\s+盈亏:\s*([-\d.]+)\s+USDT\s+\(([-\d.]+)%\)')
    
    # 分析结果正则表达式
    ANALYSIS_RESULT_PATTERN = re.compile(r'(\w+/\w+)\s+分析(未通过|通过):\s*(.+)')
    
    def __init__(self):
        self.log_entries: List[LogEntry] = []
        self.trade_signals: List[TradeSignal] = []
        self.positions_opened: List[PositionOpen] = []
        self.position_monitors: List[PositionMonitor] = []
        self.trades_completed: List[TradeComplete] = []
        self.analysis_results: List[AnalysisResult] = []
        
    def parse_line(self, line: str) -> Optional[LogEntry]:
        """解析单行日志"""
        line = line.strip()
        if not line:
            return None
            
        # 匹配日志格式
        match = self.LOG_PATTERN.match(line)
        if not match:
            return None
            
        timestamp, level, category, message = match.groups()
        
        # 提取JSON数据
        data = None
        json_match = self.JSON_PATTERN.search(message)
        if json_match:
            json_str = json_match.group(1)
            try:
                data = json.loads(json_str)
                # 清理消息，移除JSON部分
                message = message[:json_match.start()].strip()
            except json.JSONDecodeError:
                # JSON解析失败，保留原始消息
                pass
        
        # 创建日志条目
        entry = LogEntry(
            timestamp=timestamp,
            level=level,
            category=category,
            message=message,
            data=data,
            raw_line=line
        )
        
        # 进一步解析特定类型的日志
        self._parse_specific_logs(entry)
        
        return entry
    
    def _parse_specific_logs(self, entry: LogEntry):
        """解析特定类型的日志"""
        # 解析交易信号
        if entry.category == "信号" and "发现交易信号" in entry.message:
            self._parse_trade_signal(entry)
        
        # 解析开仓
        elif entry.category == "开仓" and "开仓订单已提交" in entry.message:
            self._parse_position_open(entry)
        
        # 解析持仓建立完成
        elif entry.category == "持仓" and "持仓建立完成" in entry.message:
            self._parse_position_complete(entry)
        
        # 解析持仓监控
        elif entry.category == "持仓监控":
            self._parse_position_monitor(entry)
        
        # 解析交易完成
        elif entry.category == "交易完成":
            self._parse_trade_complete(entry)
        
        # 解析分析结果
        elif entry.category == "分析结果":
            self._parse_analysis_result(entry)
    
    def _parse_trade_signal(self, entry: LogEntry):
        """解析交易信号"""
        if not entry.data:
            return
            
        # 从消息中提取交易对和方向
        signal_match = re.search(r'发现交易信号:\s*(\w+/\w+)\s+(\w+)', entry.message)
        if not signal_match:
            return
            
        symbol, direction = signal_match.groups()
        
        # 创建交易信号
        signal = TradeSignal(
            timestamp=entry.timestamp,
            symbol=symbol,
            direction=direction,
            price=entry.data.get("price", 0),
            confidence=entry.data.get("confidence", 0),
            reason=entry.data.get("reason", ""),
            raw_data=entry.data
        )
        self.trade_signals.append(signal)
    
    def _parse_position_open(self, entry: LogEntry):
        """解析开仓订单"""
        if not entry.data:
            return
            
        # 从数据中提取信息
        symbol = entry.data.get("symbol", "").split(":")[0] if ":" in entry.data.get("symbol", "") else ""
        direction = "LONG" if entry.data.get("side") == "BUY" else "SHORT"
        
        # 注意：这里需要后续的"持仓建立完成"日志来获取完整的开仓信息
        # 这里只记录订单提交信息
    
    def _parse_position_complete(self, entry: LogEntry):
        """解析持仓建立完成"""
        if not entry.data:
            return
            
        # 创建开仓记录
        position = PositionOpen(
            timestamp=entry.timestamp,
            symbol=entry.data.get("symbol", ""),
            direction=entry.data.get("direction", ""),
            entry_price=entry.data.get("entryPrice", 0),
            quantity=entry.data.get("quantity", 0),
            leverage=entry.data.get("leverage", 0),
            stop_loss=entry.data.get("stopLoss", 0),
            initial_stop_loss=entry.data.get("initialStopLoss", 0),
            take_profit1=entry.data.get("takeProfit1", 0),
            take_profit2=entry.data.get("takeProfit2", 0),
            order_id=entry.data.get("orderId", ""),
            stop_loss_order_id=entry.data.get("stopLossOrderId", ""),
            raw_data=entry.data
        )
        self.positions_opened.append(position)
    
    def _parse_position_monitor(self, entry: LogEntry):
        """解析持仓监控"""
        # 从消息中提取信息
        monitor_match = self.POSITION_MONITOR_PATTERN.search(entry.message)
        if not monitor_match:
            return
            
        symbol, direction, entry_price, current_price, pnl_usdt, pnl_percent = monitor_match.groups()
        
        # 创建持仓监控记录
        monitor = PositionMonitor(
            timestamp=entry.timestamp,
            symbol=symbol,
            direction=direction,
            entry_price=float(entry_price),
            current_price=float(current_price),
            pnl_usdt=float(pnl_usdt),
            pnl_percent=float(pnl_percent)
        )
        self.position_monitors.append(monitor)
    
    def _parse_trade_complete(self, entry: LogEntry):
        """解析交易完成"""
        # 从消息中提取盈亏 - 尝试两种格式
        trade_match = self.TRADE_COMPLETE_PATTERN.search(entry.message)
        if not trade_match:
            # 尝试带百分比的格式
            trade_match = self.TRADE_COMPLETE_WITH_PERCENT_PATTERN.search(entry.message)
            
        if not trade_match:
            return
            
        pnl_usdt = float(trade_match.group(1))
        
        # 尝试从消息中提取原因和交易对
        reason = None
        symbol = None
        direction = None
        
        # 检查是否有平仓成功的日志在前一行
        if "平仓成功" in entry.message:
            reason = "手动平仓"
        elif "止损触发" in entry.message:
            reason = "止损触发"
        elif "TP2止盈" in entry.message or "止盈" in entry.message:
            reason = "止盈"
        elif "熔断" in entry.message:
            reason = "熔断触发"
        
        # 创建交易完成记录
        trade = TradeComplete(
            timestamp=entry.timestamp,
            pnl_usdt=pnl_usdt,
            reason=reason,
            symbol=symbol,
            direction=direction
        )
        self.trades_completed.append(trade)
    
    def _parse_analysis_result(self, entry: LogEntry):
        """解析分析结果"""
        # 从消息中提取信息
        analysis_match = self.ANALYSIS_RESULT_PATTERN.search(entry.message)
        if not analysis_match:
            return
            
        symbol, result, reason = analysis_match.groups()
        passed = result == "通过"
        
        # 创建分析结果记录
        analysis = AnalysisResult(
            timestamp=entry.timestamp,
            symbol=symbol,
            passed=passed,
            reason=reason,
            raw_data=entry.data
        )
        self.analysis_results.append(analysis)
    
    def parse_file(self, filepath: str) -> List[LogEntry]:
        """解析日志文件"""
        self.log_entries = []
        self.trade_signals = []
        self.positions_opened = []
        self.position_monitors = []
        self.trades_completed = []
        self.analysis_results = []
        
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                for line in f:
                    entry = self.parse_line(line)
                    if entry:
                        self.log_entries.append(entry)
        except Exception as e:
            print(f"解析文件时出错: {e}")
            
        return self.log_entries
    
    def generate_daily_summary(self, date: str) -> DailySummary:
        """生成每日汇总"""
        # 计算交易统计
        total_pnl = sum(trade.pnl_usdt for trade in self.trades_completed)
        winning_trades = [t for t in self.trades_completed if t.pnl_usdt > 0]
        losing_trades = [t for t in self.trades_completed if t.pnl_usdt <= 0]
        
        total_trades = len(self.trades_completed)
        winning_count = len(winning_trades)
        losing_count = len(losing_trades)
        
        win_rate = winning_count / total_trades if total_trades > 0 else 0.0
        avg_win = sum(t.pnl_usdt for t in winning_trades) / winning_count if winning_count > 0 else 0.0
        avg_loss = sum(t.pnl_usdt for t in losing_trades) / losing_count if losing_count > 0 else 0.0
        
        max_win = max((t.pnl_usdt for t in winning_trades), default=0.0)
        max_loss = min((t.pnl_usdt for t in losing_trades), default=0.0)
        
        # 获取交易过的交易对
        symbols_traded = list(set(
            pos.symbol for pos in self.positions_opened
        ))
        
        # 创建每日汇总
        summary = DailySummary(
            date=date,
            total_trades=total_trades,
            total_pnl_usdt=total_pnl,
            winning_trades=winning_count,
            losing_trades=losing_count,
            win_rate=win_rate,
            avg_win=avg_win,
            avg_loss=avg_loss,
            max_win=max_win,
            max_loss=max_loss,
            symbols_traded=symbols_traded,
            trade_signals=self.trade_signals,
            positions_opened=self.positions_opened,
            positions_closed=self.trades_completed,
            analysis_results=self.analysis_results
        )
        
        return summary
