"""编排引擎：LLM 任务规划 + 能力清单 + 串行/并行执行。"""

from __future__ import annotations

import asyncio
import json
import time
import uuid
from dataclasses import dataclass, field, asdict

import worker_pool
from llm import create_model
from skill_manager import _skill_registry


# ---------------------------------------------------------------------------
# 能力注册表 — builtin_tools 名称 -> 能力描述
# ---------------------------------------------------------------------------

CAPABILITY_REGISTRY: dict[str, dict] = {
    "knowledge_search": {
        "label": "知识库检索",
        "description": "在企业知识库中进行语义搜索和文档列表查询",
        "builtin_tools": ["_knowledge_list"],
        "needs_knowledge": True,
    },
    "data_analysis": {
        "label": "数据分析",
        "description": "使用 Pandas/DuckDB/SQL 进行数据清洗、统计分析、CSV 操作",
        "builtin_tools": ["pandas", "duckdb", "csv", "file_generation"],
    },
    "chart_generation": {
        "label": "图表生成",
        "description": "生成柱状图/折线图/饼图/散点图等可视化图表",
        "builtin_tools": ["chart"],
    },
    "pdf_generation": {
        "label": "PDF 报告",
        "description": "生成包含 Markdown 格式内容的 PDF 报告",
        "builtin_tools": ["pdf"],
    },
    "excel_generation": {
        "label": "Excel 导出",
        "description": "导出 Excel 报表文件",
        "builtin_tools": ["excel"],
    },
    "code_execution": {
        "label": "代码执行",
        "description": "执行 Python 代码、文件读写操作",
        "builtin_tools": ["python", "file"],
    },
    "image_processing": {
        "label": "图片处理",
        "description": "图片缩放/裁剪/水印/格式转换等处理",
        "builtin_tools": ["image"],
    },
    "http_request": {
        "label": "HTTP 请求",
        "description": "调用外部 HTTP API（GET/POST/PUT/DELETE）",
        "builtin_tools": ["http"],
    },
    "entity_extraction": {
        "label": "实体抽取",
        "description": "从文档或文本中抽取知识实体和关系，构建知识图谱",
        "builtin_tools": ["entity_extract"],
    },
    "entity_management": {
        "label": "实体管理",
        "description": "管理知识图谱中的实体：排除、删除不需要的实体",
        "builtin_tools": ["entity_manage"],
    },
}


def get_full_capability_list() -> str:
    """返回给 LLM 的能力清单描述（含动态技能）。"""
    from knowledge import knowledge_available

    lines: list[str] = []
    for cap_id, cap in CAPABILITY_REGISTRY.items():
        if cap.get("needs_knowledge") and not knowledge_available():
            continue
        lines.append(f"- {cap_id}: {cap['description']}")
    for sid, skill in _skill_registry.items():
        meta = skill["meta"]
        lines.append(f"- skill:{sid}: {meta.get('description', meta['name'])}")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# 数据模型
# ---------------------------------------------------------------------------

@dataclass
class SubTask:
    slot_id: int
    description: str
    required_capabilities: list[str] = field(default_factory=list)
    status: str = "pending"
    result: str | None = None
    input_tokens: int = 0
    output_tokens: int = 0

@dataclass
class TaskPlan:
    plan_id: str
    project_id: str
    task_id: str | None
    user_message: str
    execution_mode: str = "single"
    subtasks: list[SubTask] = field(default_factory=list)
    status: str = "planning"
    summary: str | None = None
    reasoning: str | None = None


# ---------------------------------------------------------------------------
# 任务规划（调用 LLM）
# ---------------------------------------------------------------------------

_PLAN_SYSTEM_PROMPT = """你是一个任务规划引擎。根据用户消息和系统能力，将任务分解为子任务并分配给 SubAgent 工位。

## 系统当前可用能力
{capabilities}

## 3 个 SubAgent 工位状态
{slots_status}

## 输出要求
必须返回严格的 JSON（不要包含 markdown 标记），格式：
{{
  "execution_mode": "single 或 serial 或 parallel",
  "subtasks": [
    {{"description": "子任务描述", "required_capabilities": ["能力ID"], "slot_id": 工位号}}
  ],
  "reasoning": "面向用户的简洁说明"
}}

## 文案风格
reasoning 和 description 是直接展示给普通用户看的，必须使用通俗易懂的语言：
- reasoning 用一句话告诉用户"我正在帮你做什么"，例如："正在为您生成 PDF 报告"、"需要先查询数据，再生成图表，将按顺序完成"
- description 描述每个步骤在做什么，例如："生成2月份热力简报 PDF 文档"、"查询本月供热数据"
- 禁止出现技术术语，如：工位、能力ID、slot、serial/parallel、前置数据依赖、pdf_generation 等
- 禁止解释系统内部分配逻辑

## 规则
- 简单问答、闲聊、单一知识检索 => single，只用 1 个工位
- 有先后依赖的多步任务（如先查数据再生成报告）=> serial，按顺序分配
- 无依赖的并行任务（如同时分析 3 个维度）=> parallel
- slot_id 只能使用当前状态为 idle 的工位号
- 如果没有空闲工位，返回 {{"execution_mode": "single", "subtasks": [], "reasoning": "当前所有助手都在忙，请稍后再试"}}
- required_capabilities 中只能使用上面列出的能力 ID
- 技能类能力 ID 格式为 skill:技能名
"""


