#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Binance Futures Bot 日志处理主程序
处理每日日志文件并生成结构化JSON输出
"""

import os
import sys
import json
import argparse
from datetime import datetime
from pathlib import Path

# 添加当前目录到Python路径，确保可以导入log_analyzer
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from log_analyzer import LogParser


def process_single_log_file(log_file: str, output_dir: str = None) -> dict:
    """
    处理单个日志文件
    
    Args:
        log_file: 日志文件路径
        output_dir: 输出目录，如果为None则输出到日志文件同目录
    
    Returns:
        处理结果的字典
    """
    print(f"正在处理日志文件: {log_file}")
    
    # 检查文件是否存在
    if not os.path.exists(log_file):
        print(f"错误: 文件不存在 - {log_file}")
        return {"error": "文件不存在"}
    
    # 从文件名提取日期
    filename = os.path.basename(log_file)
    date_str = filename.replace(".log", "")
    
    # 创建解析器
    parser = LogParser()
    
    # 解析日志文件
    log_entries = parser.parse_file(log_file)
    
    print(f"解析完成: 共 {len(log_entries)} 条日志记录")
    print(f"交易信号: {len(parser.trade_signals)} 个")
    print(f"开仓记录: {len(parser.positions_opened)} 个")
    print(f"交易完成: {len(parser.trades_completed)} 个")
    print(f"分析结果: {len(parser.analysis_results)} 个")
    
    # 生成每日汇总
    summary = parser.generate_daily_summary(date_str)
    
    # 准备输出数据
    output_data = {
        "metadata": {
            "log_file": log_file,
            "date": date_str,
            "processed_at": datetime.now().isoformat(),
            "total_log_entries": len(log_entries),
            "total_trade_signals": len(parser.trade_signals),
            "total_positions_opened": len(parser.positions_opened),
            "total_trades_completed": len(parser.trades_completed),
            "total_analysis_results": len(parser.analysis_results)
        },
        "daily_summary": summary.to_dict(),
        "detailed_data": {
            "log_entries": [entry.to_dict() for entry in log_entries],
            "trade_signals": [signal.to_dict() for signal in parser.trade_signals],
            "positions_opened": [pos.to_dict() for pos in parser.positions_opened],
            "position_monitors": [monitor.to_dict() for monitor in parser.position_monitors],
            "trades_completed": [trade.to_dict() for trade in parser.trades_completed],
            "analysis_results": [analysis.to_dict() for analysis in parser.analysis_results]
        }
    }
    
    # 确定输出目录
    if output_dir is None:
        output_dir = os.path.dirname(log_file)
    
    # 确保输出目录存在
    os.makedirs(output_dir, exist_ok=True)
    
    # 生成输出文件名
    output_file = os.path.join(output_dir, f"{date_str}_structured.json")
    
    # 保存JSON文件
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(output_data, f, ensure_ascii=False, indent=2)
    
    print(f"结构化数据已保存到: {output_file}")
    
    # 同时保存一个简化的统计文件
    stats_file = os.path.join(output_dir, f"{date_str}_stats.json")
    stats_data = {
        "date": date_str,
        "total_trades": summary.total_trades,
        "total_pnl_usdt": summary.total_pnl_usdt,
        "winning_trades": summary.winning_trades,
        "losing_trades": summary.losing_trades,
        "win_rate": summary.win_rate,
        "avg_win": summary.avg_win,
        "avg_loss": summary.avg_loss,
        "max_win": summary.max_win,
        "max_loss": summary.max_loss,
        "symbols_traded": summary.symbols_traded
    }
    
    with open(stats_file, 'w', encoding='utf-8') as f:
        json.dump(stats_data, f, ensure_ascii=False, indent=2)
    
    print(f"统计信息已保存到: {stats_file}")
    
    return {
        "success": True,
        "log_file": log_file,
        "output_file": output_file,
        "stats_file": stats_file,
        "summary": {
            "total_log_entries": len(log_entries),
            "total_trades": summary.total_trades,
            "total_pnl": summary.total_pnl_usdt,
            "win_rate": summary.win_rate
        }
    }


def process_logs_directory(logs_dir: str, output_dir: str = None) -> list:
    """
    处理日志目录中的所有日志文件
    
    Args:
        logs_dir: 日志目录路径
        output_dir: 输出目录
    
    Returns:
        处理结果列表
    """
    print(f"正在处理日志目录: {logs_dir}")
    
    # 检查目录是否存在
    if not os.path.exists(logs_dir):
        print(f"错误: 目录不存在 - {logs_dir}")
        return []
    
    # 查找所有.log文件
    log_files = []
    for file in os.listdir(logs_dir):
        if file.endswith(".log"):
            log_files.append(os.path.join(logs_dir, file))
    
    print(f"找到 {len(log_files)} 个日志文件")
    
    # 处理每个日志文件
    results = []
    for log_file in sorted(log_files):
        try:
            result = process_single_log_file(log_file, output_dir)
            results.append(result)
        except Exception as e:
            print(f"处理文件 {log_file} 时出错: {e}")
            results.append({
                "error": str(e),
                "log_file": log_file
            })
    
    # 生成汇总报告
    if results:
        generate_summary_report(results, output_dir or logs_dir)
    
    return results


def generate_summary_report(results: list, output_dir: str):
    """
    生成处理结果汇总报告
    
    Args:
        results: 处理结果列表
        output_dir: 输出目录
    """
    successful_results = [r for r in results if r.get("success", False)]
    
    if not successful_results:
        print("没有成功处理任何日志文件")
        return
    
    # 汇总统计
    total_trades = sum(r["summary"]["total_trades"] for r in successful_results)
    total_pnl = sum(r["summary"]["total_pnl"] for r in successful_results)
    total_logs = sum(r["summary"]["total_log_entries"] for r in successful_results)
    
    # 生成汇总报告
    summary_report = {
        "generated_at": datetime.now().isoformat(),
        "total_files_processed": len(results),
        "successful_files": len(successful_results),
        "failed_files": len(results) - len(successful_results),
        "overall_statistics": {
            "total_trades": total_trades,
            "total_pnl_usdt": total_pnl,
            "total_log_entries": total_logs,
            "avg_pnl_per_trade": total_pnl / total_trades if total_trades > 0 else 0
        },
        "file_results": [
            {
                "log_file": r.get("log_file", ""),
                "success": r.get("success", False),
                "summary": r.get("summary", {})
            }
            for r in results
        ]
    }
    
    # 保存汇总报告
    report_file = os.path.join(output_dir, "logs_processing_summary.json")
    with open(report_file, 'w', encoding='utf-8') as f:
        json.dump(summary_report, f, ensure_ascii=False, indent=2)
    
    print(f"处理汇总报告已保存到: {report_file}")
    
    # 打印简要统计
    print("\n" + "="*50)
    print("处理汇总:")
    print(f"  处理文件总数: {len(results)}")
    print(f"  成功处理: {len(successful_results)}")
    print(f"  失败处理: {len(results) - len(successful_results)}")
    print(f"  总交易次数: {total_trades}")
    print(f"  总盈亏: {total_pnl:.2f} USDT")
    print(f"  平均每笔交易盈亏: {total_pnl/total_trades if total_trades > 0 else 0:.2f} USDT")
    print("="*50)


def main():
    """主函数"""
    parser = argparse.ArgumentParser(description='Binance Futures Bot 日志预处理器')
    parser.add_argument('input', help='日志文件或目录路径')
    parser.add_argument('-o', '--output', help='输出目录路径（可选）')
    parser.add_argument('-v', '--verbose', action='store_true', help='详细输出模式')
    
    args = parser.parse_args()
    
    # 设置详细模式
    if args.verbose:
        print("详细模式已启用")
    
    # 检查输入路径
    input_path = args.input
    
    if os.path.isfile(input_path):
        # 处理单个文件
        result = process_single_log_file(input_path, args.output)
        
        if result.get("success", False):
            print(f"\n处理成功!")
            print(f"  日志文件: {result['log_file']}")
            print(f"  输出文件: {result['output_file']}")
            print(f"  统计文件: {result['stats_file']}")
            print(f"  总日志条目: {result['summary']['total_log_entries']}")
            print(f"  总交易次数: {result['summary']['total_trades']}")
            print(f"  总盈亏: {result['summary']['total_pnl']:.2f} USDT")
        else:
            print(f"\n处理失败: {result.get('error', '未知错误')}")
            
    elif os.path.isdir(input_path):
        # 处理目录
        results = process_logs_directory(input_path, args.output)
        
        if results:
            successful = sum(1 for r in results if r.get("success", False))
            print(f"\n目录处理完成!")
            print(f"  总文件数: {len(results)}")
            print(f"  成功处理: {successful}")
            print(f"  失败处理: {len(results) - successful}")
        else:
            print("\n目录处理完成，但未找到任何日志文件")
    else:
        print(f"错误: 路径不存在 - {input_path}")
        sys.exit(1)


if __name__ == "__main__":
    main()