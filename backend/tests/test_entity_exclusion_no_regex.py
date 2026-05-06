"""
entity_exclusion 意图分支必须通过 LLM 解析用户意图，禁止硬编码正则或关键词列表。

对应 docs/KNOWN_ISSUES.md Issue 008，落实 F001 原则 1（意图理解必须由大模型完成）：
- _run_entity_exclusion_sync 不允许出现 is_restore = any(kw in ... 的关键词判断
- _run_entity_exclusion_sync 不允许调用 _extract_doc_name（正则匹配）
- 必须通过 _parse_exclusion_intent 调用 LLM → 返回 {action, source}
- entity_exclude Skill 内部也不允许嵌套正则或 `any(kw in instruction for kw in`

运行方式:
    cd backend
    .venv/bin/pytest tests/test_entity_exclusion_no_regex.py -v
"""
import inspect
import json

import pytest

import routes.chat as chat_module


@pytest.fixture
def anyio_backend():
    return "asyncio"


# ---------------------------------------------------------------------------
# 类别 A：静态断言 — 正则 / 关键词列表禁止出现在 entity_exclusion 路径
# ---------------------------------------------------------------------------

def test_run_entity_exclusion_sync_no_keyword_list():
    """_run_entity_exclusion_sync 内部不应存在 is_restore = any(kw in ... 关键词列表。

    旧实现用 5 个固定中文词判断"恢复 vs 排除"，违反 F001 原则 1。
    """
    fn = getattr(chat_module, "_run_entity_exclusion_sync", None)
    assert fn is not None, "_run_entity_exclusion_sync 函数必须存在"

    src = inspect.getsource(fn)
    assert "is_restore = any(kw" not in src, (
        "F001 原则 1 违反：_run_entity_exclusion_sync 仍在通过关键词列表判断 is_restore，"
        " 应改为 LLM 解析用户意图"
    )


def test_run_entity_exclusion_sync_no_regex_extraction():
    """_run_entity_exclusion_sync 不应通过正则（或 _extract_doc_name）提取文档名。

    旧实现调用 _extract_doc_name（含 3 条正则）提取文件名，违反 F001 原则 1。
    """
    fn = getattr(chat_module, "_run_entity_exclusion_sync", None)
    assert fn is not None

    src = inspect.getsource(fn)
    assert "_extract_doc_name" not in src, (
        "F001 原则 1 违反：_run_entity_exclusion_sync 仍调用 _extract_doc_name（正则匹配），"
        " entity_exclusion 路径内文档名必须通过 LLM 解析"
    )
    # 允许正则出现在其他函数，此处只约束 entity_exclusion 路径
    assert "re.findall" not in src, (
        "_run_entity_exclusion_sync 内部不应出现 re.findall，"
        " 文档名提取应交给 LLM"
    )


def test_parse_exclusion_intent_function_exists():
    """必须有 _parse_exclusion_intent 函数作为 LLM 意图解析的抽象层。"""
    assert hasattr(chat_module, "_parse_exclusion_intent"), (
        "routes.chat 必须提供 _parse_exclusion_intent(message, context, project_id) 函数，"
        " 用 LLM 解析排除/恢复意图和文档名"
    )


def test_parse_exclusion_intent_calls_safe_llm():
    """_parse_exclusion_intent 必须通过 safe_llm_call_sync 调用 LLM，而非使用正则。"""
    fn = getattr(chat_module, "_parse_exclusion_intent", None)
    assert fn is not None

    src = inspect.getsource(fn)
    assert "safe_llm_call_sync" in src or "safe_llm_call" in src, (
        "_parse_exclusion_intent 必须使用 safe_llm_call_sync / safe_llm_call 调用 LLM"
    )
    assert "re.findall" not in src, (
        "_parse_exclusion_intent 不允许使用 re.findall，意图解析应完全由 LLM 完成"
    )
    assert "any(kw" not in src, (
        "_parse_exclusion_intent 不允许使用关键词列表，意图解析应完全由 LLM 完成"
    )


# ---------------------------------------------------------------------------
# 类别 B：静态断言 — entity_exclude Skill 内不嵌套正则
# ---------------------------------------------------------------------------

def test_entity_exclude_skill_no_embedded_regex():
    """skills/entity_exclude.py 内部不应存在 re.findall / re.match 等正则调用。

    旧模板的 entity_exclude 内嵌 3 条正则提取文档名，违反 F001 原则 1。
    """
    from pathlib import Path
    skill_path = Path(__file__).parent.parent / "skills" / "entity_exclude.py"
    if not skill_path.exists():
        pytest.skip("skills/entity_exclude.py 尚未生成，切片 4 完成后此测试应通过")

    src = skill_path.read_text(encoding="utf-8")
    assert "re.findall" not in src, (
        "entity_exclude.py 内不允许使用 re.findall，"
        " 文档名提取必须通过 LLM 完成"
    )
    assert "any(kw in" not in src, (
        "entity_exclude.py 内不允许使用关键词列表做意图判断，"
        " 排除/恢复意图必须通过 LLM 完成"
    )
    assert "is_restore = any(" not in src, (
        "entity_exclude.py 内不允许出现 is_restore = any(... 硬编码关键词判断"
    )


# ---------------------------------------------------------------------------
# 类别 C：行为断言 — _parse_exclusion_intent 正确解析意图
# ---------------------------------------------------------------------------

