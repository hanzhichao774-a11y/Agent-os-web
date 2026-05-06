"""
LLM 调用统一封装

对应 docs/KNOWN_ISSUES.md 中的 Issue 010，落实 F001 原则 5（LLM 失败时仍由 LLM 兜底）
在执行层（而非仅路由层）的闭环。

核心问题（修复前）:
    extractor = Agent(...)
    response = extractor.run(text, stream=False)
    raw = response.content or ""
    json.loads(raw)  # 当 OpenAI 超时时，agno 把 "Request timed out." 当 content 返回，
                     # 这里 JSON 解析失败 → 上层把 "0 实体, 0 关系" 当作业务结果

核心修复（本模块）:
    1. agno 默认 retries=0；最终失败时把 RunOutput.status 置为 ERROR、把 str(e) 写到 content。
       本模块识别 status=ERROR 与已知错误字符串前缀（兜底防御）为失败。
    2. 重试 N 次（指数退避）；主重试耗尽后切换 fallback agent；最终失败抛 LLMCallError。
    3. 异步与同步两套接口对等（同步给 entity_extractor.extract_entities_sync 这类同步路径用）。

参考:
    - agno/run/base.py:299  RunStatus(str, Enum) 枚举（"PENDING"/"RUNNING"/"COMPLETED"/"ERROR"/...）
    - agno/run/agent.py:610 RunOutput dataclass（含 status/content）
    - agno/agent/_run.py    Agent 内部失败时把异常写到 content 而非抛出
"""
from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from typing import Any, Optional


# agno 在最终失败时常把这些字符串作为 content 返回（在 status 字段也设了 error，
# 但本前缀列表是双保险，兼容 status 字段未设置或 agno 版本差异的情况）。
_KNOWN_ERROR_CONTENT_PREFIXES = (
    "Request timed out",
    "API connection error",
    "Connection error",
    "Timeout",
    "Read timed out",
    "ReadTimeout",
)


@dataclass
class LLMResult:
    """LLM 调用结果。

    ok=True 时 content 必有；ok=False 时 reason 必有。
    used_fallback 用于上层日志区分"主成功"与"兜底成功"。
    """
    ok: bool
    content: Optional[str] = None
    reason: Optional[str] = None
    attempts: int = 0
    used_fallback: bool = False


class LLMCallError(Exception):
    """所有 LLM 调用尝试均失败时抛出（包括主 agent 重试 + fallback agent 重试）。

    上层应捕获此异常并区分"业务结果为 0"与"调用失败"，避免把超时伪装成"成功 0 实体"。
    """

    def __init__(self, reason: str, attempts: int):
        super().__init__(f"LLM call failed after {attempts} attempts: {reason}")
        self.reason = reason
        self.attempts = attempts


# ---------------------------------------------------------------------------
# 内部工具：判断 agno 返回是否为伪成功
# ---------------------------------------------------------------------------

def _classify_response(response: Any) -> tuple[bool, Optional[str], Optional[str]]:
    """检查 agno Agent.run/arun 的返回值是否实际成功。

    Returns:
        (ok, content, error_reason)
        - ok=True: content 是模型实际返回内容
        - ok=False: error_reason 是失败原因
    """
    content = getattr(response, "content", None)
    status = getattr(response, "status", None)

    if status is not None:
        status_str = getattr(status, "value", status)
        if isinstance(status_str, str) and status_str.upper() == "ERROR":
            return False, None, f"agno status=ERROR, content={str(content)[:200]!r}"

    if isinstance(content, str):
        for prefix in _KNOWN_ERROR_CONTENT_PREFIXES:
            if content.startswith(prefix):
                return False, None, (
                    f"agno content 以已知错误前缀开头 ({prefix!r})，"
                    f"实际可能是底层 SDK 异常被吞掉：{content[:200]!r}"
                )

    if content is None:
        return False, None, "agno 返回 content 为 None"

    if not isinstance(content, str):
        content = str(content)
    return True, content, None


# ---------------------------------------------------------------------------
# 异步版本
# ---------------------------------------------------------------------------

async def safe_llm_call(
    agent: Any,
    prompt: str,
    *,
    max_retries: int = 3,
    initial_backoff: float = 1.0,
    fallback_agent: Optional[Any] = None,
    stream: bool = False,
) -> LLMResult:
    """异步 LLM 调用（带重试与 fallback agent）。

    Args:
        agent: 已构造好的 agno.Agent 实例（主 agent）
        prompt: 用户消息
        max_retries: 主 agent 最大尝试次数（含首次调用）；指数退避
        initial_backoff: 首次重试间隔（秒）
        fallback_agent: 主 agent 全失败后切换的备用 agent；为 None 时不启用
        stream: 透传给 Agent.arun 的 stream 参数

    Returns:
        LLMResult.ok=True 时 content 是模型返回；任何路径成功后立即返回。

    Raises:
        LLMCallError: 主 + fallback 全部失败
    """
    attempts = 0
    last_reason = "unknown"

    for attempt_idx in range(max_retries):
        attempts += 1
        try:
            response = await agent.arun(prompt, stream=stream)
            ok, content, reason = _classify_response(response)
            if ok:
                return LLMResult(
                    ok=True, content=content, attempts=attempts, used_fallback=False
                )
            last_reason = reason or "unknown"
        except Exception as e:
            last_reason = f"{type(e).__name__}: {e}"

        if attempt_idx < max_retries - 1:
            await asyncio.sleep(initial_backoff * (2 ** attempt_idx))

    if fallback_agent is not None:
        try:
            response = await fallback_agent.arun(prompt, stream=stream)
            attempts += 1
            ok, content, reason = _classify_response(response)
            if ok:
                return LLMResult(
                    ok=True, content=content, attempts=attempts, used_fallback=True
                )
            last_reason = f"fallback failed: {reason}"
        except Exception as e:
            attempts += 1
            last_reason = f"fallback {type(e).__name__}: {e}"

    raise LLMCallError(last_reason, attempts)


# ---------------------------------------------------------------------------
# 同步版本
# ---------------------------------------------------------------------------

def safe_llm_call_sync(
    agent: Any,
    prompt: str,
    *,
    max_retries: int = 3,
    initial_backoff: float = 1.0,
    fallback_agent: Optional[Any] = None,
    stream: bool = False,
) -> LLMResult:
    """同步 LLM 调用（语义与 safe_llm_call 完全一致）。

    给 entity_extractor.extract_entities_sync 这类同步路径使用，
    避免在 ThreadPoolExecutor 内嵌 asyncio.run 的复杂度。
    """
    attempts = 0
    last_reason = "unknown"

    for attempt_idx in range(max_retries):
        attempts += 1
        try:
            response = agent.run(prompt, stream=stream)
            ok, content, reason = _classify_response(response)
            if ok:
                return LLMResult(
                    ok=True, content=content, attempts=attempts, used_fallback=False
                )
            last_reason = reason or "unknown"
        except Exception as e:
            last_reason = f"{type(e).__name__}: {e}"

        if attempt_idx < max_retries - 1:
            time.sleep(initial_backoff * (2 ** attempt_idx))

    if fallback_agent is not None:
        try:
            response = fallback_agent.run(prompt, stream=stream)
            attempts += 1
            ok, content, reason = _classify_response(response)
            if ok:
                return LLMResult(
                    ok=True, content=content, attempts=attempts, used_fallback=True
                )
            last_reason = f"fallback failed: {reason}"
        except Exception as e:
            attempts += 1
            last_reason = f"fallback {type(e).__name__}: {e}"

    raise LLMCallError(last_reason, attempts)
