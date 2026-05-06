# KNOWN ISSUES

> **已知问题追踪文档**
> 创建时间：2026-05-06
> 最近更新：2026-05-06（Wave 3.5 完成：Issue 011 Resolved — 前端渲染 SSE progress 进度条 + heartbeat 静默忽略）
> 用途：记录项目中的已知问题，系统化修复过程

---

## Issue Index

| ID | Priority | Status | Title | Introduced | Fixed |
|----|----------|--------|-------|------------|-------|
| 001 | High | Resolved | 系统使用硬编码模板而非动态生成技能 | v0.1.0 | 2026-05-06 |
| 002 | High | Resolved | 缺少对话式实体抽取规则学习机制 | v0.1.0 | 2026-05-06 |
| 003 | High | Resolved | 实体抽取逻辑完全硬编码无自适应 | v0.1.0 | 2026-05-06 |
| 004 | Medium | Resolved | 实体排除功能无学习能力会重复错误 | v0.1.0 | 2026-05-06 |
| 005 | High | Resolved | 意图路由依赖 4 套硬编码关键词列表 | v0.1.0 | 2026-05-06 |
| 006 | High | Resolved | 意图分类失败降级到硬编码关键词 | v0.1.0 | 2026-05-06 |
| 007 | Medium | Resolved | 意图类别枚举写死无法扩展 | v0.1.0 | 2026-05-06 |
| 008 | Medium | Resolved | Skill 内嵌硬编码正则做文档名提取 | v0.1.0 | 2026-05-06 |
| 009 | Medium | Resolved | `entity_extract` Skill 串行执行且零中间日志 | v0.1.0 | 2026-05-06 |
| 010 | High | Resolved | OpenAI API 调用无重试，单次超时即返回 0 实体 | v0.1.0 | 2026-05-06 |
| 011 | Medium | Resolved | 长任务 SSE 缺少 progress 事件，前端只能干转圈 | v0.1.0 | 2026-05-06 |
| 012 | Medium | Resolved | 用户设置规则后缓存未失效，新规则对已缓存文档无效 | v0.1.0 | 2026-05-06 |

> 全部 Issue 共同关联 [F001: AgentOS 大模型驱动的任务执行架构](features/F001_AgentOS大模型驱动的任务执行架构.md)。每个 Issue 末尾标注其对应的 F001 原则编号。

---

## Issue Details

### 001: 系统使用硬编码模板而非动态生成技能

**Priority**: High
**Status**: Open
**Introduced**: v0.1.0
**Created**: 2026-05-06

**Original Problem**：

根据 FEATURE_LIST.md (F001) 的需求，系统应该"大模型根据用户反馈自动沉淀新的抽取技能，技能内容由大模型生成，而非预定义模板"。

但实际实现中：

1. **硬编码模板系统** ([`backend/routes/chat.py:419-556`](../backend/routes/chat.py))
   - `_CAPABILITY_TEMPLATES` 字典预定义了固定的技能模板
   - 包含 `entity_extract` 和 `entity_exclude` 两个硬编码模板
   - 模板内容是固定的代码字符串（第 424-554 行）

2. **模板复制而非生成** ([`backend/routes/chat.py:559-594`](../backend/routes/chat.py))
   - `_handle_create_skill` 函数只是简单的模板匹配和文件复制
   - 通过硬编码的触发词（"实体抽取"、"排除实体"）匹配模板
   - 直接将模板内容写入文件，没有大模型参与生成

3. **违背核心需求**：
   - ❌ 技能内容不是大模型生成的
   - ❌ 无法根据用户反馈动态调整
   - ❌ 无法适应不同场景

**Expected Behavior**：
- 用户通过对话触发技能生成
- 大模型理解用户意图和上下文
- 大模型动态生成个性化的技能代码（包含具体逻辑）
- 技能代码包含用户反馈的规则和偏好

**Current Behavior**：
- 用户说"封装实体抽取技能"
- 系统通过关键词匹配找到硬编码模板
- 直接复制模板内容到文件
- 无法根据用户反馈调整技能内容

**Context**：
- 影响文件：[`backend/routes/chat.py`](../backend/routes/chat.py)
- 相关代码：第 419-594 行
- 影响范围：整个技能系统架构

**Root Cause**：
- 设计理念错误：将动态学习系统设计成静态模板系统
- 缺少大模型代码生成能力
- 过度依赖预定义规则

**Proposed Solution**：
1. 移除 `_CAPABILITY_TEMPLATES` 硬编码模板系统
2. 实现动态技能生成机制：
   - 用户触发时，调用大模型分析意图和上下文
   - 大模型生成包含具体逻辑的技能代码
   - 根据已学习的规则定制技能内容
3. 技能内容应该包含：
   - 用户反馈的排除规则
   - 当前项目特定的抽取偏好
   - 适应文档类型和内容的动态逻辑

**关联 F001 原则**：原则 3（Skill 必须由大模型生成）
**修复优先级建议**：P0 — 这是 F001 最显著的反例，修复后能直接验证"动态 Skill 生成"是否成立

**Status**: Resolved
**Fixed**: 2026-05-06（Wave 3 切片 1-2）
**Discovered During**: Wave 2 回归分析

**Resolution Summary**：
- 移除 [`backend/routes/chat.py`](../backend/routes/chat.py) 中的 `_CAPABILITY_TEMPLATES` 硬编码字典（含 `entity_extract` + `entity_exclude` 两个固定模板 + 关键词 triggers 列表）
- 重写 `_handle_create_skill`（Issue 001 核心修复）：
  1. 通过 `safe_llm_call_sync` 调用 LLM，附带 `_SKILL_GENERATION_SYSTEM_PROMPT` 系统提示
  2. 系统提示明确 Skill 格式规范（`SKILL_META` + `run()` + 允许调用的内部工具）
  3. LLM 输出 `<FILENAME>xxx.py</FILENAME>` + 纯 Python 代码
  4. 用 `ast.parse` 做语法校验；检查 `SKILL_META` + `run` 是否存在
  5. 校验通过后写入 `SKILLS_DIR / filename`，调用 `scan_skills()` 注册
  6. LLM 返回无效 Python 或 LLM 调用失败时，拒绝写文件并返回可读错误
- 由 [`backend/tests/test_handle_create_skill_is_llm_driven.py`](../backend/tests/test_handle_create_skill_is_llm_driven.py) 9 条测试守护：
  - 4 个静态断言（`_CAPABILITY_TEMPLATES` 不存在 / 不用 triggers 匹配 / 使用 `safe_llm_call_sync` / 使用 `ast.parse`）
  - 4 个行为断言（合法代码写文件成功 / 无效 Python 拒绝写文件 / 缺 `SKILL_META` 拒绝 / LLM 失败返回错误消息）
  - 1 个辅助断言（测试用 Skill 代码本身结构正确）

---

### 002: 缺少对话式实体抽取规则学习机制

**Priority**: High
**Status**: Resolved
**Introduced**: v0.1.0
**Created**: 2026-05-06
**Fixed**: 2026-05-06（Wave 4 学习层重构）

