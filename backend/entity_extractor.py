"""LLM 驱动的实体抽取：从文本中提取实体和关系，存入 SQLite。"""

from __future__ import annotations

import json
import uuid
import time

from database import _get_projects_conn
from llm import create_model

_MAX_TEXT_LEN = 8000

_EXTRACT_SYSTEM_PROMPT = """你是一个知识图谱实体抽取引擎。从给定文本中抽取实体和关系。

## 实体类型
- person: 人物
- org: 组织/机构/部门/公司
- location: 地点/地区/站点
- concept: 概念/术语/方案
- metric: 指标/数据/数值
- event: 事件/活动

## 排除列表（不要抽取以下实体）
{excluded}

## 输出格式
必须返回严格的 JSON（不要包含 markdown 标记），格式：
{{
  "entities": [
    {{"name": "实体名", "type": "类型", "description": "一句话描述"}}
  ],
  "relations": [
    {{"source": "源实体名", "target": "目标实体名", "relation": "关系描述"}}
  ]
}}

## 规则
- 只抽取文本中明确提及的实体，不要推测
- 实体名称尽量简短精确
- 关系描述用 2-5 个字的动词短语
- 合并同义实体（如"北京热力"和"北京热力集团"统一为最完整的名称）
- 指标类实体包含数值时，将数值放在 description 中
- 最多抽取 30 个实体和 40 条关系
"""


def extract_entities_sync(
    text: str,
    project_id: str,
    task_id: str | None = None,
    source_name: str = "",
) -> dict:
    """同步版本：从文本中抽取实体和关系，写入数据库，返回抽取结果摘要。"""
    from agno.agent import Agent

    truncated = text[:_MAX_TEXT_LEN] if len(text) > _MAX_TEXT_LEN else text

    excluded_names = _get_excluded_names(project_id)
    excluded_str = ", ".join(excluded_names) if excluded_names else "（无）"

    system_prompt = _EXTRACT_SYSTEM_PROMPT.format(excluded=excluded_str)

    extractor = Agent(
        name="EntityExtractor",
        model=create_model(),
        instructions=[system_prompt],
        markdown=False,
    )

    response = extractor.run(truncated, stream=False)
    raw = response.content or ""

    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[-1]
    if raw.endswith("```"):
        raw = raw.rsplit("```", 1)[0]
    raw = raw.strip()

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"[ENTITY] JSON 解析失败: {e}, raw={raw[:200]}")
        return {"entities_count": 0, "relations_count": 0, "error": str(e)}

    entities_raw = data.get("entities", [])
    relations_raw = data.get("relations", [])

    entity_ids = _upsert_entities(project_id, task_id, source_name, entities_raw)
    relations_count = _insert_relations(project_id, task_id, source_name, relations_raw, entity_ids)

    return {
        "entities_count": len(entity_ids),
        "relations_count": relations_count,
        "source": source_name,
    }


async def extract_entities(
    text: str,
    project_id: str,
    task_id: str | None = None,
    source_name: str = "",
) -> dict:
    """异步版本：在后台线程中运行同步抽取（供 knowledge_api 的 asyncio.create_task 使用）。"""
    import asyncio
    return await asyncio.to_thread(
        extract_entities_sync, text, project_id, task_id, source_name
    )


def _get_excluded_names(project_id: str) -> list[str]:
    conn = _get_projects_conn()
    rows = conn.execute(
        "SELECT name FROM entities WHERE project_id = ? AND excluded = 1",
        (project_id,),
    ).fetchall()
    conn.close()
    return [r["name"] for r in rows]


def _upsert_entities(
    project_id: str,
    task_id: str | None,
    source_name: str,
    entities_raw: list[dict],
) -> dict[str, str]:
    """Upsert entities, returns name -> id mapping."""
    conn = _get_projects_conn()
    name_to_id: dict[str, str] = {}

    existing = conn.execute(
        "SELECT id, name, task_id FROM entities WHERE project_id = ?",
        (project_id,),
    ).fetchall()
    existing_task: dict[str, str | None] = {}
    for r in existing:
        name_to_id[r["name"]] = r["id"]
        existing_task[r["name"]] = r["task_id"]

    for ent in entities_raw:
        name = ent.get("name", "").strip()
        if not name:
            continue
        ent_type = ent.get("type", "concept")
        desc = ent.get("description", "")

        if name in name_to_id:
            if task_id and not existing_task.get(name):
                conn.execute(
                    "UPDATE entities SET description = ?, type = ?, task_id = ? WHERE id = ?",
                    (desc, ent_type, task_id, name_to_id[name]),
                )
            else:
                conn.execute(
                    "UPDATE entities SET description = ?, type = ? WHERE id = ?",
                    (desc, ent_type, name_to_id[name]),
                )
        else:
            eid = f"ent_{uuid.uuid4().hex[:10]}"
            conn.execute(
                "INSERT INTO entities (id, project_id, task_id, name, type, description, source, created_at) VALUES (?,?,?,?,?,?,?,?)",
                (eid, project_id, task_id, name, ent_type, desc, source_name, time.time()),
            )
            name_to_id[name] = eid

    conn.commit()
    conn.close()
    return name_to_id


