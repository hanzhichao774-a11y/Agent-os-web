from datetime import datetime, timezone

from fastapi import APIRouter
from agno.agent import Agent

from schemas import LLMSettingsRequest, EmbeddingSettingsRequest, RerankerSettingsRequest
from database import _get_projects_conn
from llm import (
    _get_llm_config, _PROVIDER_DEFAULT_MODEL, _PROVIDER_BASE_URL_MAP,
    _PROVIDER_EXTRA_KWARGS, create_model,
)
from embeddings import (
    _get_embedding_config, _get_reranker_config, OpenAICompatibleReranker,
)
from knowledge import _rebuild_knowledge
from agents import _agents

router = APIRouter()


def _mask_api_key(key: str) -> str:
    if not key or len(key) <= 12:
        return key
    return key[:6] + "..." + key[-4:]


def _mask_key(key: str) -> str:
    if not key or len(key) <= 8:
        return key
    return key[:4] + "..." + key[-4:]


# --- LLM ---

@router.get("/api/settings/llm")
async def api_get_llm_settings():
    cfg = _get_llm_config()
    return {
        "provider": cfg["provider"],
        "model_id": cfg["model_id"],
        "api_key": _mask_api_key(cfg["api_key"]),
        "base_url": cfg["base_url"],
        "providers": list(_PROVIDER_DEFAULT_MODEL.keys()),
        "default_models": _PROVIDER_DEFAULT_MODEL,
    }


@router.put("/api/settings/llm")
async def api_save_llm_settings(req: LLMSettingsRequest):
    now = datetime.now(timezone.utc).isoformat()
    conn = _get_projects_conn()

    api_key = req.api_key
    if "..." in api_key:
        existing = conn.execute(
            "SELECT value FROM settings WHERE key = 'llm_api_key'"
        ).fetchone()
        if existing:
            api_key = existing["value"]
        else:
            cfg = _get_llm_config()
            api_key = cfg["api_key"]

    pairs = {
        "llm_provider": req.provider,
        "llm_model_id": req.model_id,
        "llm_api_key": api_key,
        "llm_base_url": req.base_url,
    }
    for k, v in pairs.items():
        conn.execute(
            "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            (k, v, now),
        )
    conn.commit()
    conn.close()

    _agents.clear()
    return {"success": True}


@router.post("/api/settings/llm/test")
async def api_test_llm_connection(req: LLMSettingsRequest):
    api_key = req.api_key
    if "..." in api_key:
        conn = _get_projects_conn()
        existing = conn.execute(
            "SELECT value FROM settings WHERE key = 'llm_api_key'"
        ).fetchone()
        conn.close()
        if existing:
            api_key = existing["value"]
        else:
            cfg = _get_llm_config()
            api_key = cfg["api_key"]

    try:
        from agno.models.openai import OpenAIChat

        provider = req.provider.lower()
        model_id = req.model_id or _PROVIDER_DEFAULT_MODEL.get(provider, "gpt-4o-mini")
        base_url = req.base_url or _PROVIDER_BASE_URL_MAP.get(provider)

        kwargs = dict(id=model_id, timeout=15)
        if api_key:
            kwargs["api_key"] = api_key
        if base_url:
            kwargs["base_url"] = base_url
        kwargs.update(_PROVIDER_EXTRA_KWARGS.get(provider, {}))
        model = OpenAIChat(**kwargs)

        test_agent = Agent(model=model, instructions=["回复OK"], markdown=False)
        resp = await test_agent.arun("ping", stream=False)
        content = (resp.content or "").strip()
        error_keywords = ["invalid", "unauthorized", "error", "failed", "denied", "forbidden", "401", "403"]
        content_lower = content.lower()
        if any(kw in content_lower for kw in error_keywords) or not content:
            return {"ok": False, "message": f"认证失败，模型返回: {content[:200]}"}
        return {"ok": True, "message": f"连接成功，模型响应: {content[:100]}"}
    except Exception as e:
        return {"ok": False, "message": f"连接失败: {str(e)[:200]}"}


# --- Embedding ---

@router.get("/api/settings/embedding")
async def api_get_embedding_settings():
    cfg = _get_embedding_config()
    cfg["api_key"] = _mask_key(cfg["api_key"])
    return cfg