**Resolution Summary**：
- 新建 `backend/rule_manager.py`：提供 `parse_rule_from_feedback`（LLM 驱动）、`save_rule`、`load_rules`、`rules_to_prompt_text`、`build_extraction_exclusion_text` 五个核心函数
- 新增 `extraction_rules` 数据库表（`database.py`）：按 `project_id` 持久化规则（包含 `rule_type` / `description` / `rule_data` / `source_message` / `created_at`）
- 新增 `rule_learning` 意图分类：`_CLASSIFY_PROMPT` 和 `_VALID_INTENTS` 包含第 6 类意图，用户说"不要抽取章节标题"时被 LLM 自动识别
- 新增 `_run_rule_learning_sync`：调用 `parse_rule_from_feedback` → 结构化规则 → `save_rule` 持久化 → 返回确认消息
- 修改 `entity_extractor.extract_entities_sync`：每次抽取前调用 `build_extraction_exclusion_text(project_id)` 融合已排除名单 + 学习规则，注入 `{excluded}` 占位符
- 守护测试：
  - [`backend/tests/test_rule_manager.py`](../backend/tests/test_rule_manager.py)：12 条测试（静态断言 + save/load 数据库读写 + prompt 格式化）
  - [`backend/tests/test_rule_learning_intent.py`](../backend/tests/test_rule_learning_intent.py)：7 条测试（classify_prompt / valid_intents / handler 调用链）
  - [`backend/tests/test_extraction_applies_rules.py`](../backend/tests/test_extraction_applies_rules.py)：4 条测试（规则注入 prompt 验证）

**Original Problem**：

根据 FEATURE_LIST.md (F001) 的需求，核心特性是"用户通过自然语言对话告诉大模型哪些内容不应该被抽取为实体，大模型理解用户的修正意图，动态调整抽取规则"。

但实际实现中：

1. **缺少规则学习机制**
   - 系统只有"实体排除"功能（删除已抽取的实体）
   - 无法从用户的反馈中学习规则
   - 每次抽取都会犯同样的错误

2. **无法理解用户意图**
   - 用户说"不要把章节标题抽成实体"
   - 系统只能删除已抽取的章节标题
   - 无法理解并记录这个规则
   - 下次抽取时还会把章节标题抽成实体

3. **缺少规则存储与查询**
   - 没有规则数据库或配置文件
   - 无法持久化用户的偏好
   - 无法在后续抽取时应用已学习的规则

**Expected Behavior**：
- 用户说："不要把章节标题、页码、日期抽成实体"
- 大模型理解：用户希望排除特定类型的实体
- 系统记录：规则"章节标题|页码|日期 不应作为实体"
- 下次抽取：自动排除这些类型的实体
- 规则沉淀：生成包含这些规则的技能

**Current Behavior**：
- 用户说："不要把章节标题抽成实体"
- 系统执行：删除已抽取的章节标题实体
- 下次抽取：仍然会把章节标题抽成实体
- 没有学习：无法记录和应用规则

**Context**：
- 影响文件：[`backend/entity_extractor.py`](../backend/entity_extractor.py)、[`backend/routes/chat.py`](../backend/routes/chat.py)
- 相关功能：实体抽取、规则管理
- 影响范围：整个知识图谱生成流程

**Root Cause**：
- 实体抽取是单次操作，没有反馈闭环
- 缺少规则理解和存储机制
- 没有将用户反馈转化为抽取约束

**Proposed Solution**：
1. 实现规则理解机制：
   - 用户说"不要抽取XXX"时，调用大模型理解意图
   - 提取要排除的实体类型、来源文档、具体特征
   - 生成结构化的排除规则

2. 实现规则存储机制：
   - 创建规则数据库或配置文件（如 `extraction_rules.json` 或 SQLite 表）
   - 存储规则内容、创建时间、应用次数、来源会话/消息（可追溯）
   - 支持规则的增删改查

3. 实现规则应用机制：
   - 实体抽取前，查询相关规则
   - 将规则转化为抽取约束（如提示词、过滤条件）
   - 在抽取过程中排除符合规则的实体

**关联 F001 原则**：原则 4（规则约束必须由大模型从对话中学习并持久化）
**修复优先级建议**：P0 — 这是 F001 闭环的关键能力（"学习"），缺它则原则 3、4 都无法落地

---

### 003: 实体抽取逻辑完全硬编码无自适应

**Priority**: High
**Status**: Resolved
**Introduced**: v0.1.0
**Created**: 2026-05-06
**Fixed**: 2026-05-06（Wave 5 自适应层重构）

**Resolution Summary**：
- 扩展 `rule_manager.py` 的 `_RULE_PARSE_SYSTEM_PROMPT`：新增 `focus_on`（重点关注实体类型）和 `strategy`（整体抽取策略）两种正向规则类型，LLM 可从用户表达中识别并结构化
- 更新 `rules_to_prompt_text`：`focus_on` 生成"重点关注/优先抽取"正向引导文本；`strategy` 生成"抽取策略（文档类型/优先类型）"说明文本
- 重构 `build_extraction_exclusion_text`：区分正向规则（`focus_on`/`strategy`）与排除规则（`exclude_*`），分两段注入 prompt："用户排除规则" + "用户抽取重点与策略"
- 抽取自适应闭环：用户说"这是财报，重点抽取财务指标" → LLM 识别为 `focus_on` 规则 → 保存到 `extraction_rules` 表 → 下次抽取 LLM prompt 包含正向引导 → 抽取结果更聚焦
- 守护测试：[`backend/tests/test_adaptive_extraction.py`](../backend/tests/test_adaptive_extraction.py)：6 条测试（prompt 包含 focus_on/strategy / 正向文本生成 / 解析行为 / build_extraction_exclusion_text 融合验证）

**Original Problem**：

根据 FEATURE_LIST.md (F001) 的需求，"实体抽取规则由大模型动态分析和决定，不使用硬编码的模板或规则，抽取逻辑根据文档内容和用户反馈自适应"。

但实际实现中：

1. **硬编码的抽取触发词** ([`backend/routes/chat.py:421`](../backend/routes/chat.py))
   ```python
   "triggers": ["实体抽取", "抽取实体", "提取实体", "实体提取"]
   ```
   - 固定的关键词列表
   - 无法根据用户表达方式调整

2. **硬编码的文档解析规则** ([`backend/routes/chat.py:445-455`](../backend/routes/chat.py))
   ```python
   files = [f for f in KNOWLEDGE_DOCS_DIR.iterdir()
            if f.is_file() and not f.name.startswith(".")]
   ```
   - 固定的文件过滤逻辑
   - 无法适应不同的知识库结构

3. **硬编码的实体排除逻辑** ([`backend/routes/chat.py:508-520`](../backend/routes/chat.py))
   ```python
   patterns = [
       r'([\w\(\)（）\-]+\.(?:pdf|md|docx|xlsx|csv|txt|doc|pptx))',
       r'([A-Za-z0-9_\-]+\.[A-Za-z0-9]+)',
       r'[「"](.*?)[」"]',
   ]
   ```
   - 固定的正则表达式
   - 无法根据文档类型或内容调整

4. **缺少自适应能力**
   - 抽取逻辑不考虑文档类型（学术论文 vs 技术文档）
   - 不考虑用户反馈（已排除的实体类型）
   - 不考虑历史抽取结果（成功率、准确率）

**Expected Behavior**：
- 大模型分析文档内容，决定抽取策略
- 根据文档类型（学术论文）调整：重点抽取概念、理论、方法
- 根据用户反馈（不要抽取章节标题）调整：过滤章节标题模式
- 根据历史结果调整：优先抽取高准确率类型的实体

**Current Behavior**：
- 所有文档使用相同的抽取逻辑
- 忽略用户反馈的排除规则
- 每次抽取都是独立的，不考虑历史

**Context**：
- 影响文件：[`backend/routes/chat.py`](../backend/routes/chat.py)、[`backend/entity_extractor.py`](../backend/entity_extractor.py)
- 相关代码：第 421、445-455、508-520 行
- 影响范围：所有实体抽取流程

**Root Cause**：
- 抽取逻辑是硬编码的流程，不是 AI 决策过程
- 缺少上下文感知能力
- 没有反馈驱动的调整机制