def _insert_relations(
    project_id: str,
    task_id: str | None,
    source_name: str,
    relations_raw: list[dict],
    entity_ids: dict[str, str],
) -> int:
    """Insert relations, skipping those with missing entities. Returns count."""
    conn = _get_projects_conn()
    count = 0

    for rel in relations_raw:
        src_name = rel.get("source", "").strip()
        tgt_name = rel.get("target", "").strip()
        relation = rel.get("relation", "").strip()
        if not src_name or not tgt_name or not relation:
            continue

        src_id = entity_ids.get(src_name)
        tgt_id = entity_ids.get(tgt_name)
        if not src_id or not tgt_id:
            continue

        existing = conn.execute(
            "SELECT id FROM entity_relations WHERE source_entity_id = ? AND target_entity_id = ? AND relation = ?",
            (src_id, tgt_id, relation),
        ).fetchone()
        if existing:
            continue

        rid = f"rel_{uuid.uuid4().hex[:10]}"
        conn.execute(
            "INSERT INTO entity_relations (id, project_id, task_id, source_entity_id, target_entity_id, relation, source, created_at) VALUES (?,?,?,?,?,?,?,?)",
            (rid, project_id, task_id, src_id, tgt_id, relation, source_name, time.time()),
        )
        count += 1

    conn.commit()
    conn.close()
    return count


def get_entity_graph(project_id: str, task_id: str | None = None) -> dict:
    """获取项目/任务的实体图数据（排除 excluded 的）。"""
    conn = _get_projects_conn()

    if task_id:
        entities = conn.execute(
            "SELECT id, name, type, description, source, excluded FROM entities WHERE project_id = ? AND task_id = ? AND excluded = 0",
            (project_id, task_id),
        ).fetchall()
    else:
        entities = conn.execute(
            "SELECT id, name, type, description, source, excluded FROM entities WHERE project_id = ? AND excluded = 0",
            (project_id,),
        ).fetchall()

    entity_ids_set = {e["id"] for e in entities}

    if task_id:
        relations = conn.execute(
            "SELECT id, source_entity_id, target_entity_id, relation FROM entity_relations WHERE project_id = ? AND task_id = ?",
            (project_id, task_id),
        ).fetchall()
    else:
        relations = conn.execute(
            "SELECT id, source_entity_id, target_entity_id, relation FROM entity_relations WHERE project_id = ?",
            (project_id,),
        ).fetchall()

    conn.close()

    filtered_relations = [
        r for r in relations
        if r["source_entity_id"] in entity_ids_set and r["target_entity_id"] in entity_ids_set
    ]

    return {
        "entities": [
            {"id": e["id"], "name": e["name"], "type": e["type"], "description": e["description"], "source": e["source"], "excluded": bool(e["excluded"])}
            for e in entities
        ],
        "relations": [
            {"id": r["id"], "source_entity_id": r["source_entity_id"], "target_entity_id": r["target_entity_id"], "relation": r["relation"]}
            for r in filtered_relations
        ],
    }


