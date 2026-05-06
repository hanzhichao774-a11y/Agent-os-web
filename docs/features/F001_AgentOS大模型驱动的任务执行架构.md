# F001: AgentOS 大模型驱动的任务执行架构

> **功能编号**: F001
> **状态**: ✅ **完成**（Wave 1~6 + Wave 3.5 全部完成，全部 12 个 Issue Resolved）
> **创建时间**: 2026-05-06
> **最近更新**: 2026-05-06（Wave 6 完成 — Issue 007 Resolved：build_intent_registry 动态注册表 + Skill SKILL_META 声明 intent + 通用 Skill 意图分发）
> **版本**: v0.1.0
> **优先级**: High
> **类别**: New Feature（架构层 / 跨切面）

---

## 功能概述

AgentOS 是一个**由大模型自主驱动的任务执行系统**。从用户在对话框中说出一句话开始，到系统理解意图、决定路由、规划任务、调用 Skill/Tool、生成产物、沉淀规则，整条链路都应由 LLM 完成决策，**而不是由硬编码关键词、字符串模板和正则表达式拼凑**。

F001 不是一个孤立的功能模块，而是一条贯穿 AgentOS 全部任务执行 Feature 的**架构原则**。它必须先成立，AgentOS 在 [`feature/AgentOS_FEATURE_LIST_v0.1.0.md`](../../feature/AgentOS_FEATURE_LIST_v0.1.0.md) 中定义的 WorkAgent 编排（F-013/F-020）、Sub-Agent 动态调用（F-017）、HubAgent Skill 创建引导（F-023）、知识图谱自动沉淀（F-029/F-030）等 Feature 才有真正"AI 自主"的语义；否则它们都只是套了 Agent 外壳的硬编码流程。

---

## 一、跨切面原则

| # | 原则 | 简述 |
|---|------|------|
| 原则 1 | 意图理解必须由大模型完成 | 不允许预定义关键词列表判定用户意图 |
| 原则 2 | 任务路由必须由大模型决策 | 不允许硬编码触发词作为路由降级 |
| 原则 3 | Skill 必须由大模型生成 | 不允许字符串模板复制式的"创建" |
| 原则 4 | 规则约束必须由大模型从对话中学习并持久化 | 用户反馈必须沉淀为可追溯的规则 |
| 原则 5 | 兜底失败方案必须仍是 LLM | 主调用失败应切换更小模型/简化 prompt，不能回到关键词 |