**Proposed Solution**：
1. 实现动态抽取策略：
   - 抽取前，大模型分析文档类型和内容特征
   - 根据分析结果生成定制化的抽取提示词
   - 提示词包含：重点类型、排除类型、上下文约束

2. 实现反馈驱动的调整：
   - 查询已学习的排除规则
   - 将规则转化为抽取约束
   - 在抽取过程中应用约束

3. 实现历史驱动的优化：
   - 记录每次抽取的结果和准确率
   - 分析高准确率的实体类型和特征
   - 优化后续抽取的策略

**关联 F001 原则**：原则 1（意图理解）+ 原则 4（规则学习）在抽取场景的具体体现
**修复优先级建议**：P1 — 依赖 002 完成（先有规则学习，才能在抽取时应用）

---

### 004: 实体排除功能无学习能力会重复错误

**Priority**: Medium
**Status**: Resolved
**Introduced**: v0.1.0
**Created**: 2026-05-06
**Fixed**: 2026-05-06（Wave 4 学习层重构，与 Issue 002 一并修复）

**Resolution Summary**：
- 修改 `_run_entity_exclusion_sync`（`backend/routes/chat.py`）：在完成实体排除操作后，调用 `rule_manager.save_rule(project_id, {...})` 保存一条 `exclude_source` 规则
- 规则内容：`rule_type="exclude_source"` + `rule_data={"sources": [matched_source]}` + `source_message=用户原始消息`
- 恢复（restore）操作不保存规则（仅取消 excluded 标记）
- 下次实体抽取时 `build_extraction_exclusion_text` 自动加载该规则，注入 LLM prompt 使其跳过该来源
- 守护测试：[`backend/tests/test_entity_exclusion_learns_rule.py`](../backend/tests/test_entity_exclusion_learns_rule.py)：3 条测试

**Original Problem**：

根据 FEATURE_LIST.md (F001) 的需求，"系统记录修正历史，避免重复错误"。

但实际实现中：

1. **实体排除是临时操作** ([`backend/routes/chat.py:482-556`](../backend/routes/chat.py))
   - 用户说"排除XXX文档的实体"
   - 系统删除已抽取的实体
   - 下次抽取时，还会抽取同样的实体

2. **无法记录排除原因**
   - 系统只记录"实体被排除"的状态
   - 不记录"为什么排除"（用户反馈的规则）
   - 无法避免重复错误

3. **缺少智能排除**
   - 用户说"章节标题不应该作为实体"
   - 系统应该：理解规则 + 应用到未来抽取
   - 当前实现：只能删除已有的章节标题实体

**Expected Behavior**：
- 用户说："章节标题不应该作为实体"
- 系统执行：
  1. 理解规则："章节标题 = 文档中的标题行"
  2. 存储规则：下次抽取时排除标题行
  3. 删除当前：删除已抽取的章节标题实体
  4. 永久生效：未来抽取自动排除章节标题

**Current Behavior**：
- 用户说："章节标题不应该作为实体"
- 系统执行：
  1. 搜索文档名：通过硬编码正则匹配文档名
  2. 删除实体：删除该文档的所有实体
  3. 没有学习：不记录"章节标题不作为实体"的规则
  4. 重复错误：下次抽取还会把章节标题作为实体

**Context**：
- 影响文件：[`backend/routes/chat.py:482-556`](../backend/routes/chat.py)
- 相关功能：实体排除、规则学习
- 影响范围：实体管理流程

**Root Cause**：
- 实体排除只是数据操作，没有规则沉淀
- 缺少用户意图理解
- 没有将排除操作转化为学习规则

**Proposed Solution**：
1. 实现智能排除流程：
   - 用户触发排除时，调用大模型理解意图
   - 提取排除规则（如实体类型、特征、来源）
   - 存储规则到规则数据库
   - 应用规则删除当前实体
   - 标记规则为永久生效

2. 实现规则关联：
   - 排除实体时，关联到具体规则
   - 记录"因为XXX规则，此实体被排除"
   - 支持查看排除历史和原因

3. 实现未来预防：
   - 抽取时查询相关规则
   - 根据规则过滤候选实体
   - 避免抽取已排除类型的实体

**关联 F001 原则**：原则 4（规则学习）+ 原则 1（意图理解，"恢复 vs 排除"判定不靠关键词）
**修复优先级建议**：P1 — 与 002 配套修复（004 是 002 在"排除"动作上的具体表现）

---

### 005: 意图路由依赖 4 套硬编码关键词列表

**Priority**: High
**Status**: Resolved
**Introduced**: v0.1.0
**Created**: 2026-05-06
**Fixed**: 2026-05-06（与 Issue 006 一并修复，第 1 波路由层重构）

**Resolution Summary**：
- 删除 [`backend/routes/chat.py`](../backend/routes/chat.py) 中全部 4 套硬编码关键词列表（`_ORCHESTRATE_KEYWORDS`、`_DIRECT_ENTITY_KEYWORDS`、`_ENTITY_EXCLUSION_KEYWORDS`、`_CREATE_SKILL_KEYWORDS`）
- 同步删除依赖关键词的辅助函数 `_needs_orchestration`、`_is_entity_exclusion`、`_is_entity_extraction`
- 由 [`backend/tests/test_intent_routing_no_hardcode.py`](../backend/tests/test_intent_routing_no_hardcode.py) 中的 8 条 parametrize 测试守护，未来再引入硬编码关键词列表会立即失败

**Original Problem**：

AgentOS 的核心架构原则是"对话中由大模型理解用户意图"。但 [`backend/routes/chat.py`](../backend/routes/chat.py) 中存在 4 套硬编码关键词列表，用户消息只要命中任一关键词就会被强制路由：

| 列表 | 位置 | 用途 | 条目数 |
|------|------|------|--------|
| `_ORCHESTRATE_KEYWORDS` | [`chat.py:23-35`](../backend/routes/chat.py) | 是否走 SubAgent 编排 | 24 |
| `_DIRECT_ENTITY_KEYWORDS` | [`chat.py:44-49`](../backend/routes/chat.py) | 是否走实体抽取 | 10 |
| `_ENTITY_EXCLUSION_KEYWORDS` | [`chat.py:51-57`](../backend/routes/chat.py) | 是否走实体排除 | 10 |
| `_CREATE_SKILL_KEYWORDS` | [`chat.py:90-94`](../backend/routes/chat.py) | 是否走 Skill 封装 | 10 |

**Expected Behavior**：
- 用户消息的所有意图判定都由 LLM 完成
- 用户表达方式不受系统预设"咒语"限制
- 例如用户说"把这堆 PDF 里的关键概念都拎出来"，系统应能理解为实体抽取，而不必出现"抽取/提取/实体/图谱"等关键词

**Current Behavior**：
- 用户消息先尝试 LLM 分类，但 LLM 失败时立即回到 4 套关键词列表
- 关键词列表本身不受 LLM 控制，等价于一张始终生效的硬编码路由表
- 用户必须使用列表中的"咒语"才能稳定触发对应能力

**Context**：
- 影响文件：[`backend/routes/chat.py`](../backend/routes/chat.py)
- 相关代码：第 23-35、44-49、51-57、90-94、137-147 行
- 影响范围：所有用户对话的路由

**Root Cause**：
- 早期实现先有了硬编码路由，后引入 LLM 分类时仅作为"主路径"叠加，未删除硬编码
- 缺少"LLM 失败时也走 LLM 兜底"的设计

**Proposed Solution**：
1. 删除全部 4 套 `_*_KEYWORDS` 列表
2. `_keyword_fallback` 函数同步删除（参见 Issue 006）
3. 主路径 LLM 分类失败时切换到二级 LLM 兜底（更小模型 / 简化 prompt / 缩短上下文重试）

