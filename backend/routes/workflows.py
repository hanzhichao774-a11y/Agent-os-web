"""工作流模板 — 暂时简化，复杂编排已由 orchestrator 接管。"""

import json

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from schemas import WorkflowRunRequest
from agents import get_agent
from utils import clean_delta

router = APIRouter()

WORKFLOW_TEMPLATES = {
    "doc_pipeline": {
        "id": "doc_pipeline",
        "name": "文档处理流水线",
        "description": "上传文档 → 解析内容 → AI 分析摘要 → 生成报告",
        "steps": ["文档解析", "知识入库", "AI 分析摘要", "生成报告"],
        "icon": "FileText",
    },
    "data_pipeline": {
        "id": "data_pipeline",
        "name": "数据分析流水线",
        "description": "接收数据需求 → 数据查询 → 统计分析 → 图表生成 → 导出报告",
        "steps": ["需求理解", "数据查询", "统计分析", "生成报告"],
        "icon": "BarChart3",
    },
}


@router.get("/api/workflows")
async def api_list_workflows():
    return [
        {
            "id": wf["id"],
            "name": wf["name"],
            "description": wf["description"],
            "steps": wf["steps"],
            "icon": wf["icon"],
        }
        for wf in WORKFLOW_TEMPLATES.values()
    ]


@router.post("/api/workflows/{workflow_id}/run")
async def api_run_workflow(workflow_id: str, request: WorkflowRunRequest):
    wf = WORKFLOW_TEMPLATES.get(workflow_id)
    if not wf:
        return {"error": f"工作流 [{workflow_id}] 不存在"}

    async def generate():
        biz = get_agent("global")
        if not biz:
            yield f"data: {json.dumps({'content': 'BizAgent 未就绪', 'done': True})}\n\n"
            return

        prompt = f"请按照以下工作流步骤处理用户需求。\n工作流：{wf['name']}\n步骤：{', '.join(wf['steps'])}\n\n用户需求：{request.input}"
        try:
            async for chunk in biz.arun(prompt, stream=True):
                if chunk.content:
                    cleaned = clean_delta(chunk.content)
                    if cleaned:
                        yield f"data: {json.dumps({'content': cleaned, 'done': False})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'content': f'执行出错: {e}', 'done': False})}\n\n"

        yield f"data: {json.dumps({'content': '', 'done': True})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
