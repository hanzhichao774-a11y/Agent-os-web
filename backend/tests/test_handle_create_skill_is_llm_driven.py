"""
Skill 创建必须由 LLM 动态生成，不允许存在硬编码模板系统。

对应 docs/KNOWN_ISSUES.md 中的 Issue 001，落实 F001 原则 3：
- _CAPABILITY_TEMPLATES 硬编码字典必须不存在
- _handle_create_skill 必须通过 LLM 生成 Skill 代码（而非复制模板字符串）
- 生成的代码必须能通过 ast.parse 语法校验后再写入文件
- LLM 返回无效 Python 时必须拒绝写文件并给出可读错误

运行方式:
    cd backend
    .venv/bin/pytest tests/test_handle_create_skill_is_llm_driven.py -v
"""
import ast
import inspect
import importlib
from unittest.mock import MagicMock, patch
from pathlib import Path
import tempfile

import pytest

import routes.chat as chat_module


@pytest.fixture
def anyio_backend():
    return "asyncio"


# ---------------------------------------------------------------------------
# 类别 A：静态断言 — 模板系统必须不存在
# ---------------------------------------------------------------------------

def test_capability_templates_constant_removed():
    """F001 原则 3：_CAPABILITY_TEMPLATES 硬编码字典必须已从 routes.chat 中移除。

    存在此字典意味着 Skill 内容是静态预置的，不是 LLM 生成的。
    """
    assert not hasattr(chat_module, "_CAPABILITY_TEMPLATES"), (
        "F001 原则 3 违反：routes.chat 仍存在 `_CAPABILITY_TEMPLATES` 硬编码 Skill 模板字典。"
        " 详见 docs/KNOWN_ISSUES.md#001-系统使用硬编码模板而非动态生成技能"
    )


def test_handle_create_skill_does_not_do_template_matching():
    """_handle_create_skill 内部不应存在关键词列表匹配逻辑。

    旧实现通过 `any(trigger in message for trigger in tpl["triggers"])` 决定生成哪个模板。
    新实现必须通过 LLM 分析用户意图。
    """
    fn = getattr(chat_module, "_handle_create_skill", None)
    assert fn is not None, "_handle_create_skill 函数必须存在"

    src = inspect.getsource(fn)
    # 旧实现的关键词匹配特征
    assert "tpl[\"triggers\"]" not in src, (
        "F001 原则 3 违反：_handle_create_skill 仍在通过 triggers 列表匹配用户消息，"
        " 应改为 LLM 分析意图"
    )
    assert "_CAPABILITY_TEMPLATES" not in src, (
        "_handle_create_skill 仍在引用 _CAPABILITY_TEMPLATES，模板系统未彻底移除"
    )


def test_handle_create_skill_imports_llm_invoker():
    """_handle_create_skill 或其调用链必须使用 safe_llm_call / safe_llm_call_sync 来调 LLM。"""
    src = inspect.getsource(chat_module)
    # 函数体或模块级别任意位置存在 safe_llm_call 调用即可
    assert "safe_llm_call" in src, (
        "routes.chat 必须使用 safe_llm_call / safe_llm_call_sync 来为 Skill 生成调用 LLM，"
        " 当前不存在任何 safe_llm_call 调用。"
    )


def test_handle_create_skill_uses_ast_parse_for_validation():
    """生成的 Skill 代码在写入前必须通过 ast.parse 语法校验。

    防止 LLM 返回语法错误的代码被直接写入 skills/ 目录导致 Skill 注册失败。
    """
    fn = getattr(chat_module, "_handle_create_skill", None)
    assert fn is not None
    src = inspect.getsource(fn)
    assert "ast.parse" in src or "ast_parse" in src or "compile(" in src, (
        "_handle_create_skill 必须对 LLM 生成的代码做语法校验（ast.parse），"
        " 防止无效 Python 被写入 skills/ 目录"
    )


# ---------------------------------------------------------------------------
# 类别 B：行为断言 — LLM 正常返回时成功创建 Skill
# ---------------------------------------------------------------------------

_VALID_SKILL_CODE = '''\
SKILL_META = {
    "name": "测试技能",
    "icon": "🧪",
    "category": "data",
    "description": "这是一个由 LLM 生成的测试技能",
}


def run(project_id: str, query: str = "") -> str:
    """执行测试操作。"""
    return f"技能已执行，项目={project_id}，查询={query}"
'''


def _make_behavior_patches(monkeypatch, tmp_path, fake_llm_fn, registry=None):
    """公共 helper：给 _handle_create_skill 行为测试打桩（Agent + LLM + scan_skills + registry）。"""
    monkeypatch.setattr("routes.chat.SKILLS_DIR", tmp_path)
    monkeypatch.setattr("routes.chat.safe_llm_call_sync", fake_llm_fn)
    monkeypatch.setattr("routes.chat.scan_skills", lambda: None)
    monkeypatch.setattr("routes.chat._skill_registry", registry or {})
    monkeypatch.setattr("routes.chat.create_model", lambda: MagicMock())
    # 阻止 agno.Agent 真正构造（它会校验 model 类型）
    monkeypatch.setattr("agno.agent.Agent.__init__", lambda self, **kw: None)