**关联 F001 原则**：原则 1（意图理解必须由大模型完成）
**修复优先级建议**：P0 — 与 Issue 006 一并修复，否则单独删除任一项都会破坏路由

---

### 006: 意图分类失败降级到硬编码关键词

**Priority**: High
**Status**: Resolved
**Introduced**: v0.1.0
**Created**: 2026-05-06
**Fixed**: 2026-05-06（与 Issue 005 一并修复，第 1 波路由层重构）

**Resolution Summary**：
- 删除 `_keyword_fallback` 函数（违反 F001 原则 5 的关键词降级路径）
- 重构 [`classify_intent`](../backend/routes/chat.py)：拆出 `_classify_with_llm`，引入两级 LLM 兜底链
  - 主调用：完整 prompt + 上下文，10 秒超时
  - 兜底 LLM：简化 prompt + 去除上下文 + 5 秒超时
  - 全部失败：默认返回 `direct_answer` 让 BizAgent 自主响应
- 修改 `orchestrator_chat` 中的调用处（原 `chat.py:719-724`），去除 `if intent is None: intent = _keyword_fallback(...)`
- 由 [`backend/tests/test_intent_routing_no_hardcode.py`](../backend/tests/test_intent_routing_no_hardcode.py) 中的 5 条断言守护：主成功不调用兜底、主失败调用 LLM 兜底、全部失败默认 direct_answer、非法 intent 触发兜底

**Original Problem**：

[`backend/routes/chat.py:97-134`](../backend/routes/chat.py) 中的 `classify_intent` 在 LLM 超时（10 秒）或 JSON 解析失败时返回 `None`。调用方 [`chat.py:719-722`](../backend/routes/chat.py) 在拿到 `None` 后直接调用 `_keyword_fallback`：

```python
intent = await classify_intent(request.message, context_str)
if intent is None:
    intent = _keyword_fallback(request.message)
```

而 `_keyword_fallback` 完全依赖 Issue 005 中的 4 套关键词列表。

**Expected Behavior**：
- LLM 主调用失败时，应仍由 LLM 完成兜底（如切换更小模型、缩短 prompt 重试、拆分查询）
- 不允许任何执行路径回退到关键词匹配——否则就等于"硬编码路由始终是真实生效的备用方案"

**Current Behavior**：
- 任何 LLM 抖动（网络、限流、超时、Provider 故障）都会导致路由权交给硬编码
- 硬编码兜底没有任何上下文感知，也没有日志区分"是 LLM 给的结果"还是"是关键词命中的结果"——但事实上行为差异巨大

**Context**：
- 影响文件：[`backend/routes/chat.py`](../backend/routes/chat.py)
- 相关代码：第 128-134（超时即 `return None`）、第 137-147（`_keyword_fallback` 主体）、第 719-722（调用处）
- 影响范围：所有用户对话的路由

**Root Cause**：
- "降级到关键词"被视为防御性编程，但没意识到这违背了 F001 的核心原则
- 缺少对"LLM 兜底"模式的明确建模

**Proposed Solution**：
1. 移除 `_keyword_fallback` 的全部调用
2. 在 `classify_intent` 内实现 LLM 兜底链：
   - 主模型超时/失败 → 切换更便宜模型重试
   - 仍失败 → 简化 prompt（去掉上下文）重试
   - 仍失败 → 默认走 `direct_answer` 并向用户暴露"分类不确定"的提示，让 BizAgent 自行处理
3. 全程不出现关键词匹配

**关联 F001 原则**：原则 2（任务路由必须由大模型决策）+ 原则 5（兜底失败方案必须仍是 LLM）
**修复优先级建议**：P0 — 必须与 Issue 005 一并修复

---

### 007: 意图类别枚举写死无法扩展

**Priority**: Medium
**Status**: Resolved
**Introduced**: v0.1.0
**Created**: 2026-05-06
**Fixed**: 2026-05-06（Wave 6 扩展层重构）

**Resolution Summary**：
- 新增 `_CORE_INTENTS` dict（4 类永久核心意图：direct_answer / rule_learning / orchestrate / create_skill）
- 新增 `build_intent_registry()` 函数：合并核心意图 + 扫描 `_skill_registry`（取各 Skill SKILL_META.intent），返回完整意图 → 描述 dict
- 新增 `build_classify_prompt(simplified=False)` 函数：从 `build_intent_registry()` 动态生成 LLM 分类 prompt
- `_classify_with_llm` 改为调用 `build_classify_prompt(simplified)` + `build_intent_registry()` 进行合法性校验，不再引用模块级常量
- `classify_intent` 中两级 LLM 调用均使用动态注册表校验
- Skill 层：`entity_extract` 和 `entity_exclude` 的 `SKILL_META` 新增 `intent` / `intent_description` 字段，使 entity_extraction / entity_exclusion 意图由 Skill 提供而非硬编码
- 新增通用 Skill 意图分发路径（`skill_intent_map`）：若 intent 匹配某 Skill 的声明意图且不在专属路径白名单中，自动分发给该 Skill 的 `run_fn`，新 Skill 无需修改 `orchestrator_chat`
- 守护测试：[`backend/tests/test_dynamic_intent_registry.py`](../backend/tests/test_dynamic_intent_registry.py)：10 条测试

**Original Problem**：

[`backend/routes/chat.py:79-86`](../backend/routes/chat.py) 中 `_CLASSIFY_PROMPT` 把意图集合写死在 prompt 里：

```
- direct_answer: ...
- entity_extraction: ...
- entity_exclusion: ...
- orchestrate: ...
- create_skill: ...
```

再加上 [`chat.py:88`](../backend/routes/chat.py)：

```python
_VALID_INTENTS = ("direct_answer", "entity_extraction", "entity_exclusion", "orchestrate", "create_skill")
```

新增一类能力（例如未来加上 `regraph_visualization`、`document_summarize` 等 Skill）必须改代码并发版，无法由 Skill 注册表动态扩展。

**Expected Behavior**：
- 意图候选集合应由 Skill 注册表 + 内置能力清单 + LLM 自身的推断综合得到
- 注册新 Skill 后，相关意图应立即可用，无需修改 `chat.py`

**Current Behavior**：
- 意图集合恒定为 5 类
- 即使 Skill 注册表已有新技能，意图分类器也不会把对应意图作为候选

**Context**：
- 影响文件：[`backend/routes/chat.py`](../backend/routes/chat.py)
- 相关代码：第 79-86、88、139-147 行（`_keyword_fallback` 的分支同样固定 5 类）

**Root Cause**：
- 意图与执行路径的映射在代码层硬编码，没有从注册表反向生成

**Proposed Solution**：
1. 让 `_CLASSIFY_PROMPT` 在每次调用时从 `_skill_registry` + `CAPABILITY_REGISTRY` 动态拼装意图候选列表
2. 移除 `_VALID_INTENTS` 常量，改为运行时校验（命中候选列表即合法）
3. Skill 在 `SKILL_META` 中声明其对应的意图描述与触发条件（让 LLM 自然学习这种映射，而不是硬编码触发词）

**关联 F001 原则**：原则 1（意图理解）+ 原则 3（Skill 必须由大模型生成，意图集合也要可扩展）
**修复优先级建议**：P1 — 在 005、006 修复后再做，避免反复改 `classify_intent`

---

### 008: Skill 内嵌硬编码正则做文档名提取

**Priority**: Medium
**Status**: Open
**Introduced**: v0.1.0
**Created**: 2026-05-06

**Original Problem**：

[`backend/routes/chat.py:508-520`](../backend/routes/chat.py) 嵌套在 `_CAPABILITY_TEMPLATES["entity_exclude"]` 模板字符串内：

