import os
import re
import json
import importlib.util
import inspect
from pathlib import Path
from dotenv import load_dotenv
from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from agno.agent import Agent
from agno.db.sqlite import SqliteDb
from agno.knowledge.knowledge import Knowledge
from agno.knowledge.embedder.fastembed import FastEmbedEmbedder
from agno.knowledge.chunking.recursive import RecursiveChunking
from agno.vectordb.lancedb import LanceDb

load_dotenv()

BASE_DIR = Path(__file__).parent
SKILLS_DIR = BASE_DIR / "skills"
KNOWLEDGE_DOCS_DIR = BASE_DIR / "knowledge" / "docs"

SKILLS_DIR.mkdir(exist_ok=True)
KNOWLEDGE_DOCS_DIR.mkdir(parents=True, exist_ok=True)
(BASE_DIR / "data").mkdir(exist_ok=True)

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
# Agent 配置
# ═══════════════════════════════════════════════════════════════════════════════

_agent_tools: dict[str, list[str]] = {}

AGENT_CONFIGS: dict[str, dict] = {
    "a1": {
        "name": "数据分析Agent",
        "instructions": [
            "你是企业数据分析专家，擅长 SQL 查询、数据清洗和统计建模。",
            "回答要专业、简洁，需要时提供示例数据说明分析思路。",
            "始终使用中文回答。",
        ],
    },
    "a2": {
        "name": "知识检索Agent",
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
        "instructions": [
            "你是专业代码助手，擅长代码生成、审查、重构与调试。",
            "提供高质量、可运行的代码示例，并用中文解释关键逻辑。",
        ],
    },
    "a4": {
        "name": "合同审查Agent",
        "instructions": [
            "你是法律合同审查专家，擅长识别合同风险和条款分析。",
            "指出潜在风险点，并给出修改建议。",
            "始终使用中文回答。",
        ],
    },
    "a5": {
        "name": "舆情监控Agent",
        "instructions": [
            "你是品牌舆情分析专家，擅长情感分析和舆情趋势研判。",
            "始终使用中文回答。",
        ],
    },
    "a6": {
        "name": "私有数据治理Agent",
        "instructions": [
            "你是企业数据治理专家，擅长数据质量管理和 ETL 流程优化。",
            "始终使用中文回答。",
        ],
    },
    "global": {
        "name": "全局助手",
        "instructions": [
            "你是效能管理智能体「全局助手」，帮助用户管理项目、Agent 和 Skill 资源。",
            "可以搜索资源、分析效能指标、提供风险预警和任务创建建议。",
            "回答要简洁实用，必要时使用列表格式。",
            "始终使用中文回答。",
        ],
    },
    "skill_engineer": {
        "name": "技能工程师",
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
        tools = _build_skill_tools(agent_id)

        kwargs = {}
        if config.get("has_knowledge"):
            kwargs["knowledge"] = _knowledge
            kwargs["add_knowledge_to_context"] = True
            kwargs["search_knowledge"] = False

        agent = Agent(
            name=config["name"],
            model=create_model(),
            db=SqliteDb(db_file=str(BASE_DIR / "data" / "sessions.db")),
            instructions=config["instructions"],
            tools=tools if tools else None,
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


@app.get("/api/agents")
async def api_list_agents():
    return [
        {"id": k, "name": v["name"], "tools": _agent_tools.get(k, [])}
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
            async for chunk in agent.arun(
                request.message,
                stream=True,
                session_id=request.session_id,
            ):
                if chunk.content:
                    yield f"data: {json.dumps({'content': chunk.content, 'done': False})}\n\n"
            yield f"data: {json.dumps({'content': '', 'done': True})}\n\n"
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
