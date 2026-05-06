"""
LLM 调用统一封装的失败测试

对应 docs/KNOWN_ISSUES.md 中的 Issue 010，验证 F001 原则 5：
- 主 LLM 调用失败时必须仍由 LLM 完成兜底
- agno Agent.run/arun 把异常转为 RunOutput(status=RunStatus.error, content=str(e)) 的"伪成功"必须被识别为失败
- 全部失败必须显式抛出 LLMCallError，不允许伪装成"成功 0 实体"

运行方式:
    cd backend
    .venv/bin/pytest tests/test_llm_invoker.py -v
"""
from dataclasses import dataclass, field
from typing import Optional
from unittest.mock import MagicMock

import pytest


@pytest.fixture
def anyio_backend():
    return "asyncio"


# ---------------------------------------------------------------------------
# Fake agno 对象
# ---------------------------------------------------------------------------

@dataclass
class _FakeRunOutput:
    """模拟 agno.run.agent.RunOutput 的最小子集。

    关键字段:
    - content: 模型返回内容（agno 失败时可能是错误字符串如 "Request timed out."）
    - status:  agno.run.base.RunStatus 枚举值；error 表示调用失败
    """
    content: Optional[str] = None
    status: object = "RUNNING"


def _make_fake_agent_class(responses):
    """构造 fake Agent 类，按顺序消费 responses。

    每个条目可以是:
    - 字符串: 作为 .content 返回，status 默认为 RunStatus.running
    - dict {"content": str, "status": RunStatus}: 作为完整 RunOutput 返回
    - Exception 实例: 抛出该异常
    """
    call_log = []

    class _FakeAgent:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

        def _next(self, message):
            call_log.append({"message": message, "kwargs": self.kwargs})
            idx = len(call_log) - 1
            if idx >= len(responses):
                raise RuntimeError(f"Unexpected extra LLM call #{idx + 1}")
            entry = responses[idx]
            if isinstance(entry, BaseException):
                raise entry
            if isinstance(entry, dict):
                return _FakeRunOutput(
                    content=entry.get("content"),
                    status=entry.get("status", "RUNNING"),
                )
            return _FakeRunOutput(content=entry, status="RUNNING")

        def run(self, message, **_kwargs):
            return self._next(message)

        async def arun(self, message, **_kwargs):
            return self._next(message)

    return _FakeAgent, call_log


# ---------------------------------------------------------------------------
# 类别 A：模块/接口存在性
# ---------------------------------------------------------------------------

def test_llm_invoker_module_exists():
    """backend/llm_invoker.py 必须存在并导出 safe_llm_call、safe_llm_call_sync、LLMResult、LLMCallError。"""
    import importlib

    mod = importlib.import_module("llm_invoker")
    for name in ("safe_llm_call", "safe_llm_call_sync", "LLMResult", "LLMCallError"):
        assert hasattr(mod, name), (
            f"llm_invoker 模块缺少导出 `{name}`。"
            " 详见 docs/KNOWN_ISSUES.md#010-openai-api-调用无重试单次超时即返回-0-实体"
        )


def test_llm_call_error_is_exception():
    """LLMCallError 必须是 Exception 子类（让上层可以用 try/except 捕获）。"""
    from llm_invoker import LLMCallError

    assert issubclass(LLMCallError, Exception)


# ---------------------------------------------------------------------------
# 类别 B：主调用成功路径（不应触发重试或兜底）
# ---------------------------------------------------------------------------

@pytest.mark.anyio
async def test_safe_llm_call_returns_ok_when_primary_succeeds():
    """主调用成功时，应直接返回 LLMResult.ok=True，content 与原始一致，attempts=1，未启用 fallback。"""
    from llm_invoker import safe_llm_call

    fake_cls, call_log = _make_fake_agent_class([
        '{"intent": "direct_answer"}',
    ])
    agent = fake_cls()

    result = await safe_llm_call(agent, "hello", max_retries=3, initial_backoff=0.01)

    assert result.ok is True
    assert result.content == '{"intent": "direct_answer"}'
    assert result.attempts == 1
    assert result.used_fallback is False
    assert len(call_log) == 1, f"主调用成功不应触发额外重试，实际 LLM 调用 {len(call_log)} 次"


def test_safe_llm_call_sync_returns_ok_when_primary_succeeds():
    """同步版本的主调用成功路径必须与异步版本对等。"""
    from llm_invoker import safe_llm_call_sync

    fake_cls, call_log = _make_fake_agent_class([
        "ok-content",
    ])
    agent = fake_cls()

    result = safe_llm_call_sync(agent, "hello", max_retries=3, initial_backoff=0.01)

    assert result.ok is True
    assert result.content == "ok-content"
    assert result.attempts == 1
    assert len(call_log) == 1


# ---------------------------------------------------------------------------
# 类别 C：主调用失败时重试 + 指数退避（关键不变量）
# ---------------------------------------------------------------------------

