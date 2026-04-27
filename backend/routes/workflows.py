import json

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from schemas import WorkflowRunRequest
from agents import get_agent

router = APIRouter()

WORKFLOW_TEMPLATES = {
    "doc_pipeline": {
        "id": "doc_pipeline",
        "name": "文档处理流水线",
        "description": "上传文档 → 解析内容 → AI 分析摘要 → 生成报告",
        "steps": ["文档解析", "知识入库", "AI 分析摘要", "生成报告"],
        "icon": "FileText",
        "agents": ["a2", "a1", "a3"],
    },
    "data_pipeline": {
        "id": "data_pipeline",
        "name": "数据分析流水线",
        "description": "接收数据需求 → 数据查询 → 统计分析 → 图表生成 → 导出报告",
        "steps": ["需求理解", "数据查询", "统计分析", "生成报告"],
        "icon": "BarChart3",
        "agents": ["a1", "a3"],
    },
    "ppt_pipeline": {
        "id": "ppt_pipeline",
        "name": "PPT 生成流水线",
        "description": "描述主题 → AI 生成大纲 → 逐页生成内容 → 输出 .pptx 文件",
        "steps": ["主题分析", "大纲生成", "内容填充", "生成文件"],
        "icon": "Presentation",
        "agents": ["a7"],
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

    steps = wf["steps"]

    async def generate():
        user_input = request.input
        _heading_sep = '\n\n---\n\n'

        if workflow_id == "ppt_pipeline":
            yield f"data: {json.dumps({'content': '[STEP:1]', 'done': False})}\n\n"
            _msg = '正在分析主题并生成 PPT...\n\n'
            yield f"data: {json.dumps({'content': _msg, 'done': False})}\n\n"

            ppt_agent = get_agent("a7")
            if ppt_agent:
                prompt = "请根据以下需求生成一个 PPT 文件：" + user_input + "\n请使用 python-pptx 生成 .pptx 文件并保存。"
                try:
                    for step_idx in range(1, len(steps) + 1):
                        _step = f'[STEP:{step_idx}]'
                        yield f"data: {json.dumps({'content': _step, 'done': False})}\n\n"
                    async for chunk in ppt_agent.arun(prompt, stream=True):
                        if chunk.content:
                            yield f"data: {json.dumps({'content': chunk.content, 'done': False})}\n\n"
                except Exception as e:
                    _err = f'\n\n执行出错: {e}'
                    yield f"data: {json.dumps({'content': _err, 'done': False})}\n\n"

        elif workflow_id == "data_pipeline":
            data_agent = get_agent("a1")
            code_agent = get_agent("a3")

            for step_idx, step_name in enumerate(steps, 1):
                _step = f'[STEP:{step_idx}]'
                yield f"data: {json.dumps({'content': _step, 'done': False})}\n\n"
                _heading = f'### 步骤 {step_idx}: {step_name}\n\n'
                yield f"data: {json.dumps({'content': _heading, 'done': False})}\n\n"

                if step_idx <= 3 and data_agent:
                    prompt = f"[{step_name}] 用户需求：{user_input}"
                    try:
                        async for chunk in data_agent.arun(prompt, stream=True):
                            if chunk.content:
                                yield f"data: {json.dumps({'content': chunk.content, 'done': False})}\n\n"
                    except Exception as e:
                        _err = f'出错: {e}'
                        yield f"data: {json.dumps({'content': _err, 'done': False})}\n\n"
                elif step_idx == 4 and code_agent:
                    try:
                        async for chunk in code_agent.arun(
                            f"请根据数据分析结果生成一份总结报告：{user_input}", stream=True
                        ):
                            if chunk.content:
                                yield f"data: {json.dumps({'content': chunk.content, 'done': False})}\n\n"
                    except Exception as e:
                        _err = f'出错: {e}'
                        yield f"data: {json.dumps({'content': _err, 'done': False})}\n\n"

                yield f"data: {json.dumps({'content': _heading_sep, 'done': False})}\n\n"

        elif workflow_id == "doc_pipeline":
            knowledge_agent = get_agent("a2")
            data_agent = get_agent("a1")

            for step_idx, step_name in enumerate(steps, 1):
                _step = f'[STEP:{step_idx}]'
                yield f"data: {json.dumps({'content': _step, 'done': False})}\n\n"
                _heading = f'### 步骤 {step_idx}: {step_name}\n\n'
                yield f"data: {json.dumps({'content': _heading, 'done': False})}\n\n"

                agent_to_use = knowledge_agent if step_idx <= 2 else data_agent
                if agent_to_use:
                    prompt = f"[{step_name}] 用户需求：{user_input}"
                    try:
                        async for chunk in agent_to_use.arun(prompt, stream=True):
                            if chunk.content:
                                yield f"data: {json.dumps({'content': chunk.content, 'done': False})}\n\n"
                    except Exception as e:
                        _err = f'出错: {e}'
                        yield f"data: {json.dumps({'content': _err, 'done': False})}\n\n"

                yield f"data: {json.dumps({'content': _heading_sep, 'done': False})}\n\n"

        yield f"data: {json.dumps({'content': '', 'done': True})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
