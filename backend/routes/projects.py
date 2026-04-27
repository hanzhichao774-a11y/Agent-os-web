import uuid
from datetime import datetime, timezone

from fastapi import APIRouter

from schemas import ProjectCreateRequest, TaskCreateRequest
from database import _get_projects_conn

router = APIRouter()


@router.get("/api/projects")
async def api_list_projects():
    conn = _get_projects_conn()
    rows = conn.execute("SELECT * FROM projects ORDER BY updated_at DESC").fetchall()
    conn.close()
    return [dict(r) for r in rows]


@router.post("/api/projects")
async def api_create_project(request: ProjectCreateRequest):
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


@router.delete("/api/projects/{project_id}")
async def api_delete_project(project_id: str):
    conn = _get_projects_conn()
    conn.execute("DELETE FROM tasks WHERE project_id = ?", (project_id,))
    conn.execute("DELETE FROM projects WHERE id = ?", (project_id,))
    conn.commit()
    conn.close()
    return {"success": True}


@router.get("/api/projects/{project_id}/tasks")
async def api_list_tasks(project_id: str):
    conn = _get_projects_conn()
    rows = conn.execute(
        "SELECT * FROM tasks WHERE project_id = ? ORDER BY sort_order, created_at",
        (project_id,),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@router.post("/api/projects/{project_id}/tasks")
async def api_create_task(project_id: str, request: TaskCreateRequest):
    task_id = f"t{uuid.uuid4().hex[:8]}"
    now_str = datetime.now(timezone.utc).isoformat()
    conn = _get_projects_conn()
    max_order = conn.execute(
        "SELECT COALESCE(MAX(sort_order), 0) FROM tasks WHERE project_id = ?",
        (project_id,),
    ).fetchone()[0]
    conn.execute(
        "INSERT INTO tasks (id, project_id, name, sort_order, created_at) VALUES (?,?,?,?,?)",
        (task_id, project_id, request.name, max_order + 1, now_str),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    conn.close()
    return dict(row)


@router.delete("/api/tasks/{task_id}")
async def api_delete_task(task_id: str):
    conn = _get_projects_conn()
    conn.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
    conn.commit()
    conn.close()
    return {"success": True}
