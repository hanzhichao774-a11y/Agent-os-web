import re
import json
import inspect
import asyncio

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from agno.agent import Agent

from schemas import ChatRequest, SkillCreateRequest, SkillRunRequest
from config import SKILLS_DIR
from llm import create_model
from skill_manager import _skill_registry, scan_skills
from agents import AGENT_CONFIGS, get_agent, invalidate_agent
from utils import clean_delta

router = APIRouter()


@router.get("/api/skills")
async def api_list_skills():
    scan_skills()
    return [
        {
            "id": s["id"],
            "name": s["meta"]["name"],
            "icon": s["meta"].get("icon", "🔧"),
            "category": s["meta"].get("category", "api"),
            "description": s["meta"].get("description", ""),
            "params": s["params"],
            "mounted_agents": [],
        }
        for s in _skill_registry.values()
    ]


@router.post("/api/skills/create")
async def api_create_skill(request: SkillCreateRequest):
    engineer = get_agent("skill_engineer")
    if not engineer:
        return {"success": False, "error": "技能工程师 Agent 初始化失败"}

    try:
        result = await engineer.arun(request.description, stream=False)
        raw = result.content.strip()
        if "```" in raw:
            match = re.search(r'```(?:json)?\s*(\{.*?\})\s*```', raw, re.DOTALL)
            if match:
                raw = match.group(1)
        data = json.loads(raw)
        filename = data["filename"]
        code = data["code"]

        if not filename.endswith(".py"):
            filename += ".py"
        filename = re.sub(r'[^a-zA-Z0-9_.]', '_', filename)

        filepath = SKILLS_DIR / filename
        filepath.write_text(code, encoding="utf-8")

        scan_skills()
        skill_id = filepath.stem
        if skill_id in _skill_registry:
            return {"success": True, "skill_id": skill_id, "skill": _skill_registry[skill_id]["meta"]}
        else:
            return {"success": False, "error": "技能代码生成成功但加载失败，请检查代码格式"}

    except json.JSONDecodeError:
        return {"success": False, "error": f"技能工程师返回了非 JSON 格式的内容: {raw[:200]}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


@router.post("/api/skills/{skill_id}/run")
async def api_run_skill(skill_id: str, request: SkillRunRequest):
    skill = _skill_registry.get(skill_id)
    if not skill:
        return {"success": False, "error": f"技能 [{skill_id}] 不存在"}
    try:
        sig = inspect.signature(skill["run_fn"])
        cast_params = {}
        for name, param in sig.parameters.items():
            if name in request.params:
                val = request.params[name]
                if param.annotation == float:
                    val = float(val)
                elif param.annotation == int:
                    val = int(val)
                cast_params[name] = val
        result = skill["run_fn"](**cast_params)
        return {"success": True, "result": str(result)}
    except Exception as e:
        return {"success": False, "error": str(e)}


@router.delete("/api/skills/{skill_id}")
async def api_delete_skill(skill_id: str):
    skill = _skill_registry.get(skill_id)
    if not skill:
        return {"success": False, "error": f"技能 [{skill_id}] 不存在"}
    filepath = SKILLS_DIR / f"{skill_id}.py"
    if filepath.exists():
        filepath.unlink()
    _skill_registry.pop(skill_id, None)
    return {"success": True, "skill_id": skill_id}


# --- Skill Management Agent ---

def _skill_tool_mount(skill_id: str, agent_id: str) -> str:
    """将技能挂载到指定 Agent（动态编排系统中技能自动可用）。"""
    if skill_id not in _skill_registry:
        return f"错误：技能 [{skill_id}] 不存在"
    return f"成功：技能 [{skill_id}] 已注册，在动态编排中可自动使用"


def _skill_tool_unmount(skill_id: str, agent_id: str) -> str:
    """卸载技能（动态编排系统中无需手动卸载）。"""
    return f"提示：动态编排系统中技能自动按需分配，无需手动卸载"


def _skill_tool_run(skill_id: str, params_json: str) -> str:
    """执行技能，params_json 是 JSON 格式的参数字典。"""
    skill = _skill_registry.get(skill_id)
    if not skill:
        return f"错误：技能 [{skill_id}] 不存在"
    try:
        params = json.loads(params_json) if params_json.strip() else {}
        sig = inspect.signature(skill["run_fn"])
        cast = {}
        for name, param in sig.parameters.items():
            if name in params:
                val = params[name]
                if param.annotation == float:
                    val = float(val)
                elif param.annotation == int:
                    val = int(val)
                cast[name] = val
        result = skill["run_fn"](**cast)
        return f"执行成功：{result}"
    except Exception as e:
        return f"执行失败：{e}"


def _skill_tool_delete(skill_id: str) -> str:
    """删除技能文件。"""
    if skill_id not in _skill_registry:
        return f"错误：技能 [{skill_id}] 不存在"
    filepath = SKILLS_DIR / f"{skill_id}.py"
    if filepath.exists():
        filepath.unlink()
    _skill_registry.pop(skill_id, None)
    return f"成功：技能 [{skill_id}] 已删除"


async def _skill_tool_modify(skill_id: str, instruction: str) -> str:
    """根据自然语言指令修改技能代码。"""
    if skill_id not in _skill_registry:
        return f"错误：技能 [{skill_id}] 不存在"
    filepath = SKILLS_DIR / f"{skill_id}.py"
    if not filepath.exists():
        return "错误：技能文件不存在"
    current_code = filepath.read_text(encoding="utf-8")

    engineer = get_agent("skill_engineer")
    if not engineer:
        return "错误：技能工程师 Agent 初始化失败"

    prompt = (
        f"请修改以下 Python 技能代码。修改要求：{instruction}\n\n"
        f"当前代码：\n```python\n{current_code}\n```\n\n"
        f'请返回一个 JSON 对象：{{"filename": "{skill_id}.py", "code": "修改后的完整 Python 代码"}}\n'
        f"只返回 JSON，不要包含任何其他文字或 markdown 标记。"
    )
    try:
        result = await engineer.arun(prompt, stream=False)
        raw = result.content.strip()
        if "```" in raw:
            match = re.search(r'```(?:json)?\s*(\{.*?\})\s*```', raw, re.DOTALL)
            if match:
                raw = match.group(1)
        data = json.loads(raw)
        new_code = data["code"]
        filepath.write_text(new_code, encoding="utf-8")
        scan_skills()
        if skill_id in _skill_registry:
            return f"成功：技能代码已更新。新描述：{_skill_registry[skill_id]['meta'].get('description', '')}"
        else:
            return "警告：代码已写入但加载失败，可能存在语法错误"
    except Exception as e:
        return f"修改失败：{e}"


async def _skill_tool_create(description: str) -> str:
    """根据自然语言描述创建新技能。"""
    engineer = get_agent("skill_engineer")
    if not engineer:
        return "错误：技能工程师 Agent 初始化失败"

    try:
        result = await engineer.arun(description, stream=False)
        raw = result.content.strip()
        if "```" in raw:
            match = re.search(r'```(?:json)?\s*(\{.*?\})\s*```', raw, re.DOTALL)
            if match:
                raw = match.group(1)
        data = json.loads(raw)
        filename = data["filename"]
        code = data["code"]
        if not filename.endswith(".py"):
            filename += ".py"
        filename = re.sub(r'[^a-zA-Z0-9_.]', '_', filename)
        filepath = SKILLS_DIR / filename
        filepath.write_text(code, encoding="utf-8")
        scan_skills()
        sid = filepath.stem
        if sid in _skill_registry:
            meta = _skill_registry[sid]["meta"]
            return f"成功：已创建技能「{meta['name']}」(ID: {sid})，描述：{meta.get('description', '')}"
        else:
            return "代码已生成但加载失败，请检查代码格式"
    except Exception as e:
        return f"创建失败：{e}"


def _build_skill_manager_agent(skill_id: str | None):
    """构建技能管理 Agent，注入当前技能上下文。"""
    context_lines = []

    if skill_id and skill_id in _skill_registry:
        s = _skill_registry[skill_id]
        meta = s["meta"]
        params_desc = ", ".join(f"{p['name']}:{p['type']}" for p in s["params"]) or "无参数"
        context_lines.append(f"当前技能：{meta['name']}（ID: {skill_id}）")
        context_lines.append(f"描述：{meta.get('description', '')}")
        context_lines.append(f"分类：{meta.get('category', '')}")
        context_lines.append(f"参数：{params_desc}")
    else:
        context_lines.append("当前未选中特定技能，你可以帮用户创建新技能。")

    agent_list = ", ".join(
        f"{k}({v['name']})" for k, v in AGENT_CONFIGS.items() if k != "skill_engineer"
    )
    context_lines.append(f"\n可用 Agent 列表：{agent_list}")

    skill_list = ", ".join(
        f"{s['id']}({s['meta']['name']})" for s in _skill_registry.values()
    )
    if skill_list:
        context_lines.append(f"已注册技能列表：{skill_list}")

    context = "\n".join(context_lines)

    instructions = [
        "你是技能管理助手，帮助用户通过自然语言管理技能。",
        "你拥有以下能力：挂载/卸载技能到 Agent、执行技能、修改技能代码、创建新技能、删除技能。",
        "用户可能用模糊的说法，比如'挂到数据分析上'，你需要推断对应的 agent_id。",
        "执行技能时，从用户消息中提取参数值，构造 JSON 字符串传给 run 工具。",
        "修改技能时，将用户的修改意图转为清晰的指令传给 modify 工具。",
        "回复使用中文，简洁明了。",
        f"\n--- 上下文 ---\n{context}",
    ]

    tools = [
        _skill_tool_mount,
        _skill_tool_unmount,
        _skill_tool_run,
        _skill_tool_delete,
        _skill_tool_modify,
        _skill_tool_create,
    ]

    return Agent(
        model=create_model(),
        tools=tools,
        instructions=instructions,
        markdown=True,
    )


@router.post("/api/skills/{skill_id}/chat")
async def skill_chat(skill_id: str, request: ChatRequest):
    agent = _build_skill_manager_agent(skill_id)

    async def generate():
        try:
            async with asyncio.timeout(180):
                async for chunk in agent.arun(
                    request.message,
                    stream=True,
                    session_id=f"skill_mgr_{skill_id}_{request.session_id}",
                ):
                    if chunk.content:
                        cleaned = clean_delta(chunk.content)
                        if cleaned:
                            yield f"data: {json.dumps({'content': cleaned, 'done': False}, ensure_ascii=False)}\n\n"
            yield f"data: {json.dumps({'content': '', 'done': True})}\n\n"
        except TimeoutError:
            yield f"data: {json.dumps({'content': '技能管理超时（3分钟），请简化操作后重试。', 'done': True})}\n\n"
        except Exception as e:
            err = str(e)
            print(f"[ERROR] Skill chat {skill_id}: {err}")
            yield f"data: {json.dumps({'content': f'出错了：{err}', 'done': True}, ensure_ascii=False)}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")
