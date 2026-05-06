"""
Issue 003 守护测试：实体抽取自适应层 — 正向规则注入。

要求：
- rule_manager 支持 focus_on / strategy 类型规则
- rules_to_prompt_text 必须为 focus_on/strategy 生成正向引导文本
- entity_extractor 的 build_extraction_exclusion_text（或替代函数）必须包含正向规则
- parse_rule_from_feedback 能识别正向规则（如"重点抽取财务指标"）

运行方式:
    cd backend
    .venv/bin/pytest tests/test_adaptive_extraction.py -v
"""
import inspect
import json
from unittest.mock import MagicMock

import pytest

import rule_manager


# ---------------------------------------------------------------------------
# 类别 A：静态断言 — rule_manager 必须支持正向规则类型
# ---------------------------------------------------------------------------

def test_rule_parse_prompt_includes_focus_on():
    """_RULE_PARSE_SYSTEM_PROMPT 必须包含 focus_on 规则类型描述。"""
    src = inspect.getsource(rule_manager)
    assert "focus_on" in src, (
        "rule_manager 必须支持 focus_on 规则类型（正向引导），"
        "当前仅支持 exclude_* 类型"
    )


def test_rule_parse_prompt_includes_strategy():
    """_RULE_PARSE_SYSTEM_PROMPT 必须包含 strategy 规则类型描述。"""
    src = inspect.getsource(rule_manager)
    assert "strategy" in src, (
        "rule_manager 必须支持 strategy 规则类型（抽取策略），"
        "例如'对学术论文关注概念和方法论'"
    )


def test_rules_to_prompt_text_handles_focus_on():
    """rules_to_prompt_text 对 focus_on 规则必须生成正向引导文本，而非排除文本。"""
    rules = [
        {
            "rule_type": "focus_on",
            "description": "重点抽取财务指标类实体",
            "rule_data": {"entity_types": ["metric"], "keywords": ["营收", "利润", "ROE"]},
        }
    ]
    text = rule_manager.rules_to_prompt_text(rules)
    assert isinstance(text, str) and len(text) > 0
    # 正向引导文本中不应只有"排除"语义
    assert any(kw in text for kw in ("重点", "关注", "优先", "抽取", "财务")), (
        f"focus_on 规则应生成正向引导文本，实际: {text!r}"
    )
    assert "排除" not in text, (
        "focus_on 规则生成的文本不应出现'排除'，应为正向引导"
    )


def test_rules_to_prompt_text_handles_strategy():
    """rules_to_prompt_text 对 strategy 规则必须生成策略说明文本。"""
    rules = [
        {
            "rule_type": "strategy",
            "description": "这是学术论文，应优先抽取理论、方法、实验概念",
            "rule_data": {"doc_type": "academic", "priority_types": ["concept"]},
        }
    ]
    text = rule_manager.rules_to_prompt_text(rules)
    assert isinstance(text, str) and len(text) > 0
    assert any(kw in text for kw in ("策略", "学术", "优先", "理论", "方法")), (
        f"strategy 规则应生成策略说明，实际: {text!r}"
    )


# ---------------------------------------------------------------------------
# 类别 B：行为断言 — parse_rule_from_feedback 识别正向规则
# ---------------------------------------------------------------------------

@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_parse_focus_on_rule_from_positive_feedback(monkeypatch):
    """parse_rule_from_feedback 对正向指示（'重点抽取财务指标'）应返回 focus_on 规则。"""
    from llm_invoker import LLMResult

    fake_rule = {
        "rule_type": "focus_on",
        "description": "重点抽取财务指标类实体",
        "rule_data": {"entity_types": ["metric"], "keywords": ["营收", "利润"]},
    }

    def fake_llm(agent, prompt, **kwargs):
        return LLMResult(ok=True, content=json.dumps(fake_rule), attempts=1)

    monkeypatch.setattr("rule_manager.safe_llm_call_sync", fake_llm)
    monkeypatch.setattr("rule_manager.create_model", lambda: MagicMock())
    monkeypatch.setattr("agno.agent.Agent.__init__", lambda self, **kw: None)

    result = rule_manager.parse_rule_from_feedback(
        "这份报告是财务数据，重点帮我抽取营收、利润、ROE 等指标实体", "proj-finance"
    )

    assert result is not None
    assert result.get("rule_type") == "focus_on", (
        f"正向指示应被解析为 focus_on 规则，实际: {result}"
    )


@pytest.mark.anyio
async def test_build_extraction_exclusion_text_includes_positive_rules(monkeypatch):
    """build_extraction_exclusion_text 的输出必须包含正向规则引导，不仅仅是排除列表。"""
    def fake_load_rules(project_id):
        return [
            {
                "rule_type": "focus_on",
                "description": "重点抽取财务指标",
                "rule_data": {"entity_types": ["metric"]},
            },
            {
                "rule_type": "exclude_entity_type",
                "description": "不抽取章节标题",
                "rule_data": {"patterns": ["章节标题"]},
            },
        ]

    monkeypatch.setattr(rule_manager, "load_rules", fake_load_rules)

    text = rule_manager.build_extraction_exclusion_text("proj-test")

    assert "财务" in text or "重点" in text or "focus" in text.lower(), (
        f"build_extraction_exclusion_text 输出必须包含 focus_on 规则的正向引导，实际: {text[:300]}"
    )
    assert "章节标题" in text or "排除" in text, (
        "同时也必须包含 exclude 规则内容"
    )
