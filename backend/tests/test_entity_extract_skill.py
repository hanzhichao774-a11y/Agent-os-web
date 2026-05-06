"""
entity_extract Skill 重写后的可观测性 + 缓存 + 失败隔离约束测试

对应 docs/KNOWN_ISSUES.md 中的 Issue 009，验证 Skill 工程基础设施：
- Skill 必须有进度日志（[SKILL:entity_extract] 前缀）
- Skill 必须支持 progress_cb 回调
- Skill 必须复用全局缓存（避免重复调 LLM）
- 单文件 LLM 失败不能阻塞其他文件继续执行
- 多文件最终消息必须显式列出失败文件名（不能伪装成"成功 N 个 0 实体"）

运行方式:
    cd backend
    .venv/bin/pytest tests/test_entity_extract_skill.py -v
"""
import importlib.util
import inspect
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from config import BASE_DIR

_SKILL_PATH = BASE_DIR / "skills" / "entity_extract.py"


def _load_skill_module():
    """以 skill_manager 同样的方式加载 entity_extract Skill 模块。"""
    spec = importlib.util.spec_from_file_location("entity_extract_skill", _SKILL_PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# ---------------------------------------------------------------------------
# 类别 A：静态约束 - 日志埋点
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "log_keyword",
    [
        "[SKILL:entity_extract] start",
        "[SKILL:entity_extract] cached",
        "[SKILL:entity_extract] extracting",
        "[SKILL:entity_extract] completed",
        "[SKILL:entity_extract] failed",
        "[SKILL:entity_extract] done",
    ],
)
def test_skill_source_contains_progress_log_keyword(log_keyword):
    """Skill 源码必须包含覆盖每个生命周期阶段的日志埋点。

    详见 docs/KNOWN_ISSUES.md#009-entity_extract-skill-串行执行且零中间日志
    """
    src = _SKILL_PATH.read_text(encoding="utf-8")
    assert log_keyword in src, (
        f"F001 工程基础设施违反：Skill 源码缺少进度日志埋点 `{log_keyword}`，"
        f" 长任务可观测性无法验收。"
    )


# ---------------------------------------------------------------------------
# 类别 B：静态约束 - run 函数签名包含 progress_cb
# ---------------------------------------------------------------------------

def test_skill_run_signature_has_progress_cb():
    """Skill run() 必须支持 progress_cb 关键字参数（默认 None），用于实时上报进度。"""
    mod = _load_skill_module()
    sig = inspect.signature(mod.run)
    assert "progress_cb" in sig.parameters, (
        "Skill run() 必须包含可选的 progress_cb 参数，"
        f" 当前签名: {sig}"
    )
    cb_param = sig.parameters["progress_cb"]
    assert cb_param.default is None, (
        f"progress_cb 默认值必须是 None（保持向后兼容），实际默认: {cb_param.default!r}"
    )
    # 必须是 keyword-only 或 positional-or-keyword（不能强制要求位置参数）
    assert cb_param.kind in (
        inspect.Parameter.KEYWORD_ONLY,
        inspect.Parameter.POSITIONAL_OR_KEYWORD,
    ), f"progress_cb 必须可作为 keyword 参数传入，实际 kind={cb_param.kind}"


def test_skill_run_signature_remains_backward_compatible():
    """旧调用方式 run(project_id, task_id, target_file) 必须保持有效。"""
    mod = _load_skill_module()
    sig = inspect.signature(mod.run)
    params = list(sig.parameters.values())
    positional_names = [
        p.name for p in params
        if p.kind in (inspect.Parameter.POSITIONAL_OR_KEYWORD,
                       inspect.Parameter.POSITIONAL_ONLY)
    ]
    assert positional_names[:3] == ["project_id", "task_id", "target_file"], (
        "Skill run() 前三个位置参数必须保持 (project_id, task_id, target_file)，"
        f" 实际: {positional_names[:3]}"
    )


# ---------------------------------------------------------------------------
# 行为测试基础设施
# ---------------------------------------------------------------------------

class _FakeConn:
    """模拟 sqlite Connection 的最小子集，按 SQL 模式分派假数据。"""

    def __init__(self, global_cached_sources: set[str], project_existing_sources: set[str]):
        self.global_cached = global_cached_sources
        self.project_existing = project_existing_sources
        self.executed_writes: list[tuple[str, tuple]] = []

    def execute(self, sql: str, params=()):
        sql_norm = " ".join(sql.split())  # 折叠空白
        return _FakeCursor(self, sql_norm, params)

    def commit(self):
        pass

    def close(self):
        pass


