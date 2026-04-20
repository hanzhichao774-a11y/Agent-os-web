# Agent OS Web

企业级 AI Agent 管理平台，基于 [Agno](https://github.com/agno-agi/agno) 框架构建，提供多 Agent 协同、技能编排和知识库 RAG 检索能力。

## 功能概览

### Agent 管理
- **6 个专业 Agent**：数据分析、知识检索、代码助手、合同审查、舆情监控、数据治理
- **全局助手**：跨 Agent 资源调度与效能管理
- **实时对话**：基于 SSE 的流式响应

### 技能系统
- **自然语言创建**：描述需求即可自动生成 Python 技能
- **动态注册**：技能自动扫描加载，支持热插拔
- **Agent 挂载**：技能可作为工具绑定到任意 Agent

### 知识库 RAG
- **多格式支持**：PDF / TXT / Markdown 文档上传
- **语义检索**：LanceDb 向量数据库 + BGE-small-zh 中文嵌入模型
- **智能分块**：RecursiveChunking 递归分块，保留上下文连贯性

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 19 + TypeScript + Vite + Tailwind CSS |
| 后端 | FastAPI + Agno Framework |
| 向量库 | LanceDb（本地文件存储，零依赖部署） |
| 嵌入模型 | FastEmbed + BAAI/bge-small-zh-v1.5（本地 ONNX 推理） |
| LLM | 可配置：MiniMax / OpenAI / Anthropic |

## 项目结构

```
agent-os-web/
├── src/                        # 前端源码
│   ├── components/
│   │   ├── Dashboard.tsx       # 仪表盘首页
│   │   ├── AgentPage.tsx       # Agent 列表
│   │   ├── AgentChat.tsx       # Agent 对话（含文件上传）
│   │   ├── SkillPage.tsx       # 技能市场
│   │   ├── SkillChat.tsx       # 技能交互
│   │   ├── GlobalChat.tsx      # 全局助手
│   │   ├── ProjectChat.tsx     # 项目群聊
│   │   ├── Header.tsx          # 顶栏
│   │   ├── Sidebar.tsx         # 侧边栏导航
│   │   └── RightPanel.tsx      # 右侧面板
│   ├── services/api.ts         # API 请求层
│   ├── data/mockData.ts        # 模拟数据
│   ├── App.tsx                 # 主布局
│   └── main.tsx                # 入口
├── backend/
│   ├── main.py                 # FastAPI 应用（Agent/技能/知识库）
│   ├── requirements.txt        # Python 依赖
│   ├── .env.example            # 环境变量模板
│   └── skills/                 # 技能脚本目录
│       ├── bmi_calculator.py   # BMI 计算器
│       └── calculate_principal.py  # 本金计算器
└── package.json                # 前端依赖
```

## 快速开始

### 环境要求

- Node.js >= 18
- Python >= 3.12

### 1. 安装前端依赖

```bash
npm install
```

### 2. 配置后端

```bash
cd backend
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

复制环境变量并填入你的 API Key：

```bash
cp .env.example .env
```

编辑 `backend/.env`，根据你使用的 LLM 提供商配置：

```env
# MiniMax（推荐国内使用）
MODEL_PROVIDER=minimax
MODEL_ID=MiniMax-M2.7
MINIMAX_API_KEY=sk-xxx

# 或 OpenAI
MODEL_PROVIDER=openai
MODEL_ID=gpt-4o-mini
OPENAI_API_KEY=sk-xxx

# 或 Anthropic
MODEL_PROVIDER=anthropic
MODEL_ID=claude-sonnet-4-6
ANTHROPIC_API_KEY=sk-ant-xxx
```

### 3. 启动服务

启动后端（默认端口 8000）：

```bash
cd backend
source .venv/bin/activate
fastapi dev main.py
```

启动前端（默认端口 5173）：

```bash
npm run dev
```

访问 http://localhost:5173 即可使用。

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查 |
| GET | `/api/agents` | 获取 Agent 列表 |
| POST | `/api/agents/{id}/chat` | Agent 对话（SSE 流） |
| PUT | `/api/agents/{id}/tools` | 为 Agent 绑定技能 |
| GET | `/api/skills` | 获取技能列表 |
| POST | `/api/skills/create` | 自然语言创建技能 |
| POST | `/api/skills/{id}/run` | 执行技能 |
| POST | `/api/knowledge/upload` | 上传文档到知识库 |
| GET | `/api/knowledge/docs` | 获取已上传文档列表 |

## 自定义技能

在 `backend/skills/` 目录下创建 Python 文件即可自动注册：

```python
SKILL_META = {
    "name": "技能名称",
    "icon": "🔧",
    "category": "analysis",       # analysis | data | code | search | api
    "description": "一句话描述",
}

def run(param1: float, param2: str) -> str:
    # 你的逻辑
    return "结果"
```

也可以在前端技能页面通过自然语言描述自动生成。

## License

MIT