@pytest.mark.anyio
async def test_parse_exclusion_intent_returns_exclude_action(monkeypatch):
    """'排除 test.md 的实体' → action='exclude', source='test.md'"""
    from llm_invoker import LLMResult

    def fake_llm(agent, prompt, **kwargs):
        return LLMResult(
            ok=True,
            content=json.dumps({"action": "exclude", "source": "test.md"}),
            attempts=1,
        )

    monkeypatch.setattr("routes.chat.safe_llm_call_sync", fake_llm)
    monkeypatch.setattr("routes.chat.create_model", lambda: __import__("unittest.mock", fromlist=["MagicMock"]).MagicMock())
    monkeypatch.setattr("agno.agent.Agent.__init__", lambda self, **kw: None)

    fn = chat_module._parse_exclusion_intent
    result = fn("排除 test.md 的实体", "", "proj-001")

    assert isinstance(result, dict), f"必须返回 dict，实际: {result!r}"
    assert result.get("action") == "exclude", f"action 应为 'exclude'，实际: {result}"
    assert result.get("source") == "test.md", f"source 应为 'test.md'，实际: {result}"


@pytest.mark.anyio
async def test_parse_exclusion_intent_returns_restore_action(monkeypatch):
    """'恢复 company.pdf 中被排除的实体' → action='restore', source='company.pdf'"""
    from llm_invoker import LLMResult

    def fake_llm(agent, prompt, **kwargs):
        return LLMResult(
            ok=True,
            content=json.dumps({"action": "restore", "source": "company.pdf"}),
            attempts=1,
        )

    monkeypatch.setattr("routes.chat.safe_llm_call_sync", fake_llm)
    monkeypatch.setattr("routes.chat.create_model", lambda: __import__("unittest.mock", fromlist=["MagicMock"]).MagicMock())
    monkeypatch.setattr("agno.agent.Agent.__init__", lambda self, **kw: None)

    fn = chat_module._parse_exclusion_intent
    result = fn("恢复 company.pdf 中被排除的实体", "", "proj-001")

    assert isinstance(result, dict)
    assert result.get("action") == "restore", f"action 应为 'restore'，实际: {result}"
    assert result.get("source") == "company.pdf", f"source 应为 'company.pdf'，实际: {result}"


@pytest.mark.anyio
async def test_parse_exclusion_intent_handles_no_source(monkeypatch):
    """'帮我排除一些实体' → LLM 返回 source=null 时 source 为 None。"""
    from llm_invoker import LLMResult

    def fake_llm(agent, prompt, **kwargs):
        return LLMResult(
            ok=True,
            content=json.dumps({"action": "exclude", "source": None}),
            attempts=1,
        )

    monkeypatch.setattr("routes.chat.safe_llm_call_sync", fake_llm)
    monkeypatch.setattr("routes.chat.create_model", lambda: __import__("unittest.mock", fromlist=["MagicMock"]).MagicMock())
    monkeypatch.setattr("agno.agent.Agent.__init__", lambda self, **kw: None)

    fn = chat_module._parse_exclusion_intent
    result = fn("帮我排除一些实体", "", "proj-001")

    assert isinstance(result, dict)
    assert result.get("action") in ("exclude", "restore", None)
    assert result.get("source") is None, f"无文档名时 source 应为 None，实际: {result}"


@pytest.mark.anyio
async def test_parse_exclusion_intent_handles_llm_failure(monkeypatch):
    """LLM 调用失败时 _parse_exclusion_intent 应返回 {action: None, source: None}（不抛出异常）。"""
    from llm_invoker import LLMCallError

    def fake_fail(agent, prompt, **kwargs):
        raise LLMCallError("timeout", attempts=3)

    monkeypatch.setattr("routes.chat.safe_llm_call_sync", fake_fail)
    monkeypatch.setattr("routes.chat.create_model", lambda: __import__("unittest.mock", fromlist=["MagicMock"]).MagicMock())
    monkeypatch.setattr("agno.agent.Agent.__init__", lambda self, **kw: None)

    fn = chat_module._parse_exclusion_intent
    result = fn("排除某个文档", "", "proj-001")

    assert isinstance(result, dict), "LLM 失败时应返回 dict，而非抛出异常"
    assert result.get("action") is None or result.get("error") is not None, (
        "LLM 失败时 action 应为 None 或包含 error 字段"
    )


# ---------------------------------------------------------------------------
# 类别 D：行为断言 — _run_entity_exclusion_sync 消费 LLM 解析结果
# ---------------------------------------------------------------------------

@pytest.mark.anyio
async def test_entity_exclusion_sync_uses_parse_result_for_exclude(monkeypatch):
    """_run_entity_exclusion_sync 应消费 _parse_exclusion_intent 的结果来决定排除哪个文档。"""
    parse_calls = []

    def fake_parse(message, context, project_id):
        parse_calls.append(message)
        return {"action": "exclude", "source": "report.md"}

    monkeypatch.setattr("routes.chat._parse_exclusion_intent", fake_parse)

    exclude_calls = []
    fake_entities = [
        {"id": "e1", "source": "report.md", "excluded": False},
        {"id": "e2", "source": "report.md", "excluded": False},
    ]

    import entity_extractor as _ee
    monkeypatch.setattr(_ee, "list_entities", lambda pid: fake_entities)
    monkeypatch.setattr(_ee, "exclude_entity", lambda eid, flag: exclude_calls.append((eid, flag)))

    result = chat_module._run_entity_exclusion_sync("proj-001", "排除 report.md 的实体")

    assert parse_calls, "_parse_exclusion_intent 必须被调用"
    assert len(exclude_calls) == 2, (
        f"应排除 2 个实体，实际 exclude_entity 调用次数: {len(exclude_calls)}"
    )
    assert all(flag is True for _, flag in exclude_calls), "排除时 flag 必须为 True"
    assert "report.md" in result or "2" in result, (
        f"返回消息应提到被排除的文档名或实体数量，实际: {result!r}"
    )