@router.put("/api/settings/embedding")
async def api_save_embedding_settings(req: EmbeddingSettingsRequest):
    now = datetime.now(timezone.utc).isoformat()
    conn = _get_projects_conn()

    api_key = req.api_key
    if "..." in api_key:
        existing = conn.execute(
            "SELECT value FROM settings WHERE key = 'embedding_api_key'"
        ).fetchone()
        if existing:
            api_key = existing["value"]
        else:
            api_key = _get_embedding_config()["api_key"]

    if req.mode == "local":
        for k in ["embedding_model_id", "embedding_api_key", "embedding_base_url", "embedding_dimensions"]:
            conn.execute("DELETE FROM settings WHERE key = ?", (k,))
    else:
        pairs = {
            "embedding_model_id": req.model_id,
            "embedding_api_key": api_key,
            "embedding_base_url": req.base_url,
            "embedding_dimensions": str(req.dimensions),
        }
        for k, v in pairs.items():
            conn.execute(
                "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
                (k, v, now),
            )
    conn.commit()
    conn.close()

    try:
        _rebuild_knowledge()
    except Exception as e:
        print(f"[WARN] 保存 Embedding 后重建知识库失败: {e}")
    _agents.clear()
    warning = "切换 Embedding 模型后，建议重新上传文档以重建索引。"
    from knowledge import knowledge_available
    if not knowledge_available():
        warning += " 注意：知识库当前不可用，知识检索功能已暂停。"
    return {"success": True, "warning": warning}


@router.post("/api/settings/embedding/test")
async def api_test_embedding_connection(req: EmbeddingSettingsRequest):
    api_key = req.api_key
    if "..." in api_key:
        api_key = _get_embedding_config()["api_key"]

    if req.mode == "local":
        return {"ok": True, "message": "本地 FastEmbed 模式，无需测试连通性。"}

    try:
        from openai import OpenAI
        client = OpenAI(
            api_key=api_key or "none",
            base_url=req.base_url,
            timeout=15,
        )
        resp = client.embeddings.create(
            model=req.model_id,
            input=["测试连通性"],
        )
        dim = len(resp.data[0].embedding)
        return {"ok": True, "message": f"连接成功，返回向量维度: {dim}"}
    except Exception as e:
        return {"ok": False, "message": f"连接失败: {str(e)[:200]}"}


# --- Reranker ---

@router.get("/api/settings/reranker")
async def api_get_reranker_settings():
    cfg = _get_reranker_config()
    cfg["api_key"] = _mask_key(cfg["api_key"])
    return cfg


@router.put("/api/settings/reranker")
async def api_save_reranker_settings(req: RerankerSettingsRequest):
    now = datetime.now(timezone.utc).isoformat()
    conn = _get_projects_conn()

    api_key = req.api_key
    if "..." in api_key:
        existing = conn.execute(
            "SELECT value FROM settings WHERE key = 'reranker_api_key'"
        ).fetchone()
        if existing:
            api_key = existing["value"]
        else:
            api_key = _get_reranker_config()["api_key"]

    pairs = {
        "reranker_enabled": str(req.enabled).lower(),
        "reranker_model_id": req.model_id,
        "reranker_api_key": api_key,
        "reranker_base_url": req.base_url,
        "reranker_top_n": str(req.top_n),
    }
    for k, v in pairs.items():
        conn.execute(
            "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            (k, v, now),
        )
    conn.commit()
    conn.close()

    try:
        _rebuild_knowledge()
    except Exception as e:
        print(f"[WARN] 保存 Reranker 后重建知识库失败: {e}")
    _agents.clear()
    resp: dict = {"success": True}
    from knowledge import knowledge_available
    if not knowledge_available():
        resp["warning"] = "知识库当前不可用，知识检索功能已暂停。"
    return resp


@router.post("/api/settings/reranker/test")
async def api_test_reranker_connection(req: RerankerSettingsRequest):
    api_key = req.api_key
    if "..." in api_key:
        api_key = _get_reranker_config()["api_key"]

    if not req.enabled:
        return {"ok": True, "message": "Reranker 未启用，无需测试。"}

    try:
        reranker = OpenAICompatibleReranker(
            model=req.model_id,
            api_key=api_key,
            base_url=req.base_url,
            top_n=req.top_n,
        )
        test_docs = ["人工智能是计算机科学的分支", "今天天气很好适合出去玩", "深度学习需要大量训练数据"]
        results = reranker._call_rerank("什么是人工智能", test_docs)
        if results:
            top = results[0]
            return {"ok": True, "message": f"连接成功，返回 {len(results)} 条排序结果，最高分: {top.get('relevance_score', 'N/A')}"}
        return {"ok": False, "message": "连接成功但返回结果为空"}
    except Exception as e:
        return {"ok": False, "message": f"连接失败: {str(e)[:200]}"}
