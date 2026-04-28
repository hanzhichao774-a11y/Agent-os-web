"""BizAgent 全局工具集：系统查询 + 编排控制 + 技能/项目管理。"""

import time
from datetime import datetime, timezone

from config import WORKSPACE_DIR
from database import _get_projects_conn
from skill_manager import _skill_registry, scan_skills
from knowledge import list_documents


def _global_list_skills() -> str:
    """列出系统中所有已注册的技能。"""
    scan_skills()
    if not _skill_registry:
        return "当前没有已注册的技能。"
    lines = []
    for s in _skill_registry.values():
        meta = s["meta"]
        lines.append(f"- **{meta['name']}** (ID: {s['id']}): {meta.get('description', '')}")
    return f"当前系统共有 {len(lines)} 个技能：\n" + "\n".join(lines)


def _global_list_projects() -> str:
    """列出系统中所有项目。"""
    conn = _get_projects_conn()
    rows = conn.execute("SELECT id, name, description, status, created_at FROM projects ORDER BY created_at DESC").fetchall()
    if not rows:
        return "当前没有项目。"
    lines = [f"- **{r[1]}** (ID: {r[0]}): {r[2]} | 状态: {r[3]}" for r in rows]
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
    lines = [f"- **{r[1]}** (ID: {r[0]}) | 创建时间: {r[2]}" for r in rows]
    return f"项目「{project['name']}」共有 {len(lines)} 个子任务：\n" + "\n".join(lines)


def _global_list_workspace_files() -> str:
    """列出工作区中所有产出文件。"""
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
    skill_count = len(_skill_registry)
    docs = list_documents()
    workspace_files = list(WORKSPACE_DIR.glob("*")) if WORKSPACE_DIR.exists() else []
    return (
        f"系统概览：\n"
        f"- 技能数量: {skill_count}\n"
        f"- 知识库文档: {len(docs)}\n"
        f"- 工作区文件: {len(workspace_files)}"
    )


def _global_mount_skill(skill_id: str, agent_id: str) -> str:
    """将指定技能挂载到 BizAgent（agent_id 应为 'global'）。"""
    from agents import AGENT_CONFIGS, invalidate_agent
    if agent_id not in AGENT_CONFIGS:
        return f"错误：Agent [{agent_id}] 不存在。可用：global"
    if skill_id not in _skill_registry:
        scan_skills()
        if skill_id not in _skill_registry:
            skill_list = ", ".join(f"{s['id']}({s['meta']['name']})" for s in _skill_registry.values())
            return f"错误：技能 [{skill_id}] 不存在。可用技能：{skill_list}"
    invalidate_agent(agent_id)
    return f"成功：技能 {_skill_registry[skill_id]['meta']['name']} 已就绪，可在任务编排中使用"


def _global_unmount_skill(skill_id: str, agent_id: str) -> str:
    """卸载技能。"""
    from agents import invalidate_agent
    invalidate_agent(agent_id)
    return f"成功：已卸载技能 [{skill_id}]"


def _global_create_project(name: str, description: str = "") -> str:
    """创建一个新项目。"""
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
    """删除一个项目及其所有子任务。"""
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


# ---------------------------------------------------------------------------
# 编排工具（BizAgent 调用来触发编排引擎）
# ---------------------------------------------------------------------------

def _plan_task(message: str) -> str:
    """将用户任务交给编排引擎执行（BizAgent 调用此工具触发 SubAgent 工作）。
    message: 用户的原始任务描述。
    返回编排状态信息。"""
    import worker_pool
    available = worker_pool.get_available_slots()
    if not available:
        return "当前没有空闲工位，请等待 SubAgent 完成后重试。"
    return f"任务已提交编排引擎，{len(available)} 个空闲工位可用。编排结果将通过实时流返回。"


def _get_worker_status() -> str:
    """查看 3 个 SubAgent 工位的当前状态和 token 消耗。"""
    import worker_pool
    slots = worker_pool.get_all_status()
    lines = []
    for s in slots:
        status_label = {
            "idle": "空闲",
            "working": "工作中",
            "completed": "已完成",
            "error": "出错",
        }.get(s["status"], s["status"])
        line = f"- 工位 {s['slot_id']}: {status_label}"
        if s["current_task"]:
            line += f" | 任务: {s['current_task'][:50]}"
        if s["cumulative_total_tokens"] > 0:
            line += f" | 累计 token: {s['cumulative_total_tokens']}"
        lines.append(line)
    stats = worker_pool.get_token_stats()
    lines.append(f"\n全局累计: {stats['global']['total_tokens']} tokens, {stats['global']['tasks_completed']} 个任务")
    return "SubAgent 工位状态：\n" + "\n".join(lines)


def _get_capabilities() -> str:
    """查看系统当前所有可用能力清单（内置工具 + 已注册技能）。"""
    from orchestrator import get_full_capability_list
    return "系统可用能力：\n" + get_full_capability_list()


# ---------------------------------------------------------------------------
# 工具列表导出
# ---------------------------------------------------------------------------

_GLOBAL_TOOLS = [
    _global_list_skills,
    _global_list_projects,
    _global_list_tasks,
    _global_list_knowledge_docs,
    _global_list_workspace_files,
    _global_system_stats,
    _global_mount_skill,
    _global_unmount_skill,
    _global_create_project,
    _global_delete_project,
    _plan_task,
    _get_worker_status,
    _get_capabilities,
]


def get_global_tools() -> list:
    """返回全局工具列表，供 agents.get_agent 延迟调用以避免循环导入。"""
    return _GLOBAL_TOOLS
