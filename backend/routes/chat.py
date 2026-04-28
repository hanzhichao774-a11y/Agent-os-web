import json
import asyncio
import re

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from agno.run.agent import RunEvent

from schemas import ChatRequest
from database import _save_chat_message
from utils import clean_content, clean_delta
from agents import AGENT_CONFIGS, get_agent
from llm import _get_llm_config
from skill_manager import _skill_registry
from knowledge import list_documents
from context import current_project_id, current_task_id

router = APIRouter()

# 需要 SubAgent 重计算的关键词（文件生成、数据分析、代码执行等）
_ORCHESTRATE_KEYWORDS = [
    "生成", "制作", "创建文件", "导出", "做一个", "画一个",
    "图表", "柱状图", "折线图", "饼图", "散点图",
    "PDF", "pdf", "报告", "Excel", "excel", "xlsx",
    "分析数据", "统计分析", "数据清洗",
    "执行代码", "运行代码", "写代码",
    "处理图片", "图片处理", "缩放", "裁剪", "水印",
    "调用API", "HTTP请求", "http",
]


def _needs_orchestration(message: str) -> bool:
    """判断消息是否需要 SubAgent 编排（文件生成、数据分析等重计算任务）。
    简单问答、系统查询、闲聊等直接由 BizAgent 处理。"""
    return any(kw in message for kw in _ORCHESTRATE_KEYWORDS)


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
                msg = "未检测到有效的 API Key，请在 backend/.env 中配置。"
            else:
                msg = f"请求出错：{err}"
            yield f"data: {json.dumps({'content': msg, 'done': True})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ---------------------------------------------------------------------------
# 编排聊天 — 替代原 team_chat
# ---------------------------------------------------------------------------

@router.post("/api/orchestrator/{project_id}/chat")
async def orchestrator_chat(project_id: str, request: ChatRequest):
    """BizAgent 编排入口：简单查询直接回答，复杂任务走 SubAgent 编排。"""
    from orchestrator import plan_task, execute_plan

    _task_match = re.search(r"_task_(.+)$", request.session_id)
    _parsed_task_id = _task_match.group(1) if _task_match else None
    if _parsed_task_id == "main":
        _parsed_task_id = None
    current_project_id.set(project_id)
    current_task_id.set(_parsed_task_id)

    chat_session_id = f"orch_{project_id}_{request.session_id}"

    def _sse(payload: dict) -> str:
        return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"

    async def _stream_biz_direct(message: str):
        """BizAgent 直接回答（不经过编排）。"""
        biz_agent = get_agent("global")
        if not biz_agent:
            yield _sse({"type": "content", "content": "BizAgent 未就绪", "done": True})
            return

        collected: list[str] = []
        async with asyncio.timeout(180):
            async for chunk in biz_agent.arun(
                message,
                stream=True,
                session_id=f"biz_{project_id}_{request.session_id}",
            ):
                if chunk.content:
                    cleaned = clean_delta(chunk.content)
                    if cleaned:
                        collected.append(cleaned)
                        yield _sse({"type": "content", "content": cleaned, "done": False})

        full_reply = clean_content("".join(collected))
        if full_reply:
            _save_chat_message(chat_session_id, "assistant", full_reply, "BizAgent")
        yield _sse({"type": "done", "content": "", "done": True})

    async def generate():
        _save_chat_message(chat_session_id, "user", request.message)

        try:
            if not _needs_orchestration(request.message):
                async for chunk in _stream_biz_direct(request.message):
                    yield chunk
                return

            plan = await plan_task(
                user_message=request.message,
                project_id=project_id,
                task_id=_parsed_task_id,
            )

            if plan.status == "failed" or not plan.subtasks:
                async for chunk in _stream_biz_direct(request.message):
                    yield chunk
                return

            event_queue: asyncio.Queue = asyncio.Queue()
            exec_task = asyncio.create_task(execute_plan(plan, event_queue))

            while True:
                try:
                    event = await asyncio.wait_for(event_queue.get(), timeout=300)
                except asyncio.TimeoutError:
                    yield _sse({"type": "error", "content": "编排执行超时", "done": True})
                    break

                yield _sse({**event, "done": False})

                if event.get("type") == "plan_completed":
                    break

            await exec_task

            if plan.summary:
                biz_agent = get_agent("global")
                if biz_agent:
                    summary_prompt = (
                        f"以下是各 SubAgent 的执行结果，请综合整理成一个简洁的最终回答给用户。\n\n"
                        f"用户原始问题：{request.message}\n\n"
                        f"SubAgent 结果：\n{plan.summary}"
                    )
                    summary_chunks: list[str] = []
                    async with asyncio.timeout(120):
                        async for chunk in biz_agent.arun(
                            summary_prompt,
                            stream=True,
                            session_id=f"biz_{project_id}_{request.session_id}",
                        ):
                            if chunk.content:
                                cleaned = clean_delta(chunk.content)
                                if cleaned:
                                    summary_chunks.append(cleaned)
                                    yield _sse({"type": "summary", "content": cleaned, "done": False})

                    full_summary = clean_content("".join(summary_chunks))
                    if full_summary:
                        _save_chat_message(chat_session_id, "assistant", full_summary, "BizAgent")

            yield _sse({"type": "done", "content": "", "done": True})

        except TimeoutError:
            print("[ERROR] Orchestrator chat: timeout")
            yield _sse({"type": "error", "content": "编排超时，请简化任务后重试。", "done": True})
        except Exception as e:
            print(f"[ERROR] Orchestrator chat: {e}")
            yield _sse({"type": "error", "content": f"编排出错：{str(e)}", "done": True})

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