def list_entities(project_id: str, task_id: str | None = None) -> list[dict]:
    """列出所有实体（含 excluded）。"""
    conn = _get_projects_conn()
    if task_id:
        rows = conn.execute(
            "SELECT id, name, type, description, source, excluded, created_at FROM entities WHERE project_id = ? AND task_id = ? ORDER BY created_at",
            (project_id, task_id),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT id, name, type, description, source, excluded, created_at FROM entities WHERE project_id = ? ORDER BY created_at",
            (project_id,),
        ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def exclude_entity(entity_id: str, exclude: bool = True) -> bool:
    conn = _get_projects_conn()
    conn.execute("UPDATE entities SET excluded = ? WHERE id = ?", (1 if exclude else 0, entity_id))
    conn.commit()
    changed = conn.total_changes > 0
    conn.close()
    return changed


def delete_entity(entity_id: str) -> bool:
    conn = _get_projects_conn()
    conn.execute("DELETE FROM entity_relations WHERE source_entity_id = ? OR target_entity_id = ?", (entity_id, entity_id))
    conn.execute("DELETE FROM entities WHERE id = ?", (entity_id,))
    conn.commit()
    changed = conn.total_changes > 0
    conn.close()
    return changed


def exclude_entity_by_name(project_id: str, name: str) -> str:
    """通过名称排除实体（供 Agent tool 调用）。"""
    conn = _get_projects_conn()
    row = conn.execute("SELECT id FROM entities WHERE project_id = ? AND name = ?", (project_id, name)).fetchone()
    if not row:
        conn.close()
        return f"未找到名为「{name}」的实体"
    conn.execute("UPDATE entities SET excluded = 1 WHERE id = ?", (row["id"],))
    conn.commit()
    conn.close()
    return f"已将「{name}」标记为排除，图谱将不再显示该实体"


def _entity_row_to_dict(e) -> dict:
    return {"id": e["id"], "name": e["name"], "type": e["type"],
            "description": e["description"], "source": e["source"],
            "excluded": bool(e["excluded"])}


def _relation_row_to_dict(r) -> dict:
    return {"id": r["id"], "source_entity_id": r["source_entity_id"],
            "target_entity_id": r["target_entity_id"], "relation": r["relation"]}


def get_top_entities(project_id: str, task_id: str | None = None, limit: int = 10) -> dict:
    """获取关联度最高的 Top N 核心实体及它们之间的关系。
    当 task_id 指定但结果不足 limit 时，回退到 project 级查询。"""
    conn = _get_projects_conn()

    def _query(tid: str | None):
        where = "project_id = ? AND excluded = 0"
        params: list = [project_id]
        if tid:
            where += " AND task_id = ?"
            params.append(tid)

        ents = conn.execute(
            f"SELECT id, name, type, description, source, excluded FROM entities WHERE {where}",
            params,
        ).fetchall()

        rw = "project_id = ?"
        rp: list = [project_id]
        if tid:
            rw += " AND task_id = ?"
            rp.append(tid)

        rels = conn.execute(
            f"SELECT id, source_entity_id, target_entity_id, relation FROM entity_relations WHERE {rw}",
            rp,
        ).fetchall()
        return ents, rels

    entities, relations = _query(task_id)

    if task_id and len(entities) < limit:
        entities, relations = _query(None)

    conn.close()

    entity_ids_set = {e["id"] for e in entities}

    degree: dict[str, int] = {}
    for r in relations:
        if r["source_entity_id"] in entity_ids_set:
            degree[r["source_entity_id"]] = degree.get(r["source_entity_id"], 0) + 1
        if r["target_entity_id"] in entity_ids_set:
            degree[r["target_entity_id"]] = degree.get(r["target_entity_id"], 0) + 1

    sorted_entities = sorted(entities, key=lambda e: degree.get(e["id"], 0), reverse=True)
    top = sorted_entities[:limit]
    top_ids = {e["id"] for e in top}

    top_relations = [
        r for r in relations
        if r["source_entity_id"] in top_ids and r["target_entity_id"] in top_ids
    ]

    total_count = len(entities)

    return {
        "entities": [_entity_row_to_dict(e) for e in top],
        "relations": [_relation_row_to_dict(r) for r in top_relations],
        "total_entities": total_count,
        "total_relations": len(relations),
    }


def get_entity_neighbors(project_id: str, entity_id: str) -> dict:
    """获取某实体的一度关联：直接相连的实体和关系。"""
    conn = _get_projects_conn()

    relations = conn.execute(
        "SELECT id, source_entity_id, target_entity_id, relation FROM entity_relations "
        "WHERE project_id = ? AND (source_entity_id = ? OR target_entity_id = ?)",
        (project_id, entity_id, entity_id),
    ).fetchall()

    neighbor_ids: set[str] = set()
    for r in relations:
        neighbor_ids.add(r["source_entity_id"])
        neighbor_ids.add(r["target_entity_id"])
    neighbor_ids.discard(entity_id)

    if not neighbor_ids:
        conn.close()
        return {"entities": [], "relations": []}

    placeholders = ",".join("?" for _ in neighbor_ids)
    neighbors = conn.execute(
        f"SELECT id, name, type, description, source, excluded FROM entities "
        f"WHERE id IN ({placeholders}) AND excluded = 0",
        list(neighbor_ids),
    ).fetchall()
    conn.close()

    valid_ids = {e["id"] for e in neighbors} | {entity_id}
    valid_relations = [
        r for r in relations
        if r["source_entity_id"] in valid_ids and r["target_entity_id"] in valid_ids
    ]

    return {
        "entities": [_entity_row_to_dict(e) for e in neighbors],
        "relations": [_relation_row_to_dict(r) for r in valid_relations],
    }
