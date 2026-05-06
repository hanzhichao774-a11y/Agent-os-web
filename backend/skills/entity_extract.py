"""实体抽取 Skill：从知识库文档中抽取实体和关系，写入数据库构建知识图谱。

Issue 009 / 010 修复版本特性：
- 复用全局缓存（按 source 聚合 entities/entity_relations，跨项目共享抽取结果）
- 单文件失败隔离（status='failed'/'parse_error' 不阻塞其他文件，最终消息显式列出）
- 进度日志埋点 [SKILL:entity_extract] start/cached/extracting/completed/failed/done
- progress_cb 关键字回调（current, total, label, status），支持 SSE 桥接
- 底层 LLM 调用经 entity_extractor.extract_entities_sync → safe_llm_call_sync 自动重试
"""
SKILL_META = {
    "name": "实体抽取",
    "icon": "🔍",
    "category": "data",
    "description": "从知识库文档中抽取实体和关系，构建知识图谱",
    "intent": "entity_extraction",
    "intent_description": "要求从文档中提取/抽取/生成实体或知识图谱",
}


def run(
    project_id: str,
    task_id: str = "",
    target_file: str = "",
    *,
    progress_cb=None,
) -> str:
    """从知识库文档中抽取实体和关系。

    Args:
        project_id: 项目 ID
        task_id: 任务 ID（可选，空字符串视为 None）
        target_file: 限定抽取的文件名（空字符串表示全部知识库文件）
        progress_cb: 可选回调 progress_cb(current: int, total: int, label: str, status: str)
            status ∈ {"cached", "extracting", "completed", "failed", "skipped"}

    Returns:
        Markdown 格式的总结消息（成功数 / 失败数 / 失败文件名）
    """
    import sys
    import os
    import uuid as _uuid

    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

    from doc_parser import read_document_text
    from entity_extractor import extract_entities_sync
    from config import KNOWLEDGE_DOCS_DIR
    from database import _get_projects_conn
    from rule_manager import load_rules

    if not KNOWLEDGE_DOCS_DIR.exists():
        return "知识库文档目录不存在"

    files = [
        f for f in KNOWLEDGE_DOCS_DIR.iterdir()
        if f.is_file() and not f.name.startswith(".")
    ]
    if not files:
        return "知识库中暂无文档，请先上传文档到知识库。"

    if target_file:
        matched = [f for f in files if target_file in f.name or f.name in target_file]
        if not matched:
            return (
                f"未找到文件「{target_file}」，"
                f" 当前知识库文件：{', '.join(f.name for f in files)}"
            )
        files = matched

    tid = task_id if task_id else None
    total = len(files)
    print(f"[SKILL:entity_extract] start: project={project_id} files={total}")

    # Issue 012：项目有学习规则时跳过全局缓存，强制重新调用 LLM
    # 确保用户设置的规则在下一次抽取时立即生效
    project_rules = load_rules(project_id)
    has_rules = len(project_rules) > 0

    conn = _get_projects_conn()
    file_names = [f.name for f in files]
    placeholders = ",".join("?" for _ in file_names)

    ent_rows = conn.execute(
        f"SELECT source, COUNT(*) as cnt FROM entities WHERE source IN ({placeholders}) GROUP BY source",
        file_names,
    ).fetchall()
    global_cache: dict[str, dict] = {}
    if has_rules:
        # 有规则时清空缓存，强制所有文档重新调用 LLM（规则必须生效）
        print(f"[SKILL:entity_extract] project has {len(project_rules)} rule(s), bypassing cache")
    else:
        for row in ent_rows:
            global_cache[row["source"]] = {"ents": row["cnt"], "rels": 0}

    rel_rows = conn.execute(
        f"SELECT source, COUNT(*) as cnt FROM entity_relations WHERE source IN ({placeholders}) GROUP BY source",
        file_names,
    ).fetchall()
    for row in rel_rows:
        if row["source"] in global_cache:
            global_cache[row["source"]]["rels"] = row["cnt"]

    total_ents = 0
    total_rels = 0
    processed = 0
    cached_count = 0
    failed: list[str] = []
    parse_errors: list[str] = []

    for idx, fpath in enumerate(files, start=1):
        if fpath.name in global_cache:
            cur_ents, cur_rels = _ensure_project_has_source(
                conn, project_id, tid, fpath.name, _uuid
            )
            total_ents += cur_ents
            total_rels += cur_rels
            processed += 1
            cached_count += 1
            print(
                f"[SKILL:entity_extract] cached {fpath.name}: "
                f"{cur_ents} entities, {cur_rels} relations"
            )
            _safe_progress(progress_cb, idx, total, fpath.name, "cached")
            continue

        text = read_document_text(fpath)
        if not text.strip():
            print(f"[SKILL:entity_extract] skipped {fpath.name}: empty content")
            _safe_progress(progress_cb, idx, total, fpath.name, "skipped")
            continue
        text = text[:8000]

        print(f"[SKILL:entity_extract] extracting {fpath.name} ({len(text)} chars)")
        _safe_progress(progress_cb, idx, total, fpath.name, "extracting")

        try:
            result = extract_entities_sync(text, project_id, tid, fpath.name)
        except Exception as e:
            reason = f"{type(e).__name__}: {e}"
            print(f"[SKILL:entity_extract] failed {fpath.name}: {reason}")
            failed.append(f"{fpath.name}（{reason}）")
            _safe_progress(progress_cb, idx, total, fpath.name, "failed")
            continue

        status = result.get("status", "ok") if isinstance(result, dict) else "ok"
        if status == "failed":
            reason = result.get("error", "LLM 调用失败")
            print(f"[SKILL:entity_extract] failed {fpath.name}: {reason}")
            failed.append(f"{fpath.name}（{reason}）")
            _safe_progress(progress_cb, idx, total, fpath.name, "failed")
            continue
        if status == "parse_error":
            reason = result.get("error", "模型返回非 JSON")
            print(
                f"[SKILL:entity_extract] failed {fpath.name}: parse_error: {reason}"
            )
            parse_errors.append(f"{fpath.name}（解析失败）")
            _safe_progress(progress_cb, idx, total, fpath.name, "failed")
            continue

        ents_n = result.get("entities_count", 0)
        rels_n = result.get("relations_count", 0)
        total_ents += ents_n
        total_rels += rels_n
        processed += 1
        print(
            f"[SKILL:entity_extract] completed {fpath.name}: "
            f"{ents_n} entities, {rels_n} relations"
        )
        _safe_progress(progress_cb, idx, total, fpath.name, "completed")

    conn.close()

    failed_total = len(failed) + len(parse_errors)
    print(
        f"[SKILL:entity_extract] done: {processed} ok / "
        f"{cached_count} cached / {failed_total} failed"
    )

    msg = (
        f"已从 **{processed}** 个文档中提取 **{total_ents}** 个实体和 "
        f"**{total_rels}** 条关系。"
    )
    if cached_count:
        msg += f"\n（其中 {cached_count} 个文档命中缓存，未重复调用 LLM）"
    if failed:
        msg += "\n\n以下文档 LLM 调用失败：" + ", ".join(failed)
    if parse_errors:
        msg += "\n\n以下文档模型未按格式返回（已自动跳过）：" + ", ".join(parse_errors)
    msg += "\n\n请切换到右侧「图谱」标签页查看知识图谱。"
    return msg