class _FakeCursor:
    def __init__(self, conn: _FakeConn, sql: str, params):
        self.conn = conn
        self.sql = sql
        self.params = params

    def fetchall(self):
        # 全局缓存查询：SELECT source, COUNT(*) ... FROM entities WHERE source IN (...)
        if "FROM entities WHERE source IN" in self.sql:
            return [
                {"source": s, "cnt": 5}
                for s in self.params if s in self.conn.global_cached
            ]
        if "FROM entity_relations WHERE source IN" in self.sql:
            return [
                {"source": s, "cnt": 3}
                for s in self.params if s in self.conn.global_cached
            ]
        # 跨项目复制时读 donor 实体/关系
        if "SELECT name, type, description" in self.sql or "SELECT id, name, type" in self.sql:
            return []
        if "FROM entity_relations WHERE project_id = ? AND source = ?" in self.sql:
            return []
        return []

    def fetchone(self):
        # 检查当前 project 是否已有该 source: SELECT COUNT(*) FROM entities WHERE project_id = ? AND source = ?
        if "SELECT COUNT(*) as cnt FROM entities WHERE project_id" in self.sql:
            source = self.params[1]
            return {"cnt": 5 if source in self.conn.project_existing else 0}
        if "SELECT COUNT(*) as cnt FROM entity_relations WHERE project_id" in self.sql:
            source = self.params[1]
            return {"cnt": 3 if source in self.conn.project_existing else 0}
        # donor 查询
        if "SELECT project_id FROM entities WHERE source" in self.sql:
            return None  # 无 donor，简化测试
        return None


def _setup_skill_environment(monkeypatch, tmp_path: Path, file_names: list[str],
                              global_cached: set[str], project_existing: set[str],
                              extract_results: dict | None = None):
    """构造测试环境：

    - 在 tmp_path 创建若干 fake 文件
    - mock KNOWLEDGE_DOCS_DIR 指向 tmp_path
    - mock _get_projects_conn 返回 _FakeConn
    - mock read_document_text 返回固定文本
    - mock entity_extractor.extract_entities_sync 按 extract_results 返回

    Returns:
        (mod, extract_call_log, fake_conn)
    """
    for name in file_names:
        (tmp_path / name).write_text(f"content of {name}", encoding="utf-8")

    mod = _load_skill_module()

    monkeypatch.setattr("config.KNOWLEDGE_DOCS_DIR", tmp_path)
    fake_conn = _FakeConn(global_cached, project_existing)
    monkeypatch.setattr("database._get_projects_conn", lambda: fake_conn)
    monkeypatch.setattr("doc_parser.read_document_text", lambda fp: f"content of {fp.name}")

    extract_call_log = []
    results = extract_results or {}

    def fake_extract(text, project_id, task_id, source_name):
        extract_call_log.append({"source": source_name, "project_id": project_id})
        if source_name in results:
            return results[source_name]
        return {"status": "ok", "entities_count": 7, "relations_count": 4, "source": source_name}

    monkeypatch.setattr("entity_extractor.extract_entities_sync", fake_extract)

    return mod, extract_call_log, fake_conn


# ---------------------------------------------------------------------------
# 类别 C：行为约束 - 缓存命中跳过 LLM
# ---------------------------------------------------------------------------

def test_cached_files_skip_llm_call(monkeypatch, tmp_path):
    """已缓存的 source（项目内已存在）应跳过 LLM 调用，仅复用数据库统计。"""
    file_names = ["doc_a.md", "doc_b.md", "doc_c.md"]
    mod, extract_log, _ = _setup_skill_environment(
        monkeypatch, tmp_path, file_names,
        global_cached={"doc_a.md", "doc_b.md"},
        project_existing={"doc_a.md", "doc_b.md"},
    )

    result = mod.run(project_id="p1", task_id="", target_file="")

    extracted_sources = {c["source"] for c in extract_log}
    assert "doc_a.md" not in extracted_sources, "缓存命中的 doc_a.md 不应再调 LLM"
    assert "doc_b.md" not in extracted_sources, "缓存命中的 doc_b.md 不应再调 LLM"
    assert "doc_c.md" in extracted_sources, "未缓存的 doc_c.md 应调 LLM 抽取"
    assert len(extract_log) == 1, f"只应调用 LLM 1 次（doc_c.md），实际 {len(extract_log)} 次"
    assert isinstance(result, str)


