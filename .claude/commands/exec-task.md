---
description: Execute task from split-task document using specialized subagent with integrated testing and status tracking
argument-hint: <任务描述或文档路径> [-d <文档路径>] [subagent名称]
---

# 任务执行命令 - exec-task

执行任务开发，可以直接提供任务描述，或通过 `-d` 选项指定 `/split-task` 生成的任务文档。使用指定的专业 subagent 完成功能开发，并集成自动化测试和状态追踪。

## ⚠️ 执行者注意事项（关键）

**本命令的核心目的是委托给专业 subagent 执行任务，而不是直接执行任务！**

执行本命令时，必须严格遵循以下原则：
1. ✅ **必须使用 Task 工具调用指定的 subagent**
2. ❌ **禁止直接执行任务，跳过 subagent 调用**
3. ✅ **等待 subagent 返回结果后再继续后续步骤**
4. ✅ **按照流程逐步执行，不可跳过任何步骤**

如果你发现自己在直接修改代码或分析问题，而没有先调用 Task 工具，说明流程错误，请立即停止并重新开始。

## 参数说明

### 基础参数
- **$1**: 任务描述或文档路径 (必填)
  - **默认**: 视为任务描述语句，直接执行任务
  - **文档路径**: 如果参数是已存在的文件路径，则作为任务文档处理

- **-d <路径>**: 任务文档路径 (可选)
  - 明确指定使用任务文档模式
  - 当使用此选项时，$1 参数将被忽略

- **最后一个参数**: Subagent 名称 (可选)
  - 用于执行任务的专业子代理名称
  - **默认值**: `client-programmer`（如果不提供则自动使用）
  - 可用的 subagent: client-programmer, frontend-programmer, backend-programmer, test-writer, code-reviewer 等

### 参数模式

**模式 1: 任务描述模式 (默认)**
```bash
# 使用默认 subagent (client-programmer)
/exec-task "实现用户认证功能"
/exec-task "添加文件上传接口"

# 指定特定 subagent
/exec-task "实现用户认证功能" client-programmer
/exec-task "编写测试用例" test-writer
```
直接执行任务描述，不依赖任务文档。

**模式 2: 文档路径模式 (使用 -d)**
```bash
# 使用默认 subagent
/exec-task -d tasks/feature-auth.md

# 指定特定 subagent
/exec-task -d tasks/feature-auth.md frontend-programmer
/exec-task -d tasks/feature-upload.md test-writer
```
从指定的任务文档读取详细任务信息和状态。

**模式 3: 自动检测模式 (兼容旧版)**
```bash
# 使用默认 subagent
/exec-task tasks/feature-auth.md

# 指定特定 subagent
/exec-task tasks/feature-auth.md frontend-programmer
```
如果第一个参数是已存在的文件，自动切换到文档模式。

## 执行流程

### 第1步: 解析和验证参数

```
参数解析规则:
1. 检查是否包含 -d 选项:
   - 有 -d: 文档模式
     * 文档路径 = -d 后的参数
     * subagent = 最后一个参数（如果提供），否则默认 "client-programmer"
   - 无 -d: 检查 $1 是否为已存在文件
     * 是文件: 文档模式，$1=文档路径, $2=subagent（如果提供），否则默认
     * 非文件: 任务描述模式，$1=任务描述, $2=subagent（如果提供），否则默认

2. Subagent 默认值处理:
   - 如果未提供 subagent 参数，自动设置为 "client-programmer"
   - 如果提供了 subagent 参数，使用用户指定的值

3. 文档模式额外验证:
   - 验证任务文档文件是否存在
   - 解析任务文档内容

4. 任务描述模式额外验证:
   - 验证任务描述不为空
   - 任务描述长度 > 5 字符

5. 通用验证:
   - 验证 subagent 是否存在于 .claude/agents/[name].md
   - 如果不存在，返回错误并列出可用的 subagent
```

如果任何验证失败，返回明确的错误信息并停止执行。

### 第2步: 准备任务信息

根据执行模式准备任务信息:

#### **文档模式**

使用 Read 工具读取任务文档，解析以下信息:

