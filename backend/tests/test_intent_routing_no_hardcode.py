"""
意图路由"无硬编码"约束测试

对应 docs/KNOWN_ISSUES.md 中的 Issue 005、006，验证 F001 原则 1、2、5：
- 原则 1：意图理解必须由大模型完成（不允许预定义关键词列表判定意图）
- 原则 2：任务路由必须由大模型决策（不允许硬编码触发词作为路由降级）
- 原则 5：兜底失败方案必须仍是 LLM（不允许"LLM 失败 → 关键词匹配"）

运行方式:
    cd backend
    .venv/bin/pytest tests/test_intent_routing_no_hardcode.py -v
"""
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import routes.chat as chat_module


@pytest.fixture
def anyio_backend():
    return "asyncio"


# =====================================================================
# 类别 A：硬编码意图路由关键词列表必须不存在（Issue 005）
# =====================================================================

@pytest.mark.parametrize(
    "constant_name",
    [
        "_ORCHESTRATE_KEYWORDS",
        "_DIRECT_ENTITY_KEYWORDS",
        "_ENTITY_EXCLUSION_KEYWORDS",
        "_CREATE_SKILL_KEYWORDS",
    ],
)
def test_no_hardcoded_keyword_list(constant_name):
    """
    F001 原则 1：意图理解必须由大模型完成。

    routes.chat 模块中不应存在 4 套硬编码意图关键词列表。
    用户消息的意图判定全部由 LLM 完成，不依赖任何预定义"咒语"。
    """
    assert not hasattr(chat_module, constant_name), (
        f"F001 原则 1 违反：仍存在意图路由用的硬编码关键词列表 `{constant_name}`。"
        f" 详见 docs/KNOWN_ISSUES.md#005-意图路由依赖-4-套硬编码关键词列表"
    )


# =====================================================================
# 类别 B：关键词降级辅助函数必须不存在（Issue 006）
# =====================================================================

@pytest.mark.parametrize(
    "fn_name",
    [
        "_keyword_fallback",
        "_needs_orchestration",
        "_is_entity_exclusion",
        "_is_entity_extraction",
    ],
)
def test_no_keyword_fallback_function(fn_name):
    """
    F001 原则 2 + 5：任务路由 + 兜底必须由 LLM 完成。

    任何"用关键词列表判断意图/路由"的辅助函数都应不存在。
    LLM 主调用失败时不能回退到关键词匹配，否则等价于硬编码路由始终生效。
    """
    assert not hasattr(chat_module, fn_name), (
        f"F001 原则 2/5 违反：仍存在关键词降级辅助函数 `{fn_name}`。"
        f" 详见 docs/KNOWN_ISSUES.md#006-意图分类失败降级到硬编码关键词"
    )


# =====================================================================
# 类别 C：classify_intent 主调用失败时仍调用 LLM 兜底
# =====================================================================

class _FakeAgnoResponse:
    """模拟 agno Agent.arun 返回的对象，最小满足 .content 属性。"""

    def __init__(self, content: str):
        self.content = content


def _make_agent_class_with_responses(responses):
    """
    构造一个会被 monkeypatch 替换的 Agent 类。
    每次实例化后调用 .arun() 都会按顺序消费 responses 列表中的下一个条目。

    每个条目可以是：
    - 字符串：作为 .content 返回
    - Exception 实例：抛出该异常
    """
    call_log = []

    class _FakeAgent:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

        async def arun(self, message, stream=False):
            call_log.append({"message": message, "kwargs": self.kwargs})
            idx = len(call_log) - 1
            if idx >= len(responses):
                raise RuntimeError(f"Unexpected extra LLM call #{idx + 1}")
            entry = responses[idx]
            if isinstance(entry, BaseException):
                raise entry
            return _FakeAgnoResponse(entry)

    return _FakeAgent, call_log


@pytest.mark.anyio
async def test_classify_intent_falls_back_to_llm_when_main_call_fails(monkeypatch):
    """
    F001 原则 5：主调用 LLM 失败时，兜底方案必须仍是 LLM。

    主调用抛 TimeoutError → 兜底 LLM 调用成功返回 "orchestrate"。
    classify_intent 应返回 "orchestrate"，且 LLM 总共被调用 2 次。
    """
    import asyncio as _asyncio

    fake_agent_cls, call_log = _make_agent_class_with_responses([
        _asyncio.TimeoutError(),
        '{"intent": "orchestrate"}',
    ])

    monkeypatch.setattr("agno.agent.Agent", fake_agent_cls)
    monkeypatch.setattr("llm.create_model", lambda: MagicMock())

    result = await chat_module.classify_intent("帮我生成一个 PDF 报告", context="")

    assert result == "orchestrate", (
        f"F001 原则 5 违反：主 LLM 失败时未由兜底 LLM 完成分类，返回 {result!r}"
    )
    assert len(call_log) == 2, (
        f"期望 LLM 被调用 2 次（主 + 兜底），实际调用 {len(call_log)} 次"
    )


