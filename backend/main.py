import os
import re
import json
import sqlite3
import asyncio
import importlib.util
import inspect
from pathlib import Path
from datetime import datetime, timezone
from dotenv import load_dotenv
from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse
from pydantic import BaseModel
from agno.agent import Agent
from agno.db.sqlite import SqliteDb
from agno.knowledge.knowledge import Knowledge
from agno.knowledge.embedder.fastembed import FastEmbedEmbedder
from agno.knowledge.chunking.recursive import RecursiveChunking
from agno.vectordb.lancedb import LanceDb
from agno.tools.pandas import PandasTools
from agno.tools.duckdb import DuckDbTools
from agno.tools.csv_toolkit import CsvTools
from agno.tools.file import FileTools
from agno.tools.file_generation import FileGenerationTools
from agno.tools.python import PythonTools
from agno.tools.calculator import CalculatorTools
from agno.guardrails.prompt_injection import PromptInjectionGuardrail

load_dotenv()

BASE_DIR = Path(__file__).parent
SKILLS_DIR = BASE_DIR / "skills"
KNOWLEDGE_DOCS_DIR = BASE_DIR / "knowledge" / "docs"
WORKSPACE_DIR = BASE_DIR / "workspace"

SKILLS_DIR.mkdir(exist_ok=True)
KNOWLEDGE_DOCS_DIR.mkdir(parents=True, exist_ok=True)
(BASE_DIR / "data").mkdir(exist_ok=True)
WORKSPACE_DIR.mkdir(exist_ok=True)

# ═══════════════════════════════════════════════════════════════════════════════
# 项目数据库（SQLite）
# ═══════════════════════════════════════════════════════════════════════════════

_PROJECTS_DB = str(BASE_DIR / "data" / "projects.db")


def _get_projects_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(_PROJECTS_DB)
    conn.row_factory = sqlite3.Row
    return conn


