# Changelog

本项目所有重要变更记录。

---

## [2026-04-30] 修复部署环境线程耗尽导致启动崩溃

### 问题现象

现场 Docker 部署时，后端容器反复重启，错误日志为：
```
RuntimeError: can't start new thread
```
崩溃点在 `matplotlib.font_manager.FontManager.__init__()` 尝试创建线程时。

### 根因分析

1. **FastEmbed + onnxruntime 占满容器线程配额**：`fastembed` 依赖 `onnxruntime`，模型加载阶段会启动大量 ONNX 推理线程，在容器 PID/线程限制较低的环境下，会占满线程配额。
2. **matplotlib 在 import 时创建线程**：`chart_generator.py` 在模块顶层 `import matplotlib.pyplot`，触发 `FontManager` 初始化启动 `threading.Timer`，此时线程已耗尽，直接崩溃。
3. **两者叠加**：FastEmbed 先加载成功，随后 matplotlib 导入时无线程可用。

### 修复措施

| 文件 | 改动 |
|------|------|
| `backend/knowledge.py` | 移除 `FastEmbedEmbedder` 本地模型。未配置远程 Embedding API 时跳过知识库初始化（不崩溃） |
| `backend/requirements.txt` | 移除 `fastembed>=0.8.0` 依赖（同时去除 onnxruntime ~300MB 包体） |
| `backend/main.py` | 在所有 import 之前设置 `OMP_NUM_THREADS=2`、`ORT_NUM_THREADS=2`、`MPLBACKEND=Agg` 限制线程数 |
| `backend/builtin_tools/chart_generator.py` | matplotlib 改为懒加载（`_ensure_matplotlib()`），不在 import 时触发 FontManager 线程 |
| `Dockerfile.backend` | 新增 `MPLBACKEND=Agg` 环境变量 |

### 影响

- Docker 镜像减小 ~300MB（去除 onnxruntime + fastembed）
- 运行时内存减少 ~500MB（不再加载本地 ONNX 模型）
- **现场部署必须配置远程 Embedding API**（在「模型配置」或 `.env` 中设置 `EMBEDDING_MODEL_ID` 等参数），否则知识库功能不可用但服务正常运行

---

## [2026-04-28] 知识图谱实体抽取与下钻式可视化

### 功能概述

新增知识图谱模块：上传文档自动抽取实体和关系，右侧面板「图谱」tab 展示可交互的力导向图，支持逐级下钻探索。

### 迭代过程与问题复盘

本功能经历了 **4 轮迭代**，主要遭遇以下技术障碍：

**第 1 轮：实体抽取不生效**
- 原因 1：`entity_extractor.py` 最初使用 `Agent.arun()`（异步），在 `asyncio.to_thread` 的线程中调用会触发「There is no current event loop in thread」错误。修复：改为 `Agent.run()` 同步调用。
- 原因 2：知识库文档解析直接用 `fpath.read_text()` 读取 PDF/DOCX 二进制文件，得到乱码。修复：抽取出 `doc_parser.py` 统一处理 PDF（fitz）、DOCX（python-docx）、XLSX（openpyxl）、CSV、纯文本。
- 原因 3：Agno 框架的 `Function.from_callable` 对 Qwen 模型的 function calling 支持不稳定，SubAgent 经常不调用工具。修复：引入「直接执行路径」——对实体抽取类请求绕过 SubAgent 编排，直接调用 `extract_entities_sync`。

**第 2 轮：图谱渲染崩溃**
- 原因：ForceGraph 组件对全部 85+ 个实体做 O(N²) 力模拟（800 次迭代），浏览器在初始布局阶段直接卡死。同时 `requestAnimationFrame` 循环在数据为空时退出后不会重启。
- 修复：优化力模拟迭代次数、跳过远距离节点、用 Map 替代 Array.find。但即使优化后，全量渲染仍然不可行。

**第 3 轮：架构重设计 — 下钻探索模式**
- 核心问题：企业知识库会持续增长，全量平铺图谱从根本上不可行。
- 新设计：初始只展示 Top 10 核心节点（按关联度排序），用户单击展开一度关联、双击收起，逐级探索。
- 新增 `/api/entities/{pid}/top` 和 `/api/entities/{pid}/expand/{eid}` 两个后端 API。

