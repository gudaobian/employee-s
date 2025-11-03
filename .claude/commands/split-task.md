---
description: 拆分任务为标准工作量单位（5人周）并生成任务文档
argument-hint: [文件名(可选)] [备注说明(可选)] [拆分标准(可选)]
allowed-tools: Read,Write,Bash,Grep,Glob
---

# 任务拆分命令

## 执行流程

### 第1步：解析参数

```
$1 (文件名，可选):
  - 如果提供且包含 /，使用完整路径
  - 如果提供但不含 /，使用 doc/$1
  - 如果未提供，使用默认路径: doc/task-split.md

$2 (备注说明，可选):
  - 如果提供，添加到文档的备注说明部分
  - 如果未提供，不显示备注说明部分

$3 (拆分标准，可选):
  - module: 按模块拆分，每个模块生成一个文件
  - feature: 按功能拆分，每个主要功能生成一个文件
  - sprint: 按Sprint拆分，每个Sprint生成一个文件
  - team: 按团队拆分，每个团队生成一个文件
  - 如果未提供，生成单一文件

  生成文件命名规则:
  - module: task-split-[模块名].md
  - feature: task-split-[功能名].md
  - sprint: task-split-sprint[N].md
  - team: task-split-team[N].md
```

### 第2步：分析当前项目状态

1. 使用 Read 工具读取相关需求文档、PRD或任务描述
2. 使用 Grep/Glob 查找现有任务文档和代码结构
3. 分析项目模块和功能点

### 第3步：计算标准工作量

**标准单位定义**:
- **人数单位**: 5人
- **时间单位**: 1周（5个工作日）
- **标准工作量**: 5人周 = 25人日

**拆分原则**:
- 每个任务应在1个标准工作量内完成
- 大于25人日的功能需拆分为多个子任务
- 每个子任务应可独立测试和验证

### 第4步：生成任务文档

创建包含以下内容的Markdown文档:

```markdown
# 任务拆分文档

**生成时间**: [当前时间]
**标准工作量**: 5人周（25人日）

## 备注说明

[如果提供了 $2 参数，在此显示备注内容]

## 任务概览

- **总任务数**: N个
- **预计总工期**: M周
- **建议团队规模**: 5人

## 任务清单

### 任务1: [功能名称]

**工作量估算**: X人日

**功能点**:
- [ ] 📝 进行中 - 功能点1: 创建实体类
  - **步骤1**: 定义Entity类和字段
    ```java
    @Entity
    @Table(name = "table_name")
    public class EntityName {
        @Id
        @GeneratedValue(strategy = GenerationType.IDENTITY)
        private Long id;
        // 主要字段
    }
    ```
  - **步骤2**: 添加JPA关系注解
    ```java
    @ManyToOne / @OneToMany
    private RelatedEntity related;
    ```
  - **步骤3**: 创建Repository接口
    ```java
    public interface EntityRepository extends JpaRepository<EntityName, Long> {
        // 自定义查询方法
    }
    ```

- [ ] ✅ 编码完成 - 功能点2: 实现Service业务逻辑
  - **步骤1**: 创建Service接口和实现类
    ```java
    @Service
    public class EntityService {
        @Autowired
        private EntityRepository repository;
    }
    ```
  - **步骤2**: 实现核心业务方法
    ```java
    public EntityResponse create(EntityRequest request) {
        // 业务逻辑
        Entity entity = repository.save(newEntity);
        return convertToResponse(entity);
    }
    ```
  - **步骤3**: 添加事务和异常处理
    ```java
    @Transactional
    public void updateWithTransaction() {
        try {
            // 业务逻辑
        } catch (Exception e) {
            throw new BusinessException("错误信息");
        }
    }
    ```

- [ ] ❌ 测试失败 - 功能点3: 开发Controller接口
  - **步骤1**: 创建Controller类和请求映射
    ```java
    @RestController
    @RequestMapping("/api/v1/entities")
    public class EntityController {
        @Autowired
        private EntityService service;
    }
    ```
  - **步骤2**: 实现RESTful接口
    ```java
    @PostMapping
    public ResponseEntity<EntityResponse> create(@RequestBody EntityRequest request) {
        return ResponseEntity.ok(service.create(request));
    }
    ```
  - **步骤3**: 添加参数验证和API文档注解
    ```java
    @Operation(summary = "创建实体")
    @PostMapping
    public ResponseEntity create(@Valid @RequestBody EntityRequest request) {
        // 实现
    }
    ```

- [ ] ✔️ 测试成功 - 功能点4: 编写单元测试
  - **步骤1**: 创建Service测试类
    ```java
    @SpringBootTest
    class EntityServiceTest {
        @Autowired
        private EntityService service;

        @Test
        void testCreate() {
            // 测试逻辑
        }
    }
    ```
  - **步骤2**: 创建Controller集成测试
    ```java
    @WebMvcTest(EntityController.class)
    class EntityControllerTest {
        @Autowired
        private MockMvc mockMvc;
    }
    ```
  - **步骤3**: 运行测试并验证覆盖率
    ```bash
    mvn clean test
    mvn jacoco:report
    ```

**依赖关系**: [前置任务]

---

### 任务2: [功能名称]

**工作量估算**: X人日

**功能点**:
- [ ] 📝 进行中 - 功能点1: [根据实际情况生成具体功能点]
  - **步骤1**: [具体操作描述]
    ```java
    // 主要代码示例
    ```
  - **步骤2**: [具体操作描述]
    ```java
    // 主要代码示例
    ```

- [ ] ✅ 编码完成 - 功能点2: [根据实际情况生成具体功能点]
  - **步骤1**: [具体操作描述]
    ```java
    // 主要代码示例
    ```
  - **步骤2**: [具体操作描述]

**依赖关系**: [前置任务]

**相关文件**:
- `path/to/file1.java`
- `path/to/file2.java`

---

## 进度跟踪图例

- 📝 **进行中**: 开发正在进行
- ✅ **编码完成**: 代码已完成，待测试
- ❌ **测试失败**: 测试未通过，需修复
- ✔️ **测试成功**: 测试通过，任务完成

## 工作量分配建议

- 第1周: 任务1, 任务2
- 第2周: 任务3, 任务4
- ...
```

