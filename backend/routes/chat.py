import json
import asyncio
import re

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from agno.run.team import TeamRunEvent, TeamRunOutput
from agno.run.agent import RunEvent, RunOutput

from schemas import ChatRequest
from database import _save_chat_message
from utils import clean_content, clean_delta
from agents import AGENT_CONFIGS, get_agent, resolve_agent_display
from teams import get_team
from llm import _get_llm_config
from skill_manager import _skill_registry
from knowledge import list_documents
from context import current_project_id, current_task_id

router = APIRouter()


@router.get("/health")
async def health():
    cfg = _get_llm_config()
    return {
        "status": "ok",
        "model_provider": cfg["provider"],
        "model_id": cfg["model_id"],
        "skills_count": len(_skill_registry),
        "docs_count": len(list_documents()),
    }


@router.post("/api/agents/{agent_id}/chat")
async def agent_chat(agent_id: str, request: ChatRequest):
    agent = get_agent(agent_id)

    async def generate():
        if not agent:
            yield f"data: {json.dumps({'content': f'Agent [{agent_id}] 未找到。', 'done': True})}\n\n"
            return

        chat_session_id = request.session_id
        _save_chat_message(chat_session_id, "user", request.message)
        collected_chunks: list[str] = []

        try:
            async with asyncio.timeout(180):
                async for chunk in agent.arun(
                    request.message,
                    stream=True,
                    session_id=request.session_id,
                ):
                    if chunk.content:
                        cleaned = clean_delta(chunk.content)
                        if cleaned:
                            collected_chunks.append(cleaned)
                            yield f"data: {json.dumps({'content': cleaned, 'done': False}, ensure_ascii=False)}\n\n"

            full_reply = clean_content("".join(collected_chunks))
            if full_reply:
                agent_name = AGENT_CONFIGS.get(agent_id, {}).get("name", agent_id)
                _save_chat_message(chat_session_id, "assistant", full_reply, agent_name)

            yield f"data: {json.dumps({'content': '', 'done': True})}\n\n"
        except TimeoutError:
            print(f"[ERROR] Agent chat {agent_id}: timeout after 180s")
            yield f"data: {json.dumps({'content': 'Agent 响应超时（3分钟），请简化问题后重试。', 'done': True})}\n\n"
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