每条原则的详细说明见 [`docs/FEATURE_LIST.md` § F001](../FEATURE_LIST.md#f001-agentos-大模型驱动的任务执行架构)。

---

## 二、影响范围（受同根问题影响的子能力）

| 子能力 | 当前位置 | 对应 AgentOS Feature | 受影响原则 |
|--------|---------|---------------------|-----------|
| BizAgent / HubAgent 意图路由 | [`backend/routes/chat.py`](../../backend/routes/chat.py) `classify_intent` + `_keyword_fallback` | F-004, F-006, F-013 | 1, 2, 5 |
| WorkAgent 任务规划 | [`backend/orchestrator.py`](../../backend/orchestrator.py) `plan_task` | F-013, F-020 | 1, 2 |
| Sub-Agent 动态调用 Skill | [`backend/orchestrator.py`](../../backend/orchestrator.py) `_run_subtask` | F-017 | 2, 3 |
| HubAgent Skill 创建引导 | [`backend/routes/chat.py`](../../backend/routes/chat.py) `_handle_create_skill` | F-023 | 3 |
| 项目知识图谱自动沉淀 | [`backend/entity_extractor.py`](../../backend/entity_extractor.py) | F-029, F-030 | 1, 4 |
| 实体抽取规则学习 | （F001 自身能力，当前缺失） | F-030 / F001 | 4 |
| 实体排除/恢复 | [`backend/routes/chat.py`](../../backend/routes/chat.py) `_handle_create_skill` 内嵌的 `entity_exclude` 模板 | F-030 / F001 | 1, 3, 4 |

---

## 三、当前硬编码症状全清单

实际代码中违反 F001 原则的位置共 **8 处**，按"严重程度 / 主路径影响面"排序：

### 症状 1（严重）：意图路由依赖 4 套硬编码关键词列表

| 列表 | 位置 | 用途 | 条目数 |
|------|------|------|--------|
| `_ORCHESTRATE_KEYWORDS` | [`chat.py:23-35`](../../backend/routes/chat.py) | 判断是否走 SubAgent 编排 | 24 |
| `_DIRECT_ENTITY_KEYWORDS` | [`chat.py:44-49`](../../backend/routes/chat.py) | 判断是否走实体抽取 | 10 |
| `_ENTITY_EXCLUSION_KEYWORDS` | [`chat.py:51-57`](../../backend/routes/chat.py) | 判断是否走实体排除 | 10 |
| `_CREATE_SKILL_KEYWORDS` | [`chat.py:90-94`](../../backend/routes/chat.py) | 判断是否走 Skill 封装 | 10 |

→ 违反 **原则 1**（意图理解）。用户必须用系统预设的"咒语"才能触发对应能力。

### 症状 2（严重）：意图分类失败即降级到硬编码关键词

[`chat.py:128-134`](../../backend/routes/chat.py)（LLM 超时即 `return None`）+ [`chat.py:137-147`](../../backend/routes/chat.py)（`_keyword_fallback` 串联调用上面 4 套列表）。

→ 违反 **原则 2 + 原则 5**。这意味着只要 LLM 一抖动，整套硬编码就会接管路由，硬编码的存在不是"备用"，而是**始终生效的真实路由表**。

### 症状 3（严重）：意图类别枚举写死

[`chat.py:79-86`](../../backend/routes/chat.py)（`_CLASSIFY_PROMPT` 内 5 类）+ [`chat.py:88`](../../backend/routes/chat.py)（`_VALID_INTENTS` tuple）。新加一个 Skill 类型必须改代码并发版，无法由 Skill 注册动态扩展。

→ 违反 **原则 1 + 原则 3**。

### 症状 4（严重）：`_CAPABILITY_TEMPLATES` 整段静态 Skill 代码

[`chat.py:419-556`](../../backend/routes/chat.py)。预置了 `entity_extract` 和 `entity_exclude` 两段完整 Skill 源码字符串，所谓"封装技能"就是把这段字符串写到文件里。

→ 违反 **原则 3**。技能内容与用户、项目、文档特征完全无关。

### 症状 5（严重）：`_handle_create_skill` 仅做模板匹配 + 文件复制

[`chat.py:559-594`](../../backend/routes/chat.py)。匹配触发词 → 找到模板 → `skill_file.write_text(tpl["content"])` → `scan_skills()`。整个过程没有任何 LLM 参与，没有任何用户上下文进入生成。

→ 违反 **原则 3**。

### 症状 6（中）：Skill 模板内嵌硬编码正则做文档名提取

[`chat.py:508-520`](../../backend/routes/chat.py)（位于 `entity_exclude` 模板字符串内部）：

```python
patterns = [
    r'([\w\(\)（）\-]+\.(?:pdf|md|docx|xlsx|csv|txt|doc|pptx))',
    r'([A-Za-z0-9_\-]+\.[A-Za-z0-9]+)',
    r'[「"](.*?)[」"]',
]
```

→ 违反 **原则 1**。即使将来 Skill 改成由 LLM 生成，目前这段嵌套硬编码也展示了"AI 外壳 + 硬编码内核"的反模式。

### 症状 7（中）：实体排除/恢复行为靠关键词判定

[`chat.py:505`](../../backend/routes/chat.py) 在 `entity_exclude` 模板内：

```python
is_restore = any(kw in instruction for kw in ("恢复", "还原", "取消排除", "重新加入", "加回"))
```

→ 违反 **原则 1**。

### 症状 8（中）：实体排除是一次性数据操作，没有规则沉淀

[`chat.py:540-553`](../../backend/routes/chat.py)。用户说"不要把章节标题抽成实体"，系统只是把已有的章节标题实体的 `excluded` 字段置 1，不写入任何"未来抽取请避开此类"的规则。下次再抽取时同样的章节标题会再次被生成出来。

→ 违反 **原则 4**。

---

## 四、期望架构对比

| 维度 | 现状（违反 F001） | 期望（符合 F001）|
|------|------------------|------------------|
| 意图判定 | 4 套关键词列表 + LLM 主路径 | 仅 LLM；Prompt 中可注入"已注册 Skill 列表"作为可选意图 |
| 路由降级 | LLM 失败 → 关键词匹配 | LLM 失败 → 切换更小模型/简化 prompt 重试 |
| 意图集合 | `_VALID_INTENTS` 写死 5 类 | 由 Skill 注册表动态生成；新 Skill 注册即新增意图 |
| Skill 创建 | 触发词 → 模板字符串 → 写文件 | LLM 生成完整代码（引用当前规则、用户偏好、文档特征）→ 沙箱校验 → 写文件 |
| Skill 内部解析 | 嵌套硬编码正则提取参数 | Skill 内部也通过结构化 LLM 调用解析 |
| 用户反馈 | 删除已抽取实体即结束 | 1) LLM 解析为结构化规则 → 2) 持久化到 `extraction_rules` 表 → 3) 删除已抽取实体 → 4) 后续抽取自动加载该规则 |
| 规则可追溯 | 无 | 每条规则记录"在哪次会话/哪条消息中被设定"，支持回看与撤销 |

