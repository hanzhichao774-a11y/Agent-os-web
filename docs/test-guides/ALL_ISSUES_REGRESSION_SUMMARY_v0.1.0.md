# AgentOS v0.1.0 — 全 12 Issue 回归测试场景汇总

> **版本**: v0.1.0
> **生成日期**: 2026-05-06
> **状态**: 全部 12 个 Issue 已 Resolved
> **关联特性**: [F001 AgentOS 大模型驱动的任务执行架构](../features/F001_AgentOS大模型驱动的任务执行架构.md)

---

## 快速索引

| Wave | Issue | 标题 | 测试场景数 |
|------|-------|------|-----------|
| Wave 1 | 005 + 006 | 路由层硬编码移除 + LLM 兜底链 | 10 个用例 + 4 个边界 |
| Wave 2 | 010 + 009 | 执行层 LLM 重试 + Skill 可观测性 | 6 个场景 |
| Wave 3 | 001 + 008 | LLM 动态 Skill 生成 + 排除意图解析 | 4 个场景 |
| Wave 3.5 | 011 | 前端 SSE progress 进度条渲染 | 3 个场景 |
| Wave 4 | 002 + 004 | 规则学习层（学习 + 持久化 + 排除联动） | 3 个测试场景 |
| Wave 5 | 003 + 012 | 自适应抽取 + 缓存失效 | 3 个场景 |
| Wave 6 | 007 | 动态意图注册表 | 3 个场景 |

---

## Wave 1 — Issue 005 + 006：路由层硬编码移除

**修复内容**：删除 4 套硬编码关键词列表（`_ORCHESTRATE_KEYWORDS` 等），移除 `_keyword_fallback`；引入两级 LLM 兜底链。

### 场景 A：传统触发词正向回归（确保 LLM 路径没有破坏原有能力）

**TC-001** 输入 `帮我从知识库里抽取实体`
- 预期路由：`[INTENT] => entity_extraction`
- 前端出现进度卡片 → 最终显示实体数量汇总

**TC-002** 输入 `帮我生成一份热力简报 PDF`
- 预期路由：`[INTENT] => orchestrate`
- 前端出现 SubAgent 编排卡片

**TC-003** 输入 `帮我把实体抽取封装成技能`
- 预期路由：`[INTENT] => create_skill`

**TC-004** 输入 `你好，能介绍一下你自己吗？`
- 预期路由：`[INTENT] => direct_answer`
- 不触发任何执行流

### 场景 B：同义词路由（核心改进点）

**TC-005** 输入 `把这堆资料里的关键概念都拎出来形成一张关系网`
- 消息中无"抽取/实体"等旧关键词
- 预期路由：`[INTENT] => entity_extraction`

**TC-006** 输入 `刚才那个文档里的内容别再当成实体了`
- 消息中无"排除/删除"等旧关键词
- 预期路由：`[INTENT] => entity_exclusion`

**TC-007** 输入 `把这套抽实体的流程做成一个能反复使用的能力`
- 预期路由：`[INTENT] => create_skill`

**TC-008** 输入 `我们昨天讨论的实体抽取效果怎么样？`（含关键词但语义为询问）
- 预期路由：`[INTENT] => direct_answer`（旧实现会误触发实体抽取）

### 场景 C：硬编码已移除验证

**TC-009** 完成 TC-001～TC-008 后检查后端日志
- 全程**不出现** `[INTENT] 降级关键词` 字样
- 全程日志格式为 `[INTENT] => xxx`

### 场景 D：兜底链行为（高级）

**TC-010** 临时将 API Key 改为无效值，发送 `帮我从知识库抽取实体`
- 日志依次出现：主调用失败 → 兜底 LLM 失败 → 默认 `direct_answer`
- **关键**：全程不出现关键词降级

### 边界用例