@pytest.mark.anyio
async def test_safe_llm_call_retries_on_exception_then_succeeds(monkeypatch):
    """主调用前两次抛异常，第三次成功。
    期望:
    - 总共调用 3 次
    - attempts == 3
    - sleep 被调用 2 次（重试间隔），且呈指数退避
    """
    from llm_invoker import safe_llm_call

    fake_cls, call_log = _make_fake_agent_class([
        TimeoutError("conn timeout 1"),
        TimeoutError("conn timeout 2"),
        "succeeded-on-3rd",
    ])
    agent = fake_cls()

    sleep_calls = []

    async def fake_sleep(delay):
        sleep_calls.append(delay)

    monkeypatch.setattr("llm_invoker.asyncio.sleep", fake_sleep)

    result = await safe_llm_call(
        agent,
        "hello",
        max_retries=3,
        initial_backoff=0.5,
    )

    assert result.ok is True
    assert result.content == "succeeded-on-3rd"
    assert result.attempts == 3
    assert len(call_log) == 3
    assert len(sleep_calls) == 2, (
        f"两次失败之间应有 2 次 sleep（重试间隔），实际 {len(sleep_calls)} 次"
    )
    assert sleep_calls[0] == pytest.approx(0.5), "首次重试间隔应为 initial_backoff=0.5"
    assert sleep_calls[1] == pytest.approx(1.0), (
        "第二次重试间隔应为 initial_backoff*2（指数退避）=1.0"
    )


# ---------------------------------------------------------------------------
# 类别 D：agno "异常变 content 字符串" 的伪成功必须被识别为失败
#         （这是 Issue 010 现场暴露的 bug 根源：
#          OpenAI 超时 -> agno 把 "Request timed out." 当 content 返回 -> 0 实体）
# ---------------------------------------------------------------------------

@pytest.mark.anyio
async def test_safe_llm_call_recognizes_run_status_error_as_failure(monkeypatch):
    """
    Issue 010 核心场景:
    agno 把 OpenAI 超时变成 RunOutput(status=RunStatus.error, content="Request timed out.")
    safe_llm_call 必须识别 status=ERROR 为失败并触发重试，而非把错误字符串当成功。
    """
    from llm_invoker import safe_llm_call

    fake_cls, call_log = _make_fake_agent_class([
        {"content": "Request timed out.", "status": "ERROR"},
        {"content": "Request timed out.", "status": "ERROR"},
        '{"valid": "json"}',
    ])
    agent = fake_cls()

    async def fake_sleep(_):
        pass

    monkeypatch.setattr("llm_invoker.asyncio.sleep", fake_sleep)

    result = await safe_llm_call(agent, "hello", max_retries=3, initial_backoff=0.01)

    assert result.ok is True, (
        "F001 原则 5 违反：agno 返回的 status=ERROR 必须被识别为失败并触发重试，"
        "而不是把 'Request timed out.' 当成功 content 返回"
    )
    assert result.content == '{"valid": "json"}'
    assert result.attempts == 3


@pytest.mark.anyio
async def test_safe_llm_call_recognizes_known_error_content_strings(monkeypatch):
    """
    防御性兜底：即使 status 字段不存在/未设置（兼容不同 agno 版本），
    若 content 是 agno 已知的错误字符串前缀（如 "Request timed out."、"API connection error"），
    safe_llm_call 也应识别为失败而非把错误字符串当模型返回。
    """
    from llm_invoker import safe_llm_call

    fake_cls, call_log = _make_fake_agent_class([
        "Request timed out.",
        '{"intent": "direct_answer"}',
    ])
    agent = fake_cls()

    async def fake_sleep(_):
        pass

    monkeypatch.setattr("llm_invoker.asyncio.sleep", fake_sleep)

    result = await safe_llm_call(agent, "hello", max_retries=3, initial_backoff=0.01)

    assert result.ok is True
    assert result.content == '{"intent": "direct_answer"}'
    assert result.attempts == 2, (
        "已知错误字符串应被识别为失败并重试一次，实际 attempts=" + str(result.attempts)
    )


# ---------------------------------------------------------------------------
# 类别 E：fallback agent 路径
# ---------------------------------------------------------------------------

@pytest.mark.anyio
async def test_safe_llm_call_falls_back_to_fallback_agent_when_primary_exhausted(monkeypatch):
    """
    主 agent 重试 max_retries 次全失败时，应切换到 fallback agent 重试一次。
    fallback 成功时返回 ok=True 且 used_fallback=True。
    """
    from llm_invoker import safe_llm_call

    primary_cls, primary_log = _make_fake_agent_class([
        TimeoutError("p1"),
        TimeoutError("p2"),
    ])
    fallback_cls, fallback_log = _make_fake_agent_class([
        "fallback-content",
    ])

    async def fake_sleep(_):
        pass

    monkeypatch.setattr("llm_invoker.asyncio.sleep", fake_sleep)

    result = await safe_llm_call(
        primary_cls(),
        "hello",
        max_retries=2,
        initial_backoff=0.01,
        fallback_agent=fallback_cls(),
    )

    assert result.ok is True
    assert result.content == "fallback-content"
    assert result.used_fallback is True
    assert len(primary_log) == 2, "主 agent 应被调用 max_retries 次"
    assert len(fallback_log) == 1, "fallback agent 应只被调用 1 次"


