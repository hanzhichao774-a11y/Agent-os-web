import time
from datetime import datetime, timezone

from config import WORKSPACE_DIR
from database import _get_projects_conn
from skill_manager import _skill_registry, scan_skills
from knowledge import list_documents
from agents import (
    AGENT_CONFIGS, _agent_tools, _agents,
    invalidate_agent, TEAM_MEMBER_IDS,
)


def _global_list_agents() -> str:
    """列出系统中所有可用的 Agent 及其能力描述。"""
    lines = []
    for aid, cfg in AGENT_CONFIGS.items():
        if aid == "skill_engineer":
            continue
        tools = cfg.get("builtin_tools", [])
        custom = [sid for sid in _agent_tools.get(aid, []) if sid in _skill_registry]
        tool_str = ", ".join(tools + custom) if (tools or custom) else "无"
        lines.append(f"- **{cfg['name']}** (ID: {aid}): {cfg.get('description', '')} | 工具: {tool_str}")
    return f"当前系统共有 {len(lines)} 个 Agent：\n" + "\n".join(lines)


def _global_list_skills() -> str:
    """列出系统中所有已注册的技能。"""
    scan_skills()
    if not _skill_registry:
        return "当前没有已注册的技能。"
    lines = []
    for s in _skill_registry.values():
        meta = s["meta"]
        mounted = [AGENT_CONFIGS[aid]["name"] for aid, sids in _agent_tools.items() if s["id"] in sids and aid in AGENT_CONFIGS]
        mount_str = ", ".join(mounted) if mounted else "未挂载"
        lines.append(f"- **{meta['name']}** (ID: {s['id']}): {meta.get('description', '')} | 挂载: {mount_str}")
    return f"当前系统共有 {len(lines)} 个技能：\n" + "\n".join(lines)


def _global_list_projects() -> str:
    """列出系统中所有项目。"""
    conn = _get_projects_conn()
    rows = conn.execute("SELECT id, name, description, status, created_at FROM projects ORDER BY created_at DESC").fetchall()
    if not rows:
        return "当前没有项目。"
    lines = []
    for r in rows:
        lines.append(f"- **{r[1]}** (ID: {r[0]}): {r[2]} | 状态: {r[3]}")
    return f"当前系统共有 {len(lines)} 个项目：\n" + "\n".join(lines)


def _global_list_knowledge_docs() -> str:
    """列出知识库中已上传的文档。"""
    docs = list_documents()
    if not docs:
        return "知识库当前没有文档。"
    lines = [f"- {d['doc_name']} ({d['chunks']} 个段落)" for d in docs]
    return f"知识库共有 {len(lines)} 个文档：\n" + "\n".join(lines)


def _global_list_tasks(project_id: str) -> str:
    """列出指定项目下的所有子任务。需提供 project_id。"""
    conn = _get_projects_conn()
    project = conn.execute("SELECT name FROM projects WHERE id = ?", (project_id,)).fetchone()
    if not project:
        conn.close()
        return f"错误：项目 [{project_id}] 不存在"
    rows = conn.execute(
        "SELECT id, name, created_at FROM tasks WHERE project_id = ? ORDER BY sort_order, created_at",
        (project_id,),
    ).fetchall()
    conn.close()
    if not rows:
        return f"项目「{project['name']}」(ID: {project_id}) 当前没有子任务。"
    lines = []
    for r in rows:
        lines.append(f"- **{r[1]}** (ID: {r[0]}) | 创建时间: {r[2]}")
    return f"项目「{project['name']}」共有 {len(lines)} 个子任务：\n" + "\n".join(lines)


def _global_list_workspace_files() -> str:
    """列出工作区中所有产出文件（Agent 生成的 PDF、图表、Excel 等）。"""
    if not WORKSPACE_DIR.exists():
        return "工作区目录不存在。"
    files = sorted(WORKSPACE_DIR.glob("*"), key=lambda f: f.stat().st_mtime, reverse=True)
    files = [f for f in files if f.is_file() and not f.name.startswith(".")]
    if not files:
        return "工作区当前没有产出文件。"
    lines = []
    for f in files:
        size = f.stat().st_size
        size_str = f"{size / 1024:.0f}KB" if size < 1024 * 1024 else f"{size / 1024 / 1024:.1f}MB"
        lines.append(f"- **{f.name}** ({size_str})")
    return f"工作区共有 {len(lines)} 个产出文件：\n" + "\n".join(lines)


def _global_system_stats() -> str:
    """获取系统整体统计概览。"""
    scan_skills()
    agent_count = sum(1 for k in AGENT_CONFIGS if k != "skill_engineer")
    skill_count = len(_skill_registry)
    docs = list_documents()
    workspace_files = list(WORKSPACE_DIR.glob("*")) if WORKSPACE_DIR.exists() else []
    return (
        f"系统概览：\n"
        f"- Agent 数量: {agent_count}\n"
        f"- 技能数量: {skill_count}\n"
        f"- 知识库文档: {len(docs)}\n"
        f"- 工作区文件: {len(workspace_files)}"
    )


