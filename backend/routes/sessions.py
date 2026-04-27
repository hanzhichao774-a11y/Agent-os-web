import json
import sqlite3

from fastapi import APIRouter

from config import SESSIONS_DB
from database import _load_chat_messages
from utils import clean_content
from agents import AGENT_CONFIGS, resolve_agent_display

router = APIRouter()


def _parse_runs_from_db(raw_runs: str) -> list[dict]:
    """解析 agno_sessions.runs 字段（可能双层 JSON 序列化）。"""
    if not raw_runs:
        return []
    parsed = json.loads(raw_runs)
    if isinstance(parsed, str):
        parsed = json.loads(parsed)
    if not isinstance(parsed, list):
        return []
    result = []
    for item in parsed:
        if isinstance(item, str):
            try:
                item = json.loads(item)
            except (json.JSONDecodeError, TypeError):
                continue
        if isinstance(item, dict):
            result.append(item)
    return result


@router.get("/api/sessions")
async def api_list_sessions(agent_id: str | None = None, team_id: str | None = None, limit: int = 50):
    conn = sqlite3.connect(SESSIONS_DB)
    conn.row_factory = sqlite3.Row

    conditions = []
    params: list = []
    if agent_id:
        conditions.append("agent_id = ?")
        params.append(agent_id)
    if team_id:
        conditions.append("team_id = ?")
        params.append(team_id)

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    rows = conn.execute(
        f"SELECT session_id, session_type, agent_id, team_id, created_at, updated_at FROM agno_sessions {where} ORDER BY updated_at DESC LIMIT ?",
        params + [limit],
    ).fetchall()

    results = []
    for r in rows:
        results.append({
            "session_id": r["session_id"],
            "session_type": r["session_type"],
            "agent_id": r["agent_id"],
            "team_id": r["team_id"],
            "created_at": r["created_at"],
            "updated_at": r["updated_at"],
        })
    conn.close()
    return results


@router.get("/api/sessions/{session_id}/messages")
async def api_get_session_messages(session_id: str):
    own_msgs = _load_chat_messages(session_id)
    if own_msgs:
        return own_msgs

    conn = sqlite3.connect(SESSIONS_DB)
    conn.row_factory = sqlite3.Row
    row = conn.execute(
        "SELECT session_type, runs FROM agno_sessions WHERE session_id = ?",
        (session_id,),
    ).fetchone()
    conn.close()

    if not row:
        return []

    runs = _parse_runs_from_db(row["runs"])
    session_type = row["session_type"]
    messages = []

    for run in runs:
        run_input = run.get("input", {})
        user_text = ""
        if isinstance(run_input, dict):
            user_text = run_input.get("input_content", "") or run_input.get("message", "")
        elif isinstance(run_input, str):
            user_text = run_input

        if user_text:
            messages.append({
                "id": f"hist_user_{run.get('run_id', '')}",
                "role": "user",
                "content": user_text,
                "timestamp": run.get("created_at", 0),
            })

        assistant_content = run.get("content", "")
        agent_name = run.get("agent_name", "")

        if session_type == "team":
            member_responses = run.get("member_responses", [])
            if member_responses:
                for mr in member_responses:
                    mr_content = ""
                    if isinstance(mr, dict):
                        mr_content = mr.get("content", "")
                    elif isinstance(mr, str):
                        mr_content = mr
                    mr_content = clean_content(mr_content) if mr_content else ""
                    mr_name = mr.get("agent_name", "") if isinstance(mr, dict) else ""
                    mr_id = mr.get("agent_id", "") if isinstance(mr, dict) else ""
                    avatar, display_name = resolve_agent_display(mr_id)
                    if mr_content:
                        messages.append({
                            "id": f"hist_member_{run.get('run_id', '')}_{mr_id}",
                            "role": "assistant",
                            "content": mr_content,
                            "agent_name": f"{avatar} {display_name}" if mr_id else mr_name,
                            "timestamp": run.get("created_at", 0),
                        })
            elif assistant_content:
                assistant_content = clean_content(assistant_content)
                messages.append({
                    "id": f"hist_asst_{run.get('run_id', '')}",
                    "role": "assistant",
                    "content": assistant_content,
                    "agent_name": agent_name,
                    "timestamp": run.get("created_at", 0),
                })
        else:
            if assistant_content:
                assistant_content = clean_content(assistant_content)
                messages.append({
                    "id": f"hist_asst_{run.get('run_id', '')}",
                    "role": "assistant",
                    "content": assistant_content,
                    "agent_name": agent_name,
                    "timestamp": run.get("created_at", 0),
                })

    return messages