| 编号 | 输入 | 预期 |
|------|------|------|
| BC-001 | 空消息 | 前端拦截 / 后端 `direct_answer`，不崩溃 |
| BC-002 | 超过 2000 字的消息 | 主调用超时后触发兜底 LLM |
| BC-003 | `Extract entities from the knowledge base`（纯英文） | `entity_extraction`（旧关键词全是中文，英文用户会受益） |
| BC-004 | `帮我抽取实体啦 👻🎃`（含特殊字符） | `entity_extraction`（LLM 不被噪声干扰） |

---

## Wave 2 — Issue 009 + 010：执行层 LLM 重试 + Skill 可观测性

**修复内容**：新增 `llm_invoker.py`（重试 3 次 + 指数退避）；重写 `entity_extract` Skill（缓存 + 日志 + `progress_cb`）；SSE 进度事件桥接。

### 场景 A：网络正常 — 完整生命周期日志

输入 `帮我从知识库里抽取实体`，知识库有 ≥ 2 个文档

- 后端日志：`[SKILL:entity_extract] start` → `extracting <file>` → `completed <file>: N entities` → `done: N ok / 0 cached / 0 failed`
- 浏览器 EventStream 出现 `{"type": "progress", "status": "extracting"}` 和 `"status": "completed"` 事件
- 最终消息包含正确实体数量汇总

### 场景 B：缓存命中 — 第二次抽取跳过 LLM

在场景 A 完成后，立即再次发送 `帮我从知识库里抽取实体`

- 日志出现 `[SKILL:entity_extract] cached <file>`
- **不**出现 `extracting` 日志
- 完成速度显著快于场景 A（亚秒 vs 数十秒）
- EventStream 进度事件 status 为 `cached`

### 场景 C：跨项目缓存复用

新建项目，加入与场景 A 相同的文档，执行抽取

- 日志出现 `cross-project copy <file>: <src_pid> -> <new_pid>`
- 新项目图谱标签页能看到与原项目相同的实体节点

### 场景 D：网络断开 — 重试耗尽 + 失败隔离

临时将 OpenAI API Key 改为无效值，执行抽取

- 日志出现 `[ENTITY] LLM 调用失败 (attempts=3): ...`
- 每个文件输出 `[SKILL:entity_extract] failed <file>` 而不中断下一个文件
- 最终消息**明确列出**失败文件，不伪装成"成功 0 实体"
- EventStream 出现 `"status": "failed"` 进度事件

### 场景 E：网络抖动 — 重试后成功（可选）

- 配合本地代理注入前 1-2 次 503，第 3 次放行
- 预期：同一文件日志出现多次重试，最终 `completed`
- 建议优先用自动化测试 `test_llm_invoker.py` 守护

### 场景 F：自动化回归

```bash
cd backend && source .venv/bin/activate
pytest tests/test_intent_routing_no_hardcode.py tests/test_llm_invoker.py \
       tests/test_entity_extractor_uses_safe_llm.py tests/test_entity_extract_skill.py -v
# 预期：46 passed
```

---

## Wave 3 — Issue 001 + 008：LLM 动态 Skill 生成 + 排除意图解析

**修复内容**：删除 `_CAPABILITY_TEMPLATES`；`_handle_create_skill` 改为 LLM 生成代码 + `ast.parse` 校验；新增 `_parse_exclusion_intent`（LLM 解析排除意图），新建 `entity_exclude.py` Skill（无正则）。

### 场景 1：LLM 动态生成 Skill

输入 `帮我生成一个 Skill，能统计知识库中每个文档的字数并排序`

- 后端日志：`[SKILL_GEN] 已写入 Skill 文件: .../skills/word_count.py`
- 响应包含技能名称、文件路径、说明
- 验证文件：`python -c "import ast; ast.parse(open('backend/skills/word_count.py').read()); print('语法校验通过')"`
- 文件包含 `SKILL_META` 和 `def run(`，**不含**硬编码正则

### 场景 2A：排除意图 — LLM 解析文件名

输入 `把 test_company.md 里的实体都排除掉`

- 后端日志出现 `[EXCLUSION_INTENT] ...`
- 响应包含被排除实体数量

### 场景 2B：排除意图 — 非标准表达（Issue 008 核心验证）