---

## 五、验收标准（与 [`docs/FEATURE_LIST.md`](../FEATURE_LIST.md) 同步）

- [x] 代码库内不再存在意图路由用的硬编码关键词列表（症状 1 全部移除） — 2026-05-06
- [x] `_keyword_fallback` 类型的关键词降级路径被移除（症状 2 修复） — 2026-05-06
- [ ] `_VALID_INTENTS` / `_CLASSIFY_PROMPT` 的意图集合可由 Skill 注册动态扩充（症状 3 修复）
- [ ] `_CAPABILITY_TEMPLATES` 字典与字符串模板复制逻辑被移除（症状 4 + 5 修复）
- [ ] Skill 创建调用 LLM 生成完整代码，且生成内容会引用当前已学习的规则
- [ ] Skill 内部不再嵌套硬编码正则做意图/参数解析（症状 6 修复）
- [ ] 实体排除/恢复的方向判定由 LLM 完成（症状 7 修复）
- [ ] 用户在对话中说"不要把章节标题抽成实体"，规则被持久化（症状 8 修复）
- [ ] 后续相同类型的实体抽取自动加载该规则，不再产生被排除项
- [x] 主调用 LLM 失败时，没有任何执行路径会走回到关键词匹配（路由层） — 2026-05-06
- [x] **执行层 LLM 调用失败时仍由 LLM 兜底**（重试 + 异常分类 + fallback agent，绝不"成功 0 实体"伪装失败） — 2026-05-06（Wave 2）
- [x] **长任务 Skill 内部具备进度日志 + 进度回调**（`progress_cb` + `[SKILL:...]` 日志），单文件失败不阻塞其他文件 — 2026-05-06（Wave 2）

**已修复测试守护**：
- [`backend/tests/test_intent_routing_no_hardcode.py`](../../backend/tests/test_intent_routing_no_hardcode.py)（13 个测试）— 症状 1、2 路由层
- [`backend/tests/test_llm_invoker.py`](../../backend/tests/test_llm_invoker.py)（13 个测试）— 执行层 LLM 兜底
- [`backend/tests/test_entity_extractor_uses_safe_llm.py`](../../backend/tests/test_entity_extractor_uses_safe_llm.py)（7 个测试）— 实体抽取必须经 safe_llm_call_sync
- [`backend/tests/test_entity_extract_skill.py`](../../backend/tests/test_entity_extract_skill.py)（13 个测试）— Skill 缓存 + 日志 + progress_cb + 失败隔离

---

## 六、应用场景示例：知识图谱实体抽取与规则学习

> 本节是 F001 在"知识图谱"场景下的具体展开（即原 F001 的内容）。它演示了 5 条原则在一个具体闭环里如何协同。

### 场景流程

```
1. 用户在 BizAgent 对话中说："帮我从知识库里抽取实体"
   → 原则 1：LLM 理解为 entity_extraction 意图（不依赖 _DIRECT_ENTITY_KEYWORDS）
   → 原则 2：路由到实体抽取执行路径

2. 系统先加载该项目的 extraction_rules（之前学到的规则）
   → 原则 4：规则参与本次抽取

3. LLM 完成抽取，写入数据库
   → 用户在对话区看到实体列表

4. 用户说："不要把章节标题、页码、日期抽成实体"
   → 原则 1：LLM 理解为 rule_learning 意图
   → 原则 4：LLM 解析出结构化规则：
       {type: exclude_entity_type, patterns: ["章节标题", "页码", "日期"], scope: "project"}
   → 规则持久化到 extraction_rules 表
   → 同步删除当前已抽取的对应实体

5. 用户说："把刚才的实体抽取流程封装成技能"
   → 原则 3：LLM 读取当前项目的 extraction_rules，生成包含这些规则的 Skill 代码
   → 不是从模板复制，而是包含个性化排除逻辑的代码

6. 一周后用户再次抽取
   → 自动加载已注册的 Skill + 已学习的 extraction_rules
   → 章节标题、页码、日期不再被抽取
   → 不会"重复犯同样的错"
```

### 期望的 Skill 代码示例（由 LLM 生成，非模板复制）

```python
SKILL_META = {
    "name": "实体抽取（含本项目排除规则）",
    "description": "从知识库抽取实体，应用项目 P-123 已学习的 7 条排除规则",
    "generated_by": "llm",
    "generated_at": "2026-05-06T14:32:00",
    "rules_snapshot": ["chapter_title", "page_number", "date_literal", ...],
}

def run(project_id: str, target_file: str = "") -> str:
    rules = load_extraction_rules(project_id)
    text = read_documents(target_file)
    # LLM 生成的提示词中已经把规则编织进去
    prompt = build_extraction_prompt(text, exclude_rules=rules)
    entities = llm_extract(prompt)
    save_entities(project_id, entities, source=target_file)
    return f"完成，共抽取 {len(entities)} 个实体（已应用 {len(rules)} 条排除规则）"
```