```python
patterns = [
    r'([\w\(\)（）\-]+\.(?:pdf|md|docx|xlsx|csv|txt|doc|pptx))',
    r'([A-Za-z0-9_\-]+\.[A-Za-z0-9]+)',
    r'[「"](.*?)[」"]',
]
for pattern in patterns:
    matches = re.findall(pattern, instruction)
    ...
```

这是"硬编码模板"内部又嵌套"硬编码正则"——展示了 AI 外壳 + 硬编码内核的反模式。同位置第 505 行的 `is_restore = any(kw in instruction for kw in ("恢复", "还原", ...))` 也是同样的反模式。

**Expected Behavior**：
- Skill 内部解析用户意图（"要排除哪个文档的实体"、"是排除还是恢复"）也应通过结构化 LLM 调用
- LLM 输出 JSON：`{"action": "exclude" | "restore", "source": "文档名"}`
- 不依赖任何正则或关键词

**Current Behavior**：
- 模板内的逻辑用 3 条正则尝试从用户消息中提取文件名
- 用 5 个固定中文词判断"恢复 vs 排除"
- 用户表达稍有不同就解析失败，落到"请指定要 X 的文档名称"的兜底提示

**Context**：
- 影响文件：[`backend/routes/chat.py`](../backend/routes/chat.py)
- 相关代码：第 482-556 行（`entity_exclude` 模板字符串整体）
- 影响范围：实体排除/恢复操作

**Root Cause**：
- 即使将来 Issue 001 把模板改为 LLM 生成，这段嵌套正则也会被原样复制，必须同步修复
- 反映了"动态生成代码"和"代码内部仍走 LLM"是两件不同的事，都要做

**Proposed Solution**：
1. Skill 模板（无论后续是模板还是 LLM 生成）内部对用户消息的解析必须通过 LLM
2. 提供工具函数 `parse_user_intent(message: str, schema: dict) -> dict`，在 Skill 内统一调用
3. 实体排除 Skill 改为：调用 `parse_user_intent` → 拿到 `{action, source}` → 执行数据库操作

**关联 F001 原则**：原则 1（意图理解必须由大模型完成）
**修复优先级建议**：P2 — 在 Issue 001 修复（移除模板系统）后会顺带消失大部分；剩余的 LLM 生成代码内部的反模式可在该阶段一并约束

**Status**: Resolved
**Fixed**: 2026-05-06（Wave 3 切片 3-4，与 Issue 001 同批修复）

**Resolution Summary**：
- 删除 `_CAPABILITY_TEMPLATES["entity_exclude"]` 模板内的 3 条正则 + `is_restore = any(kw in ...)` 关键词判断（随 Issue 001 修复一并消除）
- 在 [`backend/routes/chat.py`](../backend/routes/chat.py) 新增 `_parse_exclusion_intent(message, context, project_id)` 函数：
  - 用 `safe_llm_call_sync` 调用 LLM（系统提示 `_EXCLUSION_INTENT_SYSTEM_PROMPT`）
  - LLM 输出 JSON `{"action": "exclude"|"restore", "source": "文件名|null"}`
  - LLM 失败时返回 `{"action": None, "source": None, "error": reason}`（不抛出异常）
- 重写 `_run_entity_exclusion_sync`：调用 `_parse_exclusion_intent` → 消费 `{action, source}` → 执行数据库排除/恢复操作
- 新建 [`backend/skills/entity_exclude.py`](../backend/skills/entity_exclude.py) Skill：
  - 内部同样通过 `safe_llm_call_sync` 解析意图（`_parse_intent` 函数），**完全不使用正则**
  - 接受 `instruction: str` 参数，由 Skill 系统自动从用户消息传入
- 由 [`backend/tests/test_entity_exclusion_no_regex.py`](../backend/tests/test_entity_exclusion_no_regex.py) 10 条测试守护：
  - 4 个静态断言（`_run_entity_exclusion_sync` 无 `is_restore=any(kw` / 无 `_extract_doc_name` / 无 `re.findall`；`_parse_exclusion_intent` 使用 `safe_llm_call_sync`；`entity_exclude.py` 无嵌套正则）
  - 5 个行为断言（exclude 意图解析 / restore 意图解析 / 无文档名时 source=None / LLM 失败时不抛异常 / `_run_entity_exclusion_sync` 消费 parse 结果正确排除实体）

---

### 009: `entity_extract` Skill 串行执行且零中间日志

**Priority**: Medium
**Status**: Resolved
**Introduced**: v0.1.0
**Created**: 2026-05-06
**Fixed**: 2026-05-06（Wave 2 第 5-7 切片）
**Discovered During**: 第 1 波路由层 Wave 1 回归测试（[ISSUE_005-006_v0.1.0_REGRESSION_GUIDE.md](test-guides/ISSUE_005-006_v0.1.0_REGRESSION_GUIDE.md)）

**Resolution Summary**：
- 重写 [`backend/skills/entity_extract.py`](../backend/skills/entity_extract.py)：
  - 合并 [`backend/routes/chat.py:139-242`](../backend/routes/chat.py) 的全局缓存查询 + 跨项目实体复制逻辑（避免对已抽取过的文档重复调 LLM）
  - 加入完整生命周期日志：`[SKILL:entity_extract] start/cached/extracting/completed/failed/skipped/done`
  - 新增 keyword-only `progress_cb` 关键字参数，签名 `progress_cb(current, total, label, status)`
  - 单文件失败（status='failed' / 'parse_error' / 异常）不阻塞其他文件，最终消息显式列出失败列表
- 扩展 [`backend/skill_manager.py`](../backend/skill_manager.py)：
  - `validate_skill` 与 `_load_skill_module` 跳过 keyword-only 参数（`progress_cb` 不进入前端 UI 表单）
- 改造 [`backend/routes/chat.py`](../backend/routes/chat.py) 实体抽取分支：
  - 用 `inspect.signature` 检测 Skill 是否声明 `progress_cb`；声明则启用 SSE 桥接
  - 跨线程 `loop.call_soon_threadsafe` + `asyncio.Queue` 把 worker 线程进度事件 push 到 SSE 流
  - 每收到一个进度事件就 `yield {"type": "progress", "current", "total", "label", "status"}`
- 由 [`backend/tests/test_entity_extract_skill.py`](../backend/tests/test_entity_extract_skill.py) 13 条测试守护：
  - 6 个静态日志埋点存在断言
  - 2 个签名约束（progress_cb 存在 + 位置参数向后兼容）
  - 5 个行为断言（缓存命中/progress_cb 调用次数/失败隔离/parse_error 区分/target_file 过滤）

**Original Problem**：

回归测试时发送"帮我从上面的文档中抽取实体"，路由层（Issue 005/006 修复后）正确识别意图并把任务交给已注册 Skill `entity_extract`：

```text
[INTENT] => entity_extraction          ✅
[ENTITY] 使用已注册Skill: entity_extract  ✅
（之后约 10+ 分钟日志完全静默，仅有 worker_status 心跳）
```

事后排查发现两个独立缺陷叠加：

1. **串行循环阻塞** ([`backend/skills/entity_extract.py:34-49`](../backend/skills/entity_extract.py))
   ```python
   for fpath in files:
       ...
       future = executor.submit(extract_entities_sync, ...)
       result = future.result(timeout=180)
   ```
   - 知识库 6 个文件被串行抽取，单文件最长 180s
   - 最坏情况 6 × 180s = **18 分钟**才结束
   - 没有任何并行（`max_workers=1`）

