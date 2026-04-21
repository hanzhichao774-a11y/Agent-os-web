# Changelog

## [0.2.0] - 2026-04-20

### 🚀 新功能

- **Agno 内置工具集成**：接入 PandasTools、DuckDbTools、CsvTools、FileTools、PythonTools、CalculatorTools、PPT 生成等企业级工具
- **Team 多 Agent 协作**：基于 Agno Team Coordinate 模式，支持 Leader 自动分配任务给 7 个专家 Agent 协同完成
- **工作流引擎**：新增 WorkflowPage，支持预定义工作流模板的选择和流式执行
- **全局文件上传**：所有聊天界面（全局助手、Agent 对话、项目群聊）均支持文件上传到知识库
- **项目管理 CRUD**：后端 SQLite 持久化项目数据，前端支持创建/删除项目，替换 mock 数据
- **Guardrails 安全防护**：集成 Agno PromptInjectionGuardrail 作为 pre_hook
- **Markdown 渲染**：所有聊天界面支持完整 Markdown 渲染（表格、代码块、列表等），集成 react-markdown + remark-gfm

### 🔧 优化

- **Team 知识检索修复**：Leader 上下文动态注入知识库文档列表，确保知识相关问题正确分配给知识检索 Agent
- **超时保护**：Team 协作 5 分钟超时、Agent 对话 3 分钟超时、MiniMax 模型请求 2 分钟超时，防止后端挂死
- **流式输出优化**：成员 Agent 支持实时流式输出（member_streaming/member_started 事件），不再延迟一次性输出
- **内容清理**：后端自动清除 think 标签、成员列表 XML 等框架标记，流式内容保留换行符确保 Markdown 正确渲染
- **Agent 名称解析**：正确解析 agent_id 到中文名称和 avatar，不再显示 "delegate_task_to_member" 等原始名称
- **任务执行流 UI**：缩小图标和间距适配长工作流，去除重复标题，底部改为显示耗时信息
- **活跃 Agent 面板**：Team Leader 始终在线显示，带金色高亮区分

### 🏗️ 架构变更

- **前后端数据对齐**：AgentPage、Dashboard、Sidebar 均从后端 API 获取真实数据，移除大部分 mock 数据
- **SSE 事件体系**：Team 聊天支持 member_delegated / member_started / member_streaming / member_response / leader_content / done 完整事件流
- **新增依赖**：pandas、duckdb、python-pptx（后端）；react-markdown、remark-gfm（前端）

### 📁 文件变更

- `backend/main.py` - 新增 635 行：工具工厂、Team 管理、项目 CRUD API、内容清理、超时保护
- `backend/requirements.txt` - 新增 pandas、duckdb、python-pptx
- `src/components/WorkflowPage.tsx` - 新增工作流页面
- `src/components/ProjectChat.tsx` - 重构 Team 群聊，支持流式事件和 Markdown
- `src/components/RightPanel.tsx` - 任务执行流和 Agent 状态面板优化
- `src/components/GlobalChat.tsx` - 新增 Markdown 渲染和文件上传
- `src/components/Sidebar.tsx` - 项目列表改为实时数据 + 创建项目弹窗
- `src/services/api.ts` - 新增 Team 聊天、项目管理、文件上传等 API
- `src/data/mockData.ts` - 移除 projects、agents、skills 等 mock 数据

---

## [0.1.0] - 2026-04-19

### 初始版本

- 基于 Agno 框架的 Agent OS MVP
- 自定义 Skill 创建与使用
- 知识库文档上传与 RAG 检索（LanceDb + FastEmbed 本地向量化）
- PDF 文档解析（pymupdf）
- MiniMax M2.7 大模型接入
- React + TypeScript + Vite + Tailwind CSS 前端
- FastAPI 后端 + SSE 流式响应
