"""
实体抽取自适应规则注入守护测试（Issue 002 + 003）。

要求：
- extract_entities_sync 必须调用 rule_manager.load_rules 加载项目规则
- 加载的规则必须注入到 LLM prompt 中（通过 build_extraction_exclusion_text 或类似机制）
- entity_extract Skill 的 run() 也必须在抽取前加载规则并注入
- 规则注入不通过正则或硬编码字符串，而是通过 rule_manager.rules_to_prompt_text

运行方式:
    cd backend
    .venv/bin/pytest tests/test_extraction_applies_rules.py -v
"""
import inspect
from unittest.mock import MagicMock

import pytest

import entity_extractor


def test_extract_entities_sync_calls_load_rules():
    """extract_entities_sync 必须调用 rule_manager.load_rules 加载规则，才能让规则生效。"""
    src = inspect.getsource(entity_extractor.extract_entities_sync)
    assert "load_rules" in src or "build_extraction_exclusion_text" in src or "rule_manager" in src, (
        "extract_entities_sync 必须调用 rule_manager.load_rules (或 build_extraction_exclusion_text) "
        "以加载项目规则，当前实现未找到相关调用"
    )


def test_extract_entities_system_prompt_uses_rules_text():
    """extract_entities_sync 构建 system prompt 时必须包含规则文本，不能只有已排除名单。"""
    src = inspect.getsource(entity_extractor.extract_entities_sync)
    # 必须有某种形式的规则注入，不是简单的 excluded_str
    has_rules_injection = (
        "build_extraction_exclusion_text" in src
        or "rules_to_prompt_text" in src
        or "load_rules" in src
    )
    assert has_rules_injection, (
        "extract_entities_sync 必须通过 rule_manager 将规则注入 system prompt"
    )


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_extraction_uses_rules_from_db(monkeypatch):
    """当项目有学习规则时，extract_entities_sync 的 LLM prompt 必须包含规则内容。"""
    import rule_manager

    captured_instructions = []

    # Mock load_rules 返回一条规则
    def fake_load_rules(project_id):
        return [{
            "rule_type": "exclude_entity_type",
            "description": "不抽取章节标题",
            "rule_data": {"patterns": ["章节标题"]},
        }]

    # Mock Agent.__init__ 捕获 instructions 参数
    def fake_agent_init(self, **kw):
        instrs = kw.get("instructions", [])
        if instrs:
            captured_instructions.extend(instrs)

    # Mock safe_llm_call_sync 正常返回
    from llm_invoker import LLMResult

    def fake_llm_call(agent, prompt_text, **kwargs):
        return LLMResult(ok=True, content='{"entities": [], "relations": []}', attempts=1)

    monkeypatch.setattr(rule_manager, "load_rules", fake_load_rules)
    monkeypatch.setattr("entity_extractor.safe_llm_call_sync", fake_llm_call)
    monkeypatch.setattr("entity_extractor.create_model", lambda: MagicMock())
    monkeypatch.setattr("agno.agent.Agent.__init__", fake_agent_init)
    # Mock _get_excluded_names to return empty (for excluded names)
    monkeypatch.setattr("entity_extractor._get_excluded_names", lambda pid: [])

    import asyncio
    await asyncio.to_thread(
        entity_extractor.extract_entities_sync,
        "文本内容",
        "proj-test",
    )

    # Agent 的 instructions 中应包含规则内容
    combined = " ".join(str(p) for p in captured_instructions)
    assert "章节标题" in combined or "不抽取" in combined or "排除" in combined, (
        f"extract_entities_sync 的 LLM instructions 中必须包含规则内容（章节标题/不抽取/排除），"
        f"实际内容: {combined[:300]}"
    )


@pytest.mark.anyio
async def test_extraction_without_rules_uses_fallback(monkeypatch):
    """没有学习规则时，抽取仍然正常运行（不报错，使用默认排除列表）。"""
    import rule_manager

    monkeypatch.setattr(rule_manager, "load_rules", lambda pid: [])

    from llm_invoker import LLMResult

    def fake_llm_call(agent, prompt_text, **kwargs):
        return LLMResult(ok=True, content='{"entities": [], "relations": []}', attempts=1)

    monkeypatch.setattr("entity_extractor.safe_llm_call_sync", fake_llm_call)
    monkeypatch.setattr("entity_extractor.create_model", lambda: MagicMock())
    monkeypatch.setattr("agno.agent.Agent.__init__", lambda self, **kw: None)
    monkeypatch.setattr("entity_extractor._get_excluded_names", lambda pid: [])

    import asyncio
    result = await asyncio.to_thread(
        entity_extractor.extract_entities_sync,
        "文本内容",
        "proj-empty",
    )

    assert isinstance(result, dict), "无规则时 extract_entities_sync 也必须返回 dict"
    assert "status" in result, f"返回 dict 必须包含 status 字段，实际: {result}"
