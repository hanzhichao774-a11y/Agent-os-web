SKILL_META = {
    "name": "实体抽取",
    "icon": "🔍",
    "category": "data",
    "description": "从知识库文档中抽取实体和关系，构建知识图谱",
}


def run(project_id: str, task_id: str = "", target_file: str = "") -> str:
    """从知识库文档中抽取实体和关系。target_file 为空时扫描全部文档。"""
    import sys, os
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeout
    from doc_parser import read_document_text
    from entity_extractor import extract_entities_sync
    from config import KNOWLEDGE_DOCS_DIR

    if not KNOWLEDGE_DOCS_DIR.exists():
        return "知识库文档目录不存在"

    files = [f for f in KNOWLEDGE_DOCS_DIR.iterdir()
             if f.is_file() and not f.name.startswith(".")]
    if not files:
        return "知识库中暂无文档，请先上传。"

    if target_file:
        matched = [f for f in files if target_file in f.name or f.name in target_file]
        if not matched:
            return f"未找到文件「{target_file}」，当前知识库文件：{', '.join(f.name for f in files)}"
        files = matched

    tid = task_id if task_id else None
    total_ents, total_rels, processed, failed = 0, 0, 0, []
    for fpath in files:
        text = read_document_text(fpath)
        if not text.strip():
            continue
        text = text[:8000]
        try:
            with ThreadPoolExecutor(max_workers=1) as executor:
                future = executor.submit(extract_entities_sync, text, project_id, tid, fpath.name)
                result = future.result(timeout=180)
            total_ents += result.get("entities_count", 0)
            total_rels += result.get("relations_count", 0)
            processed += 1
        except FuturesTimeout:
            failed.append(f"{fpath.name}(超时)")
        except Exception:
            failed.append(fpath.name)

    msg = f"已从 {processed} 个文档中提取 {total_ents} 个实体和 {total_rels} 条关系。"
    if failed:
        msg += f"\n处理失败：{', '.join(failed)}"
    msg += "\n请切换到右侧「图谱」标签页查看知识图谱。"
    return msg