输入 `把 report.pdf 的那些节点从图谱里去掉`（不含"排除"关键词）

- 预期：LLM 理解"去掉" = exclude，成功执行（旧实现无此关键词会报错）

### 场景 2C：恢复操作

输入 `把刚才排除的 test_company.md 的实体恢复回来`

- 预期：LLM 解析为 restore 操作，实体恢复正常

### 场景 2D：无文件名引导

输入 `帮我排除一些实体`

- 预期：返回引导提示，列出当前可排除的来源文档名

---

## Wave 3.5 — Issue 011：前端 SSE Progress 进度条渲染

**修复内容**：`api.ts` 新增 `progress` / `heartbeat` 事件类型；`ProjectChat.tsx` 新增 `progressMap` state，`SubTaskCard` 渲染动态进度条。

### 场景 1：执行实体抽取时进度条动态更新

在有 ≥ 2 个文档的项目中发送 `帮我从知识库里抽取实体`

- SubTask 卡片在 status=working 期间显示蓝色进度条
- 进度条文字：`N / M 个文档` + 当前文件名标签
- 百分比随文件处理进度实时更新

### 场景 2：任务完成后进度条消失

- SubTask 卡片变为 completed 状态时进度条自然消失
- 不遗留空进度条或 0% 残影

### 场景 3：新任务重置进度

重新发送抽取指令（触发新 plan_created 事件）

- 上一次的进度状态被清空，进度条从 0 重新开始

---

## Wave 4 — Issue 002 + 004：规则学习层

**修复内容**：新增 `extraction_rules` 表 + `rule_manager.py`；新增 `rule_learning` 意图；`entity_extractor.py` 在抽取前加载规则注入 prompt；排除操作自动保存 `exclude_source` 规则。

### 场景 A：规则学习意图识别

| 输入 | 期望响应 |
|------|---------|
| `不要把章节标题抽成实体，记住这个规则` | "已记录规则：不抽取章节标题作为实体" |
| `以后忽略页码，不要把它抽成实体` | "已记录规则：不抽取页码作为实体" |
| `记住：日期不应该是实体` | "已记录规则：不抽取日期作为实体" |

**A-3** 输入 `balalbala 记住这个`（过于模糊）
- 预期：返回友好提示，不保存空规则，不报错

### 场景 B：规则在抽取时自动生效

1. 先执行实体抽取，记录抽取结果
2. 输入 `不要把章节标题抽成实体` → 等待确认
3. 再次执行实体抽取
4. 第二次抽取的后端日志 system_prompt 中含 `用户学习规则（必须遵守）：- 章节标题...`
5. 结果：章节标题类实体不再出现

**B-2** 新建项目（无规则）执行抽取 → 正常抽取，排除提示为"（无）"，无报错

### 场景 C：排除操作自动学习规则（Issue 004）

**C-1** 输入 `排除 report.pdf 的实体`
- 响应包含："已将来源为「report.pdf」的 N 个实体标记为排除。已同时记录规则：下次从该文档抽取时将自动忽略其实体。"
- 系统同时保存了 `exclude_source` 规则

**C-2** 输入 `恢复 report.pdf 的实体`
- 系统恢复实体，但**不保存**任何规则（恢复是可逆操作）

**C-3** 排除 `report.pdf` 后重新全量抽取
- LLM 的 prompt 中已包含排除规则，`report.pdf` 的内容不再被实体化

---

## Wave 5 — Issue 003 + 012：自适应抽取 + 缓存失效

**修复内容**：`rule_manager` 支持 `focus_on` / `strategy` 正向规则，`build_extraction_exclusion_text` 合并正负规则注入 prompt；`entity_extract` Skill 在有规则时绕过缓存。

### 场景 1：正向规则（focus_on / strategy）生效

输入 `以后抽取时重点关注财务指标类实体`（正向引导规则）

- 预期：系统识别为 `rule_learning`，保存 `focus_on` 规则
- 下次抽取的 LLM prompt 含 `重点抽取以下类型：财务指标`

### 场景 2：缓存失效 — 规则生效优先于缓存

