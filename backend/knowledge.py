try:
    from agno.knowledge.knowledge import Knowledge
    from agno.knowledge.embedder.fastembed import FastEmbedEmbedder
    from agno.knowledge.chunking.recursive import RecursiveChunking
    from agno.vectordb.lancedb import LanceDb
    from agno.vectordb.search import SearchType
    _LANCE_AVAILABLE = True
except Exception as _import_err:
    _LANCE_AVAILABLE = False
    print(f"[KNOWLEDGE] LanceDB/Agno 向量模块导入失败，知识库功能将不可用: {_import_err}")

from config import BASE_DIR, KNOWLEDGE_DOCS_DIR

_knowledge = None
_vector_db = None
_uploaded_docs: dict[str, int] = {}


def knowledge_available() -> bool:
    """知识库（向量检索）是否可用。"""
    return _knowledge is not None


def _rebuild_knowledge():
    """根据 settings 配置动态重建 Knowledge（embedder + reranker）。"""
    global _knowledge, _vector_db

    if not _LANCE_AVAILABLE:
        print("[KNOWLEDGE] 跳过初始化：LanceDB 模块不可用")
        _knowledge = None
        _vector_db = None
        return

    from embeddings import _get_embedding_config, _get_reranker_config, OpenAICompatibleReranker

    emb_cfg = _get_embedding_config()
    rer_cfg = _get_reranker_config()

    if emb_cfg["mode"] == "api" and emb_cfg["model_id"]:
        from agno.knowledge.embedder.openai import OpenAIEmbedder
        emb_kwargs: dict = {"id": emb_cfg["model_id"]}
        if emb_cfg["dimensions"]:
            emb_kwargs["dimensions"] = emb_cfg["dimensions"]
        if emb_cfg["api_key"]:
            emb_kwargs["api_key"] = emb_cfg["api_key"]
        if emb_cfg["base_url"]:
            emb_kwargs["base_url"] = emb_cfg["base_url"]
        embedder = OpenAIEmbedder(**emb_kwargs)
        print(f"[KNOWLEDGE] 使用远程 Embedding: {emb_cfg['model_id']} @ {emb_cfg['base_url'] or 'default'}")
    else:
        embedder = FastEmbedEmbedder(id="BAAI/bge-small-zh-v1.5", dimensions=512)
        print("[KNOWLEDGE] 使用本地 FastEmbed: BAAI/bge-small-zh-v1.5")

    reranker = None
    if rer_cfg["enabled"] and rer_cfg["model_id"]:
        reranker = OpenAICompatibleReranker(
            model=rer_cfg["model_id"],
            api_key=rer_cfg["api_key"],
            base_url=rer_cfg["base_url"],
            top_n=rer_cfg["top_n"],
        )
        print(f"[KNOWLEDGE] 使用 Reranker: {rer_cfg['model_id']} @ {rer_cfg['base_url'] or 'default'}")
    else:
        print("[KNOWLEDGE] Reranker 未启用")

    _vector_db = LanceDb(
        uri=str(BASE_DIR / "data" / "lancedb"),
        table_name="knowledge",
        embedder=embedder,
        search_type=SearchType.hybrid,
        reranker=reranker,
    )

    _knowledge = Knowledge(
        vector_db=_vector_db,
        max_results=10,
    )
    print("[KNOWLEDGE] Knowledge 初始化完成")


try:
    _rebuild_knowledge()
except Exception as _init_err:
    _knowledge = None
    _vector_db = None
    print(f"[KNOWLEDGE] 初始化失败，知识库功能已降级: {_init_err}")


def ingest_document(doc_name: str, text: str) -> int:
    """将文本通过 RecursiveChunking 分块后存入向量库。"""
    if not knowledge_available():
        raise RuntimeError("知识库功能不可用（LanceDB 初始化失败），无法入库文档")

    from agno.knowledge.reader.text_reader import TextReader
    reader = TextReader(
        chunk=True,
        chunk_size=1500,
        chunking_strategy=RecursiveChunking(chunk_size=1500, overlap=200),
    )
    _knowledge.insert(
        name=doc_name,
        text_content=text,
        reader=reader,
        upsert=True,
    )
    from agno.knowledge.document.base import Document
    doc = Document(content=text, name=doc_name)
    chunks = RecursiveChunking(chunk_size=1500, overlap=200).chunk(doc)
    return len(chunks)


def search_knowledge(query: str, top_k: int = 5) -> list[dict]:
    """向量语义检索。"""
    if not knowledge_available():
        return []

    results = _knowledge.search(query, max_results=top_k)
    chunks = []
    for doc in results:
        meta = doc.meta_data or {}
        name = meta.get("content_name") or meta.get("name") or doc.name or "unknown"
        chunks.append({
            "doc_name": name,
            "chunk_text": doc.content,
        })
    return chunks


def _restore_uploaded_docs():
    """启动时扫描 KNOWLEDGE_DOCS_DIR，恢复文档名列表到内存。"""
    if not KNOWLEDGE_DOCS_DIR.exists():
        return
    for f in KNOWLEDGE_DOCS_DIR.iterdir():
        if f.is_file() and not f.name.startswith("."):
            _uploaded_docs.setdefault(f.name, -1)
    if _uploaded_docs:
        print(f"[KNOWLEDGE] 从磁盘恢复了 {len(_uploaded_docs)} 个文档记录: {', '.join(_uploaded_docs.keys())}")


try:
    _restore_uploaded_docs()
except Exception as _restore_err:
    print(f"[KNOWLEDGE] 文档列表恢复失败: {_restore_err}")


def list_documents() -> list[dict]:
    return [{"doc_name": k, "chunks": v} for k, v in _uploaded_docs.items()]