**第 4 轮：端到端不通**
- 原因 1：后端代码已更新但 uvicorn 未重启，`/top` 路由返回 404（日志中出现 30+ 次 404）。
- 原因 2：用户说「生产实体」但直接抽取关键词列表只有「提取实体」「抽取实体」等，不匹配。请求走了普通编排路径，BizAgent 只是文本描述了实体但未写入数据库。
- 原因 3：85 个实体 `task_id=NULL`（早期抽取），按 task 过滤查不到。`_upsert_entities` 更新已有实体时不更新 task_id。
- 修复：扩展关键词列表、增加 task→project 回退查询、upsert 时补填 task_id。

### 新增

- **`backend/entity_extractor.py`**：LLM 驱动的实体抽取引擎
  - `extract_entities_sync()`：同步版本，用于直接执行路径和 SubAgent 工具
  - `extract_entities()`：异步版本，用于文件上传后的后台自动抽取
  - `get_top_entities()`：按关联度排序返回 Top N 核心实体，支持 task→project 回退
  - `get_entity_neighbors()`：获取某实体的一度关联
  - `_upsert_entities()`：按 name 去重的实体写入，自动补填 NULL task_id
- **`backend/doc_parser.py`**：统一文档文本提取工具（PDF/DOCX/XLSX/CSV/TXT）
- **`backend/routes/entity_api.py`**：实体 CRUD + 图谱 API
  - `GET /api/entities/{pid}/top`：顶层核心节点（支持 task_id、limit 参数）
  - `GET /api/entities/{pid}/expand/{eid}`：展开一度关联
  - `GET /api/entities/{pid}/graph`：全量图（保留兼容）
  - `PUT /api/entities/item/{eid}/exclude`：排除/恢复实体
  - `DELETE /api/entities/item/{eid}`：删除实体
- **`src/components/ForceGraph.tsx`**：Canvas 力导向图组件
  - 增量式布局：新节点从父节点附近生成，短迭代快速收敛
  - 单击/双击回调，已展开节点外圈光环，可展开节点 "+" 标记
  - 拖拽不误触发点击
- **数据库 schema**：`entities` 表（id, project_id, task_id, name, type, description, source, excluded）+ `entity_relations` 表
- **文件上传自动抽取**：`knowledge_api.py` 上传文档后 `asyncio.create_task` 后台抽取实体
- **直接执行路径**：`chat.py` 中实体抽取请求绕过 SubAgent 编排，直接执行写入

### 优化

- **RightPanel「图谱」tab**：重写为下钻探索模式，左侧标签云同步显示当前可见实体
- **BizAgent 编排关键词**：增加实体/图谱相关触发词
- **`_DIRECT_ENTITY_KEYWORDS`**：覆盖"生产实体""生成实体""知识图谱"等 12 种用户表达
- **BizAgent 汇总隔离**：使用独立 session_id 防止上下文污染

---

## [2026-04-28] 动态编排架构 — 去除固定数字员工，SubAgent 工位制

### 架构重构
- **去除固定"数字员工"体系**：删除 `teams.py`、`AgentPage.tsx`，移除 a1-a7 七个固定 Agent 配置，仅保留 BizAgent（管理智能体）和 SkillEngineer
- **引入 3 工位 SubAgent 动态编排**：
  - 新增 `worker_pool.py`：管理 3 个 SubAgent 工位的状态（idle/working/completed/error）、token 消耗统计、累计任务数
  - 新增 `orchestrator.py`：LLM 驱动的任务规划引擎，支持 single / serial / parallel 三种执行模式
  - BizAgent 作为中央编排者，分析用户请求后自动拆解子任务、分配工位、聚合结果
- **动态 Agent 创建**：`agents.py` 新增 `create_dynamic_agent()` 函数，根据任务所需能力（内置工具 + 已注册技能）动态组装临时 Agent，不再缓存
- **能力注册表**：`orchestrator.py` 定义 `CAPABILITY_REGISTRY`，统一映射 pdf_generation / chart_generation / excel_generation / image_processing / http_client 等能力 ID 到对应工具函数

