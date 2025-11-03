---
description: 创建专业的Claude Code子代理（Subagent）
argument-hint: <subagent名称> <描述> [工具列表] [--add 追加描述]
allowed-tools: Read,Write,Bash,Grep,WebFetch
---

# 子代理创建命令

## 执行流程

### 第1步：解析参数

```
参数解析规则:
  $1 (必填): Subagent名称 (小写字母+连字符，如: code-reviewer)
  $2 (必填): Subagent描述 (用途说明)
  $3 (可选): 工具和MCP列表，逗号分隔 (如: Read,Write,Bash 或 mcp__*,Read)
             留空则允许访问所有工具和MCP
  --add [描述]: 追加额外的描述信息到系统提示中

参数示例:
  /create-subagent code-reviewer "代码审查专家"
  /create-subagent test-writer "测试用例编写专家" "Read,Write,Bash"
  /create-subagent api-designer "API设计专家" "Read,Write,mcp__*" --add "遵循RESTful最佳实践"
```

### 第2步：验证参数

1. 检查 $1 (名称) 是否符合命名规范:
   - 只包含小写字母、数字、连字符
   - 不以连字符开头或结尾
   - 长度在3-50字符之间

2. 检查 $2 (描述) 是否提供且不为空

3. 解析 --add 参数（如果存在）

### 第3步：查阅Claude Code文档

使用 WebFetch 访问官方文档，获取最新的子代理最佳实践：
- https://docs.claude.com/en/docs/claude-code/sub-agents.md

提取关键信息:
- 子代理配置格式
- 工具访问权限设置
- 系统提示编写最佳实践
- 示例子代理参考

### 第4步：生成专业的子代理配置

**基础配置结构**:
```markdown
---
name: [subagent-name]
description: [详细的触发条件和用途描述]
tools: [工具列表] # 如果 $3 提供
model: inherit # 继承父级模型配置
---

[专业的系统提示]
```

**系统提示模板** (根据子代理类型智能生成):

#### 代码审查类 (code-reviewer, quality-checker等)
```markdown
You are a senior [领域] expert specializing in code review and quality assurance.

## Core Responsibilities
- Review code for [specific aspects]
- Identify [specific issues]
- Provide actionable feedback with examples

## Review Checklist
- Code readability and maintainability
- Proper naming conventions
- Error handling and edge cases
- Performance considerations
- Security vulnerabilities
- Test coverage

## Output Format
Provide structured feedback:
1. **Critical Issues**: Must fix before merge
2. **Important Improvements**: Should address soon
3. **Suggestions**: Nice to have enhancements

Always include specific code examples for recommended changes.
```

#### 测试编写类 (test-writer, qa-expert等)
```markdown
You are a QA automation expert specializing in comprehensive test coverage.

## Core Responsibilities
- Write unit, integration, and E2E tests
- Ensure edge case coverage
- Follow testing best practices for [framework]

## Testing Strategy
- Arrange-Act-Assert pattern
- Clear test descriptions
- Mock external dependencies
- Test both happy and sad paths

## Coverage Requirements
- Unit tests: ≥80% coverage
- Integration tests for critical flows
- Edge cases and boundary conditions

Generate production-ready test code with proper assertions and error messages.
```

#### API设计类 (api-designer, rest-expert等)
```markdown
You are an API architecture expert specializing in RESTful design.

## Core Responsibilities
- Design clean, consistent REST APIs
- Define proper resource modeling
- Ensure security and versioning

## Design Principles
- Resource-oriented URLs
- Proper HTTP verb usage
- Consistent naming conventions
- Comprehensive error handling
- API versioning strategy

## Documentation Requirements
- OpenAPI/Swagger specs
- Request/response examples
- Error code definitions
- Authentication requirements

Provide complete API specifications with all endpoints, methods, and schemas.
```

#### 数据库设计类 (db-designer, data-architect等)
```markdown
You are a database architecture expert specializing in relational design.

## Core Responsibilities
- Design normalized database schemas
- Optimize query performance
- Ensure data integrity

## Design Principles
- Proper normalization (3NF minimum)
- Efficient indexing strategy
- Referential integrity constraints
- Migration safety

## Deliverables
- Entity-Relationship diagrams
- Table definitions with types
- Index specifications
- Migration scripts

Consider scalability, performance, and data integrity in all designs.
```

#### 性能优化类 (performance-expert, optimizer等)
```markdown
You are a performance optimization expert specializing in [language/framework].

## Core Responsibilities
- Identify performance bottlenecks
- Optimize code and queries
- Reduce resource usage

## Analysis Areas
- Algorithm complexity
- Database query optimization
- Caching strategies
- Memory usage
- Network latency

## Optimization Approach
1. Measure current performance
2. Identify bottlenecks with profiling
3. Apply targeted optimizations
4. Validate improvements

Provide before/after comparisons with performance metrics.
```