2. **零中间日志** ([`backend/skills/entity_extract.py`](../backend/skills/entity_extract.py))
   - 该 Skill 文件**完全没有 `print` / `logging` 调用**
   - 唯一的反馈是 `return msg` 在最末尾返回的字符串
   - 同位置的 [`chat.py:_run_entity_extraction_sync`](../backend/routes/chat.py) 实现版本反而有完整日志（`[ENTITY] 开始抽取`、`[ENTITY] 直接抽取成功`、`[ENTITY] 已有缓存`、`[ENTITY] 抽取超时`），但已注册 Skill 路径绕过了这套日志

3. **观察现场证据**
   - 后端 worker pid 一直在跑（CPU 0.0% / 等 IO）
   - 浏览器 SSE 连接 `127.0.0.1:8000<->127.0.0.1:62208` 一直 ESTABLISHED
   - 后端日志静默，开发者和用户都无法判断"是真的卡死了"还是"在等 LLM"
   - 实际是后者，但需要 lsof 端口 7897 才能确认在等 OpenAI 返回

**Expected Behavior**：
- Skill 在每一步关键节点输出结构化日志（开始 / 进度 / 完成 / 失败 / 跳过）
- 多文件场景使用并发（`asyncio.gather` 或 `ThreadPoolExecutor(max_workers=N)`）
- 单文件超时不应阻塞其他文件
- 已存在缓存命中的文件应被跳过（参考 `chat.py:_run_entity_extraction_sync` 的 `global_cache` 分支）

**Current Behavior**：
- 6 个文件全部从头跑一遍，无缓存复用
- 串行阻塞，单文件慢 → 全部慢
- 中途无任何日志 → 表象等同于"挂起"

**Context**：
- 影响文件：[`backend/skills/entity_extract.py`](../backend/skills/entity_extract.py)
- 同样模式可能存在于：所有未来由 LLM 生成的 Skill（参见 Issue 001）
- 影响范围：所有以"扫描多个文件"为模式的 Skill 任务

**Root Cause**：
- Skill 文件由人工首次实现，没有按"长任务最佳实践"设计（无日志、无并发、无缓存）
- 将来如 Issue 001 修复后由 LLM 动态生成 Skill，如不在 prompt 中明确要求，仍会复制此反模式

**Proposed Solution**：
1. 短期修复：
   - 在 `entity_extract.py` 每个文件循环开始/结束/失败时 `print(f"[SKILL:entity_extract] ...")`
   - 引入并发：`ThreadPoolExecutor(max_workers=3)` 或 `asyncio.gather` + `asyncio.Semaphore(3)`
   - 复用 `chat.py:_run_entity_extraction_sync` 的缓存查询逻辑（已有数据库实体的文件直接返回）
2. 长期约束（与 Issue 001 联动）：
   - 定义 Skill 模板规范：所有 Skill 必须在 `run_fn` 入口/每个外部调用前后输出日志
   - LLM 生成 Skill 时，prompt 中显式要求"包含进度日志、并发执行、错误重试"
   - 提供 Skill 工具函数 `with_progress(items, fn, label)` 统一处理批量任务的日志和并发

**关联 F001 原则**：与 F001 五大原则均不直接相关，但**会显著拖慢 F001 验收**（人工测试时无法判断系统行为）；属于"工程质量基础设施"问题
**修复优先级建议**：P1 — 在 Wave 2 (001 + 008) 之前先修，否则后续生成的所有 LLM-Skill 都会继承这一反模式

---

### 010: OpenAI API 调用无重试，单次超时即返回 0 实体

**Priority**: High
**Status**: Resolved
**Introduced**: v0.1.0
**Created**: 2026-05-06
**Fixed**: 2026-05-06（Wave 2 第 1-4 切片）
**Discovered During**: 第 1 波路由层 Wave 1 回归测试

**Resolution Summary**：
- 新增 [`backend/llm_invoker.py`](../backend/llm_invoker.py)：
  - `safe_llm_call(agent, prompt, ..., max_retries, initial_backoff, fallback_agent)` 异步版
  - `safe_llm_call_sync(...)` 同步版（给 entity_extractor 这类同步路径用）
  - 关键设计：识别两种 agno"伪成功"模式 — `RunOutput.status == ERROR` 与已知错误字符串前缀（"Request timed out"/"API connection error"/"Connection error"/...）
  - 重试链：N 次主调用（指数退避 1s → 2s → 4s）→ fallback agent 1 次 → 抛 `LLMCallError(reason, attempts)`
  - `LLMResult{ok, content, reason, attempts, used_fallback}` 让上层精确区分"主成功"/"兜底成功"/"调用失败"
- 改造 [`backend/entity_extractor.py:71`](../backend/entity_extractor.py)：
  - 把 `extractor.run(...)` 替换为 `safe_llm_call_sync(extractor, truncated, max_retries=3, initial_backoff=1.0)`
  - 捕获 `LLMCallError` 返回 `{"status": "failed", "entities_count": 0, "error": ..., "attempts": ...}` 显式失败标记
  - 新增 `status` 字段三态：`ok` / `failed`（LLM 调用失败）/ `parse_error`（模型返回非 JSON）— 上层据此精确区分
- 由 [`backend/tests/test_llm_invoker.py`](../backend/tests/test_llm_invoker.py) 13 条 + [`backend/tests/test_entity_extractor_uses_safe_llm.py`](../backend/tests/test_entity_extractor_uses_safe_llm.py) 7 条共 20 条测试守护：
  - `RunOutput(status=ERROR, content="Request timed out.")` 必须被识别为失败而非"成功 content"
  - 重试间隔严格指数退避（0.5s/1.0s/2.0s）
  - 全部失败必须抛 `LLMCallError`（不允许伪装"成功 0 实体"）
  - `extract_entities_sync` 失败时不允许返回不带 `status` 字段的 dict

**Original Problem**：

回归测试中观察到 OpenAI API 超时直接导致整次抽取失败：

```text
ERROR    API connection error from OpenAI API: Request timed out.
ERROR    Error in Agent run: Request timed out.
[ENTITY] JSON 解析失败: Expecting value: line 1 column 1 (char 0), raw=Request timed out.
[ENTITY] 自动抽取完成: 北京热力集团智能体建设技术方案-260204.docx -> 0 实体, 0 关系
```

排查 [`backend/entity_extractor.py:48-97`](../backend/entity_extractor.py) 发现：

1. **单次调用，无重试** ([`backend/entity_extractor.py:71`](../backend/entity_extractor.py))
   ```python
   response = extractor.run(truncated, stream=False)
   raw = response.content or ""
   ```
   - 调用 agno `Agent.run` 一次即用，没有 `for attempt in range(3)` / 指数退避
   - 网络抖动 / 限流 / Provider 5xx 都会立即"失败"

2. **异常被 agno 框架吞成字符串**
   - OpenAI SDK 抛出的 timeout 异常被 agno 的 `Agent.run` 内部 `except` 捕获
   - 然后把异常消息（"Request timed out."）当作 `response.content` 返回
   - 应用层看到的是"成功返回了一段非 JSON 文本"——而非异常
   - 导致 [`entity_extractor.py:81-85`](../backend/entity_extractor.py) 的 JSON 解析失败分支被触发，吐出 `{"entities_count": 0, "relations_count": 0, "error": ...}`

3. **失败结果被静默写入数据库聚合**
   - 上层 [`chat.py:253-256`](../backend/routes/chat.py) 用 `result.get("entities_count", 0)` 累加
   - 0 实体被算作"成功处理 1 个文档"
   - 用户看到"已从 6 个文档中提取 25 个实体"，但实际是"5 个真失败 + 1 个真成功"

**Expected Behavior**：
- LLM 调用应有重试机制（至少 3 次，指数退避，例如 1s / 4s / 16s）
- 重试失败应抛出明确异常或返回 `{"status": "failed", "reason": "..."}`，**不可与"成功 0 实体"混淆**
- 多次失败应触发 F001 原则 5 的 LLM 兜底链：切换更小模型 / 简化 prompt / 拆分文本块重试
- 真正失败的文件应在用户消息中显式列出（区分"成功 0 实体"和"调用失败"）

