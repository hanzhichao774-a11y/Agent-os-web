"""
规则学习机制（extraction_rules 表 + rule_manager 模块）守护测试。

对应 docs/KNOWN_ISSUES.md Issue 002，落实 F001 原则 4：
- extraction_rules 数据库表必须存在
- parse_rule_from_feedback 必须通过 LLM 解析用户反馈为结构化规则
- save_rule 必须将规则持久化到 extraction_rules 表
- load_rules 必须从 extraction_rules 表加载项目规则
- 规则必须包含 rule_type / description / rule_data / source_message 字段

运行方式:
    cd backend
    .venv/bin/pytest tests/test_rule_manager.py -v
"""
import json
import inspect
import sqlite3
import tempfile
from pathlib import Path
from unittest.mock import MagicMock

import pytest

# ---------------------------------------------------------------------------
# 类别 A：静态断言 — 模块与数据库结构必须存在
# ---------------------------------------------------------------------------

def test_rule_manager_module_exists():
    """rule_manager.py 模块必须存在并可导入。"""
    try:
        import rule_manager
    except ImportError as e:
        pytest.fail(f"rule_manager 模块必须存在: {e}")


def test_extraction_rules_table_exists():
    """extraction_rules 表必须在数据库 schema 中被创建（CREATE TABLE IF NOT EXISTS）。"""
    import database
    src = inspect.getsource(database._init_projects_db)
    assert "extraction_rules" in src, (
        "database._init_projects_db 必须创建 extraction_rules 表，"
        " 当前未找到该表名"
    )


def test_extraction_rules_has_required_columns():
    """extraction_rules 表必须包含 project_id/rule_type/description/rule_data/source_message 列。"""
    import database
    src = inspect.getsource(database._init_projects_db)
    required_cols = ["project_id", "rule_type", "description", "rule_data", "source_message"]
    for col in required_cols:
        assert col in src, (
            f"extraction_rules 表必须包含 '{col}' 列，当前 schema 中未找到"
        )


def test_rule_manager_has_required_functions():
    """rule_manager 必须提供 parse_rule_from_feedback / save_rule / load_rules 三个函数。"""
    import rule_manager
    for fn_name in ("parse_rule_from_feedback", "save_rule", "load_rules"):
        assert hasattr(rule_manager, fn_name), (
            f"rule_manager 必须提供 '{fn_name}' 函数"
        )


def test_parse_rule_from_feedback_calls_llm():
    """parse_rule_from_feedback 必须通过 safe_llm_call_sync 调用 LLM，不允许正则或关键词判断。"""
    import rule_manager
    fn = getattr(rule_manager, "parse_rule_from_feedback", None)
    assert fn is not None
    src = inspect.getsource(fn)
    assert "safe_llm_call_sync" in src or "safe_llm_call" in src, (
        "parse_rule_from_feedback 必须使用 safe_llm_call_sync 解析用户反馈"
    )
    assert "re.findall" not in src, (
        "parse_rule_from_feedback 不允许使用正则，规则理解必须由 LLM 完成"
    )


# ---------------------------------------------------------------------------
# 类别 B：行为断言 — parse_rule_from_feedback 正确解析反馈
# ---------------------------------------------------------------------------

@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_parse_rule_returns_structured_rule(monkeypatch):
    """parse_rule_from_feedback 应返回包含 rule_type/description/rule_data 的 dict。"""
    from llm_invoker import LLMResult
    import rule_manager

    fake_rule = {
        "rule_type": "exclude_entity_type",
        "description": "不抽取章节标题作为实体",
        "rule_data": {"patterns": ["章节标题", "一级标题", "二级标题"], "entity_types": ["concept"]},
    }

    def fake_llm(agent, prompt, **kwargs):
        return LLMResult(ok=True, content=json.dumps(fake_rule), attempts=1)

    monkeypatch.setattr("rule_manager.safe_llm_call_sync", fake_llm)
    monkeypatch.setattr("rule_manager.create_model", lambda: MagicMock())
    monkeypatch.setattr("agno.agent.Agent.__init__", lambda self, **kw: None)

    result = rule_manager.parse_rule_from_feedback("不要把章节标题抽成实体", "proj-001")

    assert isinstance(result, dict), f"必须返回 dict，实际: {result!r}"
    assert result.get("rule_type") == "exclude_entity_type", (
        f"rule_type 应为 'exclude_entity_type'，实际: {result}"
    )
    assert "description" in result, "必须包含 description 字段"
    assert "rule_data" in result, "必须包含 rule_data 字段"


