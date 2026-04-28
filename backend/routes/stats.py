from typing import Optional

from fastapi import APIRouter, Query
from fastapi.responses import FileResponse

from config import WORKSPACE_DIR, KNOWLEDGE_DOCS_DIR
from agents import AGENT_CONFIGS
from skill_manager import _skill_registry
from knowledge import _uploaded_docs
from database import list_task_files

router = APIRouter()


@router.get("/api/stats")
async def api_stats():
    return {
        "agents_count": len([k for k in AGENT_CONFIGS if k != "skill_engineer"]),
        "skills_count": len(_skill_registry),
        "docs_count": len(_uploaded_docs),
        "workspace_files": len(list(WORKSPACE_DIR.glob("*"))) if WORKSPACE_DIR.exists() else 0,
    }


@router.get("/api/workspace/files")
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


@router.get("/api/workspace/files/{filename}")
async def api_download_workspace_file(filename: str):
    filepath = WORKSPACE_DIR / filename
    if not filepath.exists() or not filepath.is_file():
        return {"error": "文件不存在"}

    ext = filepath.suffix.lower()
    inline_types = {".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".txt", ".md", ".json", ".csv"}
    disposition = "inline" if ext in inline_types else "attachment"

    media_map = {
        ".pdf": "application/pdf",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".webp": "image/webp",
        ".svg": "image/svg+xml",
        ".txt": "text/plain; charset=utf-8",
        ".md": "text/plain; charset=utf-8",
        ".json": "application/json",
        ".csv": "text/csv; charset=utf-8",
        ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".xls": "application/vnd.ms-excel",
        ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    }
    media_type = media_map.get(ext)

    return FileResponse(
        filepath,
        filename=filename,
        media_type=media_type,
        content_disposition_type=disposition,
    )


@router.get("/api/projects/{project_id}/tasks/{task_id}/files")
async def api_list_task_files(
    project_id: str,
    task_id: str,
    file_type: Optional[str] = Query(None),
):
    """List files associated with a specific task (or main chat if task_id='main')."""
    tid = None if task_id == "main" else task_id
    records = list_task_files(project_id, tid, file_type)

    result = []
    for rec in records:
        entry = {
            "file_name": rec["file_name"],
            "file_type": rec["file_type"],
            "file_source": rec["file_source"],
            "created_at": rec["created_at"],
        }
        if rec["file_source"] == "workspace":
            fpath = WORKSPACE_DIR / rec["file_name"]
            if fpath.exists():
                entry["size"] = fpath.stat().st_size
            else:
                entry["size"] = 0
        elif rec["file_source"] == "knowledge":
            fpath = KNOWLEDGE_DOCS_DIR / rec["file_name"]
            if fpath.exists():
                entry["size"] = fpath.stat().st_size
            else:
                entry["size"] = 0
        result.append(entry)
    return result