### 新增
- **`backend/orchestrator.py`**：任务规划（`plan_task`）+ 子任务执行（`_run_subtask`）+ 计划调度（`execute_plan`），含 120 秒子任务超时保护
- **`backend/worker_pool.py`**：SubAgent 工位状态管理、slot 分配/释放/失败/重置、token 统计（单次 + 累计）
- **`backend/routes/workers.py`**：`GET /api/workers/status`（实时工位状态）、`GET /api/workers/stats`（token 消耗统计）
- **智能编排入口**：`routes/chat.py` 新增 `orchestrator_chat` 端点，替代原有 `team_chat`；内置关键词启发式判断（`_needs_orchestration`），简单问答直接由 BizAgent 回答，复杂任务触发 LLM 规划
- **Dashboard 工位面板**：首页展示 3 个 SubAgent 工位实时状态卡片 + 全局 token 消耗面板，轮询刷新
- **SSE 事件流**：新增 `plan_created`、`subtask_started`、`subtask_completed`、`subtask_failed`、`summary`、`plan_completed` 事件类型

### 优化
- **主对话去重**：`subtask_completed` 不再在主对话中生成独立消息，仅保留 BizAgent 最终汇总，避免内容重复
- **右侧产出去重**：`extractOutputs` 仅从 BizAgent 汇总（leader 角色）中提取文件产出，不再从 SubAgent 原始结果中提取
- **任务规划文案用户友好化**：规划引擎 prompt 要求使用通俗语言描述（如"正在为您生成 PDF 报告"），禁止出现工位、能力 ID、slot 等技术术语
- **BizAgent 工具集精简**：移除 `_global_create_agent` / `_global_delete_agent` / `_global_list_agents`，新增 `_plan_task` / `_get_worker_status` / `_get_capabilities`
- **工作流模板简化**：所有预设工作流改为由 BizAgent 统一调度执行

### 删除
- `backend/teams.py`：Team 多 Agent 路由协作模块（被编排器替代）
- `src/components/AgentPage.tsx`：数字员工管理页面
- Sidebar 中"数字员工"导航项
- `agents_api.py` 中 Agent CRUD 端点（create/delete/update/setTools）
- `api.ts` 中 Agent CRUD 前端函数

---

## [2026-04-28] 任务级文件隔离 + 新文件格式支持 + 知识检索增强

### 新增
- **任务级文件隔离**：
  - 新增 `task_files` 数据表，记录每个文件所属的项目和任务
  - 上传文件和 Agent 产出文件均关联到具体任务，右侧面板按任务维度展示
  - `contextvars` 线程安全传递 `project_id` / `task_id`，内置工具（PDF/图表/Excel）生成后自动注册到对应任务
  - 新增 `GET /api/projects/{project_id}/tasks/{task_id}/files` 接口
- **新文件格式支持**：
  - `.docx`（Word）：基于 `python-docx` 解析段落和表格内容
  - `.xlsx` / `.xls`（Excel）：基于 `openpyxl` 解析所有工作表数据
  - `.csv`：UTF-8 文本直接入库
- **知识检索 Agent 增强**：新增 `list_knowledge_documents` 工具，支持列举所有已入库文档（不再仅依赖语义搜索）
- **context.py**：新增 `current_project_id` / `current_task_id` 上下文变量模块

### 优化
- **UI 布局调整**：项目视图去除独立文件库面板，BizAgent 提升为项目维度侧边栏，与数字员工/技能页布局一致
- **BizAgent 项目上下文**：BizAgent 在项目视图中自动注入当前项目名称和 ID，支持项目维度问答
- **前端文件上传**：扩展支持 `.docx` / `.xlsx` / `.xls` / `.csv` 格式

### 修复
- **移除 PromptInjectionGuardrail**：Agno 内置 prompt injection 检测对中文查询误报率极高，导致正常提问被拦截卡住
- **FastEmbed 模型缓存损坏**：清除损坏的 ONNX 模型缓存，修复文档向量化静默失败问题

### 依赖
- 新增 `python-docx>=1.1.0`、`openpyxl>=3.1.0`

---

## [2026-04-27] 后端模块化拆分 + 内置工具 + 图表/文件交互优化

