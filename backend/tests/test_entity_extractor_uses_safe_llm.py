"""
entity_extractor.extract_entities_sync 必须经由 safe_llm_call_sync 调用 LLM。

对应 docs/KNOWN_ISSUES.md 中的 Issue 010，落实 F001 原则 5 在执行层的闭环：
- 不允许直接 extractor.run(...) 单次调用（无重试、把 agno 错误字符串当 content 处理）
- LLM 调用失败时必须返回 status="failed" 让上层区分"调用失败"vs"业务结果 0 实体"
- 模型返回非 JSON 是另一种失败类型（status="parse_error"），不能与 LLM 调用失败混淆

运行方式:
    cd backend
    .venv/bin/pytest tests/test_entity_extractor_uses_safe_llm.py -v
"""
import inspect
from unittest.mock import MagicMock

import pytest


# ---------------------------------------------------------------------------
# 类别 A：静态断言（源码层面）
# ---------------------------------------------------------------------------

def test_entity_extractor_imports_safe_llm_call_sync():
    """extract_entities_sync 必须 import 并使用 safe_llm_call_sync 与 LLMCallError。

    通过模块属性验证 import 链路成立（而不是仅检查源码文本）。
    """
    import entity_extractor

    assert hasattr(entity_extractor, "safe_llm_call_sync"), (
        "entity_extractor 必须从 llm_invoker 导入 safe_llm_call_sync。"
        " 详见 docs/KNOWN_ISSUES.md#010-openai-api-调用无重试单次超时即返回-0-实体"
    )
    assert hasattr(entity_extractor, "LLMCallError"), (
        "entity_extractor 必须从 llm_invoker 导入 LLMCallError"
    )


def test_extract_entities_sync_source_does_not_call_extractor_run_directly():
    """源码层面：extract_entities_sync 函数体内不应再出现 `extractor.run(` 字面调用。

    所有 LLM 调用必须经由 safe_llm_call_sync 中转。
    """
    import entity_extractor

    src = inspect.getsource(entity_extractor.extract_entities_sync)

    assert "extractor.run(" not in src, (
        "F001 原则 5 违反：extract_entities_sync 内仍存在直接 `extractor.run(` 调用，"
        " 应改用 safe_llm_call_sync(extractor, ...) 以获得重试 + 异常分类能力。"
    )
    assert ".arun(" not in src, (
        "extract_entities_sync 是同步函数，不应出现 `.arun(` 异步调用"
    )


# ---------------------------------------------------------------------------
# 类别 B：行为断言 - 成功路径
# ---------------------------------------------------------------------------

def _patch_common(monkeypatch, llm_call_behaviour):
    """安装通用的 monkeypatch：

    - 让 Agent 构造无副作用
    - 让 _get_excluded_names 不查数据库
    - 让 _upsert_entities / _insert_relations 不查数据库（返回简单值）
    - 让 safe_llm_call_sync 按 llm_call_behaviour 行事
    """
    import entity_extractor

    monkeypatch.setattr("entity_extractor.create_model", lambda: MagicMock())
    monkeypatch.setattr("agno.agent.Agent", MagicMock)
    monkeypatch.setattr(entity_extractor, "_get_excluded_names", lambda pid: [])
    monkeypatch.setattr(
        entity_extractor,
        "_upsert_entities",
        lambda pid, tid, src, ents: {e["name"]: f"id_{i}" for i, e in enumerate(ents)},
    )
    monkeypatch.setattr(
        entity_extractor,
        "_insert_relations",
        lambda pid, tid, src, rels, eids: len(
            [r for r in rels if r.get("source") and r.get("target") and r.get("relation")]
        ),
    )
    monkeypatch.setattr(entity_extractor, "safe_llm_call_sync", llm_call_behaviour)


def test_extract_entities_sync_returns_normal_result_on_llm_success(monkeypatch):
    """LLM 正常返回有效 JSON 时，extract_entities_sync 应返回带 entities_count/relations_count 的成功 dict。"""
    from llm_invoker import LLMResult
    import entity_extractor

    call_count = {"n": 0}

    def fake_safe_llm_call_sync(agent, prompt, **kwargs):
        call_count["n"] += 1
        return LLMResult(
            ok=True,
            content='{"entities": [{"name": "北京", "type": "location", "description": "首都"}], '
                    '"relations": []}',
            attempts=1,
        )

    _patch_common(monkeypatch, fake_safe_llm_call_sync)

    result = entity_extractor.extract_entities_sync(
        "北京是首都", project_id="p1", task_id=None, source_name="t.md"
    )

    assert call_count["n"] == 1, "应通过 safe_llm_call_sync 调用 LLM 恰好 1 次"
    assert result["entities_count"] == 1
    assert result["relations_count"] == 0
    assert result.get("status", "ok") == "ok", (
        f"LLM 成功路径不应带 failed 状态，实际 result={result}"
    )


