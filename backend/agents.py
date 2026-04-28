import time

from agno.agent import Agent
from agno.db.sqlite import SqliteDb
from agno.tools.pandas import PandasTools
from agno.tools.duckdb import DuckDbTools
from agno.tools.csv_toolkit import CsvTools
from agno.tools.file import FileTools
from agno.tools.file_generation import FileGenerationTools
from agno.tools.python import PythonTools
from agno.tools.calculator import CalculatorTools

from config import BASE_DIR, WORKSPACE_DIR, SESSIONS_DB, KNOWLEDGE_DOCS_DIR
from llm import create_model
from skill_manager import _skill_registry
from builtin_tools import (
    generate_pdf_report, generate_chart, generate_excel,
    process_image, http_request,
)


def list_knowledge_documents() -> str:
    """列出知识库中所有已入库的文档名称和段落数量。"""
    from knowledge import list_documents
    docs = list_documents()
    if not docs:
        return "知识库当前没有已入库的文档。"
    lines = []
    for d in docs:
        chunks = d["chunks"]
        chunk_str = f"{chunks} 个段落" if chunks >= 0 else "已入库"
        lines.append(f"- {d['doc_name']}（{chunk_str}）")
    return f"知识库共有 {len(docs)} 个文档：\n" + "\n".join(lines)


# ---------------------------------------------------------------------------
# Agent 配置：仅保留 BizAgent (global) 和技能工程师 (skill_engineer)
# ---------------------------------------------------------------------------

AGENT_CONFIGS: dict[str, dict] = {
    "global": {
        "name": "BizAgent",
        "avatar": "🌐",
        "description": "系统管理智能体，负责任务编排、资源查询、技能管理、项目管理",
        "capabilities": ["任务编排", "资源查询", "技能管理", "项目管理", "计算器", "PDF报告", "图表生成", "Excel导出"],
        "builtin_tools": ["calculator", "pdf", "chart", "excel"],
        "has_knowledge": True,
        "instructions": [
            "你是「BizAgent」，系统中的管理智能体，负责接收用户任务并编排 SubAgent 执行。",
            "",
            "## 核心职责",
            "1. 接收用户消息，判断任务复杂度",
            "2. 简单问答（闲聊、系统查询）直接回答",
            "3. 复杂任务调用 _plan_task 工具进行任务规划和编排",
            "",
            "## 何时调用 _plan_task",
            "- 需要知识检索的问题（从知识库查找信息）",
            "- 需要生成文件的任务（PDF/图表/Excel）",
            "- 需要数据分析的任务",
            "- 需要执行代码的任务",
            "- 多步骤复合任务",
            "",
            "## 何时直接回答",
            "- 系统管理查询（查看项目、技能、工位状态等）",
            "- 简单闲聊和问候",
            "- 关于系统能力的说明",
            "",
            "## 管理工具",
            "",
            "### 任务编排",
            "- _plan_task(message)：将用户任务交给编排引擎，自动分解并分配给 SubAgent 执行",
            "- _get_worker_status()：查看 3 个 SubAgent 工位的当前状态",
            "- _get_capabilities()：查看系统当前所有可用能力清单",
            "",
            "### 查询类",
            "- _global_list_skills：列出所有技能及其状态",
            "- _global_list_projects：列出所有项目",
            "- _global_list_tasks(project_id)：列出指定项目下的所有子任务",
            "- _global_list_knowledge_docs：列出知识库文档",
            "- _global_list_workspace_files：列出工作区所有产出文件",
            "- _global_system_stats：获取系统统计概览",
            "",
            "### 技能管理",
            "- _global_mount_skill(skill_id, agent_id)：挂载技能（agent_id 可使用 'global'）",
            "- _global_unmount_skill(skill_id, agent_id)：卸载技能",
            "",
            "### 项目管理",
            "- _global_create_project(name, description)：创建新项目",
            "- _global_delete_project(project_id)：删除项目",
            "",
            "### 数据报表工具",
            "- generate_pdf_report / generate_chart / generate_excel",
            "- output_filename 请使用中文命名",
            "- PDF content 不要包含 emoji",
            "",
            "### 输出格式要求（重要！）",
            "生成文件后必须按以下格式输出：",
            "- 已生成柱状图：图表标题  或  已生成报告：标题",
            "- 文件名称：实际文件名.扩展名",
            "",
            "## 行为准则",
            "- 当用户消息包含 [当前项目上下文] 时，提取项目名称和 ID。",
            "- 查询信息时主动调用工具获取实时数据，不要编造。",
            "- 回答简洁实用，使用列表或表格呈现结构化数据。",
            "- 始终使用中文回答。",
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
            '    "description": "做什么 + 适用场景，5~200字符",',
            '    "version": "1.0.0",',
            '    "tags": ["标签1", "标签2"],',
            '    "examples": [',
            '        {"input": {"param1": "value"}, "expect_contains": "预期输出关键词"}',
            '    ],',
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
            "description 必须同时包含'做什么'和'适用于什么场景'。",
            "尽量提供 examples 字段用于自动验证。",
        ],
    },
}