### 重构
- **main.py 模块化拆分**：将原 ~2800 行的单体 `main.py` 拆分为 12 个核心模块 + 9 个路由文件
  - 核心模块：`config.py`、`schemas.py`、`utils.py`、`database.py`、`llm.py`、`embeddings.py`、`knowledge.py`、`skill_manager.py`、`agents.py`、`teams.py`、`tools.py`
  - 路由包：`routes/settings.py`、`routes/sessions.py`、`routes/chat.py`、`routes/skills.py`、`routes/agents_api.py`、`routes/projects.py`、`routes/knowledge_api.py`、`routes/stats.py`、`routes/workflows.py`
  - `main.py` 精简至 ~30 行，仅负责 FastAPI app 创建和路由注册

### 新增
- **B 端数据处理内置工具**（`backend/builtin_tools/` 包）：
  - `pdf_generator.py`：基于 ReportLab 的 PDF 报告生成，支持 Markdown 转换、中文字体、emoji 自动清理
  - `chart_generator.py`：基于 Matplotlib 的图表生成（柱状图/折线图/饼图/散点图/水平柱状图），支持多系列数据
  - `excel_generator.py`：基于 XlsxWriter 的 Excel 报表导出
  - `image_processor.py`：基于 Pillow 的图片处理（缩放/裁剪/水印/格式转换等）
  - `http_client.py`：基于 httpx 的通用 HTTP 请求工具
- **BizAgent 新增管理工具**：
  - `_global_list_tasks(project_id)`：查询指定项目下的子任务列表
  - `_global_list_workspace_files()`：列出工作区所有产出文件
- **聊天记录持久化**：新增 `chat_messages` 表，Team/Agent 对话刷新后不再丢失
- **双模式技能结构**：支持单 `.py` 文件技能和目录型技能（含 `main.py` 入口）

### 优化
- **Team 路由优先级**：文件生成类请求（图表/PDF/Excel）提升为最高优先级路由到 a1（数据分析Agent），解决跨上下文路由错误
- **Agent 输出格式规范**：a1/a3/global 的 instructions 要求输出 `已生成柱状图：标题` + `文件名称：xxx.ext` 格式，便于前端渲染下载卡片
- **图谱页 BizAgent 对话**：从 Team 路由改为直接对话 BizAgent（global agent），注入当前项目上下文，正确回答项目维度问题
- **右侧文件面板数据源修正**："上传文件"改为展示知识库文档，"产出文件"改为展示 workspace 生成文件

### 修复
- **OutputCards 正则兼容**：修复前端正则无法匹配 Markdown 格式（`**文件名称**`、`` `文件名.ext` ``）导致下载卡片不渲染的问题
- **OutputCards 点击功能**：为文件卡片添加预览（PNG/PDF 等新窗口打开）和下载（Blob 下载）功能
- **PDF 特殊字符清理**：自动去除 emoji 和不支持的 Unicode 字符，避免 STSong 字体渲染失败
- **中文文件名**：Agent instructions 要求使用中文命名产出文件
- **workspace 文件下载**：区分 inline（可预览类型）和 attachment（强制下载），修复 PDF/图片无法在浏览器打开的问题

---

## [2026-04-27] Embedding / Reranker 配置管理

### 新增
- **SettingsModal 三 Tab 改造**：模型配置弹窗新增「Embedding」和「Reranker」两个独立 Tab，各自独立配置、测试、保存
- **Embedding 配置**：支持「本地 FastEmbed」和「远程 API (OpenAI 兼容)」两种模式切换；远程模式可配置 Model ID、API Key、Base URL、向量维度
- **Reranker 配置**：支持启用/禁用开关；启用后可配置 Model ID、API Key、Base URL、Top N
- **OpenAICompatibleReranker 类**：自定义 Reranker 实现，自动兼容 Jina/Cohere (`/v1/rerank`) 和 TEI (`/rerank`) 两种 API 格式
- **知识库动态重建**（`_rebuild_knowledge()`）：替代原来的模块级硬编码初始化，保存 Embedding/Reranker 配置后自动重建 Knowledge 实例
- **后端 API 端点**：新增 `GET/PUT /api/settings/embedding`、`POST /api/settings/embedding/test`、`GET/PUT /api/settings/reranker`、`POST /api/settings/reranker/test` 共 6 个端点
- **预检脚本扩展**：`preflight_check.py` 新增 `--embedding-models` 和 `--reranker-models` 参数，支持 Embedding 向量测试和 Reranker 排序测试
- **.env 模板**：新增 `EMBEDDING_*` 和 `RERANKER_*` 环境变量注释模板

