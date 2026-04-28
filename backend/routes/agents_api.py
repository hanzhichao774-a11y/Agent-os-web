from fastapi import APIRouter

from agents import AGENT_CONFIGS

router = APIRouter()


@router.get("/api/agents")
async def api_list_agents():
    """列出系统 Agent 配置（仅 BizAgent 和技能工程师）。"""
    return [
        {
            "id": k,
            "name": v["name"],
            "avatar": v.get("avatar", "🤖"),
            "description": v.get("description", ""),
            "capabilities": v.get("capabilities", []),
        }
        for k, v in AGENT_CONFIGS.items()
        if k != "skill_engineer"
    ]