def _safe_progress(progress_cb, current, total, label, status):
    """调用 progress_cb 时吞掉异常，避免单次回调失败拖垮整个抽取流程。"""
    if progress_cb is None:
        return
    try:
        progress_cb(current, total, label, status)
    except Exception as e:
        print(f"[SKILL:entity_extract] progress_cb error (ignored): {e}")


def _ensure_project_has_source(conn, project_id, task_id, source, _uuid_mod):
    """确保当前项目下有该 source 的实体；若没有则从其他项目复制。

    返回 (entities_count, relations_count) 当前项目下统计值。
    复用 backend/routes/chat.py:_run_entity_extraction_sync 的跨项目复制逻辑。
    """
    cur_cnt = conn.execute(
        "SELECT COUNT(*) as cnt FROM entities WHERE project_id = ? AND source = ?",
        (project_id, source),
    ).fetchone()["cnt"]

    if cur_cnt == 0:
        donor = conn.execute(
            "SELECT project_id FROM entities WHERE source = ? LIMIT 1",
            (source,),
        ).fetchone()
        if donor:
            donor_pid = donor["project_id"]
            donor_ents = conn.execute(
                "SELECT name, type, description, source, excluded, created_at FROM entities WHERE project_id = ? AND source = ?",
                (donor_pid, source),
            ).fetchall()

            old_to_new: dict[str, str] = {}
            donor_id_rows = conn.execute(
                "SELECT id, name, type FROM entities WHERE project_id = ? AND source = ?",
                (donor_pid, source),
            ).fetchall()
            for de in donor_ents:
                new_id = f"e_{_uuid_mod.uuid4().hex[:12]}"
                conn.execute(
                    "INSERT OR IGNORE INTO entities (id, project_id, task_id, name, type, description, source, excluded, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
                    (new_id, project_id, task_id, de["name"], de["type"],
                     de["description"], de["source"], de["excluded"], de["created_at"]),
                )
                key = f"{de['name']}|{de['type']}"
                old_to_new[key] = new_id

            old_id_to_key: dict[str, str] = {}
            for dr in donor_id_rows:
                old_id_to_key[dr["id"]] = f"{dr['name']}|{dr['type']}"

            donor_rels = conn.execute(
                "SELECT source_entity_id, target_entity_id, relation, source, created_at FROM entity_relations WHERE project_id = ? AND source = ?",
                (donor_pid, source),
            ).fetchall()
            for rel in donor_rels:
                src_key = old_id_to_key.get(rel["source_entity_id"], "")
                tgt_key = old_id_to_key.get(rel["target_entity_id"], "")
                new_src = old_to_new.get(src_key)
                new_tgt = old_to_new.get(tgt_key)
                if new_src and new_tgt:
                    new_rel_id = f"r_{_uuid_mod.uuid4().hex[:12]}"
                    conn.execute(
                        "INSERT OR IGNORE INTO entity_relations (id, project_id, task_id, source_entity_id, target_entity_id, relation, source, created_at) VALUES (?,?,?,?,?,?,?,?)",
                        (new_rel_id, project_id, task_id, new_src, new_tgt,
                         rel["relation"], rel["source"], rel["created_at"]),
                    )
            conn.commit()
            print(f"[SKILL:entity_extract] cross-project copy {source}: {donor_pid} -> {project_id}")

    cur_ents = conn.execute(
        "SELECT COUNT(*) as cnt FROM entities WHERE project_id = ? AND source = ?",
        (project_id, source),
    ).fetchone()["cnt"]
    cur_rels = conn.execute(
        "SELECT COUNT(*) as cnt FROM entity_relations WHERE project_id = ? AND source = ?",
        (project_id, source),
    ).fetchone()["cnt"]
    return cur_ents, cur_rels