_agents: dict[str, Agent] = {}


# ---------------------------------------------------------------------------
# 内置工具工厂
# ---------------------------------------------------------------------------

def _make_builtin_tools(tool_names: list[str]) -> list:
    """根据工具名称列表实例化 Agno 内置 Toolkit 或自定义工具函数。"""
    from entity_extractor import extract_entities_sync, exclude_entity_by_name
    from context import current_project_id, current_task_id
    from doc_parser import read_document_text

    def _entity_extract_from_knowledge(doc_name: str = "") -> str:
        """从知识库文档中抽取实体和关系，构建知识图谱。doc_name 可选，为空则扫描所有文档。"""
        proj_id = current_project_id.get()
        task_id = current_task_id.get()
        if not proj_id:
            return "错误：无法获取当前项目上下文"

        docs_dir = KNOWLEDGE_DOCS_DIR
        if not docs_dir.exists():
            return "知识库文档目录不存在"

        files = []
        if doc_name:
            target = docs_dir / doc_name
            if target.exists():
                files = [target]
            else:
                return f"文档「{doc_name}」不存在"
        else:
            files = [f for f in docs_dir.iterdir() if f.is_file() and not f.name.startswith(".")]

        if not files:
            return "知识库中暂无文档"

        total_ents = 0
        total_rels = 0
        for fpath in files:
            text = read_document_text(fpath)
            if not text.strip():
                continue
            text = text[:8000]
            try:
                result = extract_entities_sync(text, proj_id, task_id, fpath.name)
                total_ents += result.get("entities_count", 0)
                total_rels += result.get("relations_count", 0)
                print(f"[ENTITY] 抽取成功 {fpath.name}: {result.get('entities_count', 0)} 实体")
            except Exception as e:
                print(f"[ENTITY] 抽取失败 {fpath.name}: {e}")

        return f"实体抽取完成：从 {len(files)} 个文档中提取了 {total_ents} 个实体和 {total_rels} 条关系，已保存到知识图谱。"

    def _entity_exclude_tool(entity_name: str) -> str:
        """将指定名称的实体标记为排除，不再在图谱中显示。entity_name: 要排除的实体名称"""
        proj_id = current_project_id.get()
        if not proj_id:
            return "错误：无法获取当前项目上下文"
        return exclude_entity_by_name(proj_id, entity_name)

    factories = {
        "pandas": lambda: PandasTools(),
        "duckdb": lambda: DuckDbTools(db_path=str(WORKSPACE_DIR / "duckdb.db")),
        "csv": lambda: CsvTools(csvs=[str(WORKSPACE_DIR)]),
        "file": lambda: FileTools(base_dir=WORKSPACE_DIR),
        "file_generation": lambda: FileGenerationTools(output_directory=str(WORKSPACE_DIR)),
        "python": lambda: PythonTools(base_dir=WORKSPACE_DIR, restrict_to_base_dir=True),
        "calculator": lambda: CalculatorTools(),
        "pdf": lambda: generate_pdf_report,
        "chart": lambda: generate_chart,
        "excel": lambda: generate_excel,
        "image": lambda: process_image,
        "http": lambda: http_request,
        "_knowledge_list": lambda: list_knowledge_documents,
        "entity_extract": lambda: _entity_extract_from_knowledge,
        "entity_manage": lambda: _entity_exclude_tool,
    }
    tools = []
    for name in tool_names:
        factory = factories.get(name)
        if factory:
            tools.append(factory())
        else:
            print(f"[WARN] 未知内置工具: {name}")
    return tools


# ---------------------------------------------------------------------------
# BizAgent / 缓存 Agent 获取
# ---------------------------------------------------------------------------

