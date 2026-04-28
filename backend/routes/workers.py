"""SubAgent 工位状态和统计 API。"""

from fastapi import APIRouter

import worker_pool

router = APIRouter()


@router.get("/api/workers/status")
async def api_worker_status():
    """获取 3 个 SubAgent 工位的实时状态。"""
    return {"slots": worker_pool.get_all_status()}


@router.get("/api/workers/stats")
async def api_worker_stats():
    """获取 token 消耗统计。"""
    return worker_pool.get_token_stats()
