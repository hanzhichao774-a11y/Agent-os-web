"""
Issue 012 守护测试：项目有学习规则时，entity_extract Skill 不得命中缓存。

根因：entity_extract 的 global_cache 以"该 source 在 DB 中已有实体"为依据，
不感知 extraction_rules 变更。规则设置后立即再次抽取，LLM 不会被调用，新规则失效。

修复要求：
- entity_extract Skill 的 run() 在构建 global_cache 前，
  必须调用 rule_manager.load_rules(project_id)
- 若规则非空，则 global_cache 必须被清空（强制重新调用 LLM）
- 若规则为空，缓存行为保持不变（不应引起 regression）

运行方式:
    cd backend
    .venv/bin/pytest tests/test_cache_invalidation_on_rules.py -v
"""
import inspect
import sys
import os

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import importlib


def _load_skill():
    """动态加载 skills/entity_extract.py（避免 sys.path 问题）。"""
    skill_path = os.path.join(os.path.dirname(__file__), "..", "skills", "entity_extract.py")
    spec = importlib.util.spec_from_file_location("entity_extract_skill", skill_path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# ---------------------------------------------------------------------------
# 类别 A：静态断言
# ---------------------------------------------------------------------------

def test_skill_run_calls_load_rules():
    """entity_extract Skill 的 run() 必须调用 rule_manager.load_rules。"""
    mod = _load_skill()
    src = inspect.getsource(mod.run)
    assert "load_rules" in src or "rule_manager" in src, (
        "entity_extract Skill 的 run() 必须调用 rule_manager.load_rules，"
        "否则无法检测规则变更来决定是否使用缓存"
    )


def test_skill_clears_cache_when_rules_exist_code():
    """run() 源码中必须有'规则非空时清空/跳过 global_cache'的逻辑。"""
    mod = _load_skill()
    src = inspect.getsource(mod.run)
    # 关键行为：有规则时清空 global_cache 或设为空 dict
    has_cache_bypass = (
        "global_cache = {}" in src
        or "global_cache.clear()" in src
        or "if rules" in src
        or "rules_exist" in src
        or "has_rules" in src
    )
    assert has_cache_bypass, (
        "entity_extract Skill run() 中必须包含"
        " '有规则时清空 global_cache' 的代码分支"
    )


# ---------------------------------------------------------------------------
# 类别 B：行为断言
# ---------------------------------------------------------------------------

@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_cache_bypassed_when_project_has_rules(monkeypatch, tmp_path):
    """当项目有规则时，即使数据库中已有实体，也必须重新调用 LLM（不走缓存）。"""
    import rule_manager
    from entity_extractor import extract_entities_sync

    # 模拟：项目有规则
    monkeypatch.setattr(rule_manager, "load_rules", lambda pid: [
        {"rule_type": "exclude_entity_type", "description": "不抽取章节标题", "rule_data": {}}
    ])

    extract_calls = []

    # 模拟 extract_entities_sync，记录是否被调用
    def fake_extract(text, project_id, task_id=None, source_name=""):
        extract_calls.append(source_name)
        return {"status": "ok", "entities_count": 5, "relations_count": 3, "source": source_name}

    # 模拟数据库已有该文档的实体（正常情况下会命中缓存）
    import sqlite3
    db_path = tmp_path / "test.db"
    conn = sqlite3.connect(db_path)
    conn.execute("CREATE TABLE entities (id TEXT, project_id TEXT, source TEXT, excluded INTEGER DEFAULT 0)")
    conn.execute("CREATE TABLE entity_relations (id TEXT, project_id TEXT, source TEXT)")
    conn.execute("INSERT INTO entities VALUES ('e1', 'proj-rules', 'doc.md', 0)")
    conn.execute("INSERT INTO entities VALUES ('e2', 'proj-rules', 'doc.md', 0)")
    conn.commit()
    conn.close()

    import asyncio
    from pathlib import Path

    # 创建假文档
    doc_dir = tmp_path / "docs"
    doc_dir.mkdir()
    (doc_dir / "doc.md").write_text("这是一份测试文档，包含 AI 算法服务、章节标题等内容。")

    # Monkeypatch 相关依赖
    monkeypatch.setattr("database.PROJECTS_DB", db_path)

    import database
    # Re-init DB to create all tables
    orig_init = database._init_projects_db

    def patched_get_conn():
        import sqlite3 as _sq
        c = _sq.connect(db_path)
        c.row_factory = _sq.Row
        return c

    monkeypatch.setattr("database._get_projects_conn", patched_get_conn)

    # Monkeypatch KNOWLEDGE_DOCS_DIR
    import config
    monkeypatch.setattr(config, "KNOWLEDGE_DOCS_DIR", doc_dir)

    # Monkeypatch extract_entities_sync
    monkeypatch.setattr("entity_extractor.extract_entities_sync", fake_extract)

    # Monkeypatch doc_parser
    import types
    fake_doc_parser = types.ModuleType("doc_parser")
    fake_doc_parser.read_document_text = lambda fpath: "这是一份测试文档内容"
    sys.modules["doc_parser"] = fake_doc_parser

    mod = _load_skill()

    await asyncio.to_thread(
        mod.run, "proj-rules", "", ""
    )

    assert extract_calls, (
        "项目有规则时，即使数据库已有实体（缓存命中），"
        "extract_entities_sync 也必须被调用"
    )


@pytest.mark.anyio
async def test_cache_used_when_project_has_no_rules(monkeypatch, tmp_path):
    """当项目没有规则时，缓存行为保持不变（不应 regression）。"""
    import rule_manager

    # 模拟：项目无规则
    monkeypatch.setattr(rule_manager, "load_rules", lambda pid: [])

    extract_calls = []

    def fake_extract(text, project_id, task_id=None, source_name=""):
        extract_calls.append(source_name)
        return {"status": "ok", "entities_count": 5, "relations_count": 3}

    # 数据库已有实体
    import sqlite3
    db_path = tmp_path / "test_no_rules.db"
    conn = sqlite3.connect(db_path)
    conn.execute("CREATE TABLE entities (id TEXT, project_id TEXT, source TEXT, excluded INTEGER DEFAULT 0, task_id TEXT, name TEXT, type TEXT, description TEXT, created_at REAL)")
    conn.execute("CREATE TABLE entity_relations (id TEXT, project_id TEXT, source TEXT, task_id TEXT, source_entity_id TEXT, target_entity_id TEXT, relation TEXT, created_at REAL)")
    conn.execute("INSERT INTO entities VALUES ('e1', 'proj-norules', 'doc.md', 0, NULL, 'E1', 'concept', '', 0)")
    conn.commit()
    conn.close()

    doc_dir = tmp_path / "docs2"
    doc_dir.mkdir()
    (doc_dir / "doc.md").write_text("测试内容")

    import config
    monkeypatch.setattr(config, "KNOWLEDGE_DOCS_DIR", doc_dir)

    def patched_get_conn():
        import sqlite3 as _sq
        c = _sq.connect(db_path)
        c.row_factory = _sq.Row
        return c

    monkeypatch.setattr("database._get_projects_conn", patched_get_conn)

    import types
    fake_doc_parser = types.ModuleType("doc_parser")
    fake_doc_parser.read_document_text = lambda fpath: "测试内容"
    sys.modules["doc_parser"] = fake_doc_parser

    monkeypatch.setattr("entity_extractor.extract_entities_sync", fake_extract)

    mod = _load_skill()

    await asyncio.to_thread(
        mod.run, "proj-norules", "", ""
    )

    # 无规则时，应命中缓存，不调用 extract_entities_sync
    assert not extract_calls, (
        "项目无规则时，数据库已有实体应命中缓存，"
        "不应调用 extract_entities_sync（避免 regression）"
    )


import asyncio
