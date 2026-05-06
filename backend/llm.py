import os

from database import _get_projects_conn


_PROVIDER_API_KEY_MAP = {
    "kimi": "KIMI_API_KEY",
    "minimax": "MINIMAX_API_KEY",
    "openai": "OPENAI_API_KEY",
}

_PROVIDER_BASE_URL_MAP = {
    "kimi": "https://api.moonshot.cn/v1",
    "minimax": "https://api.minimaxi.com/v1",
}

_PROVIDER_DEFAULT_MODEL = {
    "kimi": "kimi-k2.6",
    "minimax": "MiniMax-M2.7",
    "openai": "gpt-4o-mini",
    "custom": "qwen-plus",
}

_COMPAT_ROLE_MAP = {
    "system": "system",
    "user": "user",
    "assistant": "assistant",
    "tool": "tool",
    "model": "assistant",
}

_PROVIDER_EXTRA_KWARGS: dict[str, dict] = {
    "kimi": {
        "extra_body": {"thinking": {"type": "disabled"}},
        "role_map": _COMPAT_ROLE_MAP,
    },
    "minimax": {"role_map": _COMPAT_ROLE_MAP},
    "custom": {"role_map": _COMPAT_ROLE_MAP},
}


def _get_llm_config() -> dict:
    """从 DB 读取 LLM 配置，无则回退到 .env。"""
    conn = _get_projects_conn()
    rows = conn.execute(
        "SELECT key, value FROM settings WHERE key LIKE 'llm_%'"
    ).fetchall()
    conn.close()
    db_cfg = {r["key"]: r["value"] for r in rows}
    if db_cfg.get("llm_provider"):
        return {
            "provider": db_cfg["llm_provider"],
            "model_id": db_cfg.get("llm_model_id", ""),
            "api_key": db_cfg.get("llm_api_key", ""),
            "base_url": db_cfg.get("llm_base_url", ""),
        }
    provider = os.getenv("MODEL_PROVIDER", "openai").lower()
    env_key = _PROVIDER_API_KEY_MAP.get(provider)
    return {
        "provider": provider,
        "model_id": os.getenv("MODEL_ID", ""),
        "api_key": os.getenv(env_key) if env_key else os.getenv("CUSTOM_API_KEY", ""),
        "base_url": os.getenv("CUSTOM_BASE_URL", ""),
    }


def _is_kimi_model(model_id: str, base_url: str) -> bool:
    """判断是否为 Kimi (Moonshot) 模型，无论 provider 配置为何。"""
    if base_url and "moonshot.cn" in base_url:
        return True
    if model_id and model_id.lower().startswith("kimi"):
        return True
    return False


def create_model():
    from agno.models.openai import OpenAIChat

    cfg = _get_llm_config()
    provider = cfg["provider"]
    model_id = cfg["model_id"] or _PROVIDER_DEFAULT_MODEL.get(provider, "gpt-4o-mini")
    api_key = cfg["api_key"]
    base_url = cfg["base_url"] or _PROVIDER_BASE_URL_MAP.get(provider)

    kwargs = dict(id=model_id, timeout=120)
    if api_key:
        kwargs["api_key"] = api_key
    if base_url:
        kwargs["base_url"] = base_url

    # 先应用 provider 级别的 extra kwargs
    kwargs.update(_PROVIDER_EXTRA_KWARGS.get(provider, {}))

    # 若为 Kimi 模型（通过 custom provider 配置时 provider!="kimi"，需兜底处理），
    # 自动禁用 extended thinking，防止 agno 工具调用多轮时 reasoning_content 丢失报 400
    if _is_kimi_model(model_id, base_url or ""):
        kwargs.setdefault("extra_body", {"thinking": {"type": "disabled"}})
        kwargs.setdefault("role_map", _COMPAT_ROLE_MAP)

    return OpenAIChat(**kwargs)
