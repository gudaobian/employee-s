---
description: 创建新的自定义slash命令
argument-hint: <命令名> <命令描述> [选项]
allowed-tools: Read, Write, WebFetch
---

你需要创建一个新的slash命令。

## 输入参数

- $1 = 命令名称 (必填)
- $2 = 命令描述 (必填)
- $3+ = 可选配置，格式: key=value

## 可选配置说明

可以从第3个参数开始添加这些配置:

- allowed-tools=工具列表 (不指定则所有工具可用)
- argument-hint=参数提示
- think=true (启用深度思考)

## 执行任务

**第1步**: 检查参数

确认 $1 和 $2 都已提供，否则返回错误。

**第2步**: 查阅文档

访问 https://docs.claude.com/en/docs/claude-code/slash-commands.md 了解命令创建规范。

关键规范:
- 位置: .claude/commands/ 目录
- 格式: Markdown文件
- Frontmatter: YAML格式
- 变量: $ARGUMENTS 或 $1 $2 等

**第3步**: 解析配置

将 $3 及之后的参数解析为frontmatter配置项。

示例: allowed-tools=Bash,Read 转换为 frontmatter 中的 allowed-tools: Bash,Read

**第4步**: 生成文件内容

构建包含以下部分的Markdown:
- YAML frontmatter (description + 其他配置)
- 命令实现说明

**第5步**: 写入文件

使用 Write 工具创建文件: .claude/commands/$1.md

**第6步**: 验证

使用 Read 工具读取并验证文件格式正确。

## 模板示例

基础模板:
```
---
description: 说明文字
---
命令内容
```

带工具限制:
```
---
description: 说明文字
allowed-tools: Read,Grep
---
命令内容
```

现在执行创建任务。