def _global_mount_skill(skill_id: str, agent_id: str) -> str:
    """将指定技能挂载到指定 Agent。需提供 skill_id 和 agent_id。"""
    if agent_id not in AGENT_CONFIGS:
        agent_list = ", ".join(f"{k}({v['name']})" for k, v in AGENT_CONFIGS.items() if k != "skill_engineer")
        return f"错误：Agent [{agent_id}] 不存在。可用 Agent：{agent_list}"
    if skill_id not in _skill_registry:
        scan_skills()
        if skill_id not in _skill_registry:
            skill_list = ", ".join(f"{s['id']}({s['meta']['name']})" for s in _skill_registry.values())
            return f"错误：技能 [{skill_id}] 不存在。可用技能：{skill_list}"
    current = _agent_tools.get(agent_id, [])
    if skill_id in current:
        return f"技能 [{skill_id}] 已经挂载在 {AGENT_CONFIGS[agent_id]['name']} 上了"
    _agent_tools[agent_id] = current + [skill_id]
    invalidate_agent(agent_id)
    from teams import _teams
    _teams.clear()
    return f"成功：已将技能 {_skill_registry[skill_id]['meta']['name']}({skill_id}) 挂载到 {AGENT_CONFIGS[agent_id]['name']}（{agent_id}）"


def _global_unmount_skill(skill_id: str, agent_id: str) -> str:
    """从指定 Agent 卸载技能。需提供 skill_id 和 agent_id。"""
    if agent_id not in AGENT_CONFIGS:
        return f"错误：Agent [{agent_id}] 不存在"
    current = _agent_tools.get(agent_id, [])
    if skill_id not in current:
        return f"技能 [{skill_id}] 未挂载在 {AGENT_CONFIGS[agent_id]['name']} 上"
    current.remove(skill_id)
    _agent_tools[agent_id] = current
    invalidate_agent(agent_id)
    from teams import _teams
    _teams.clear()
    return f"成功：已从 {AGENT_CONFIGS[agent_id]['name']} 卸载技能 [{skill_id}]"


def _global_create_agent(name: str, description: str = "", instructions: str = "") -> str:
    """创建一个新的自定义 Agent（数字员工）。name 为 Agent 名称，description 为描述，instructions 为指令（多条用换行分隔）。"""
    agent_id = f"custom_{int(time.time() * 1000)}"
    instr_list = [line.strip() for line in instructions.split("\n") if line.strip()] if instructions else [f"你是{name}，请根据用户需求提供帮助。"]
    config = {
        "name": name,
        "avatar": "🤖",
        "description": description or name,
        "capabilities": [],
        "builtin_tools": [],
        "instructions": instr_list,
    }
    AGENT_CONFIGS[agent_id] = config
    return f"成功：已创建 Agent「{name}」（ID: {agent_id}）"


def _global_delete_agent(agent_id: str) -> str:
    """删除一个自定义 Agent。只能删除 ID 以 custom_ 开头的 Agent。"""
    if not agent_id.startswith("custom_"):
        return f"错误：内置 Agent [{agent_id}] 不允许删除，只能删除自定义 Agent（ID 以 custom_ 开头）"
    if agent_id not in AGENT_CONFIGS:
        return f"错误：Agent [{agent_id}] 不存在"
    name = AGENT_CONFIGS[agent_id]["name"]
    del AGENT_CONFIGS[agent_id]
    _agent_tools.pop(agent_id, None)
    _agents.pop(agent_id, None)
    if agent_id in TEAM_MEMBER_IDS:
        TEAM_MEMBER_IDS.remove(agent_id)
    from teams import _teams
    _teams.clear()
    return f"成功：已删除 Agent「{name}」（{agent_id}）"


def _global_create_project(name: str, description: str = "") -> str:
    """创建一个新项目。name 为项目名称，description 为描述。"""
    import uuid
    project_id = f"p{uuid.uuid4().hex[:8]}"
    now = datetime.now(timezone.utc).isoformat()
    conn = _get_projects_conn()
    conn.execute(
        "INSERT INTO projects (id, name, description, status, created_at, updated_at) VALUES (?,?,?,?,?,?)",
        (project_id, name, description, "active", now, now),
    )
    conn.commit()
    conn.close()
    return f"成功：已创建项目「{name}」（ID: {project_id}）"


def _global_delete_project(project_id: str) -> str:
    """删除一个项目及其所有子任务。需提供 project_id。"""
    conn = _get_projects_conn()
    row = conn.execute("SELECT name FROM projects WHERE id = ?", (project_id,)).fetchone()
    if not row:
        conn.close()
        return f"错误：项目 [{project_id}] 不存在"
    name = row["name"]
    conn.execute("DELETE FROM tasks WHERE project_id = ?", (project_id,))
    conn.execute("DELETE FROM projects WHERE id = ?", (project_id,))
    conn.commit()
    conn.close()
    return f"成功：已删除项目「{name}」（{project_id}）及其所有子任务"


_GLOBAL_TOOLS = [
    _global_list_agents,
    _global_list_skills,
    _global_list_projects,
    _global_list_tasks,
    _global_list_knowledge_docs,
    _global_list_workspace_files,
    _global_system_stats,
    _global_mount_skill,
    _global_unmount_skill,
    _global_create_agent,
    _global_delete_agent,
    _global_create_project,
    _global_delete_project,
]


def get_global_tools() -> list:
    """返回全局工具列表，供 agents.get_agent 延迟调用以避免循环导入。"""
    return _GLOBAL_TOOLS