对比当前 [`chat.py:419-481`](../../backend/routes/chat.py) 的 `entity_extract` 模板：现版本里没有"应用规则"，没有"包含项目特征"，对所有项目执行的代码字面量完全一样。

---

## 七、漂移状态

详见：
- [漂移检测报告（架构层）](../analysis/DRIFT_REPORT_2026-05-06.md)
- [已知问题列表](../KNOWN_ISSUES.md)

---

## 八、相关 Issue

- [Issue 001](../KNOWN_ISSUES.md#001-系统使用硬编码模板而非动态生成技能)：系统使用硬编码模板而非动态生成技能（症状 4 + 5，原则 3）— ✅ Resolved 2026-05-06（Wave 3）
- [Issue 002](../KNOWN_ISSUES.md#002-缺少对话式实体抽取规则学习机制)：缺少对话式实体抽取规则学习机制（症状 8，原则 4）— ✅ Resolved 2026-05-06（Wave 4：extraction_rules 表 + rule_manager + rule_learning 意图 + 抽取时自动加载规则）
- [Issue 003](../KNOWN_ISSUES.md#003-实体抽取逻辑完全硬编码无自适应)：实体抽取逻辑完全硬编码无自适应（原则 1 + 4）— ✅ Resolved 2026-05-06（Wave 5：focus_on/strategy 正向规则 + build_extraction_exclusion_text 正负向规则双注入）
- [Issue 004](../KNOWN_ISSUES.md#004-实体排除功能无学习能力会重复错误)：实体排除功能无学习能力会重复错误（症状 7 + 8，原则 4）— ✅ Resolved 2026-05-06（Wave 4：entity_exclusion 排除时自动保存 exclude_source 规则）
- [Issue 005](../KNOWN_ISSUES.md#005-意图路由依赖-4-套硬编码关键词列表)：意图路由依赖 4 套硬编码关键词列表（症状 1，原则 1）— ✅ Resolved 2026-05-06（Wave 1）
- [Issue 006](../KNOWN_ISSUES.md#006-意图分类失败降级到硬编码关键词)：意图分类失败降级到硬编码关键词（症状 2，原则 2 + 5）— ✅ Resolved 2026-05-06（Wave 1）
- [Issue 007](../KNOWN_ISSUES.md#007-意图类别枚举写死无法扩展)：意图类别枚举写死，无法扩展（症状 3，原则 1 + 3）— ✅ Resolved 2026-05-06（Wave 6：build_intent_registry + build_classify_prompt 动态构建 + Skill SKILL_META 声明 intent）
- [Issue 008](../KNOWN_ISSUES.md#008-skill-内嵌硬编码正则做文档名提取)：Skill 内嵌硬编码正则做文档名提取（症状 6，原则 1）— ✅ Resolved 2026-05-06（Wave 3）

---

## 九、技术设计

待补充（需要架构重构，建议分阶段）：

1. **阶段 A（移除关键词降级）**：~~把 `_keyword_fallback` 替换为"更小模型 + 简化 prompt"的二级 LLM 兜底；移除 4 套 `_*_KEYWORDS`~~ ✅ 已完成 2026-05-06（采用"简化 prompt + 缩短超时 + 默认 direct_answer"两级 LLM 兜底链）
2. **阶段 B（动态意图集合）**：让 `_CLASSIFY_PROMPT` 从 Skill 注册表动态生成意图候选；移除 `_VALID_INTENTS`
3. **阶段 C（动态 Skill 生成）**：~~用 LLM 替换 `_handle_create_skill`，输入为"用户消息 + 当前项目规则 + 已注册 Skill 列表"，输出为完整 Skill 代码 + 沙箱校验~~ ✅ 已完成 2026-05-06（Wave 3 Issue 001：`_CAPABILITY_TEMPLATES` 删除，`_handle_create_skill` 改为 LLM 生成 + `ast.parse` 校验；entity_exclusion 路径改为 LLM 意图解析 Issue 008）
4. **阶段 D（规则学习闭环）**：~~新增 `extraction_rules` 表 + LLM 解析"用户反馈→规则"+ 抽取流程读取规则 + 规则可追溯查询~~ ✅ 已完成 2026-05-06（Wave 4 Issue 002/004：`rule_manager.py` + `extraction_rules` 表 + `rule_learning` 意图 + 抽取时 `build_extraction_exclusion_text` 注入 + 排除时自动学习 `exclude_source` 规则）

---

## 十、测试计划

待补充（使用 `/human-test-guide` 生成）

---