### 技术说明
- Embedding 切换后需重新上传文档（不同模型向量维度不同，需重建索引），保存时会提示用户
- Reranker 挂载到 LanceDb 的 `reranker` 参数，检索时自动对结果二次排序
- 配置优先级：DB settings 表 > `.env` 环境变量 > 默认值（本地 FastEmbed / Reranker 禁用）

---

## [2026-04-27] LLM 模型配置管理 + 连通性预检

### 新增
- **前端模型配置弹窗**（`SettingsModal`）：支持切换服务提供商（Kimi / MiniMax / OpenAI / 自定义），配置 Model ID、API Key、Base URL，带连通测试和保存功能
- **Sidebar 入口**：底部新增「模型配置」按钮（齿轮图标）
- **后端配置接口**：`GET/PUT /api/settings/llm` 配置读写，`POST /api/settings/llm/test` 连通测试
- **持久化配置**：`settings` 表存储 LLM 配置，优先级 DB > `.env`
- **自定义提供商**（`custom`）：支持千问等 OpenAI 兼容的私有化部署服务
- **部署预检脚本**（`preflight_check.py`）：可批量验证多模型连通性（SDK 直连 + Agno Agent 全链路）
- **后端开发规则**（`.cursor/rules/backend.mdc`）：记录虚拟环境、启动命令等约定

### 修复
- **角色映射兼容**：修复 Agno 2.5.17 默认将 `system` 角色映射为 `developer`，导致 Kimi / MiniMax / 千问等非 OpenAI 服务返回 `tokenization failed` 的问题；通过 `_COMPAT_ROLE_MAP` 为非 OpenAI 提供商自动使用标准角色映射
- **脱敏 Key 回退**：修复连通测试使用前端传来的脱敏 API Key（`sk-b14...1vrX`）导致认证失败的问题，增加 DB → `.env` 多级回退查找真实密钥
- **错误检测增强**：修复连通测试对 LLM 返回的错误响应误报「连接成功」的问题，扩展错误关键词匹配范围

### 重构
- **统一模型工厂**：`create_model()` 合并为单一 `OpenAIChat` 入口，通过 `_PROVIDER_EXTRA_KWARGS` 配置映射注入各提供商的特殊参数（`role_map`、`extra_body` 等），消除 `if/elif` 硬编码分支
- **移除 Anthropic**：移除 Claude 相关代码，仅保留 OpenAI 兼容模型

### 文档
- `README.md` 更新技术栈说明，新增自定义提供商配置指南和 API 接口文档

---

## [2026-04-23] 对齐 Demo 配色与图谱 + 产出文件卡片 + 任务创建弹窗

### 新增
- 产出文件卡片组件
- 任务创建弹窗
- Demo 配色方案对齐与图谱可视化优化

---

## [2026-04-23] 项目子任务体系 + UI 全面改版

### 新增
- 项目子任务管理体系
- UI 全面改版，优化布局和交互体验

---

## [2026-04-22] 深夜模式一键切换

### 新增
- 深夜模式（Dark Mode）一键切换
- 科技风深蓝黑配色方案

---

## [2026-04-22] Team 多轮对话记忆 + 路由指令优化

### 优化
- Team 多轮对话记忆保持
- 路由指令优化，提升 Agent 调度准确性

---

## [2026-04-21] 全面升级知识检索 + Team Route 模式 + Kimi k2.6 集成

### 新增
- 知识库检索全面升级
- Team Route 模式（多 Agent 路由协作）
- Kimi k2.6 模型集成

---

## [2026-04-21] 全局助手优化

### 优化
- 去除 mock 数据，接入真实资源查询
- 可拖拽布局

---

## [2026-04-21] 技能对话式管理

### 新增
- 自然语言管理技能全流程（创建、编辑、删除、查询）

---

## [2026-04-21] Team 多 Agent 协作

### 新增
- Team 多 Agent 协作框架
- 工具集成
- Markdown 渲染与全面优化

---

## [2026-04-20] MVP 初始版本

### 新增
- Agent OS Web MVP，双闭环核心功能
- 项目 README 及 API 文档