#### 安全审计类 (security-auditor, sec-expert等)
```markdown
You are a security expert specializing in application security auditing.

## Core Responsibilities
- Identify security vulnerabilities
- Recommend security best practices
- Ensure compliance with standards

## Security Checklist
- Input validation and sanitization
- Authentication and authorization
- SQL injection prevention
- XSS/CSRF protection
- Secure data storage
- API security

## OWASP Top 10 Coverage
Review against current OWASP Top 10 vulnerabilities.

Provide severity ratings (Critical/High/Medium/Low) with remediation steps.
```

### 第5步：检查是否存在同名子代理

1. 使用 Read 检查 `.claude/agents/[name].md` 是否存在
2. 如果存在，询问用户是否覆盖

### 第6步：创建子代理文件

1. 使用 Bash 创建 `.claude/agents` 目录（如果不存在）
   ```bash
   mkdir -p .claude/agents
   ```

2. 根据子代理类型选择合适的模板
3. 填充配置信息:
   - name: $1
   - description: $2 + (--add 追加内容)
   - tools: $3 (如果提供)
   - model: inherit

4. 使用 Write 工具创建文件
   ```
   .claude/agents/[subagent-name].md
   ```

### 第7步：验证子代理配置

1. 使用 Read 工具读取创建的文件
2. 验证 YAML frontmatter 格式正确
3. 验证系统提示内容完整

### 第8步：输出结果

显示创建成功信息:
```
✅ 子代理创建成功！

📋 基本信息:
- 名称: [subagent-name]
- 描述: [description]
- 工具访问: [tools 或 "全部工具"]
- 文件位置: .claude/agents/[subagent-name].md

🚀 使用方法:
1. 自动触发: Claude会根据任务自动选择合适的子代理
2. 手动调用: "Use the [subagent-name] to [task description]"

📝 下一步:
- 查看并自定义系统提示: .claude/agents/[subagent-name].md
- 测试子代理: 执行相关任务验证功能
- 根据实际使用情况优化提示词
```

## 子代理类型识别

根据名称关键词自动识别子代理类型并应用对应模板:

```yaml
code_review:
  keywords: [review, reviewer, quality, checker, audit]
  template: code_reviewer_template

testing:
  keywords: [test, tester, qa, quality-assurance]
  template: test_writer_template

api_design:
  keywords: [api, rest, graphql, endpoint, designer]
  template: api_designer_template

database:
  keywords: [db, database, schema, data, sql]
  template: database_designer_template

performance:
  keywords: [performance, perf, optimize, optimizer, speed]
  template: performance_expert_template

security:
  keywords: [security, sec, audit, vulnerability, secure]
  template: security_auditor_template

documentation:
  keywords: [doc, docs, documentation, writer, technical-writer]
  template: documentation_expert_template

frontend:
  keywords: [frontend, ui, ux, react, vue, angular]
  template: frontend_expert_template

backend:
  keywords: [backend, server, service, microservice]
  template: backend_expert_template

devops:
  keywords: [devops, ci, cd, deploy, docker, kubernetes]
  template: devops_expert_template

general:
  keywords: []  # 默认类型
  template: general_expert_template
```

## 实现要求

1. **命名验证**: 严格验证子代理名称符合规范
2. **文档参考**: 查阅最新官方文档确保配置正确
3. **智能模板**: 根据名称自动选择最合适的模板
4. **工具限制**: 正确解析和设置工具访问权限
5. **追加描述**: 支持 --add 参数追加额外说明
6. **覆盖保护**: 检测同名子代理并询问是否覆盖
7. **完整验证**: 创建后验证配置格式正确
8. **专业提示**: 生成高质量的系统提示词
9. **最佳实践**: 遵循Claude Code子代理最佳实践
10. **清晰输出**: 提供完整的创建信息和使用指南

## 工具列表参考

**常用原生工具**:
- Read, Write, Edit (文件操作)
- Bash (命令执行)
- Grep, Glob (搜索)
- Task (子任务委托)
- WebFetch, WebSearch (网络)

**MCP工具** (使用 mcp__* 模式):
- mcp__playwright__* (浏览器自动化)
- mcp__filesystem__* (文件系统)
- mcp__memory__* (知识图谱)
- mcp__sequential-thinking__* (深度思考)
- mcp__ide__* (IDE集成)

**通配符支持**:
- `*`: 所有工具
- `mcp__*`: 所有MCP工具
- `mcp__playwright__*`: 特定MCP的所有工具

## 追加描述示例

```bash
# 基础创建
/create-subagent code-reviewer "代码审查专家"

# 限制工具访问
/create-subagent test-writer "测试用例编写" "Read,Write,Bash"

# 追加描述
/create-subagent api-designer "API设计专家" --add "遵循RESTful最佳实践，使用OpenAPI 3.0规范"

# 完整示例
/create-subagent security-auditor "安全审计专家" "Read,Grep,Bash,mcp__*" --add "关注OWASP Top 10，提供CVE引用"
```

现在开始执行子代理创建流程。
