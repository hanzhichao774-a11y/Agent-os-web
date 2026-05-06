"""
Issue 007 守护测试：意图类别应由 Skill 注册表动态构建，而非硬编码常量。

要求：
- build_intent_registry() 必须存在，合并核心意图 + Skill 声明意图
- build_classify_prompt() 必须使用 build_intent_registry() 的动态结果
- _CLASSIFY_PROMPT 模块级常量应被废弃（或保留但不直接用于分类）
- 若某 Skill 在 SKILL_META 中声明 intent，该意图必须出现在 classify prompt 中
- _classify_with_llm 中的合法性校验必须检查动态集合，而非固定 _VALID_INTENTS 常量

运行方式:
    cd backend
    .venv/bin/pytest tests/test_dynamic_intent_registry.py -v
"""
import inspect
import json
from unittest.mock import MagicMock

import pytest

import routes.chat as chat_module


# ---------------------------------------------------------------------------
# 类别 A：静态断言 — 注册表与构建函数必须存在
# ---------------------------------------------------------------------------

def test_build_intent_registry_exists():
    """build_intent_registry() 函数必须存在于 routes.chat。"""
    assert hasattr(chat_module, "build_intent_registry"), (
        "routes.chat 必须提供 build_intent_registry() 函数，"
        "将核心意图 + Skill 声明意图合并为统一字典"
    )


def test_build_classify_prompt_exists():
    """build_classify_prompt() 函数必须存在，替代 _CLASSIFY_PROMPT 模块级常量。"""
    assert hasattr(chat_module, "build_classify_prompt"), (
        "routes.chat 必须提供 build_classify_prompt() 函数，"
        "从 build_intent_registry() 动态构建意图分类 prompt"
    )


def test_build_intent_registry_includes_core_intents():
    """build_intent_registry() 必须包含核心意图（direct_answer / orchestrate）。"""
    registry = chat_module.build_intent_registry()
    assert isinstance(registry, dict), f"必须返回 dict，实际: {type(registry)}"
    assert "direct_answer" in registry, "core intent 'direct_answer' 必须始终存在"
    assert "orchestrate" in registry, "core intent 'orchestrate' 必须始终存在"


def test_build_intent_registry_scans_skill_registry():
    """build_intent_registry() 必须扫描 _skill_registry，纳入 Skill 声明的意图。"""
    src = inspect.getsource(chat_module.build_intent_registry)
    assert "_skill_registry" in src or "skill_registry" in src, (
        "build_intent_registry() 必须读取 _skill_registry 以获取 Skill 声明的意图"
    )


def test_build_classify_prompt_uses_registry():
    """build_classify_prompt() 必须调用 build_intent_registry()，不得直接拼接硬编码字符串。"""
    src = inspect.getsource(chat_module.build_classify_prompt)
    assert "build_intent_registry" in src, (
        "build_classify_prompt() 必须调用 build_intent_registry()，"
        "确保 prompt 反映动态意图集合"
    )


def test_classify_with_llm_uses_dynamic_prompt():
    """_classify_with_llm 必须调用 build_classify_prompt()，不得硬引用 _CLASSIFY_PROMPT 常量。"""
    src = inspect.getsource(chat_module._classify_with_llm)
    assert "build_classify_prompt" in src, (
        "_classify_with_llm 必须调用 build_classify_prompt() 获取动态 prompt，"
        "不得直接使用 _CLASSIFY_PROMPT 模块级常量"
    )


def test_classify_with_llm_validates_against_dynamic_registry():
    """_classify_with_llm 的合法性校验必须使用动态意图集合，而非固定 _VALID_INTENTS 元组。"""
    src = inspect.getsource(chat_module._classify_with_llm)
    assert "build_intent_registry" in src, (
        "_classify_with_llm 在校验 LLM 返回意图是否合法时，"
        "必须查询 build_intent_registry()，确保新增 Skill 意图能被接受"
    )


# ---------------------------------------------------------------------------
# 类别 B：行为断言 — Skill 声明意图时，自动纳入分类系统
# ---------------------------------------------------------------------------

@pytest.fixture
def anyio_backend():
    return "asyncio"


def test_skill_declared_intent_appears_in_registry(monkeypatch):
    """当 _skill_registry 中有 Skill 声明了 intent，build_intent_registry() 必须包含该意图。"""
    from skill_manager import _skill_registry

    fake_skill = {
        "id": "doc_summary",
        "meta": {
            "name": "文档摘要",
            "icon": "📝",
            "category": "analysis",
            "description": "生成文档摘要",
            "intent": "document_summary",
            "intent_description": "用户要求对文档生成摘要或提炼要点",
        },
        "run_fn": lambda project_id, target_file="": "摘要内容",
        "params": [],
    }

    # 临时向注册表注入测试 Skill
    original = dict(_skill_registry)
    _skill_registry["doc_summary"] = fake_skill
    try:
        registry = chat_module.build_intent_registry()
        assert "document_summary" in registry, (
            "Skill 声明 intent='document_summary' 后，"
            "build_intent_registry() 必须包含 'document_summary'"
        )
    finally:
        _skill_registry.clear()
        _skill_registry.update(original)


def test_skill_declared_intent_appears_in_prompt(monkeypatch):
    """Skill 声明了 intent 后，build_classify_prompt() 生成的 prompt 必须包含该意图。"""
    from skill_manager import _skill_registry

    fake_skill = {
        "id": "doc_summary",
        "meta": {
            "name": "文档摘要",
            "icon": "📝",
            "category": "analysis",
            "description": "生成文档摘要",
            "intent": "document_summary",
            "intent_description": "用户要求对文档生成摘要或提炼要点",
        },
        "run_fn": lambda project_id, target_file="": "摘要内容",
        "params": [],
    }

    original = dict(_skill_registry)
    _skill_registry["doc_summary"] = fake_skill
    try:
        prompt = chat_module.build_classify_prompt()
        assert "document_summary" in prompt, (
            "Skill 声明 intent='document_summary' 后，"
            "build_classify_prompt() 输出的 prompt 必须包含 'document_summary'"
        )
        assert "摘要" in prompt or "document_summary" in prompt, (
            "prompt 中应包含 Skill 的意图描述"
        )
    finally:
        _skill_registry.clear()
        _skill_registry.update(original)


def test_skill_intent_dispatch_exists_in_orchestrator():
    """orchestrator_chat 中必须有通用 Skill 意图分发路径（当意图匹配某 Skill 的声明意图时自动调用）。"""
    src = inspect.getsource(chat_module)
    assert "skill_intent_map" in src or "intent_to_skill" in src or "skill_intent" in src, (
        "orchestrator_chat 中必须有通用 Skill 意图分发路径，"
        "避免每新增一类 Skill 意图都要手动改 orchestrator_chat"
    )
