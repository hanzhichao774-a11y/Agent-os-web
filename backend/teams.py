from agno.agent import Agent
from agno.team.team import Team
from agno.team.mode import TeamMode
from agno.db.sqlite import SqliteDb

from config import SESSIONS_DB
from llm import create_model
from skill_manager import _skill_registry
from agents import (
    AGENT_CONFIGS, _agent_tools, get_agent, TEAM_MEMBER_IDS,
)


_teams: dict[str, Team] = {}

_INTENT_CATEGORIES: dict[str, dict] = {
    "knowledge":     {"target": "a2", "name": "知识检索Agent", "desc": "从知识库检索已有文档内容"},
    "data_analysis": {"target": "a1", "name": "数据分析Agent", "desc": "对 CSV/结构化数据做统计分析"},
    "report":        {"target": "a1", "name": "数据分析Agent", "desc": "生成 PDF 报告、Excel 报表、数据图表"},
    "code":          {"target": "a3", "name": "代码助手Agent", "desc": "代码生成、执行与调试"},
    "contract":      {"target": "a4", "name": "合同审查Agent", "desc": "法律合同条款风险识别"},
    "sentiment":     {"target": "a5", "name": "舆情监控Agent", "desc": "品牌舆情分析"},
    "data_govern":   {"target": "a6", "name": "私有数据治理Agent", "desc": "数据质量与 ETL 管理"},
    "ppt":           {"target": "a7", "name": "PPT制作Agent",  "desc": "生成演示文稿"},
    "multi_step":    {"target": None, "name": None, "desc": "需要多个 Agent 协作"},
}


async def classify_intent(message: str, docs: list[dict]) -> str:
    """用一次轻量 LLM 调用对用户问题做意图分类，返回类别标签。"""
    doc_list = ", ".join(d["doc_name"] for d in docs) if docs else "（无文档）"

    prompt = (
        "你是意图分类器。根据用户问题和已有知识库文档列表，判断该问题最适合由哪个类别处理。\n"
        "只返回一个分类标签（英文小写），不要解释。\n\n"
        f"已有知识库文档：{doc_list}\n"
        f"用户问题：{message}\n\n"
        "分类标签：\n"
        "- knowledge: 与已有文档/报告/简报/报表内容相关的问答检索（只要问题可能涉及已有文档就选此项）\n"
        "- data_analysis: 明确要求对 CSV/数据库做统计分析、建模、可视化\n"
        "- report: 要求生成 PDF 报告、Excel 报表、数据图表/可视化图片（不是查询已有内容，而是生成新文件）\n"
        "- code: 代码生成、调试、审查\n"
        "- contract: 合同/法律条款审查\n"
        "- sentiment: 品牌舆情分析\n"
        "- data_govern: 数据质量/ETL 治理\n"
        "- ppt: 生成演示文稿/PPT\n"
        "- multi_step: 需要多个Agent协作的复杂任务（如先检索再分析再生成）\n"
    )

    try:
        classifier = Agent(
            model=create_model(),
            instructions=["只返回一个英文分类标签，不要输出任何其他内容。"],
            markdown=False,
        )
        response = await classifier.arun(prompt)
        label = (response.content or "").strip().lower().replace('"', "").replace("'", "")
        for key in _INTENT_CATEGORIES:
            if key in label:
                return key
        return "knowledge"
    except Exception as e:
        print(f"[WARN] 意图分类失败，fallback 到 knowledge: {e}")
        return "knowledge"


def _build_team_member_description() -> str:
    """动态构建团队成员能力描述，包含挂载的自定义技能。"""
    lines = []
    for aid in TEAM_MEMBER_IDS:
        cfg = AGENT_CONFIGS.get(aid)
        if not cfg:
            continue
        desc = cfg.get("description", "")
        custom_skills = _agent_tools.get(aid, [])
        skill_names = []
        for sid in custom_skills:
            if sid in _skill_registry:
                skill_names.append(_skill_registry[sid]["meta"]["name"])
        skill_part = f"，额外技能：{'、'.join(skill_names)}" if skill_names else ""
        lines.append(f"- {aid} {cfg['name']}：{desc}{skill_part}")
    return "\n".join(lines)


def get_team(project_id: str) -> Team:
    if project_id in _teams:
        return _teams[project_id]

    members = [get_agent(aid) for aid in TEAM_MEMBER_IDS]
    members = [m for m in members if m is not None]

    member_desc = _build_team_member_description()

    team = Team(
        name="项目团队",
        mode=TeamMode.route,
        model=create_model(),
        members=members,
        determine_input_for_members=False,
        db=SqliteDb(db_file=SESSIONS_DB),
        add_history_to_context=True,
        num_history_runs=5,
        add_team_history_to_members=True,
        num_team_history_runs=3,
        share_member_interactions=True,
        instructions=[
            "你是管理智能体，根据用户问题分配最合适的专家 Agent 来处理。",
            "你能看到之前的对话历史，要理解用户的指代（如'上面的'、'刚才的'等），结合上下文做出正确路由。",
            "",
            "## 核心路由原则",
            "**最高优先级**：当用户明确要求'生成图表'、'生成PDF'、'导出Excel'、'画柱状图'、'做可视化'等文件生成操作时，",
            "必须选择数据分析Agent（a1），即使之前的对话上下文是知识检索。a1 拥有 generate_chart、generate_excel、generate_pdf_report 工具。",
            "",
            "当用户问的是文档、简报、报告中已有的内容（如排名、统计数据、分析结论等），选择知识检索Agent（a2）。",
            "只有当用户明确要求对 CSV 文件或数据库进行 SQL 查询、建模时，才选择数据分析Agent（a1）。",
            "当用户要求基于之前对话结果做进一步操作（如生成PPT、写报告），根据目标操作选择对应Agent，并确保上下文传递。",
            "如果某成员挂载了与用户需求匹配的额外技能（如天气查询、BMI 计算等），优先将请求路由到该成员。",
            "",
            "## 成员能力",
            member_desc,
            "",
            "## 路由规则（按优先级排列）",
            "1. 要求生成图表、Excel 报表、PDF 报告、数据可视化 -> 数据分析Agent (a1)【最高优先级】",
            "2. 如果某成员拥有与用户需求直接匹配的额外技能 -> 优先路由到该成员",
            "3. 涉及文档/报告/简报中的内容（排名、分析、数据、结论等）-> 知识检索Agent (a2)",
            "4. 明确要求对 CSV/数据库做 SQL 查询、建模 -> 数据分析Agent (a1)",
            "5. 代码生成/调试/审查 -> 代码助手Agent (a3)",
            "6. 需要调用外部 API、图片处理 -> 代码助手Agent (a3)",
            "7. 通用技术方案/架构设计等 -> 代码助手Agent (a3)",
            "8. 不确定时优先选择知识检索Agent (a2)",
            "",
            "## 技能缺失建议",
            "如果用户请求的能力（如翻译、特定格式转换等）当前没有成员能直接完成，",
            "你应该告知用户：'当前没有成员具备该能力，建议通过技能管理创建对应技能并挂载到合适的成员上。'",
            "",
            "注意：PDF报告、图表可视化、Excel报表、图片处理、HTTP请求 这些能力已经内置，不需要创建技能。",
        ],
        show_members_responses=True,
        markdown=True,
    )
    _teams[project_id] = team
    return team
