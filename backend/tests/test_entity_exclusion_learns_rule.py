"""
Issue 004 守护测试：entity_exclusion 排除操作必须同时学习规则。

要求：
- _run_entity_exclusion_sync 执行排除时，必须调用 rule_manager.save_rule
- 保存的规则类型应为 exclude_source（关联到被排除的来源文档）
- 排除恢复操作（restore）时不需要保存规则
- 规则保存后，下次调用 entity_extractor 时应能加载到该规则

运行方式:
    cd backend
    .venv/bin/pytest tests/test_entity_exclusion_learns_rule.py -v
"""
import inspect
from unittest.mock import MagicMock

import pytest

import routes.chat as chat_module


def test_exclusion_sync_calls_save_rule_on_exclude():
    """_run_entity_exclusion_sync 在排除实体时必须调用 rule_manager.save_rule 记录规则。"""
    src = inspect.getsource(chat_module._run_entity_exclusion_sync)
    assert "save_rule" in src or "rule_manager" in src, (
        "_run_entity_exclusion_sync 在排除实体后必须调用 rule_manager.save_rule，"
        "确保下次抽取不再重复抽取该来源"
    )


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_exclusion_saves_exclude_source_rule(monkeypatch):
    """排除来源实体时，必须保存一条 exclude_source 规则。"""
    import rule_manager as _rm
    from entity_extractor import list_entities, exclude_entity

    saved_rules = []

    # Fake entities with a source
    fake_entities = [
        {"id": "e1", "name": "北京热力", "source": "report.pdf", "excluded": 0},
        {"id": "e2", "name": "燃气供应", "source": "report.pdf", "excluded": 0},
    ]

    # Mock intent parsing → action=exclude, source=report.pdf
    def fake_parse_intent(message, context, project_id):
        return {"action": "exclude", "source": "report.pdf"}

    # Mock list_entities (imported inside function body from entity_extractor)
    import entity_extractor as _ee
    monkeypatch.setattr(_ee, "list_entities", lambda pid: fake_entities)

    # Mock exclude_entity (no-op)
    exclude_calls = []
    monkeypatch.setattr(_ee, "exclude_entity", lambda eid, flag: exclude_calls.append(eid))

    # Mock _parse_exclusion_intent
    monkeypatch.setattr(chat_module, "_parse_exclusion_intent", fake_parse_intent)

    # Mock rule_manager.save_rule
    monkeypatch.setattr(_rm, "save_rule", lambda pid, rule: saved_rules.append(rule) or "r-001")

    import asyncio
    result = await asyncio.to_thread(
        chat_module._run_entity_exclusion_sync, "proj-001", "排除 report.pdf 的实体"
    )

    assert saved_rules, (
        "排除操作后 rule_manager.save_rule 必须被调用，以记录 exclude_source 规则"
    )
    rule = saved_rules[0]
    assert rule.get("rule_type") == "exclude_source", (
        f"保存的规则类型应为 'exclude_source'，实际: {rule}"
    )
    sources = rule.get("rule_data", {}).get("sources", [])
    assert any("report.pdf" in s for s in sources), (
        f"exclude_source 规则的 rule_data.sources 必须包含 'report.pdf'，实际: {sources}"
    )


@pytest.mark.anyio
async def test_restore_does_not_save_rule(monkeypatch):
    """恢复（restore）操作不应保存规则，只需取消 excluded 标记。"""
    import rule_manager as _rm

    saved_rules = []

    fake_entities = [
        {"id": "e1", "name": "实体1", "source": "doc.md", "excluded": 1},
    ]

    def fake_parse_intent(message, context, project_id):
        return {"action": "restore", "source": "doc.md"}

    import entity_extractor as _ee
    monkeypatch.setattr(_ee, "list_entities", lambda pid: fake_entities)
    monkeypatch.setattr(_ee, "exclude_entity", lambda eid, flag: None)
    monkeypatch.setattr(chat_module, "_parse_exclusion_intent", fake_parse_intent)
    monkeypatch.setattr(_rm, "save_rule", lambda pid, rule: saved_rules.append(rule) or "")

    import asyncio
    await asyncio.to_thread(
        chat_module._run_entity_exclusion_sync, "proj-001", "恢复 doc.md 的实体"
    )

    assert not saved_rules, (
        "恢复（restore）操作不应保存规则，只有排除（exclude）时才需要学习"
    )