def get_agent(agent_id: str) -> Agent | None:
    """获取缓存的 Agent（仅 global / skill_engineer）。"""
    if agent_id in _agents:
        return _agents[agent_id]

    config = AGENT_CONFIGS.get(agent_id)
    if not config:
        return None

    try:
        builtin = _make_builtin_tools(config.get("builtin_tools", []))
        all_tools = builtin[:]

        if agent_id == "global":
            from tools import get_global_tools
            all_tools = all_tools + get_global_tools()

        kwargs = {}
        if config.get("has_knowledge"):
            from knowledge import _knowledge, knowledge_available
            if knowledge_available():
                kwargs["knowledge"] = _knowledge
                kwargs["add_knowledge_to_context"] = True
                kwargs["search_knowledge"] = True
                kwargs["enable_agentic_knowledge_filters"] = True
            else:
                print(f"[WARN] Agent {agent_id} 请求知识库但知识库不可用，跳过注入")

        agent = Agent(
            name=config["name"],
            id=agent_id,
            model=create_model(),
            db=SqliteDb(db_file=SESSIONS_DB),
            instructions=config["instructions"],
            tools=all_tools if all_tools else None,
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
    """清除 Agent 缓存，下次使用时重建。"""
    _agents.pop(agent_id, None)


# ---------------------------------------------------------------------------
# 动态 SubAgent 创建（用完即弃，不缓存）
# ---------------------------------------------------------------------------

def create_dynamic_agent(
    slot_id: int,
    capabilities: list[str],
    task_description: str,
) -> Agent:
    """根据所需能力动态创建一个临时 Agno Agent。"""
    from orchestrator import CAPABILITY_REGISTRY

    all_builtin_names: list[str] = []
    needs_knowledge = False
    skill_tools: list = []

    for cap in capabilities:
        if cap.startswith("skill:"):
            skill_id = cap[len("skill:"):]
            skill = _skill_registry.get(skill_id)
            if skill:
                skill_tools.append(skill["run_fn"])
            continue

        cap_def = CAPABILITY_REGISTRY.get(cap)
        if cap_def:
            all_builtin_names.extend(cap_def.get("builtin_tools", []))
            if cap_def.get("needs_knowledge"):
                needs_knowledge = True

    unique_tools = list(dict.fromkeys(all_builtin_names))
    tools = _make_builtin_tools(unique_tools) + skill_tools

    tool_hints = []
    for cap in capabilities:
        if cap == "entity_extraction":
            tool_hints.append("- 你有一个 `_entity_extract_from_knowledge` 工具，直接调用即可从知识库文档抽取实体，无需手动传参。")
        elif cap == "entity_management":
            tool_hints.append("- 你有一个 `_entity_exclude_tool` 工具，传入要排除的实体名称即可。")

    instructions = [
        f"你是 SubAgent #{slot_id}，正在执行以下任务：",
        f"「{task_description}」",
        "",
        "请专注完成任务并给出清晰的结果。",
        "**重要：你必须使用提供的工具来完成任务，不要只用文字回答。**",
    ]
    if tool_hints:
        instructions.append("")
        instructions.append("## 可用工具说明")
        instructions.extend(tool_hints)

    instructions.extend([
        "",
        "## 输出格式要求（重要！）",
        "如果生成了文件，必须按以下格式输出：",
        "- 已生成柱状图：标题  或  已生成报告：标题",
        "- 文件名称：实际文件名.扩展名",
        "- output_filename 使用中文命名",
        "- PDF content 不要包含 emoji 符号",
        "",
        "始终使用中文回答。",
    ])

    kwargs = {}
    if needs_knowledge:
        from knowledge import _knowledge, knowledge_available
        if knowledge_available():
            kwargs["knowledge"] = _knowledge
            kwargs["add_knowledge_to_context"] = True
            kwargs["search_knowledge"] = True
            kwargs["enable_agentic_knowledge_filters"] = True
        else:
            print(f"[WARN] SubAgent-{slot_id} 请求知识库但知识库不可用，跳过注入")

    agent = Agent(
        name=f"SubAgent-{slot_id}",
        id=f"sub_{slot_id}_{int(time.time())}",
        model=create_model(),
        instructions=instructions,
        tools=tools if tools else None,
        markdown=True,
        **kwargs,
    )
    return agent