```yaml
必要信息:
  - 任务列表及其状态 (未开始/进行中/已完成/已测试)
  - 任务优先级和依赖关系
  - 功能需求和验收标准
  - 相关文件路径和模块信息

状态标识格式:
  - [ ] 未开始
  - [>] 进行中
  - [x] 已完成
  - [✓] 已测试
```

#### **任务描述模式**

直接使用提供的任务描述作为任务信息:

```yaml
任务信息:
  - 任务描述: 用户提供的任务描述语句
  - 状态: 默认为 "未开始"
  - 优先级: 默认为 "中"
  - 依赖关系: 无
  - 验收标准: 根据任务描述推断

任务分解建议:
  - 如果任务描述复杂，建议先使用 /split-task 生成详细文档
  - 简单任务可以直接执行
```

### 第3步: 检查测试用例文档

根据执行模式处理测试用例:

#### **文档模式**

```
测试用例查找规则:
1. 检查是否存在对应的测试文档:
   - 任务文档: /path/to/task.md
   - 测试文档: /path/to/task-test.md (或同名目录下 tests/ 子目录)

2. 如果测试文档不存在:
   - 提示: "未找到测试用例文档，建议先运行 /analyse-task-test -d <文档路径>"
   - 询问用户是否继续 (可选: 自动调用 /analyse-task-test)
```

#### **任务描述模式**

```
测试策略:
1. 不依赖预先生成的测试文档
2. 在实现完成后，根据任务内容执行适当的测试:
   - 编译检查: mvn compile
   - 单元测试: mvn test (如果有相关测试)
   - 手动验证: 提示用户验证功能
3. 可选: 建议用户后续使用 /analyse-task-test 生成完整测试用例
```

### 第4步: 创建 TodoWrite 追踪计划

根据任务文档内容创建结构化的 Todo 追踪:

```markdown
TodoWrite 结构:
1. [任务名称] - 实现功能
   - Status: pending/in_progress/completed

2. [任务名称] - 运行测试
   - Status: pending

3. [任务名称] - 更新文档状态
   - Status: pending

重复以上结构覆盖所有待执行任务
```

### 第5步: 调用 Subagent 执行任务 ⚠️ **【核心步骤 - 必须执行】**

**❗ 重要：这是本命令的核心步骤，必须严格执行，不可跳过！**

使用 Task 工具调用指定的 subagent 执行功能实现:

```
Task 调用参数:
  - subagent_type: $2 (用户指定的 subagent 名称)
  - description: 简短任务描述 (从任务文档提取或用户提供的任务描述)
  - prompt: 详细任务说明，必须包含:
    * 完整的功能需求
    * 技术规范和约束
    * 验收标准
    * 相关文件路径（如果已知）
    * 设计考虑 (可扩展性、松耦合、高内聚)
    * 明确指示: "完成实现后返回实现摘要和修改的文件列表"

执行检查:
  ✅ 必须实际调用 Task 工具
  ✅ 必须等待 subagent 返回结果
  ✅ 必须处理 subagent 返回的结果
  ❌ 禁止跳过此步骤直接修改代码
  ❌ 禁止自己分析和实现，而不调用 subagent
```

**Task 工具调用模板**:
使用 Task 工具时，参数格式如下：
- subagent_type: 指定的 subagent 名称
- description: 任务简短描述（5-10个字）
- prompt: 详细的任务说明文档

### 第6步: 更新 TodoWrite - 功能完成

功能实现完成后:
1. 标记 "[任务名称] - 实现功能" 为 completed
2. 标记 "[任务名称] - 运行测试" 为 in_progress

### 第7步: 执行测试用例

如果测试文档存在:

```
测试执行流程:
1. 读取测试用例文档获取:
   - 单元测试列表
   - 集成测试场景
   - 测试命令 (如: mvn test, npm test)

2. 执行测试:
   - 使用 Bash 工具运行测试命令
   - 捕获测试输出和结果

3. 分析测试结果:
   - 成功: 所有测试通过
   - 失败: 识别失败的测试用例
   - 错误: 测试执行出错

4. 测试失败处理:
   - 分析失败原因
   - 再次调用 subagent 修复问题
   - 重新运行测试 (最多3次重试)
```