1. 执行实体抽取，文档命中缓存
2. 输入新规则（如 `不要把 AI 算法服务抽成实体`）→ 规则保存成功
3. 立即再次执行实体抽取
4. 后端日志出现 `[SKILL:entity_extract] project has N rule(s), bypassing cache`
5. LLM 被重新调用，结果不同于旧缓存

### 场景 3：无规则时缓存行为不变

新建项目（无任何学习规则）执行两次抽取

- 第二次命中缓存，日志 `cached`，不触发规则绕过逻辑（无 regression）

---

## Wave 6 — Issue 007：动态意图注册表

**修复内容**：新增 `build_intent_registry()` + `build_classify_prompt()`；意图候选集从 Skill `SKILL_META.intent` 动态生成；新增通用 Skill 意图分发路径。

### 场景 1：意图列表随 Skill 注册表动态扩展

1. 在 `backend/skills/` 下新增一个声明了 `"intent": "document_summary"` 的 Skill 文件
2. 无需修改 `routes/chat.py`，重启后端
3. 后端 `build_intent_registry()` 自动包含 `document_summary`
4. 发送相关消息，日志显示 `[INTENT] => document_summary`，并自动路由到对应 Skill

### 场景 2：核心意图仍正常工作（无 regression）

依次测试以下路由，确保动态化后无破坏：

| 输入 | 预期意图 |
|------|---------|
| `帮我从知识库里抽取实体` | `entity_extraction` |
| `把 report.pdf 的实体排除掉` | `entity_exclusion` |
| `不要把章节标题抽成实体` | `rule_learning` |
| `你好` | `direct_answer` |

### 场景 3：意图合法性校验仍生效

LLM 若返回注册表之外的意图字符串（如 `unknown_intent`），系统应兜底到 `direct_answer`，不崩溃。

---

## 自动化测试全量回归命令

```bash
cd backend && source .venv/bin/activate

pytest \
  tests/test_intent_routing_no_hardcode.py \
  tests/test_llm_invoker.py \
  tests/test_entity_extractor_uses_safe_llm.py \
  tests/test_entity_extract_skill.py \
  tests/test_handle_create_skill_is_llm_driven.py \
  tests/test_entity_exclusion_no_regex.py \
  tests/test_rule_manager.py \
  tests/test_rule_learning_intent.py \
  tests/test_extraction_applies_rules.py \
  tests/test_entity_exclusion_learns_rule.py \
  tests/test_cache_invalidation_on_rules.py \
  tests/test_adaptive_extraction.py \
  tests/test_dynamic_intent_registry.py \
  -v

# 预期：111 passed, 0 failed
```

---

## 测试通过标准

| Wave | 最低通过要求 |
|------|------------|
| Wave 1 | 场景 A 全通过（不破坏正向流程）+ TC-005/006/008 通过（改进生效）+ TC-009 通过（硬编码已移除） |
| Wave 2 | 场景 A 全通过（日志完整）+ 场景 B 通过（缓存命中）+ 场景 D 通过（失败隔离，不伪装 0 实体） |
| Wave 3 | 场景 1 Skill 文件通过语法校验 + 场景 2B 非标准表达可解析（无需旧关键词） |
| Wave 3.5 | 场景 1 进度条实时更新 + 场景 2 任务完成后进度条消失 |
| Wave 4 | 场景 A-1 规则学习识别 + 场景 B-1 规则在抽取中生效 + 场景 C-1 排除自动保存规则 |
| Wave 5 | 场景 2 缓存失效（规则设置后强制重新抽取）+ 场景 3 无规则缓存不受影响 |
| Wave 6 | 场景 1 新 Skill 自动扩展意图 + 场景 2 核心意图无 regression |

---

*测试指南生成时间: 2026-05-06*
*覆盖 Issue: 001, 002, 003, 004, 005, 006, 007, 008, 009, 010, 011, 012*
*关联 Feature: F001 — AgentOS 大模型驱动的任务执行架构（原则 1-5 全覆盖）*
*自动化守护: 111 条 pytest 测试*
