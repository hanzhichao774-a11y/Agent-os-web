# Changelog

本项目所有重要变更记录。

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