async def plan_task(
    user_message: str,
    project_id: str,
    task_id: str | None = None,
) -> TaskPlan:
    """调用 LLM 分析用户消息，生成 TaskPlan。"""
    from agno.agent import Agent

    capabilities = get_full_capability_list()
    available = worker_pool.get_available_slots()
    slots_desc = ""
    for sd in worker_pool.get_all_status():
        status_label = "idle（空闲）" if sd["status"] == "idle" else sd["status"]
        slots_desc += f"- 工位 {sd['slot_id']}: {status_label}\n"

    system_prompt = _PLAN_SYSTEM_PROMPT.format(
        capabilities=capabilities,
        slots_status=slots_desc.strip(),
    )

    planner = Agent(
        name="TaskPlanner",
        model=create_model(),
        instructions=[system_prompt],
        markdown=False,
    )

    response = await planner.arun(user_message, stream=False)
    raw = response.content or ""

    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[-1]
    if raw.endswith("```"):
        raw = raw.rsplit("```", 1)[0]
    raw = raw.strip()

    plan = TaskPlan(
        plan_id=f"plan_{uuid.uuid4().hex[:8]}",
        project_id=project_id,
        task_id=task_id,
        user_message=user_message,
    )

    try:
        data = json.loads(raw)
        plan.execution_mode = data.get("execution_mode", "single")
        plan.reasoning = data.get("reasoning", "")
        for st in data.get("subtasks", []):
            plan.subtasks.append(SubTask(
                slot_id=st.get("slot_id", 1),
                description=st.get("description", ""),
                required_capabilities=st.get("required_capabilities", []),
            ))
        plan.status = "executing" if plan.subtasks else "completed"
    except (json.JSONDecodeError, KeyError) as e:
        print(f"[ORCHESTRATOR] 规划 JSON 解析失败: {e}, raw={raw[:200]}")
        plan.status = "failed"
        plan.reasoning = f"规划失败: {e}"

    return plan


# ---------------------------------------------------------------------------
# 子任务执行
# ---------------------------------------------------------------------------

async def _run_subtask(
    subtask: SubTask,
    event_queue: asyncio.Queue,
    previous_context: str | None = None,
):
    """执行单个子任务：动态创建 Agno Agent -> arun -> 收集结果和 token。"""
    from agents import create_dynamic_agent

    worker_pool.assign_slot(subtask.slot_id, subtask.description)
    await event_queue.put({
        "type": "subtask_started",
        "slot_id": subtask.slot_id,
        "description": subtask.description,
    })

    try:
        agent = create_dynamic_agent(
            slot_id=subtask.slot_id,
            capabilities=subtask.required_capabilities,
            task_description=subtask.description,
        )

        message = subtask.description
        if previous_context:
            message = f"上一步结果：\n{previous_context}\n\n当前任务：{subtask.description}"

        _SUBTASK_TIMEOUT = 120  # seconds
        try:
            response = await asyncio.wait_for(
                agent.arun(message, stream=False),
                timeout=_SUBTASK_TIMEOUT,
            )
        except asyncio.TimeoutError:
            raise TimeoutError(f"子任务执行超时（{_SUBTASK_TIMEOUT}秒）")

        metrics = response.metrics
        token_usage = {}
        if metrics:
            token_usage = {
                "input_tokens": metrics.input_tokens or 0,
                "output_tokens": metrics.output_tokens or 0,
                "total_tokens": metrics.total_tokens or 0,
            }

        subtask.result = response.content or ""
        subtask.input_tokens = token_usage.get("input_tokens", 0)
        subtask.output_tokens = token_usage.get("output_tokens", 0)
        subtask.status = "completed"

        worker_pool.release_slot(subtask.slot_id, subtask.result, token_usage)

        await event_queue.put({
            "type": "subtask_completed",
            "slot_id": subtask.slot_id,
            "result": subtask.result,
            "token_usage": token_usage,
        })

    except Exception as e:
        subtask.status = "failed"
        subtask.result = f"执行失败: {e}"
        worker_pool.fail_slot(subtask.slot_id, str(e))
        await event_queue.put({
            "type": "subtask_failed",
            "slot_id": subtask.slot_id,
            "error": str(e),
        })


async def execute_plan(plan: TaskPlan, event_queue: asyncio.Queue):
    """执行 TaskPlan（串行/并行），通过 event_queue 推送事件。"""
    await event_queue.put({
        "type": "plan_created",
        "plan_id": plan.plan_id,
        "execution_mode": plan.execution_mode,
        "reasoning": plan.reasoning,
        "subtasks": [
            {"slot_id": st.slot_id, "description": st.description}
            for st in plan.subtasks
        ],
    })

    if not plan.subtasks:
        plan.status = "completed"
        return

    try:
        if plan.execution_mode == "parallel":
            await asyncio.gather(*[
                _run_subtask(st, event_queue) for st in plan.subtasks
            ])
        else:
            previous_result: str | None = None
            for st in plan.subtasks:
                await _run_subtask(st, event_queue, previous_context=previous_result)
                if st.status == "completed":
                    previous_result = st.result
                else:
                    break

        all_results = []
        for st in plan.subtasks:
            status_label = "完成" if st.status == "completed" else "失败"
            all_results.append(f"[工位{st.slot_id} - {status_label}] {st.description}\n{st.result or st.status}")

        plan.summary = "\n\n---\n\n".join(all_results)
        plan.status = "completed"

    except Exception as e:
        plan.status = "failed"
        plan.summary = f"执行失败: {e}"

    finally:
        for st in plan.subtasks:
            worker_pool.reset_slot(st.slot_id)

        await event_queue.put({
            "type": "plan_completed",
            "plan_id": plan.plan_id,
            "status": plan.status,
            "summary": plan.summary,
        })