**Current Behavior**：
- 一次超时 = 永久失败
- 失败被伪装成"成功 0 实体"
- 用户和日志都无法区分"文档没实体"和"OpenAI 挂了"
- 与 F001 原则 5 直接冲突——LLM 主调用失败时应仍由 LLM 完成兜底

**Context**：
- 影响文件：
  - [`backend/entity_extractor.py:48-97`](../backend/entity_extractor.py) — 抽取层
  - [`backend/skills/entity_extract.py`](../backend/skills/entity_extract.py) — Skill 层（同样无重试）
  - [`backend/routes/chat.py:419-475`](../backend/routes/chat.py) — `_CAPABILITY_TEMPLATES` 中的模板版本
  - 推断：所有调用 `agno.Agent.run` 的位置都有同样问题
- 影响范围：实体抽取、未来所有 Skill 生成、意图分类的 LLM 调用（Issue 006 修复中已部分覆盖，但底层机制仍缺失）

**Root Cause**：
- agno 框架默认行为是"吞掉异常返回字符串"，应用层未显式拦截
- 没有定义统一的"LLM 调用工具函数"——每个调用方各写各的，没有重试 / 指数退避 / 异常分类
- 缺少"LLM 调用结果"与"业务结果"的区分（成功 0 实体 vs LLM 失败）

**Proposed Solution**：
1. 引入统一的 LLM 调用工具 `backend/llm_invoker.py`：
   ```python
   async def safe_llm_call(
       agent: Agent,
       prompt: str,
       *,
       max_retries: int = 3,
       initial_backoff: float = 1.0,
       fallback_model: str | None = None,
   ) -> LLMResult:
       """
       Returns:
         LLMResult.ok(content)  - 调用成功，content 是文本
         LLMResult.failed(reason) - 重试耗尽 / 兜底耗尽
       """
   ```
2. 改造 `entity_extractor.py:71` 改用 `safe_llm_call`，区分三种结果：
   - 成功且 JSON 合法 → 抽取实体
   - 成功但 JSON 非法 → 重试 1 次后兜底报告"模型未按格式返回"
   - LLM 失败 → 抛出异常，让上层标记该文件为 `failed`，**不计入 processed**
3. 同步约束：
   - Skill 内部所有 LLM 调用必须经过 `safe_llm_call`
   - 在 Issue 001 修复后，LLM 生成 Skill 的 prompt 中明确要求使用此工具
4. 用户可见反馈：失败文件单独列在结果消息中，例如
   `已成功抽取 5 个文档（25 实体），1 个文档因 LLM 超时失败：xxx.docx`

**关联 F001 原则**：原则 5（LLM 主调用失败时必须仍由 LLM 兜底）—— 当前实现"主调用失败 → 静默 0 实体"是对原则 5 最直接的违反
**修复优先级建议**：P0 — 与 Issue 005/006 同等优先级；005/006 修复了"路由层"的 LLM 兜底，010 修复"执行层"的 LLM 兜底，二者构成 F001 原则 5 的完整闭环

---

### 011: 长任务 SSE 缺少 progress 事件，前端只能干转圈

**Priority**: Medium
**Status**: Resolved
**Introduced**: v0.1.0
**Created**: 2026-05-06
**Fixed**: 2026-05-06（Wave 3.5 前端进度渲染）
**Discovered During**: 第 1 波路由层 Wave 1 回归测试

**Final Resolution Summary**（Wave 3.5）：
- `src/services/api.ts`：`TeamChatEvent` 新增 `progress` 和 `heartbeat` 类型，`progress` 事件携带 `current` / `total` / `label` 字段
- `src/components/ProjectChat.tsx`：
  - 新增 `SubTaskProgress` 接口和 `progressMap` state（`Record<slot_id, SubTaskProgress>`）
  - 新增 `progress` 事件分支：更新对应 slot_id 的进度状态
  - 新增 `heartbeat` 事件分支：静默忽略，保持 SSE 连接
  - `plan_created` 时清空 `progressMap`（重置进度）
  - `subtask_completed` 时删除对应 slot 的进度记录
  - `SubTaskCard` 组件扩展：接受可选 `progress` prop，执行中时渲染蓝色进度条 + 百分比 + 当前文件标签（current/total）

**Partial Resolution Summary**（Wave 2 第 7 切片）：
- 后端侧已经在 `entity_extraction` 分支通过 `progress_cb` + `asyncio.Queue` 桥接 SSE，
  发出 `{"type": "progress", "current", "total", "label", "status"}` 事件。
- **待补**：
  - 前端需要新增 `progress` 事件的渲染（进度条 + 当前文件名 + 状态图标）
  - 心跳机制（每 10s 一个 `heartbeat` 事件）尚未引入
  - 同套桥接需要扩展到 `entity_exclusion` 等其他长任务分支
- 因前端改动不在 Wave 2 范围（聚焦后端 Issue 010/009），保留 Open，待 Wave 3 一并完成。

**Original Problem**：

回归测试时用户多次反馈"抽取实体一直在执行中"。排查发现 SSE 流确实保持连接（`127.0.0.1:8000<->127.0.0.1:62208 ESTABLISHED`），但 [`backend/routes/chat.py:701-738`](../backend/routes/chat.py) 在 `entity_extraction` 路径上只发送了 4 类事件：

```python
yield _sse({"type": "plan_created", ...})
yield _sse({"type": "subtask_started", ...})
result_text = await asyncio.to_thread(skill["run_fn"], ...)   # ← 此处可能阻塞 18 分钟
yield _sse({"type": "subtask_completed", ...})
yield _sse({"type": "summary", "content": result_text, ...})
yield _sse({"type": "done", ...})
```

中间的 `await asyncio.to_thread(...)` 是一个**整段阻塞**——整个 Skill 执行期间，前端收不到任何事件。前端 UI 表现为：
- 进度条卡在 0%（或转圈动画无限循环）
- 用户怀疑系统死掉了，反复刷新或取消任务
- 即使后端正常完成，用户也已失去信任

**Expected Behavior**：
- 长任务 Skill 应能向 SSE 流推送 `progress` 事件（如 `{"type": "progress", "current": 2, "total": 6, "label": "正在处理 xxx.docx"}`）
- 前端根据事件渲染进度条 + 当前文件名 + 已用时间
- 单文件失败时立即推送 `subtask_warning` 事件，让用户实时知道哪个文件失败
- 心跳机制：即使没有进度变化，每 N 秒推送一个 `heartbeat` 事件防止用户和反向代理误判超时断开

**Current Behavior**：
- 前端在 `subtask_started` 后就再无新事件，直到 `subtask_completed`
- 中间不论 1 秒还是 18 分钟，UI 表现完全一致
- 用户无法区分"任务在进行"和"任务卡死"

**Context**：
- 影响文件：
  - [`backend/routes/chat.py:701-738`](../backend/routes/chat.py) — entity_extraction 分支
  - [`backend/routes/chat.py:740+`](../backend/routes/chat.py) — entity_exclusion 分支（同样模式）
  - [`backend/skills/entity_extract.py`](../backend/skills/entity_extract.py) — Skill 内部循环（应能向外暴露进度回调）
  - 推断：所有 `await asyncio.to_thread(skill["run_fn"], ...)` 调用点
- 影响范围：所有耗时超过 5 秒的任务执行

**Root Cause**：
- Skill 接口设计为"同步函数返回字符串"，没有进度回调通道
- SSE 流和 Skill 执行被 `asyncio.to_thread` 完全隔离，进度无法穿越
- 前端没有约定 `progress` / `heartbeat` 事件类型