### 第8步: 更新任务状态

根据执行模式更新任务状态:

#### **文档模式**

测试通过后，更新任务文档的状态标识:

```
状态更新规则:
- 测试通过: [x] → [✓] (从已完成更新为已测试)
- 测试失败: [>] 保持进行中，添加失败原因注释
- 更新时间戳和完成者信息
```

使用 Edit 工具精确更新任务文档中的状态行。

#### **任务描述模式**

记录任务完成状态:

```
状态记录:
- 在 TodoWrite 中标记任务为 completed
- 可选: 生成执行日志到 claudedocs/ 目录
- 可选: 建议用户使用 /split-task 创建正式文档以便追踪
```

### 第9步: 更新 TodoWrite - 全部完成

所有步骤完成后:
1. 标记 "[任务名称] - 运行测试" 为 completed
2. 标记 "[任务名称] - 更新文档状态" 为 completed

### 第10步: 输出执行摘要

生成结构化的执行报告:

```markdown
✅ 任务执行完成: [任务名称]

📋 功能实现:
- Subagent: $2
- 修改文件: [文件列表]
- 实现摘要: [简要说明]

🧪 测试结果:
- 测试用例数: X
- 通过: X
- 失败: X
- 测试命令: [命令]
- 执行时间: [时长]

📝 文档更新:
- 任务状态: [✓] 已测试
- 更新位置: $1

🔄 下一步:
- [如果还有未完成任务，列出下一个任务]
- [或] 所有任务已完成，可以执行代码审查
```

## 高级特性

### 并行执行支持

如果任务文档中标识了可并行执行的任务:
```
支持特性:
- 识别无依赖关系的任务
- 使用多个 Task 工具调用并行执行
- 分别追踪每个任务的进度
- 合并测试结果和状态更新
```

### 失败恢复机制

```
自动恢复策略:
1. 测试失败: 最多3次重试，每次重试前调用 subagent 分析和修复
2. 实现卡住: 超过10分钟无响应则提示用户介入
3. 依赖缺失: 自动安装依赖后重试 (如: Maven 依赖)
```

### 状态持久化

```
会话恢复:
- 使用 mcp__memory 存储执行状态
- 支持中断后恢复执行
- 记录关键决策和问题解决过程
```

## 使用示例

### 模式 1: 任务描述模式 (快速开发)

```bash
# 使用默认 subagent (client-programmer)
/exec-task "添加用户登录API"
/exec-task "实现周报导出为PDF功能，支持自定义模板"
/exec-task "修复文件上传时的内存溢出问题"

# 指定特定 subagent
/exec-task "编写用户登录测试用例" test-writer
/exec-task "审查认证模块代码" code-reviewer
```

**适用场景**:
- 快速功能开发
- 简单的代码修改
- Bug修复
- 不需要详细任务追踪的场景

### 模式 2: 文档模式 (结构化开发)

```bash
# 使用默认 subagent
/exec-task -d tasks/feature-user-auth.md

# 使用 -d 选项明确指定文档和 subagent
/exec-task -d tasks/feature-user-auth.md client-programmer
/exec-task -d tasks/test-suite.md test-writer

# 或使用自动检测 (兼容旧版)
/exec-task tasks/feature-user-auth.md
/exec-task tasks/feature-user-auth.md client-programmer
```

**适用场景**:
- 复杂功能需要详细规划
- 多人协作需要状态追踪
- 需要测试用例覆盖
- 长期项目需要历史记录

### 完整工作流示例

#### 工作流 1: 快速迭代 (任务描述模式)
```bash
# 直接开发（使用默认 subagent）
/exec-task "实现用户注册功能"

# 后续如果需要完善，可以生成文档
/split-task feature-user-register.md "实现用户注册功能"
/analyse-task-test -d tasks/feature-user-register.md
```