@pytest.mark.anyio
async def test_handle_create_skill_succeeds_with_valid_llm_output(monkeypatch, tmp_path):
    """LLM 返回合法 Skill 代码时，_handle_create_skill 应：
    1. 把代码写入 skills/<filename>.py
    2. 触发 scan_skills() 注册
    3. 返回包含 Skill 名称的成功消息
    """
    from llm_invoker import LLMResult

    llm_content = f"<FILENAME>test_skill.py</FILENAME>\n{_VALID_SKILL_CODE}"
    call_log = []

    def fake_llm(agent, prompt, **kwargs):
        call_log.append(prompt)
        return LLMResult(ok=True, content=llm_content, attempts=1)

    _make_behavior_patches(monkeypatch, tmp_path, fake_llm, registry={"test_skill": {"meta": {"name": "测试技能", "category": "data", "description": "desc"}}})

    result = chat_module._handle_create_skill("帮我生成一个数据查询技能")

    assert call_log, "必须调用 safe_llm_call_sync 向 LLM 请求代码生成"
    assert isinstance(result, str)
    assert any(kw in result for kw in ("成功", "生成", "已创建", "技能")), (
        f"成功消息应包含 '成功'/'生成'/'已创建'/'技能' 等关键词，实际: {result!r}"
    )

    py_files = list(tmp_path.glob("*.py"))
    assert py_files, "skills/ 目录下必须有新生成的 .py 文件"

    code = py_files[0].read_text(encoding="utf-8")
    try:
        ast.parse(code)
    except SyntaxError as e:
        pytest.fail(f"写入 skills/ 的代码必须是合法 Python，实际语法错误: {e}")


@pytest.mark.anyio
async def test_handle_create_skill_rejects_invalid_python(monkeypatch, tmp_path):
    """LLM 返回不合法 Python 时，_handle_create_skill 必须拒绝写文件，返回错误提示。"""
    from llm_invoker import LLMResult

    def fake_llm(agent, prompt, **kwargs):
        return LLMResult(ok=True, content="这不是 Python 代码，只是一段中文描述", attempts=1)

    _make_behavior_patches(monkeypatch, tmp_path, fake_llm)

    result = chat_module._handle_create_skill("帮我生成一个技能")

    py_files = list(tmp_path.glob("*.py"))
    assert not py_files, (
        "LLM 返回无效 Python 时，不应该写文件，"
        f"但在 skills/ 目录中发现了文件: {[f.name for f in py_files]}"
    )
    assert isinstance(result, str)
    assert any(kw in result for kw in ("失败", "错误", "无法", "语法", "重试")), (
        f"拒绝时应返回包含 '失败'/'错误'/'无法'/'语法'/'重试' 的提示，实际: {result!r}"
    )


@pytest.mark.anyio
async def test_handle_create_skill_rejects_missing_skill_meta(monkeypatch, tmp_path):
    """LLM 返回的代码缺少 SKILL_META 时应拒绝（Skill 无法注册）。"""
    from llm_invoker import LLMResult

    no_meta_code = "<FILENAME>bad_skill.py</FILENAME>\ndef run(project_id: str) -> str:\n    return 'hello'\n"

    def fake_llm(agent, prompt, **kwargs):
        return LLMResult(ok=True, content=no_meta_code, attempts=1)

    _make_behavior_patches(monkeypatch, tmp_path, fake_llm)

    result = chat_module._handle_create_skill("帮我生成技能")

    assert any(kw in result for kw in ("SKILL_META", "失败", "错误", "缺少", "无效")), (
        f"缺少 SKILL_META 时应拒绝并给出提示，实际: {result!r}"
    )


@pytest.mark.anyio
async def test_handle_create_skill_raises_when_llm_call_fails(monkeypatch, tmp_path):
    """LLM 调用失败（safe_llm_call_sync 抛 LLMCallError）时，应返回用户友好的错误消息。"""
    from llm_invoker import LLMCallError

    def fake_fail(agent, prompt, **kwargs):
        raise LLMCallError("OpenAI timeout", attempts=3)

    _make_behavior_patches(monkeypatch, tmp_path, fake_fail)

    result = chat_module._handle_create_skill("帮我生成技能")

    assert not list(tmp_path.glob("*.py")), "LLM 调用失败时不应写文件"
    assert isinstance(result, str)
    assert any(kw in result for kw in ("失败", "错误", "无法", "重试")), (
        f"LLM 调用失败时应有用户友好错误提示，实际: {result!r}"
    )


# ---------------------------------------------------------------------------
# 类别 C：生成的 Skill 必须是自洽的合法 Skill（端到端校验）
# ---------------------------------------------------------------------------

def test_valid_skill_code_has_required_structure():
    """用于行为断言的测试辅助：_VALID_SKILL_CODE 本身必须符合 Skill 结构规范。"""
    tree = ast.parse(_VALID_SKILL_CODE)

    assigns = [n for n in ast.walk(tree) if isinstance(n, ast.Assign)]
    targets = [t.id for a in assigns for t in a.targets if isinstance(t, ast.Name)]
    assert "SKILL_META" in targets, "测试用 Skill 代码必须包含 SKILL_META"

    funcs = [n.name for n in ast.walk(tree) if isinstance(n, ast.FunctionDef)]
    assert "run" in funcs, "测试用 Skill 代码必须包含 run() 函数"