# ---------------------------------------------------------------------------
# 类别 C：行为断言 - LLM 调用失败必须明确区分
# ---------------------------------------------------------------------------

def test_extract_entities_sync_returns_failed_status_when_llm_call_error(monkeypatch):
    """
    Issue 010 核心：safe_llm_call_sync 抛 LLMCallError 时，
    extract_entities_sync 必须返回 status="failed" 的 dict，
    而不是把"LLM 调用失败"伪装成"业务结果 0 实体"。
    """
    from llm_invoker import LLMCallError
    import entity_extractor

    def fake_raise(agent, prompt, **kwargs):
        raise LLMCallError("OpenAI: Request timed out", attempts=3)

    _patch_common(monkeypatch, fake_raise)

    result = entity_extractor.extract_entities_sync(
        "some text", project_id="p1", task_id=None, source_name="t.md"
    )

    assert isinstance(result, dict)
    assert result.get("status") == "failed", (
        "F001 原则 5 违反：LLM 调用失败时必须返回 status='failed'，"
        f"实际 result={result}（之前的实现会伪装成 entities_count=0 的'成功'）"
    )
    assert result.get("entities_count", 0) == 0
    assert result.get("relations_count", 0) == 0
    assert "error" in result or "reason" in result, (
        f"失败结果应包含 error/reason 字段以便上层日志，实际 result={result}"
    )


def test_extract_entities_sync_does_not_swallow_llm_call_error_as_zero_result(monkeypatch):
    """
    回归保护：不允许出现"LLM 调用失败 → 静默返回 entities_count=0 而无 status 标记"。
    上层据此区分"成功 0 实体"vs"调用失败"。
    """
    from llm_invoker import LLMCallError
    import entity_extractor

    def fake_raise(agent, prompt, **kwargs):
        raise LLMCallError("connection error", attempts=3)

    _patch_common(monkeypatch, fake_raise)

    result = entity_extractor.extract_entities_sync(
        "x", project_id="p1", task_id=None, source_name="t.md"
    )

    keys = set(result.keys())
    assert "status" in keys, (
        f"调用失败结果必须显式包含 status 字段，实际 keys={keys}"
    )
    assert result["status"] != "ok", (
        f"调用失败时 status 不能是 'ok'，实际={result['status']}"
    )


# ---------------------------------------------------------------------------
# 类别 D：行为断言 - 模型乱吐（成功调用但非 JSON）独立分类
# ---------------------------------------------------------------------------

def test_extract_entities_sync_distinguishes_parse_error_from_call_failure(monkeypatch):
    """
    LLM 调用成功但模型返回非 JSON（例如模型乱吐 markdown 文本），
    应返回 status="parse_error"，与 status="failed" 明确区分：
    - "failed" 表示 LLM 调用本身失败（应触发上层重试或人工干预）
    - "parse_error" 表示模型按格式约束失败（应触发提示词调整或重新询问）
    """
    from llm_invoker import LLMResult
    import entity_extractor

    def fake_returns_garbage(agent, prompt, **kwargs):
        return LLMResult(
            ok=True,
            content="对不起，这个文本太复杂了，我无法抽取实体。",
            attempts=1,
        )

    _patch_common(monkeypatch, fake_returns_garbage)

    result = entity_extractor.extract_entities_sync(
        "x", project_id="p1", task_id=None, source_name="t.md"
    )

    assert result.get("status") == "parse_error", (
        f"模型返回非 JSON 时应标 status='parse_error'，实际 result={result}"
    )
    assert result["status"] != "failed", (
        "解析失败 ≠ 调用失败，不可混用 'failed' 状态"
    )


# ---------------------------------------------------------------------------
# 类别 E：行为断言 - 业务空结果（合法 JSON 但 entities=[]）保持 status='ok'
# ---------------------------------------------------------------------------

def test_extract_entities_sync_returns_ok_for_legitimate_zero_entities(monkeypatch):
    """
    LLM 调用成功且模型按格式返回 {"entities": [], "relations": []}，
    应保持 status="ok"，entities_count=0，relations_count=0。
    这是"业务上确实没有实体"的合法情况，必须能与"调用失败"区分。
    """
    from llm_invoker import LLMResult
    import entity_extractor

    def fake_returns_empty_json(agent, prompt, **kwargs):
        return LLMResult(ok=True, content='{"entities": [], "relations": []}', attempts=1)

    _patch_common(monkeypatch, fake_returns_empty_json)

    result = entity_extractor.extract_entities_sync(
        "this is just whitespace.....", project_id="p1", task_id=None, source_name="t.md"
    )

    assert result.get("status", "ok") == "ok", (
        f"业务空结果应保持 status='ok'，实际 result={result}"
    )
    assert result["entities_count"] == 0
    assert result["relations_count"] == 0