### 第5步：根据拆分标准生成文件

**如果未提供 $3 参数（单文件模式）**:
1. 使用 Bash 创建 doc 目录（如果不存在）
2. 使用 Write 工具写入生成的任务文档到指定路径
3. 使用 Read 工具验证文件创建成功

**如果提供 $3 参数（多文件模式）**:
1. 分析项目结构，识别拆分目标（模块/功能/Sprint/团队）
2. 为每个拆分单元生成独立的任务文档
3. 生成索引文件 `task-split-index.md` 包含：
   - 所有拆分文件的链接
   - 总体工作量统计
   - 跨文件依赖关系图

**文件生成示例**:
- module 模式: `doc/task-split-auth.md`, `doc/task-split-report.md`
- feature 模式: `doc/task-split-user-management.md`, `doc/task-split-data-export.md`
- sprint 模式: `doc/task-split-sprint1.md`, `doc/task-split-sprint2.md`
- team 模式: `doc/task-split-team1.md`, `doc/task-split-team2.md`

**索引文件格式**:
```markdown
# 任务拆分索引

**生成时间**: [时间]
**拆分标准**: [module/feature/sprint/team]
**文件总数**: N个

## 文件列表

- [模块/功能/Sprint/团队1](./task-split-xxx.md) - X人日
- [模块/功能/Sprint/团队2](./task-split-xxx.md) - X人日

## 总体统计

- **总任务数**: N个
- **总工作量**: M人日
- **预计工期**: K周

## 依赖关系

- 任务A → 任务B
- 任务C → 任务D
```

### 第6步：输出结果

**单文件模式**:
- ✅ 任务拆分完成
- 📄 文档位置: [文件路径]
- 📊 总任务数: N个
- ⏱️ 预计工期: M周
- 👥 建议团队: 5人
- 📝 备注说明: [如果提供了 $2，显示备注内容]

**多文件模式**:
- ✅ 任务拆分完成
- 📁 拆分标准: [module/feature/sprint/team]
- 📄 生成文件数: N个
- 📋 索引文件: doc/task-split-index.md
- 📊 总任务数: M个
- ⏱️ 总工期: K周
- 👥 建议团队: 5人
- 📝 备注说明: [如果提供了 $2，显示备注内容]
- 📎 文件列表:
  - task-split-xxx.md (X人日)
  - task-split-yyy.md (Y人日)

## 实现要求

1. **严格遵循5人周标准**: 每个任务不超过25人日
2. **状态标记规范**: 使用指定的复选框和emoji
3. **依赖关系明确**: 标注任务之间的依赖
4. **具体代码步骤**: 每个功能点必须包含：
   - 清晰的步骤描述
   - 主要代码示例（不是全部代码，只展示关键部分）
   - 相关文件路径
   - 具体的命令或配置
5. **专注任务拆分**: 不包含验收标准，只专注于任务拆分和实现步骤
6. **可追踪性**: 文档支持持续更新和状态跟踪
7. **备注支持**: 支持附加备注说明($2参数)
8. **灵活拆分**: 支持按不同标准生成单文件或多文件($3参数)
9. **代码质量**: 代码示例应遵循项目规范和最佳实践
10. **完整性**: 多文件模式下生成索引文件和依赖关系图

现在开始执行任务拆分流程。