@pytest.mark.anyio
async def test_parse_rule_handles_llm_failure(monkeypatch):
    """LLM 解析失败时，parse_rule_from_feedback 应返回 None 或含 error 的 dict，不抛出异常。"""
    from llm_invoker import LLMCallError
    import rule_manager

    def fake_fail(agent, prompt, **kwargs):
        raise LLMCallError("timeout", attempts=3)

    monkeypatch.setattr("rule_manager.safe_llm_call_sync", fake_fail)
    monkeypatch.setattr("rule_manager.create_model", lambda: MagicMock())
    monkeypatch.setattr("agno.agent.Agent.__init__", lambda self, **kw: None)

    result = rule_manager.parse_rule_from_feedback("不要抽取章节标题", "proj-001")

    assert result is None or isinstance(result, dict), (
        "LLM 失败时必须返回 None 或 dict，不能抛出异常"
    )
    if isinstance(result, dict):
        assert result.get("error") is not None


# ---------------------------------------------------------------------------
# 类别 C：行为断言 — save_rule + load_rules 数据库读写
# ---------------------------------------------------------------------------

@pytest.fixture
def temp_db(tmp_path, monkeypatch):
    """使用临时数据库文件，不影响生产数据。"""
    db_path = tmp_path / "test_projects.db"
    monkeypatch.setattr("database.PROJECTS_DB", db_path)
    # 重新初始化数据库（会创建 extraction_rules 表）
    import database
    database._init_projects_db()
    return db_path


def test_save_and_load_rule(temp_db):
    """save_rule 保存规则后，load_rules 必须能按 project_id 检索到。"""
    import rule_manager

    rule = {
        "rule_type": "exclude_entity_type",
        "description": "不抽取章节标题",
        "rule_data": {"patterns": ["章节标题"]},
        "source_message": "不要把章节标题抽成实体",
    }

    rule_manager.save_rule("proj-test", rule)
    rules = rule_manager.load_rules("proj-test")

    assert len(rules) >= 1, "save 后 load_rules 必须至少返回 1 条规则"
    saved = rules[0]
    assert saved["rule_type"] == "exclude_entity_type"
    assert "章节标题" in saved["description"]


def test_load_rules_returns_empty_for_new_project(temp_db):
    """没有规则的新项目 load_rules 应返回空列表，不报错。"""
    import rule_manager
    rules = rule_manager.load_rules("brand-new-project")
    assert isinstance(rules, list), "load_rules 必须返回 list"
    assert len(rules) == 0, f"新项目应返回空列表，实际: {rules}"


def test_load_rules_isolates_by_project(temp_db):
    """load_rules 只返回指定 project_id 的规则，不混入其他项目的规则。"""
    import rule_manager

    rule_manager.save_rule("proj-A", {
        "rule_type": "exclude_entity_type",
        "description": "A 项目规则",
        "rule_data": {},
        "source_message": "test",
    })
    rule_manager.save_rule("proj-B", {
        "rule_type": "exclude_source",
        "description": "B 项目规则",
        "rule_data": {},
        "source_message": "test",
    })

    rules_a = rule_manager.load_rules("proj-A")
    rules_b = rule_manager.load_rules("proj-B")

    assert all(r.get("description") == "A 项目规则" for r in rules_a), (
        "proj-A 不应包含 proj-B 的规则"
    )
    assert all(r.get("description") == "B 项目规则" for r in rules_b), (
        "proj-B 不应包含 proj-A 的规则"
    )


def test_rules_to_prompt_text_function_exists():
    """rule_manager 必须提供 rules_to_prompt_text(rules) 函数，将规则列表转为 prompt 插入文本。"""
    import rule_manager
    assert hasattr(rule_manager, "rules_to_prompt_text"), (
        "rule_manager 必须提供 rules_to_prompt_text(rules) 函数"
    )


def test_rules_to_prompt_text_formats_correctly():
    """rules_to_prompt_text 应将 exclude_entity_type 规则转为可读的中文列表。"""
    import rule_manager

    rules = [
        {
            "rule_type": "exclude_entity_type",
            "description": "不抽取章节标题",
            "rule_data": {"patterns": ["章节标题", "页码"]},
        }
    ]
    text = rule_manager.rules_to_prompt_text(rules)
    assert isinstance(text, str), "必须返回字符串"
    assert len(text) > 0, "有规则时不应返回空字符串"
    assert "章节标题" in text or "排除" in text or "不抽取" in text, (
        f"生成的 prompt 文本应包含规则内容，实际: {text!r}"
    )
