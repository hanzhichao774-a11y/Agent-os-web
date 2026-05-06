"""
rule_learning 意图识别与处理守护测试（Issue 002）。

要求：
- _CLASSIFY_PROMPT 必须包含 rule_learning 意图分类
- _VALID_INTENTS 必须包含 "rule_learning"
- orchestrator_chat 路由中 rule_learning 必须调用 rule_manager.parse_rule_from_feedback
- 处理后必须保存规则并返回用户友好的确认消息

运行方式:
    cd backend
    .venv/bin/pytest tests/test_rule_learning_intent.py -v
"""
import inspect
import json
from unittest.mock import MagicMock

import pytest

import routes.chat as chat_module


@pytest.fixture
def anyio_backend():
    return "asyncio"


# ---------------------------------------------------------------------------
# 类别 A：静态断言 — rule_learning 必须存在于意图分类系统中
# ---------------------------------------------------------------------------

def test_classify_prompt_includes_rule_learning():
    """_CLASSIFY_PROMPT 必须包含 rule_learning 意图描述，否则 LLM 无法分类规则学习消息。"""
    assert "rule_learning" in chat_module._CLASSIFY_PROMPT, (
        "F001 原则 4：_CLASSIFY_PROMPT 必须包含 rule_learning 意图，"
        " 当前 prompt 缺少该意图描述"
    )


def test_valid_intents_includes_rule_learning():
    """_VALID_INTENTS 必须包含 'rule_learning'，否则 LLM 返回该意图会被当作未知意图丢弃。"""
    assert "rule_learning" in chat_module._VALID_INTENTS, (
        "_VALID_INTENTS 必须包含 'rule_learning'，"
        f"当前: {chat_module._VALID_INTENTS}"
    )


def test_rule_learning_handler_exists_in_routing():
    """orchestrator_chat 路由中必须有处理 rule_learning 意图的代码路径。"""
    src = inspect.getsource(chat_module)
    assert "rule_learning" in src, (
        "routes.chat 中必须有 rule_learning 意图的处理路径"
    )
    assert "rule_manager" in src or "parse_rule_from_feedback" in src, (
        "rule_learning 处理路径必须调用 rule_manager.parse_rule_from_feedback"
    )


def test_rule_learning_handler_saves_rule():
    """rule_learning 处理路径必须调用 save_rule 将规则持久化。"""
    src = inspect.getsource(chat_module)
    assert "save_rule" in src, (
        "rule_learning 处理路径必须调用 rule_manager.save_rule 持久化规则"
    )


# ---------------------------------------------------------------------------
# 类别 B：行为断言 — _run_rule_learning_sync 正确执行
# ---------------------------------------------------------------------------

def test_run_rule_learning_sync_exists():
    """_run_rule_learning_sync 函数必须存在。"""
    assert hasattr(chat_module, "_run_rule_learning_sync"), (
        "routes.chat 必须提供 _run_rule_learning_sync(project_id, message) 函数"
    )


@pytest.mark.anyio
async def test_run_rule_learning_calls_parse_and_save(monkeypatch):
    """_run_rule_learning_sync 必须调用 parse_rule_from_feedback 并在成功时调用 save_rule。"""
    import rule_manager as _rm

    parse_calls = []
    save_calls = []

    def fake_parse(message, project_id):
        parse_calls.append(message)
        return {
            "rule_type": "exclude_entity_type",
            "description": "不抽取章节标题",
            "rule_data": {"patterns": ["章节标题"]},
        }

    def fake_save(project_id, rule):
        save_calls.append((project_id, rule))
        return "rule-123"

    monkeypatch.setattr(_rm, "parse_rule_from_feedback", fake_parse)
    monkeypatch.setattr(_rm, "save_rule", fake_save)

    result = chat_module._run_rule_learning_sync(
        "proj-001", "不要把章节标题抽成实体"
    )

    assert parse_calls, "必须调用 parse_rule_from_feedback"
    assert save_calls, "规则解析成功后必须调用 save_rule"
    assert isinstance(result, str), "必须返回字符串确认消息"
    assert any(kw in result for kw in ("已记录", "规则", "学习", "成功", "排除", "标题")), (
        f"确认消息应描述学到的规则内容，实际: {result!r}"
    )


@pytest.mark.anyio
async def test_run_rule_learning_handles_parse_failure(monkeypatch):
    """parse_rule_from_feedback 返回 None 时，_run_rule_learning_sync 应给出友好提示，不保存规则。"""
    import rule_manager as _rm

    save_calls = []

    monkeypatch.setattr(_rm, "parse_rule_from_feedback", lambda msg, pid: None)
    monkeypatch.setattr(_rm, "save_rule", lambda pid, r: save_calls.append(r) or "")

    result = chat_module._run_rule_learning_sync("proj-001", "balalbala 模糊输入")

    assert not save_calls, "LLM 解析失败（返回 None）时不应保存规则"
    assert isinstance(result, str)
    assert any(kw in result for kw in ("无法", "理解", "失败", "重试", "请")), (
        f"解析失败时应给出有用提示，实际: {result!r}"
    )