def _init_projects_db():
    conn = _get_projects_conn()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'active',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    """)
    conn.commit()
    count = conn.execute("SELECT COUNT(*) FROM projects").fetchone()[0]
    if count == 0:
        now = datetime.now(timezone.utc).isoformat()
        seed = [
            ("p1", "Q3 财报分析", "季度财务数据汇总与可视化", "active", now, now),
            ("p2", "供应链优化", "物流路径与库存优化方案", "active", now, now),
            ("p3", "客户流失预警", "高价值客户流失风险评估", "idle", now, now),
        ]
        conn.executemany(
            "INSERT INTO projects (id, name, description, status, created_at, updated_at) VALUES (?,?,?,?,?,?)",
            seed,
        )
        conn.commit()
    conn.close()


_init_projects_db()

app = FastAPI(title="Agent OS API", version="2.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ═══════════════════════════════════════════════════════════════════════════════
# 模型工厂
# ═══════════════════════════════════════════════════════════════════════════════

def create_model():
    provider = os.getenv("MODEL_PROVIDER", "openai").lower()
    model_id = os.getenv("MODEL_ID")

    if provider == "minimax":
        from agno.models.openai import OpenAIChat
        return OpenAIChat(
            id=model_id or "MiniMax-M2.7",
            api_key=os.getenv("MINIMAX_API_KEY"),
            base_url="https://api.minimaxi.com/v1",
            role_map={"system": "system", "user": "user", "assistant": "assistant", "tool": "tool", "model": "assistant"},
            timeout=120,
        )
    elif provider == "anthropic":
        from agno.models.anthropic import Claude
        return Claude(id=model_id or "claude-3-5-sonnet-20241022")
    else:
        from agno.models.openai import OpenAIChat
        return OpenAIChat(id=model_id or "gpt-4o-mini")


# ═══════════════════════════════════════════════════════════════════════════════
# 技能加载器
# ═══════════════════════════════════════════════════════════════════════════════

_skill_registry: dict[str, dict] = {}


def _load_skill_module(path: Path) -> dict | None:
    """从 .py 文件加载一个技能，返回 {meta, run_fn} 或 None。"""
    try:
        spec = importlib.util.spec_from_file_location(path.stem, path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        meta = getattr(mod, "SKILL_META", None)
        run_fn = getattr(mod, "run", None)
        if not meta or not callable(run_fn):
            return None
        sig = inspect.signature(run_fn)
        params = []
        for name, p in sig.parameters.items():
            ptype = "string"
            if p.annotation in (float, int):
                ptype = "number"
            params.append({"name": name, "type": ptype, "default": str(p.default) if p.default is not inspect.Parameter.empty else None})
        return {
            "id": path.stem,
            "meta": meta,
            "run_fn": run_fn,
            "params": params,
            "file": str(path),
        }
    except Exception as e:
        print(f"[WARN] 加载技能 {path.name} 失败: {e}")
        return None


def scan_skills():
    """扫描 skills/ 目录，刷新技能注册表。"""
    _skill_registry.clear()
    for f in sorted(SKILLS_DIR.glob("*.py")):
        if f.name.startswith("_"):
            continue
        skill = _load_skill_module(f)
        if skill:
            _skill_registry[skill["id"]] = skill
            print(f"[SKILL] 已加载: {skill['meta']['name']} ({skill['id']})")


scan_skills()


# ═══════════════════════════════════════════════════════════════════════════════
# 知识库 (Agno Knowledge + LanceDb + FastEmbed)
# ═══════════════════════════════════════════════════════════════════════════════

_embedder = FastEmbedEmbedder(id="BAAI/bge-small-zh-v1.5", dimensions=512)

_vector_db = LanceDb(
    uri=str(BASE_DIR / "data" / "lancedb"),
    table_name="knowledge",
    embedder=_embedder,
)

_knowledge = Knowledge(
    vector_db=_vector_db,
    max_results=5,
)

print("[KNOWLEDGE] Agno Knowledge + LanceDb + FastEmbed 初始化完成")


def ingest_document(doc_name: str, text: str) -> int:
    """将文本通过 RecursiveChunking 分块后存入向量库。"""
    from agno.knowledge.reader.text_reader import TextReader
    reader = TextReader(
        chunk=True,
        chunk_size=500,
        chunking_strategy=RecursiveChunking(chunk_size=500, overlap=50),
    )
    _knowledge.insert(
        name=doc_name,
        text_content=text,
        reader=reader,
        upsert=True,
    )
    from agno.knowledge.document.base import Document
    doc = Document(content=text, name=doc_name)
    chunks = RecursiveChunking(chunk_size=500, overlap=50).chunk(doc)
    return len(chunks)


def search_knowledge(query: str, top_k: int = 5) -> list[dict]:
    """向量语义检索。"""
    results = _knowledge.search(query, max_results=top_k)
    chunks = []
    for doc in results:
        meta = doc.meta_data or {}
        name = meta.get("content_name") or meta.get("name") or doc.name or "unknown"
        chunks.append({
            "doc_name": name,
            "chunk_text": doc.content,
        })
    return chunks


_uploaded_docs: dict[str, int] = {}


def list_documents() -> list[dict]:
    return [{"doc_name": k, "chunks": v} for k, v in _uploaded_docs.items()]


# ═══════════════════════════════════════════════════════════════════════════════
# Agno 内置工具工厂
# ═══════════════════════════════════════════════════════════════════════════════

def _make_builtin_tools(tool_names: list[str]) -> list:
    """根据工具名称列表实例化 Agno 内置 Toolkit。"""
    ws = str(WORKSPACE_DIR)
    factories = {
        "pandas": lambda: PandasTools(),
        "duckdb": lambda: DuckDbTools(db_path=str(WORKSPACE_DIR / "duckdb.db")),
        "csv": lambda: CsvTools(csvs=[ws]),
        "file": lambda: FileTools(base_dir=ws),
        "file_generation": lambda: FileGenerationTools(output_directory=ws),
        "python": lambda: PythonTools(base_dir=ws, restrict_to_base_dir=True),
        "calculator": lambda: CalculatorTools(),
    }
    tools = []
    for name in tool_names:
        factory = factories.get(name)
        if factory:
            tools.append(factory())
        else:
            print(f"[WARN] 未知内置工具: {name}")
    return tools


# ═══════════════════════════════════════════════════════════════════════════════
# Agent 配置
# ═══════════════════════════════════════════════════════════════════════════════

_agent_tools: dict[str, list[str]] = {}

AGENT_CONFIGS: dict[str, dict] = {
    "a1": {
        "name": "数据分析Agent",
        "avatar": "📊",
        "description": "擅长 SQL 查询、数据清洗、统计建模，可直接操作 CSV/Excel 数据",
        "capabilities": ["SQL", "Pandas", "DuckDB", "CSV", "可视化"],
        "builtin_tools": ["pandas", "duckdb", "csv", "file_generation"],
        "instructions": [
            "你是企业数据分析专家，擅长 SQL 查询、数据清洗和统计建模。",
            "你可以使用 Pandas 处理数据框、DuckDB 执行 SQL 查询、操作 CSV 文件。",
            "你还可以生成 CSV/JSON/PDF 格式的分析报告文件。",
            "回答要专业、简洁，需要时提供代码和分析结果。",
            "始终使用中文回答。",
        ],
    },
    "a2": {
        "name": "知识检索Agent",
        "avatar": "🔍",
        "description": "企业内部知识库问答与检索",
        "capabilities": ["RAG", "文档解析", "语义搜索"],
        "instructions": [
            "你是企业知识库检索专家。",
            "当用户提问时，系统会自动从知识库中检索相关文档片段并附在上下文中。",
            "你必须优先基于这些检索到的文档片段来回答问题。",
            "在回答中标注信息出处（如引用的文档名称）。",
            "如果知识库中没有找到相关内容，如实告知用户。",
            "始终使用中文回答。",
        ],
        "has_knowledge": True,
    },
    "a3": {
        "name": "代码助手Agent",
        "avatar": "💻",
        "description": "代码生成、审查、重构与调试，可执行 Python 代码",
        "capabilities": ["Python 执行", "代码生成", "文件读写", "调试"],
        "builtin_tools": ["python", "file"],
        "instructions": [
            "你是专业代码助手，擅长代码生成、审查、重构与调试。",
            "你可以直接执行 Python 代码并返回结果，也可以读写文件。",
            "提供高质量、可运行的代码示例，并用中文解释关键逻辑。",
            "始终使用中文回答。",
        ],
    },
    "a4": {
        "name": "合同审查Agent",
        "avatar": "📄",
        "description": "法律条款风险识别与比对",
        "capabilities": ["NLP", "合规检查", "文件读取"],
        "builtin_tools": ["file"],
        "instructions": [
            "你是法律合同审查专家，擅长识别合同风险和条款分析。",
            "你可以读取文件进行分析。",
            "指出潜在风险点，并给出修改建议。",
            "始终使用中文回答。",
        ],
    },
    "a5": {
        "name": "舆情监控Agent",
        "avatar": "📡",
        "description": "全网品牌舆情实时抓取与分析",
        "capabilities": ["情感分析", "趋势研判", "告警"],
        "instructions": [
            "你是品牌舆情分析专家，擅长情感分析和舆情趋势研判。",
            "始终使用中文回答。",
        ],
    },
    "a6": {
        "name": "私有数据治理Agent",
        "avatar": "🛡️",
        "description": "企业数据质量管理与 ETL 流程优化",
        "capabilities": ["数据质量", "规则引擎", "ETL"],
        "instructions": [
            "你是企业数据治理专家，擅长数据质量管理和 ETL 流程优化。",
            "始终使用中文回答。",
        ],
    },
    "a7": {
        "name": "PPT制作Agent",
        "avatar": "📑",
        "description": "根据描述自动生成专业 PPT 演示文稿",
        "capabilities": ["PPT生成", "模板设计", "内容编排"],
        "builtin_tools": ["python", "file"],
        "instructions": [
            "你是专业的 PPT 制作专家，能根据用户需求生成高质量的演示文稿。",
            "你使用 python-pptx 库来生成 .pptx 文件。",
            "生成 PPT 时请遵循以下原则：",
            "1. 首页包含标题和副标题",
            "2. 每页幻灯片有清晰的标题和要点",
            "3. 合理使用布局（标题页、内容页、双栏页等）",
            "4. 内容简洁，每页不超过 5-6 个要点",
            "5. 文件保存到工作目录",
            "",
            "生成 PPT 的代码模板：",
            "```python",
            "from pptx import Presentation",
            "from pptx.util import Inches, Pt",
            "from pptx.enum.text import PP_ALIGN",
            "prs = Presentation()",
            "# 标题页",
            "slide = prs.slides.add_slide(prs.slide_layouts[0])",
            "slide.shapes.title.text = '标题'",
            "slide.placeholders[1].text = '副标题'",
            "# 内容页",
            "slide = prs.slides.add_slide(prs.slide_layouts[1])",
            "slide.shapes.title.text = '章节标题'",
            "body = slide.placeholders[1]",
            "body.text = '要点内容'",
            "prs.save('output.pptx')",
            "```",
            "",
            "始终使用中文回答。生成完文件后，告知用户文件名。",
        ],
    },
    "global": {
        "name": "全局助手",
        "avatar": "🌐",
        "description": "效能管理智能体，管理项目、Agent 和 Skill 资源",
        "capabilities": ["资源调度", "效能分析", "计算器"],
        "builtin_tools": ["calculator"],
        "instructions": [
            "你是效能管理智能体「全局助手」，帮助用户管理项目、Agent 和 Skill 资源。",
            "你可以使用计算器来辅助计算。",
            "可以搜索资源、分析效能指标、提供风险预警和任务创建建议。",
            "回答要简洁实用，必要时使用列表格式。",
            "始终使用中文回答。",
        ],
    },
    "skill_engineer": {
        "name": "技能工程师",
        "avatar": "🔧",
        "description": "根据自然语言描述自动生成 Python 技能",
        "capabilities": ["代码生成"],
        "instructions": [
            "你是技能工程师，专门根据用户的自然语言描述生成 Python 技能代码。",
            "生成的代码必须严格遵循以下格式：",
            "",
            "```python",
            'SKILL_META = {',
            '    "name": "技能中文名",',
            '    "icon": "合适的emoji",',
            '    "category": "analysis|data|code|search|api 之一",',
            '    "description": "一句话描述技能功能",',
            '}',
            "",
            "def run(参数1: 类型, 参数2: 类型) -> str:",
            '    """函数文档"""',
            "    # 实现逻辑",
            '    return "结果字符串"',
            "```",
            "",
            "你的回答必须是一个 JSON 对象，格式为：",
            '{"filename": "snake_case_name.py", "code": "完整的Python代码"}',
            "只返回 JSON，不要包含任何其他文字或 markdown 标记。",
            "文件名使用英文 snake_case，不含中文。",
            "run() 函数的参数使用基础类型（str, int, float, bool），返回 str。",
        ],
    },
}


# ═══════════════════════════════════════════════════════════════════════════════
# Agent 实例管理
# ═══════════════════════════════════════════════════════════════════════════════

_agents: dict[str, Agent] = {}


def _build_skill_tools(agent_id: str) -> list:
    """为指定 Agent 构建已挂载技能的工具函数列表。"""
    tool_ids = _agent_tools.get(agent_id, [])
    tools = []
    for sid in tool_ids:
        skill = _skill_registry.get(sid)
        if skill:
            tools.append(skill["run_fn"])
    return tools


def get_agent(agent_id: str) -> Agent | None:
    if agent_id in _agents:
        return _agents[agent_id]

    config = AGENT_CONFIGS.get(agent_id)
    if not config:
        return None

    try:
        builtin = _make_builtin_tools(config.get("builtin_tools", []))
        custom = _build_skill_tools(agent_id)
        all_tools = builtin + custom

        kwargs = {}
        if config.get("has_knowledge"):
            kwargs["knowledge"] = _knowledge
            kwargs["add_knowledge_to_context"] = True
            kwargs["search_knowledge"] = False

        _guardrail = PromptInjectionGuardrail()

        agent = Agent(
            name=config["name"],
            id=agent_id,
            model=create_model(),
            db=SqliteDb(db_file=str(BASE_DIR / "data" / "sessions.db")),
            instructions=config["instructions"],
            tools=all_tools if all_tools else None,
            pre_hooks=[_guardrail],
            add_history_to_context=True,
            num_history_runs=10,
            markdown=True,
            **kwargs,
        )
        _agents[agent_id] = agent
        return agent
    except Exception as e:
        print(f"[ERROR] 创建 Agent {agent_id} 失败: {e}")
        return None


def invalidate_agent(agent_id: str):
    """清除 Agent 缓存，下次使用时重建（加载新工具）。"""
    _agents.pop(agent_id, None)
    _teams.clear()


# ═══════════════════════════════════════════════════════════════════════════════
# Team 多 Agent 协作 (coordinate 模式)
# ═══════════════════════════════════════════════════════════════════════════════

from agno.team.team import Team
from agno.team.mode import TeamMode

_teams: dict[str, Team] = {}

TEAM_MEMBER_IDS = ["a1", "a2", "a3", "a4", "a5", "a6", "a7"]


def get_team(project_id: str) -> Team:
    if project_id in _teams:
        return _teams[project_id]

    members = [get_agent(aid) for aid in TEAM_MEMBER_IDS]
    members = [m for m in members if m is not None]

    team = Team(
        name=f"项目团队",
        mode=TeamMode.coordinate,
        model=create_model(),
        members=members,
        instructions=[
            "你是项目协调者（Team Leader），负责理解用户需求并将任务分配给最合适的专家 Agent。",
            "你的团队成员包括：",
            "- 数据分析Agent：擅长 SQL、Pandas、DuckDB 数据分析",
            "- 知识检索Agent：负责企业知识库检索和文档问答",
            "- 代码助手Agent：擅长代码生成、执行和调试",
            "- 合同审查Agent：法律合同风险识别",
            "- 舆情监控Agent：品牌舆情分析",
            "- 私有数据治理Agent：数据质量管理",
            "- PPT制作Agent：自动生成 PPT 演示文稿",
            "",
            "分配任务时请说明选择该成员的理由。",
            "汇总成员响应时，提供清晰的结论和下一步建议。",
            "始终使用中文回答。",
        ],
        markdown=True,
        share_member_interactions=True,
    )
    _teams[project_id] = team
    return team


# ═══════════════════════════════════════════════════════════════════════════════
# 请求模型
# ═══════════════════════════════════════════════════════════════════════════════

class ChatRequest(BaseModel):
    message: str
    session_id: str = "default"

class SkillCreateRequest(BaseModel):
    description: str

class SkillRunRequest(BaseModel):
    params: dict

class AgentToolsRequest(BaseModel):
    skill_ids: list[str]


# ═══════════════════════════════════════════════════════════════════════════════
# 路由：健康检查 & Agent 聊天
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "model_provider": os.getenv("MODEL_PROVIDER", "openai"),
        "model_id": os.getenv("MODEL_ID", "gpt-4o-mini"),
        "skills_count": len(_skill_registry),
        "docs_count": len(list_documents()),
    }


# ═══════════════════════════════════════════════════════════════════════════════
# 路由：项目管理
# ═══════════════════════════════════════════════════════════════════════════════

class ProjectCreateRequest(BaseModel):
    name: str
    description: str = ""


@app.get("/api/projects")
async def api_list_projects():
    conn = _get_projects_conn()
    rows = conn.execute("SELECT * FROM projects ORDER BY updated_at DESC").fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.post("/api/projects")
async def api_create_project(request: ProjectCreateRequest):
    import uuid
    project_id = f"p{uuid.uuid4().hex[:8]}"
    now = datetime.now(timezone.utc).isoformat()
    conn = _get_projects_conn()
    conn.execute(
        "INSERT INTO projects (id, name, description, status, created_at, updated_at) VALUES (?,?,?,?,?,?)",
        (project_id, request.name, request.description, "active", now, now),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
    conn.close()
    return dict(row)


@app.delete("/api/projects/{project_id}")
async def api_delete_project(project_id: str):
    conn = _get_projects_conn()
    conn.execute("DELETE FROM projects WHERE id = ?", (project_id,))
    conn.commit()
    conn.close()
    return {"success": True}


@app.get("/api/agents")
async def api_list_agents():
    return [
        {
            "id": k,
            "name": v["name"],
            "avatar": v.get("avatar", "🤖"),
            "description": v.get("description", ""),
            "capabilities": v.get("capabilities", []),
            "builtin_tools": v.get("builtin_tools", []),
            "custom_tools": _agent_tools.get(k, []),
            "has_knowledge": v.get("has_knowledge", False),
        }
        for k, v in AGENT_CONFIGS.items()
        if k != "skill_engineer"
    ]


@app.post("/api/agents/{agent_id}/chat")
async def agent_chat(agent_id: str, request: ChatRequest):
    agent = get_agent(agent_id)

    async def generate():
        if not agent:
            yield f"data: {json.dumps({'content': f'Agent [{agent_id}] 未找到。', 'done': True})}\n\n"
            return
        try:
            async with asyncio.timeout(180):
                async for chunk in agent.arun(
                    request.message,
                    stream=True,
                    session_id=request.session_id,
                ):
                    if chunk.content:
                        cleaned = _clean_delta(chunk.content)
                        if cleaned:
                            yield f"data: {json.dumps({'content': cleaned, 'done': False}, ensure_ascii=False)}\n\n"
            yield f"data: {json.dumps({'content': '', 'done': True})}\n\n"
        except TimeoutError:
            print(f"[ERROR] Agent chat {agent_id}: timeout after 180s")
            yield f"data: {json.dumps({'content': 'Agent 响应超时（3分钟），请简化问题后重试。', 'done': True})}\n\n"
        except Exception as e:
            err = str(e)
            if "api_key" in err.lower() or "authentication" in err.lower():
                msg = "⚠️ 未检测到有效的 API Key，请在 backend/.env 中配置。"
            else:
                msg = f"请求出错：{err}"
            yield f"data: {json.dumps({'content': msg, 'done': True})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ═══════════════════════════════════════════════════════════════════════════════
# 路由：Team 协作
# ═══════════════════════════════════════════════════════════════════════════════

_THINK_RE = re.compile(r"<think>.*?</think>", re.DOTALL)
_MEMBER_XML_RE = re.compile(r"<member\b[^>]*>.*?</member>", re.DOTALL)
_MEMBER_LIST_BLOCK_RE = re.compile(
    r"Please choose the correct member from the list of members:\s*(?:<member\b.*?</member>\s*)+",
    re.DOTALL,
)

def _clean_content(text: str) -> str:
    """清理完整消息中的 think 标签、成员列表 XML 等。"""
    text = _THINK_RE.sub("", text)
    text = _MEMBER_LIST_BLOCK_RE.sub("", text)
    text = _MEMBER_XML_RE.sub("", text)
    text = text.strip()
    return text

def _clean_delta(text: str) -> str:
    """清理流式 chunk 中的 think 标签，但保留空白和换行。"""
    return _THINK_RE.sub("", text)

def _resolve_agent_display(member_id: str | None) -> tuple[str, str]:
    """根据 member_id 解析出 (avatar, display_name)。"""
    if not member_id:
        return "🤖", "成员"
    for k, v in AGENT_CONFIGS.items():
        if k == member_id or v["name"] == member_id:
            return v.get("avatar", "🤖"), v["name"]
    return "🤖", member_id


@app.post("/api/teams/{project_id}/chat")
async def team_chat(project_id: str, request: ChatRequest):
    from agno.run.team import TeamRunEvent, TeamRunOutput
    from agno.run.agent import RunEvent, RunOutput

    team = get_team(project_id)
    streamed_members: set[str] = set()

    docs = list_documents()
    if docs:
        doc_names = ", ".join(d["doc_name"] for d in docs)
        context_msg = (
            f"[知识库状态] 当前知识库已有以下文档：{doc_names}。"
            f"如果用户的问题可能与这些文档内容相关，请务必将任务分配给知识检索Agent（a2）。\n\n"
            f"用户问题：{request.message}"
        )
    else:
        context_msg = request.message

    def _sse(payload: dict) -> str:
        return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"

    async def generate():
        try:
            async with asyncio.timeout(300):
                async for event in team.arun(
                    context_msg,
                    stream=True,
                    stream_events=True,
                    session_id=f"team_{project_id}_{request.session_id}",
                    yield_run_output=True,
                ):
                    if isinstance(event, TeamRunOutput):
                        for mr in event.member_responses:
                            mid = None
                            if isinstance(mr, RunOutput):
                                mid = mr.agent_id
                            if mid and mid in streamed_members:
                                continue
                            avatar, display_name = _resolve_agent_display(mid)
                            content = ""
                            if hasattr(mr, "content") and mr.content:
                                content = mr.content if isinstance(mr.content, str) else str(mr.content)
                            content = _clean_content(content)
                            if content:
                                yield _sse({
                                    "type": "member_response",
                                    "agent_name": f"{avatar} {display_name}",
                                    "content": content,
                                    "done": False,
                                })
                        continue

                    ev_type = getattr(event, "event", "")

                    # ── Team 级事件：Leader 分配任务 ──
                    if ev_type == TeamRunEvent.tool_call_started.value:
                        tool = getattr(event, "tool", None)
                        if tool and tool.tool_name and "delegate_task" in tool.tool_name:
                            args = tool.tool_args or {}
                            mid = args.get("member_id", "")
                            task_raw = args.get("task", "")
                            avatar, display_name = _resolve_agent_display(mid)
                            task_clean = task_raw.replace("\\n", " ").strip()
                            if len(task_clean) > 80:
                                task_clean = task_clean[:80] + "..."
                            yield _sse({
                                "type": "member_delegated",
                                "agent_name": f"{avatar} {display_name}",
                                "task": task_clean,
                                "done": False,
                            })

                    # ── Team 级事件：成员完成（如果已流式过则跳过）──
                    elif ev_type == TeamRunEvent.tool_call_completed.value:
                        tool = getattr(event, "tool", None)
                        if tool and tool.tool_name and "delegate_task" in tool.tool_name:
                            args = tool.tool_args or {}
                            mid = args.get("member_id", "")
                            if mid in streamed_members:
                                continue
                            avatar, display_name = _resolve_agent_display(mid)
                            result_text = ""
                            if tool.result:
                                result_text = tool.result if isinstance(tool.result, str) else str(tool.result)
                            content = getattr(event, "content", None)
                            if not result_text and content:
                                result_text = content if isinstance(content, str) else str(content)
                            result_text = _clean_content(result_text)
                            if result_text:
                                yield _sse({
                                    "type": "member_response",
                                    "agent_name": f"{avatar} {display_name}",
                                    "content": result_text,
                                    "done": False,
                                })

                    # ── Team 级事件：Leader 自身流式输出 ──
                    elif ev_type == TeamRunEvent.run_content.value:
                        content = getattr(event, "content", None)
                        if content:
                            text = content if isinstance(content, str) else str(content)
                            text = _clean_delta(text)
                            if text:
                                yield _sse({
                                    "type": "leader_content",
                                    "content": text,
                                    "done": False,
                                })

                    # ── Agent 级事件：成员 Agent 流式输出 ──
                    elif ev_type == RunEvent.run_content.value:
                        agent_id = getattr(event, "agent_id", "")
                        content = getattr(event, "content", None)
                        if content and agent_id:
                            streamed_members.add(agent_id)
                            avatar, display_name = _resolve_agent_display(agent_id)
                            text = content if isinstance(content, str) else str(content)
                            text = _clean_delta(text)
                            if text:
                                yield _sse({
                                    "type": "member_streaming",
                                    "agent_name": f"{avatar} {display_name}",
                                    "content": text,
                                    "done": False,
                                })

                    # ── Agent 级事件：成员开始执行 ──
                    elif ev_type == RunEvent.run_started.value:
                        agent_id = getattr(event, "agent_id", "")
                        if agent_id:
                            avatar, display_name = _resolve_agent_display(agent_id)
                            yield _sse({
                                "type": "member_started",
                                "agent_name": f"{avatar} {display_name}",
                                "done": False,
                            })

            yield _sse({"type": "done", "content": "", "done": True})
        except TimeoutError:
            print("[ERROR] Team chat: timeout after 300s")
            yield _sse({"type": "leader_content", "content": "Team 协作超时（5分钟），请简化问题后重试。", "done": True})
        except Exception as e:
            err = str(e)
            print(f"[ERROR] Team chat: {err}")
            yield _sse({"type": "leader_content", "content": f"Team 协作出错：{err}", "done": True})

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ═══════════════════════════════════════════════════════════════════════════════
# 路由：技能管理
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/api/skills")
async def api_list_skills():
    scan_skills()
    return [
        {
            "id": s["id"],
            "name": s["meta"]["name"],
            "icon": s["meta"].get("icon", "🔧"),
            "category": s["meta"].get("category", "api"),
            "description": s["meta"].get("description", ""),
            "params": s["params"],
        }
        for s in _skill_registry.values()
    ]


@app.post("/api/skills/create")
async def api_create_skill(request: SkillCreateRequest):
    """调用技能工程师 Agent 根据自然语言描述生成技能代码。"""
    engineer = get_agent("skill_engineer")
    if not engineer:
        return {"success": False, "error": "技能工程师 Agent 初始化失败"}

    try:
        result = await engineer.arun(request.description, stream=False)
        raw = result.content.strip()
        # 尝试从回复中提取 JSON
        if "```" in raw:
            match = re.search(r'```(?:json)?\s*(\{.*?\})\s*```', raw, re.DOTALL)
            if match:
                raw = match.group(1)
        data = json.loads(raw)
        filename = data["filename"]
        code = data["code"]

        if not filename.endswith(".py"):
            filename += ".py"
        filename = re.sub(r'[^a-zA-Z0-9_.]', '_', filename)

        filepath = SKILLS_DIR / filename
        filepath.write_text(code, encoding="utf-8")

        scan_skills()
        skill_id = filepath.stem
        if skill_id in _skill_registry:
            return {"success": True, "skill_id": skill_id, "skill": _skill_registry[skill_id]["meta"]}
        else:
            return {"success": False, "error": "技能代码生成成功但加载失败，请检查代码格式"}

    except json.JSONDecodeError:
        return {"success": False, "error": f"技能工程师返回了非 JSON 格式的内容: {raw[:200]}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


@app.post("/api/skills/{skill_id}/run")
async def api_run_skill(skill_id: str, request: SkillRunRequest):
    skill = _skill_registry.get(skill_id)
    if not skill:
        return {"success": False, "error": f"技能 [{skill_id}] 不存在"}
    try:
        sig = inspect.signature(skill["run_fn"])
        cast_params = {}
        for name, param in sig.parameters.items():
            if name in request.params:
                val = request.params[name]
                if param.annotation == float:
                    val = float(val)
                elif param.annotation == int:
                    val = int(val)
                cast_params[name] = val
        result = skill["run_fn"](**cast_params)
        return {"success": True, "result": str(result)}
    except Exception as e:
        return {"success": False, "error": str(e)}


@app.put("/api/agents/{agent_id}/tools")
async def api_set_agent_tools(agent_id: str, request: AgentToolsRequest):
    if agent_id not in AGENT_CONFIGS:
        return {"success": False, "error": f"Agent [{agent_id}] 不存在"}
    _agent_tools[agent_id] = request.skill_ids
    invalidate_agent(agent_id)
    return {"success": True, "agent_id": agent_id, "tools": request.skill_ids}


# ═══════════════════════════════════════════════════════════════════════════════
# 路由：知识库
# ═══════════════════════════════════════════════════════════════════════════════

@app.post("/api/knowledge/upload")
async def api_upload_document(file: UploadFile = File(...)):
    content = await file.read()
    doc_name = file.filename or "unknown.txt"
    suffix = Path(doc_name).suffix.lower()

    doc_path = KNOWLEDGE_DOCS_DIR / doc_name

    if suffix == ".pdf":
        import fitz
        doc_path.write_bytes(content)
        pdf = fitz.open(stream=content, filetype="pdf")
        pages = [page.get_text().strip() for page in pdf if page.get_text().strip()]
        pdf.close()
        text = "\n\n".join(pages)
    else:
        text = content.decode("utf-8", errors="ignore")
        doc_path.write_text(text, encoding="utf-8")

    if not text.strip():
        return {"success": False, "error": "文件内容为空，无法解析"}

    try:
        chunk_count = ingest_document(doc_name, text)
        _uploaded_docs[doc_name] = chunk_count
        invalidate_agent("a2")
        return {"success": True, "doc_name": doc_name, "chunks": chunk_count}
    except Exception as e:
        return {"success": False, "error": f"解析失败: {e}"}


@app.get("/api/knowledge/docs")
async def api_list_docs():
    return list_documents()


# ═══════════════════════════════════════════════════════════════════════════════
# 路由：统计数据 & 文件下载
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/api/stats")
async def api_stats():
    return {
        "agents_count": len([k for k in AGENT_CONFIGS if k != "skill_engineer"]),
        "skills_count": len(_skill_registry),
        "docs_count": len(_uploaded_docs),
        "workspace_files": len(list(WORKSPACE_DIR.glob("*"))) if WORKSPACE_DIR.exists() else 0,
    }


@app.get("/api/workspace/files")
async def api_list_workspace_files():
    if not WORKSPACE_DIR.exists():
        return []
    files = []
    for f in sorted(WORKSPACE_DIR.iterdir()):
        if f.is_file() and not f.name.startswith("."):
            files.append({
                "name": f.name,
                "size": f.stat().st_size,
                "modified": f.stat().st_mtime,
            })
    return files


@app.get("/api/workspace/files/{filename}")
async def api_download_workspace_file(filename: str):
    filepath = WORKSPACE_DIR / filename
    if not filepath.exists() or not filepath.is_file():
        return {"error": "文件不存在"}
    return FileResponse(filepath, filename=filename)


# ═══════════════════════════════════════════════════════════════════════════════
# 路由：Workflow 工作流
# ═══════════════════════════════════════════════════════════════════════════════

class WorkflowRunRequest(BaseModel):
    input: str

WORKFLOW_TEMPLATES = {
    "doc_pipeline": {
        "id": "doc_pipeline",
        "name": "文档处理流水线",
        "description": "上传文档 → 解析内容 → AI 分析摘要 → 生成报告",
        "steps": ["文档解析", "知识入库", "AI 分析摘要", "生成报告"],
        "icon": "FileText",
        "agents": ["a2", "a1", "a3"],
    },
    "data_pipeline": {
        "id": "data_pipeline",
        "name": "数据分析流水线",
        "description": "接收数据需求 → 数据查询 → 统计分析 → 图表生成 → 导出报告",
        "steps": ["需求理解", "数据查询", "统计分析", "生成报告"],
        "icon": "BarChart3",
        "agents": ["a1", "a3"],
    },
    "ppt_pipeline": {
        "id": "ppt_pipeline",
        "name": "PPT 生成流水线",
        "description": "描述主题 → AI 生成大纲 → 逐页生成内容 → 输出 .pptx 文件",
        "steps": ["主题分析", "大纲生成", "内容填充", "生成文件"],
        "icon": "Presentation",
        "agents": ["a7"],
    },
}


@app.get("/api/workflows")
async def api_list_workflows():
    return [
        {
            "id": wf["id"],
            "name": wf["name"],
            "description": wf["description"],
            "steps": wf["steps"],
            "icon": wf["icon"],
        }
        for wf in WORKFLOW_TEMPLATES.values()
    ]


@app.post("/api/workflows/{workflow_id}/run")
async def api_run_workflow(workflow_id: str, request: WorkflowRunRequest):
    wf = WORKFLOW_TEMPLATES.get(workflow_id)
    if not wf:
        return {"error": f"工作流 [{workflow_id}] 不存在"}

    steps = wf["steps"]
    agent_ids = wf["agents"]

    async def generate():
        user_input = request.input

        if workflow_id == "ppt_pipeline":
            yield f"data: {json.dumps({'content': '[STEP:1]', 'done': False})}\n\n"
            yield f"data: {json.dumps({'content': '正在分析主题并生成 PPT...\n\n', 'done': False})}\n\n"

            ppt_agent = get_agent("a7")
            if ppt_agent:
                prompt = f"请根据以下需求生成一个 PPT 文件：{user_input}\n请使用 python-pptx 生成 .pptx 文件并保存。"
                try:
                    for step_idx in range(1, len(steps) + 1):
                        yield f"data: {json.dumps({'content': f'[STEP:{step_idx}]', 'done': False})}\n\n"
                    async for chunk in ppt_agent.arun(prompt, stream=True):
                        if chunk.content:
                            yield f"data: {json.dumps({'content': chunk.content, 'done': False})}\n\n"
                except Exception as e:
                    yield f"data: {json.dumps({'content': f'\n\n执行出错: {e}', 'done': False})}\n\n"

        elif workflow_id == "data_pipeline":
            data_agent = get_agent("a1")
            code_agent = get_agent("a3")

            for step_idx, step_name in enumerate(steps, 1):
                yield f"data: {json.dumps({'content': f'[STEP:{step_idx}]', 'done': False})}\n\n"
                yield f"data: {json.dumps({'content': f'### 步骤 {step_idx}: {step_name}\n\n', 'done': False})}\n\n"

                if step_idx <= 3 and data_agent:
                    prompt = f"[{step_name}] 用户需求：{user_input}"
                    try:
                        async for chunk in data_agent.arun(prompt, stream=True):
                            if chunk.content:
                                yield f"data: {json.dumps({'content': chunk.content, 'done': False})}\n\n"
                    except Exception as e:
                        yield f"data: {json.dumps({'content': f'出错: {e}', 'done': False})}\n\n"
                elif step_idx == 4 and code_agent:
                    try:
                        async for chunk in code_agent.arun(
                            f"请根据数据分析结果生成一份总结报告：{user_input}", stream=True
                        ):
                            if chunk.content:
                                yield f"data: {json.dumps({'content': chunk.content, 'done': False})}\n\n"
                    except Exception as e:
                        yield f"data: {json.dumps({'content': f'出错: {e}', 'done': False})}\n\n"

                yield f"data: {json.dumps({'content': '\n\n---\n\n', 'done': False})}\n\n"

        elif workflow_id == "doc_pipeline":
            knowledge_agent = get_agent("a2")
            data_agent = get_agent("a1")

            for step_idx, step_name in enumerate(steps, 1):
                yield f"data: {json.dumps({'content': f'[STEP:{step_idx}]', 'done': False})}\n\n"
                yield f"data: {json.dumps({'content': f'### 步骤 {step_idx}: {step_name}\n\n', 'done': False})}\n\n"

                agent_to_use = knowledge_agent if step_idx <= 2 else data_agent
                if agent_to_use:
                    prompt = f"[{step_name}] 用户需求：{user_input}"
                    try:
                        async for chunk in agent_to_use.arun(prompt, stream=True):
                            if chunk.content:
                                yield f"data: {json.dumps({'content': chunk.content, 'done': False})}\n\n"
                    except Exception as e:
                        yield f"data: {json.dumps({'content': f'出错: {e}', 'done': False})}\n\n"

                yield f"data: {json.dumps({'content': '\n\n---\n\n', 'done': False})}\n\n"

        yield f"data: {json.dumps({'content': '', 'done': True})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
