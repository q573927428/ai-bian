# 日志分析脚本

这个目录包含了Binance Futures Bot的日志分析脚本。

## 文件说明

- `log_analyzer.py` - 日志解析器核心模块，定义了日志解析的类和方法
- `process_logs.py` - 日志处理主程序，提供命令行接口

## 使用方法

### 从scripts目录运行

```bash
# 进入scripts目录
cd scripts

# 处理单个日志文件
python process_logs.py ../logs/2026-03-01.log

# 处理整个日志目录
python process_logs.py ../logs

# 指定输出目录
python process_logs.py ../logs -o ../logs/fenxi
```

### 从项目根目录运行

```bash
# 使用相对路径
python scripts/process_logs.py logs/2026-03-01.log

# 或者先进入scripts目录
cd scripts && python process_logs.py ../logs/2026-03-01.log
```

## 命令行参数

```
usage: process_logs.py [-h] [-o OUTPUT] [-v] input

Binance Futures Bot 日志预处理器

positional arguments:
  input                 日志文件或目录路径

optional arguments:
  -h, --help           显示帮助信息
  -o OUTPUT, --output OUTPUT
                        输出目录路径（可选）
  -v, --verbose        详细输出模式
```

## 输出文件

脚本会生成以下文件：

1. `{date}_structured.json` - 完整的结构化日志数据
2. `{date}_stats.json` - 简化的统计信息
3. `logs_processing_summary.json` - 批量处理汇总报告（当处理目录时）

## 注意事项

- 脚本使用Python 3编写，确保已安装Python 3.6或更高版本
- 脚本会自动处理相对路径和绝对路径
- 输出目录如果不存在会自动创建