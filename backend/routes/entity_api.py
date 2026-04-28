"""实体 CRUD 和图数据 API。"""

from __future__ import annotations

from fastapi import APIRouter, Query
from pydantic import BaseModel

from entity_extractor import (
    get_entity_graph,
    list_entities,
    exclude_entity,
    delete_entity,
    extract_entities,
    get_top_entities,
    get_entity_neighbors,
)

router = APIRouter()


class ExtractRequest(BaseModel):
    text: str
    source_name: str = "manual"
    task_id: str | None = None


@router.get("/api/entities/{project_id}")
async def api_list_entities(
    project_id: str,
    task_id: str | None = Query(None),
):
    return {"entities": list_entities(project_id, task_id)}


@router.get("/api/entities/{project_id}/graph")
async def api_entity_graph(
    project_id: str,
    task_id: str | None = Query(None),
):
    return get_entity_graph(project_id, task_id)


@router.get("/api/entities/{project_id}/top")
async def api_top_entities(
    project_id: str,
    task_id: str | None = Query(None),
    limit: int = Query(10),
):
    return get_top_entities(project_id, task_id, limit)


@router.get("/api/entities/{project_id}/expand/{entity_id}")
async def api_expand_entity(project_id: str, entity_id: str):
    return get_entity_neighbors(project_id, entity_id)


@router.delete("/api/entities/item/{entity_id}")
async def api_delete_entity(entity_id: str):
    ok = delete_entity(entity_id)
    return {"success": ok}


@router.put("/api/entities/item/{entity_id}/exclude")
async def api_exclude_entity(entity_id: str, exclude: bool = Query(True)):
    ok = exclude_entity(entity_id, exclude)
    return {"success": ok}


@router.post("/api/entities/{project_id}/extract")
async def api_extract_entities(project_id: str, body: ExtractRequest):
    result = await extract_entities(
        text=body.text,
        project_id=project_id,
        task_id=body.task_id,
        source_name=body.source_name,
    )
    return result