@pytest.mark.anyio
async def test_safe_llm_call_raises_when_all_attempts_fail(monkeypatch):
    """
    主 + fallback 全部失败时，应抛出 LLMCallError；不允许返回 ok=True 也不允许返回伪装成功。
    这是与"agno 默认行为吞异常返回 RunOutput.content=str(e)"的核心区别。
    """
    from llm_invoker import safe_llm_call, LLMCallError

    primary_cls, _ = _make_fake_agent_class([
        TimeoutError("p1"),
        TimeoutError("p2"),
    ])
    fallback_cls, _ = _make_fake_agent_class([
        TimeoutError("f1"),
    ])

    async def fake_sleep(_):
        pass

    monkeypatch.setattr("llm_invoker.asyncio.sleep", fake_sleep)

    with pytest.raises(LLMCallError) as exc_info:
        await safe_llm_call(
            primary_cls(),
            "hello",
            max_retries=2,
            initial_backoff=0.01,
            fallback_agent=fallback_cls(),
        )

    assert exc_info.value.attempts >= 2, (
        f"LLMCallError.attempts 应记录总尝试次数（主+兜底），实际 {exc_info.value.attempts}"
    )
    assert exc_info.value.reason, "LLMCallError 必须包含失败原因"


@pytest.mark.anyio
async def test_safe_llm_call_raises_when_no_fallback_and_primary_fails(monkeypatch):
    """没有 fallback agent 时，主 agent 重试耗尽必须直接抛 LLMCallError。"""
    from llm_invoker import safe_llm_call, LLMCallError

    primary_cls, primary_log = _make_fake_agent_class([
        TimeoutError("p1"),
        TimeoutError("p2"),
        TimeoutError("p3"),
    ])

    async def fake_sleep(_):
        pass

    monkeypatch.setattr("llm_invoker.asyncio.sleep", fake_sleep)

    with pytest.raises(LLMCallError):
        await safe_llm_call(
            primary_cls(),
            "hello",
            max_retries=3,
            initial_backoff=0.01,
        )

    assert len(primary_log) == 3


# ---------------------------------------------------------------------------
# 类别 F：同步版本完整行为对等
# ---------------------------------------------------------------------------

def test_safe_llm_call_sync_retries_and_raises(monkeypatch):
    """同步版本必须支持重试 + 抛 LLMCallError，行为与异步版本对等。"""
    from llm_invoker import safe_llm_call_sync, LLMCallError

    fake_cls, call_log = _make_fake_agent_class([
        TimeoutError("sync 1"),
        TimeoutError("sync 2"),
    ])

    sleep_calls = []
    monkeypatch.setattr("llm_invoker.time.sleep", lambda d: sleep_calls.append(d))

    with pytest.raises(LLMCallError):
        safe_llm_call_sync(
            fake_cls(),
            "hello",
            max_retries=2,
            initial_backoff=0.5,
        )

    assert len(call_log) == 2
    assert len(sleep_calls) == 1, (
        f"两次调用之间应有 1 次 sleep，实际 {len(sleep_calls)}"
    )
    assert sleep_calls[0] == pytest.approx(0.5)


def test_safe_llm_call_sync_recognizes_run_status_error(monkeypatch):
    """
    同步版本必须同样识别 RunOutput.status=ERROR 为失败。
    （Issue 010 在 entity_extractor.extract_entities_sync 这条同步路径上是首次暴露的）
    """
    from llm_invoker import safe_llm_call_sync

    fake_cls, call_log = _make_fake_agent_class([
        {"content": "Request timed out.", "status": "ERROR"},
        '{"entities": []}',
    ])

    monkeypatch.setattr("llm_invoker.time.sleep", lambda _: None)

    result = safe_llm_call_sync(
        fake_cls(),
        "hello",
        max_retries=2,
        initial_backoff=0.01,
    )

    assert result.ok is True
    assert result.content == '{"entities": []}'
    assert result.attempts == 2


# ---------------------------------------------------------------------------
# 类别 G：LLMResult 形状
# ---------------------------------------------------------------------------

def test_llm_result_has_required_fields():
    """LLMResult 必须能区分成功/失败、记录尝试次数和是否使用了 fallback。"""
    from llm_invoker import LLMResult

    success = LLMResult(ok=True, content="x", attempts=1, used_fallback=False)
    assert success.ok is True
    assert success.content == "x"
    assert success.attempts == 1
    assert success.used_fallback is False

    failed = LLMResult(ok=False, reason="timeout", attempts=3)
    assert failed.ok is False
    assert failed.reason == "timeout"
    assert failed.attempts == 3
