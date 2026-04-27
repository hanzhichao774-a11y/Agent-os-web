import time

from fastapi import APIRouter

from schemas import CreateAgentRequest, AgentToolsRequest, AgentConfigRequest
from agents import (
    AGENT_CONFIGS, _agent_tools, _agents, _HIDDEN_AGENT_IDS,
    TEAM_MEMBER_IDS, invalidate_agent,
)
from teams import _teams

router = APIRouter()


@router.get("/api/agents")
async def api_list_agents():
    return [
        {
            "id": k,
            "name": v["name"],
            "avatar": v.get("avatar", "🤖"),
            "description": v.get("description", ""),
            "capabilities": v.get("capabilities", []),
            "builtin_tools": v.get("builtin_tools", []),
            "custom_tools": _agent_tools.get(k, []),
            "has_knowledge": v.get("has_knowledge", False),
            "instructions": v.get("instructions", []),
        }
        for k, v in AGENT_CONFIGS.items()
        if k not in _HIDDEN_AGENT_IDS
    ]


@router.post("/api/agents")
async def api_create_agent(req: CreateAgentRequest):
    agent_id = f"custom_{int(time.time() * 1000)}"
    config = {
        "name": req.name,
        "avatar": req.avatar,
        "description": req.description,
        "capabilities": [],
        "builtin_tools": req.builtin_tools or [],
        "instructions": req.instructions or [
            f"你是{req.name}，一个智能数字员工。",
            "根据用户的指令完成任务。",
            "始终使用中文回答。",
        ],
    }
    AGENT_CONFIGS[agent_id] = config
    if req.skill_ids:
        _agent_tools[agent_id] = req.skill_ids
    if req.join_team:
        TEAM_MEMBER_IDS.append(agent_id)
        _teams.clear()
    return {
        "success": True,
        "agent": {
            "id": agent_id,
            "name": config["name"],
            "avatar": config["avatar"],
            "description": config["description"],
            "capabilities": config["capabilities"],
            "builtin_tools": config["builtin_tools"],
            "custom_tools": _agent_tools.get(agent_id, []),
            "has_knowledge": config.get("has_knowledge", False),
            "instructions": config["instructions"],
        },
    }


@router.delete("/api/agents/{agent_id}")
async def api_delete_agent(agent_id: str):
    if not agent_id.startswith("custom_"):
        return {"success": False, "error": "内置 Agent 不允许删除"}
    if agent_id not in AGENT_CONFIGS:
        return {"success": False, "error": f"Agent [{agent_id}] 不存在"}
    AGENT_CONFIGS.pop(agent_id, None)
    _agent_tools.pop(agent_id, None)
    _agents.pop(agent_id, None)
    if agent_id in TEAM_MEMBER_IDS:
        TEAM_MEMBER_IDS.remove(agent_id)
    _teams.clear()
    return {"success": True, "agent_id": agent_id}


@router.put("/api/agents/{agent_id}/tools")
async def api_set_agent_tools(agent_id: str, request: AgentToolsRequest):
    if agent_id not in AGENT_CONFIGS:
        return {"success": False, "error": f"Agent [{agent_id}] 不存在"}
    _agent_tools[agent_id] = request.skill_ids
    invalidate_agent(agent_id)
    return {"success": True, "agent_id": agent_id, "tools": request.skill_ids}


@router.put("/api/agents/{agent_id}/config")
async def api_update_agent_config(agent_id: str, request: AgentConfigRequest):
    if agent_id not in AGENT_CONFIGS:
        return {"success": False, "error": f"Agent [{agent_id}] 不存在"}
    config = AGENT_CONFIGS[agent_id]
    if request.description is not None:
        config["description"] = request.description
    if request.instructions is not None:
        config["instructions"] = request.instructions
    invalidate_agent(agent_id)
    return {"success": True, "agent_id": agent_id}
