# 全局偏好

- 默认使用简体中文回复用户。
- 代码、命令、配置键、文件路径和专有名词保持原文，必要时附中文解释。

# Windows / PowerShell 编码约束

- 在 Windows PowerShell 5.1 中读取包含中文的源码时，使用 `Get-Content -Encoding UTF8`，不要直接使用无编码参数的 `Get-Content`。
- 写入包含中文的文本文件时，优先使用 `apply_patch`。如必须使用 PowerShell 写文件，必须显式指定 UTF-8 编码。
- 不要因为终端显示乱码就判断源码文件已乱码；先用 `git diff`、编辑器或 `Get-Content -Encoding UTF8` 验证。
- 避免使用未指定编码的 `Set-Content`、`Out-File`、`>`、`>>` 重写源码文件。