#### 工作流 2: 正式开发 (文档模式)
```bash
# 1. 拆分任务
/split-task feature-user-auth.md "实现用户认证功能"

# 2. 生成测试用例
/analyse-task-test -d tasks/feature-user-auth.md

# 3. 执行任务（使用默认 subagent）
/exec-task -d tasks/feature-user-auth.md

# 4. 如果有多个任务文档，继续执行下一个
/exec-task -d tasks/feature-user-profile.md
```

#### 工作流 3: 混合模式
```bash
# 快速原型（默认 subagent）
/exec-task "实现基础的用户登录"

# 发现需要更复杂的功能，切换到文档模式
/split-task feature-auth-complete.md "完整的用户认证系统，包括登录、注册、密码重置"
/exec-task -d tasks/feature-auth-complete.md

# 如果需要不同的 subagent
/exec-task -d tasks/feature-auth-tests.md test-writer
```

## 注意事项

1. **Subagent 选择**: 根据任务类型选择合适的 subagent
   - client-programmer: 跨平台客户端开发 (Electron/Windows/macOS)（默认）
   - frontend-programmer: Vue/React 前端开发
   - backend-programmer: Java/Spring Boot 后端开发
   - test-writer: 测试用例编写
   - code-reviewer: 代码审查

2. **测试策略**: 确保测试用例覆盖
   - 单元测试: Service 层业务逻辑
   - 集成测试: Repository 层数据访问
   - API 测试: Controller 层接口

3. **状态追踪**: 任务文档是唯一的真实来源
   - 及时更新状态避免重复工作
   - 记录问题和决策便于后续参考

4. **错误处理**: 测试失败不要跳过
   - 分析根本原因
   - 修复后验证
   - 更新测试用例 (如果需要)

## 集成工具

本命令会自动集成以下工具:
- **Task**: 调用 subagent 执行开发任务
- **TodoWrite**: 追踪任务进度
- **Read/Edit**: 读取和更新任务文档 (文档模式)
- **Bash**: 执行测试命令
- **mcp__memory** (可选): 持久化执行状态

## 参数解析优先级

```
解析优先级:
1. 检测 -d 选项 → 文档模式
2. 检测第一个参数是否为文件 → 自动检测模式
3. 默认 → 任务描述模式

Subagent 解析:
1. 检查最后一个参数是否为有效的 subagent 名称
2. 如果是有效 subagent → 使用该 subagent
3. 如果不是或未提供 → 使用默认值 "client-programmer"
```

---

## 🔍 执行前检查清单

在开始执行本命令之前，请确认以下事项：

**参数解析** ✅
- [ ] 已识别执行模式（任务描述模式 / 文档模式）
- [ ] 已提取 subagent 名称（如果未提供，使用默认值 "client-programmer"）
- [ ] 已验证 subagent 文件存在于 `.claude/agents/[name].md`

**流程确认** ✅
- [ ] 已创建 TodoWrite 追踪任务进度
- [ ] **【关键】准备调用 Task 工具委托给 subagent**
- [ ] 准备好任务的详细说明（prompt 参数）
- [ ] 确认不会跳过 Task 工具调用直接执行

**常见错误预防** ❌
- [ ] 不会直接使用 Read/Edit/Write 修改代码
- [ ] 不会直接分析和实现功能
- [ ] 不会跳过 subagent 调用步骤
- [ ] 不会在 subagent 返回之前继续后续步骤

---

## 📋 执行步骤总览

1. **解析和验证参数** → 确定模式和 subagent
2. **准备任务信息** → 读取文档或使用任务描述
3. **检查测试用例** → 查找相关测试文档
4. **创建 TodoWrite** → 追踪任务进度
5. **⚠️ 调用 Subagent（核心步骤）** → 使用 Task 工具委托执行
6. **更新进度** → 标记功能完成
7. **执行测试** → 运行测试用例
8. **更新状态** → 更新文档或记录状态
9. **完成追踪** → 标记所有任务完成
10. **输出摘要** → 生成执行报告

---

**现在开始执行**:
1. 检测执行模式 (任务描述 / 文档)
2. 验证参数和 subagent
3. 准备任务信息
4. 创建 TodoWrite
5. **【关键】调用 Task 工具委托给指定的 subagent**
6. 等待 subagent 返回结果
7. 继续后续测试和状态更新流程