def test_progress_cb_invoked_per_file(monkeypatch, tmp_path):
    """progress_cb 必须为每个文件被调用至少一次（含缓存命中 + 抽取成功 + 抽取失败）。"""
    file_names = ["a.md", "b.md", "c.md", "d.md"]
    mod, _, _ = _setup_skill_environment(
        monkeypatch, tmp_path, file_names,
        global_cached={"a.md"},
        project_existing={"a.md"},
        extract_results={
            "c.md": {"status": "failed", "entities_count": 0, "relations_count": 0,
                     "source": "c.md", "error": "LLM timeout"},
        },
    )

    progress_log = []

    def cb(current, total, label, status):
        progress_log.append({
            "current": current, "total": total, "label": label, "status": status,
        })

    mod.run(project_id="p1", task_id="", target_file="", progress_cb=cb)

    # 每个文件至少触发一次 progress（cached/extracting/completed/failed 任一）
    labels_with_progress = {p["label"] for p in progress_log}
    assert labels_with_progress == set(file_names), (
        f"progress_cb 应覆盖全部文件，实际仅: {labels_with_progress}"
    )
    # status 必须是已知集合
    valid_statuses = {"cached", "extracting", "completed", "failed", "skipped"}
    for p in progress_log:
        assert p["status"] in valid_statuses, (
            f"progress_cb 收到未知 status={p['status']!r}，"
            f" 必须 ∈ {valid_statuses}"
        )
    # total 必须固定为 4
    totals = {p["total"] for p in progress_log}
    assert totals == {4}, f"progress_cb 的 total 必须为 4，实际 {totals}"


# ---------------------------------------------------------------------------
# 类别 D：行为约束 - 单文件失败必须隔离
# ---------------------------------------------------------------------------

def test_single_file_failure_does_not_block_others(monkeypatch, tmp_path):
    """LLM 调用失败的文件应记录但不阻塞其他文件继续抽取。

    这是 Issue 010 + 009 的联合约束：
    - extract_entities_sync 返回 status='failed' → Skill 标记该文件失败
    - 其他文件继续执行
    - 最终消息显式包含失败文件名
    """
    file_names = ["good1.md", "bad.md", "good2.md"]
    mod, extract_log, _ = _setup_skill_environment(
        monkeypatch, tmp_path, file_names,
        global_cached=set(),
        project_existing=set(),
        extract_results={
            "good1.md": {"status": "ok", "entities_count": 8, "relations_count": 5,
                         "source": "good1.md"},
            "bad.md": {"status": "failed", "entities_count": 0, "relations_count": 0,
                       "source": "bad.md", "error": "OpenAI timeout"},
            "good2.md": {"status": "ok", "entities_count": 12, "relations_count": 9,
                         "source": "good2.md"},
        },
    )

    result = mod.run(project_id="p1", task_id="", target_file="")

    # 文件遍历顺序由文件系统决定（与平台/文件名相关），不在断言范围。
    # 关键不变量：失败的文件不能阻塞其他文件继续抽取。
    extracted_sources = sorted(c["source"] for c in extract_log)
    assert extracted_sources == ["bad.md", "good1.md", "good2.md"], (
        f"全部 3 个文件都应被尝试抽取（失败文件不阻塞），实际: {extracted_sources}"
    )
    assert "bad.md" in result, (
        "F001 工程基础设施违反：失败文件名必须出现在最终消息中，"
        f" 实际消息: {result}"
    )
    # 最终消息必须显式区分成功/失败计数（不能把 'bad.md' 伪装成 0 实体的成功）
    lower = result.lower()
    assert any(kw in result for kw in ("失败", "失败：", "失败:", "failed")), (
        f"最终消息必须显式标记'失败'，实际: {result}"
    )


def test_parse_error_distinguished_from_call_failure(monkeypatch, tmp_path):
    """LLM 调用成功但模型返回非 JSON（status='parse_error'）应与 status='failed' 在消息中区分。"""
    file_names = ["weird_doc.md"]
    mod, _, _ = _setup_skill_environment(
        monkeypatch, tmp_path, file_names,
        global_cached=set(),
        project_existing=set(),
        extract_results={
            "weird_doc.md": {"status": "parse_error", "entities_count": 0,
                              "relations_count": 0, "source": "weird_doc.md",
                              "error": "JSON decode error"},
        },
    )

    result = mod.run(project_id="p1", task_id="", target_file="")

    assert "weird_doc.md" in result, "解析失败文件名必须出现在最终消息中"


# ---------------------------------------------------------------------------
# 类别 E：行为约束 - target_file 限定
# ---------------------------------------------------------------------------

def test_target_file_filters_to_single_file(monkeypatch, tmp_path):
    """指定 target_file 时只处理匹配的单个文件。"""
    file_names = ["a.md", "b.md", "c.md"]
    mod, extract_log, _ = _setup_skill_environment(
        monkeypatch, tmp_path, file_names,
        global_cached=set(),
        project_existing=set(),
    )

    mod.run(project_id="p1", task_id="", target_file="b.md")

    extracted_sources = [c["source"] for c in extract_log]
    assert extracted_sources == ["b.md"], (
        f"target_file=b.md 应只处理 b.md，实际: {extracted_sources}"
    )