**Proposed Solution**：
1. 扩展 Skill 接口：
   ```python
   def run(project_id, task_id="", target_file="", *, progress_cb=None) -> str:
       ...
       for i, fpath in enumerate(files):
           if progress_cb: progress_cb(current=i+1, total=len(files), label=fpath.name)
           ...
   ```
2. 后端 SSE 路径改造：
   - 用 `asyncio.Queue` 桥接 worker 线程的 `progress_cb` 与 SSE 异步循环
   - 每收到一个进度事件就 `yield _sse({"type": "progress", ...})`
   - 同时启动一个心跳任务：每 10s 推送 `{"type": "heartbeat"}`（即使没有进度变化）
3. 前端约定：
   - 渲染 `progress` 事件为进度条 + 当前文件名 + 已用时间
   - 渲染 `subtask_warning` 为黄色提示
   - 收到 `heartbeat` 时刷新"最后心跳时间"显示
4. 与 Issue 009 联动：Skill 在每个外部调用前后调 `progress_cb`，自然就同时有了日志和前端进度

**关联 F001 原则**：与 F001 五大原则不直接相关，但**严重影响 F001 验收的人工测试体验**；属于"长任务可观测性"问题
**修复优先级建议**：P2 — 在 Issue 009 修复后顺带做（共用 Skill 接口扩展），独立修复价值低

---

## Summary

**Total Issues**: 11
**Open Issues**: 6
**Partial**: 1（011 — 后端已落地，前端渲染待补）
**Resolved Issues**: 4（005, 006, 009, 010）

**Priority Distribution**:
- High Open: 3（001, 002, 003）
- Medium Open: 3（004, 007, 008）
- Partial: 1（011）
- Low: 0

**Next to Resolve**:
- **Wave 3（生成层）**：001 + 008 一起改 — 用 LLM 替换 `_CAPABILITY_TEMPLATES`，同步去除 Skill 内嵌正则
- **Wave 3.5（前端进度）**：011 完成 — 前端渲染 `progress` SSE 事件 + 引入 heartbeat
- **Wave 4（学习层）**：002 + 004 一起改 — 引入 `extraction_rules` 表与规则学习闭环

---

## Notes

---

### 012: 用户设置规则后缓存未失效，新规则对已缓存文档无效

**Priority**: Medium
**Status**: Resolved
**Introduced**: v0.1.0
**Created**: 2026-05-06
**Fixed**: 2026-05-06（Wave 5 补丁，与 Issue 003 一并修复）

**Resolution Summary**：
- 修改 `backend/skills/entity_extract.py`：在构建 `global_cache` 前调用 `load_rules(project_id)`
- 若项目有学习规则（`len(project_rules) > 0`），则 `global_cache` 保持空字典，强制所有文档跳过缓存、重新调用 LLM
- 若项目无规则，缓存行为不变，避免 regression
- 日志：有规则时打印 `[SKILL:entity_extract] project has N rule(s), bypassing cache`
- 守护测试：[`backend/tests/test_cache_invalidation_on_rules.py`](../backend/tests/test_cache_invalidation_on_rules.py)：4 条测试

**Original Problem**：

手动测试发现：用户通过 `rule_learning` 意图设置新规则（如"不要把 AI 算法服务抽成实体"）后，立即再次触发实体抽取时，如果该文档命中了旧缓存（`entity_extract` Skill 的文档级缓存），LLM **不会被重新调用**，新规则无法生效。

复现步骤：
1. 执行一次实体抽取，文档结果被缓存
2. 输入规则：「不要把 AI 算法服务成实体，记住这个规则」→ 规则保存成功
3. 立即输入：「重新抽取实体」→ 日志显示"命中缓存，未重复调用 LLM"
4. 结果：抽取数量未变化，新规则未生效

**Expected Behavior**：
- 用户设置新规则后，相关文档的抽取缓存应自动失效
- 下次抽取强制用新 prompt（含规则）调用 LLM，排除规则中指定的实体

**Current Behavior**：
- 缓存以文档内容 hash 为 key，不感知 `extraction_rules` 变更
- 规则保存成功，但缓存命中导致新规则"沉默失效"，用户无感知

**Context**：
- 影响文件：`backend/skills/entity_extract.py`（缓存逻辑）、`backend/rule_manager.py`（规则保存时机）
- 影响范围：Wave 4 规则学习的完整闭环

**Root Cause**：
- `entity_extract` Skill 的缓存 key 仅基于文档内容 hash，未加入项目规则的 hash/版本号
- 规则保存时未通知缓存层失效

**Proposed Solution**：
1. 将 `load_rules(project_id)` 的结果 hash 加入缓存 key 计算（规则变化 → 缓存 miss）
2. 或：`save_rule` 保存规则后，主动清除该 project_id 下所有文档缓存

**关联 F001 原则**：原则 4（规则约束必须由大模型从对话中学习并持久化）— 规则持久化后如果无法生效，等价于规则学习没有落地
**修复优先级建议**：P1 — 与 Issue 002/004 配套，不修复则规则学习形同虚设

---

### F001 原则覆盖矩阵

| Issue | 原则 1 意图理解 | 原则 2 任务路由 | 原则 3 Skill 生成 | 原则 4 规则学习 | 原则 5 LLM 兜底 | 工程基础设施 |
|-------|----------------|----------------|------------------|----------------|----------------|------------|
| 001 | | | ✅ | | | |
| 002 | | | | ✅ | | |
| 003 | ✅ | | | ✅ | | |
| 004 | ✅ | | | ✅ | | |
| 005 | ✅ | | | | | |
| 006 | | ✅ | | | ✅ | |
| 007 | ✅ | | ✅ | | | |
| 008 | ✅ | | | | | |
| 009 | | | | | | ✅（可观测性 / 并发） |
| 010 | | | | | ✅ | ✅（重试 / 异常分类） |
| 011 | | | | | | ✅（SSE 进度 / 心跳） |
| 012 | | | | ✅ | | ✅（缓存失效策略） |

> **说明**：Issue 009/011 不直接对应 F001 五大原则，但属于"长任务可靠性 / 可观测性"的工程基础设施。它们不修复，将持续污染 F001 后续 Wave 的人工验收信号——例如"无法判断 Skill 是真在工作还是卡死"。Issue 010 同时是 F001 原则 5 的执行层缺口和 LLM 调用基础设施缺口。

### 建议修复顺序

1. **第一波（路由层）✅ 已完成（Wave 1）**：005 + 006 一起改 → 删除 4 套关键词 + 引入 LLM 兜底链
2. **第二波（执行层 LLM 兜底 + Skill 可观测性）✅ 已完成（Wave 2）**：010 + 009 → 统一 `safe_llm_call_sync` 重试封装；重写 `entity_extract` Skill 加缓存/日志/progress_cb；后端 SSE 桥接
3. **第三波（生成层）✅ 已完成（Wave 3）**：001 + 008 → LLM 动态生成 Skill 代码（`ast.parse` 校验）；entity_exclusion 路径改为 LLM 解析意图；新建 `entity_exclude.py` Skill（无正则）
4. **第三波·补丁（前端进度渲染）**：011 → 前端渲染后端已发出的 `progress` 事件；引入 `heartbeat`
5. **第四波（学习层）**：002 + 004 一起改 → 引入 `extraction_rules` 表与规则学习闭环
6. **第五波（自适应层）**：003 → 抽取流程读取规则并应用
7. **第六波（扩展层）**：007 → 让意图集合由注册表动态生成

每一波修复都应遵循 TDD 原则，并对照 F001 验收标准的对应条目逐项勾选。