@pytest.mark.anyio
async def test_classify_intent_does_not_call_keyword_matcher(monkeypatch):
    """
    F001 原则 2：任何执行路径都不应回到关键词匹配。

    通过验证 LLM 全部失败时，结果仍是合法意图（而不是依赖关键词列表给出的结果），
    间接确认调用链中没有关键词匹配兜底。
    """
    fake_agent_cls, call_log = _make_agent_class_with_responses([
        RuntimeError("primary llm down"),
        RuntimeError("fallback llm also down"),
    ])

    monkeypatch.setattr("agno.agent.Agent", fake_agent_cls)
    monkeypatch.setattr("llm.create_model", lambda: MagicMock())

    result = await chat_module.classify_intent(
        "帮我抽取实体提取知识图谱", context=""
    )

    assert result == "direct_answer", (
        "F001 原则 2 违反：LLM 全失败时应默认 direct_answer 让 BizAgent 自主响应，"
        f"而不是命中关键词列表后路由到其它意图。实际返回：{result!r}"
    )
    assert len(call_log) == 2, (
        "F001 原则 5 违反：兜底链应只有 LLM 调用（主 + 1 次 LLM 兜底）。"
        f" 实际 LLM 调用次数：{len(call_log)}"
    )


# =====================================================================
# 类别 D：classify_intent 全部 LLM 调用失败时返回默认 direct_answer
# =====================================================================

@pytest.mark.anyio
async def test_classify_intent_all_llm_fail_defaults_to_direct_answer(monkeypatch):
    """
    F001 原则 5：全部 LLM 调用失败时，应返回 'direct_answer' 让 BizAgent 自主响应，
    而不是返回 None 让上游走关键词降级。
    """
    import asyncio as _asyncio

    fake_agent_cls, call_log = _make_agent_class_with_responses([
        _asyncio.TimeoutError(),
        _asyncio.TimeoutError(),
    ])

    monkeypatch.setattr("agno.agent.Agent", fake_agent_cls)
    monkeypatch.setattr("llm.create_model", lambda: MagicMock())

    result = await chat_module.classify_intent("xyz 不是任何关键词的句子", context="")

    assert result == "direct_answer", (
        f"全部 LLM 失败时应默认 'direct_answer'，实际返回 {result!r}"
    )
    assert result is not None, (
        "classify_intent 不应返回 None（旧实现的 None 会触发硬编码降级）"
    )


# =====================================================================
# 类别 E：classify_intent 主调用成功时不调用兜底
# =====================================================================

@pytest.mark.anyio
async def test_classify_intent_no_extra_llm_call_when_primary_succeeds(monkeypatch):
    """
    主调用 LLM 成功返回合法意图时，不应再调用兜底 LLM（避免不必要的开销）。
    """
    fake_agent_cls, call_log = _make_agent_class_with_responses([
        '{"intent": "entity_extraction"}',
    ])

    monkeypatch.setattr("agno.agent.Agent", fake_agent_cls)
    monkeypatch.setattr("llm.create_model", lambda: MagicMock())

    result = await chat_module.classify_intent("从知识库里抽取实体", context="")

    assert result == "entity_extraction"
    assert len(call_log) == 1, (
        f"主调用成功时不应再调用兜底，实际 LLM 调用 {len(call_log)} 次"
    )


# =====================================================================
# 类别 F：classify_intent 返回的意图必须是合法集合
# =====================================================================

@pytest.mark.anyio
async def test_classify_intent_invalid_llm_output_falls_back(monkeypatch):
    """
    主调用 LLM 返回非法 intent 时，应触发 LLM 兜底（而不是直接接受非法值）。
    """
    fake_agent_cls, call_log = _make_agent_class_with_responses([
        '{"intent": "this_is_not_a_valid_intent"}',
        '{"intent": "direct_answer"}',
    ])

    monkeypatch.setattr("agno.agent.Agent", fake_agent_cls)
    monkeypatch.setattr("llm.create_model", lambda: MagicMock())

    result = await chat_module.classify_intent("hello", context="")

    assert result == "direct_answer"
    assert len(call_log) == 2, (
        f"主调用返回非法意图时应调用兜底 LLM，实际 LLM 调用 {len(call_log)} 次"
    )