@router.post("/api/teams/{project_id}/chat")
async def team_chat(project_id: str, request: ChatRequest):
    team = get_team(project_id)
    streamed_members: set[str] = set()
    chat_session_id = f"team_{project_id}_{request.session_id}"
    collected_member_content: dict[str, list[str]] = {}
    collected_member_names: dict[str, str] = {}

    _task_match = re.search(r"_task_(.+)$", request.session_id)
    _parsed_task_id = _task_match.group(1) if _task_match else None
    if _parsed_task_id == "main":
        _parsed_task_id = None
    current_project_id.set(project_id)
    current_task_id.set(_parsed_task_id)

    def _sse(payload: dict) -> str:
        return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"

    async def generate():
        routed_agent_name: str | None = None

        _save_chat_message(chat_session_id, "user", request.message)

        try:
            async with asyncio.timeout(300):
                async for event in team.arun(
                    request.message,
                    stream=True,
                    stream_events=True,
                    session_id=f"team_{project_id}_{request.session_id}",
                    yield_run_output=True,
                ):
                    if isinstance(event, TeamRunOutput):
                        for mr in event.member_responses:
                            mid = None
                            if isinstance(mr, RunOutput):
                                mid = mr.agent_id
                            if mid and mid in streamed_members:
                                continue
                            avatar, display_name = resolve_agent_display(mid)
                            content = ""
                            if hasattr(mr, "content") and mr.content:
                                content = mr.content if isinstance(mr.content, str) else str(mr.content)
                            content = clean_content(content)
                            if content:
                                key = mid or "_team_output"
                                if key not in collected_member_content:
                                    collected_member_content[key] = [content]
                                    collected_member_names[key] = f"{avatar} {display_name}"
                                yield _sse({
                                    "type": "member_response",
                                    "agent_name": f"{avatar} {display_name}",
                                    "content": content,
                                    "done": False,
                                })
                        continue

                    ev_type = getattr(event, "event", "")

                    if ev_type == TeamRunEvent.tool_call_started.value:
                        tool = getattr(event, "tool", None)
                        if tool and tool.tool_name and ("delegate_task" in tool.tool_name or "route_to" in tool.tool_name):
                            args = tool.tool_args or {}
                            mid = args.get("member_id", "")
                            task_raw = args.get("task", args.get("input", ""))
                            avatar, display_name = resolve_agent_display(mid)
                            routed_agent_name = f"{avatar} {display_name}"
                            streamed_members.add(mid)
                            task_clean = (task_raw or "").replace("\\n", " ").strip()
                            if len(task_clean) > 80:
                                task_clean = task_clean[:80] + "..."
                            yield _sse({
                                "type": "member_delegated",
                                "agent_name": routed_agent_name,
                                "task": task_clean or request.message,
                                "done": False,
                            })

                    elif ev_type == TeamRunEvent.tool_call_completed.value:
                        pass

                    elif ev_type in (RunEvent.tool_call_started.value,):
                        tool = getattr(event, "tool", None)
                        agent_id = getattr(event, "agent_id", "")
                        tool_name = tool.tool_name if tool else "unknown"
                        print(f"[DEBUG] Member {agent_id} tool_call_started: {tool_name}")
                        if agent_id and tool:
                            avatar, display_name = resolve_agent_display(agent_id)
                            yield _sse({
                                "type": "member_tool_call",
                                "agent_name": f"{avatar} {display_name}",
                                "tool_name": tool_name,
                                "done": False,
                            })

                    elif ev_type in (RunEvent.tool_call_completed.value,):
                        tool = getattr(event, "tool", None)
                        agent_id = getattr(event, "agent_id", "")
                        result = getattr(event, "content", None) or (tool.result if tool else None)
                        result_preview = str(result)[:200] if result else "(empty)"
                        print(f"[DEBUG] Member {agent_id} tool_call_completed: {result_preview}")

                    elif ev_type == TeamRunEvent.run_content.value:
                        content = getattr(event, "content", None)
                        if content:
                            text = content if isinstance(content, str) else str(content)
                            text = clean_delta(text)
                            if text:
                                if routed_agent_name:
                                    collected_member_content.setdefault("_leader_routed", []).append(text)
                                    collected_member_names["_leader_routed"] = routed_agent_name
                                    yield _sse({
                                        "type": "member_streaming",
                                        "agent_name": routed_agent_name,
                                        "content": text,
                                        "done": False,
                                    })
                                else:
                                    collected_member_content.setdefault("_leader", []).append(text)
                                    yield _sse({
                                        "type": "leader_content",
                                        "content": text,
                                        "done": False,
                                    })

                    elif ev_type == RunEvent.run_content.value:
                        agent_id = getattr(event, "agent_id", "")
                        content = getattr(event, "content", None)
                        if content and agent_id:
                            streamed_members.add(agent_id)
                            avatar, display_name = resolve_agent_display(agent_id)
                            text = content if isinstance(content, str) else str(content)
                            text = clean_delta(text)
                            if text:
                                collected_member_content.setdefault(agent_id, []).append(text)
                                collected_member_names[agent_id] = f"{avatar} {display_name}"
                                yield _sse({
                                    "type": "member_streaming",
                                    "agent_name": f"{avatar} {display_name}",
                                    "content": text,
                                    "done": False,
                                })

                    elif ev_type == RunEvent.run_started.value:
                        agent_id = getattr(event, "agent_id", "")
                        if agent_id:
                            avatar, display_name = resolve_agent_display(agent_id)
                            yield _sse({
                                "type": "member_started",
                                "agent_name": f"{avatar} {display_name}",
                                "done": False,
                            })

                    else:
                        print(f"[DEBUG] Unhandled event: type={ev_type}, keys={[k for k in dir(event) if not k.startswith('_')]}")

            for key, chunks in collected_member_content.items():
                full_text = clean_content("".join(chunks))
                if full_text:
                    _save_chat_message(chat_session_id, "assistant", full_text, collected_member_names.get(key, ""))

            yield _sse({"type": "done", "content": "", "done": True})
        except TimeoutError:
            print("[ERROR] Team chat: timeout after 300s")
            yield _sse({"type": "leader_content", "content": "Team 协作超时（5分钟），请简化问题后重试。", "done": True})
        except Exception as e:
            err = str(e)
            print(f"[ERROR] Team chat: {err}")
            yield _sse({"type": "leader_content", "content": f"Team 协作出错：{err}", "done": True})

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
