import os

import httpx
from agno.knowledge.reranker.base import Reranker as BaseReranker
from agno.knowledge.document.base import Document as AgnoDocument

from database import _get_projects_conn


def _get_embedding_config() -> dict:
    """从 DB 读取 Embedding 配置，无则回退到 .env。"""
    try:
        conn = _get_projects_conn()
        rows = conn.execute(
            "SELECT key, value FROM settings WHERE key LIKE 'embedding_%'"
        ).fetchall()
        conn.close()
        db_cfg = {r["key"]: r["value"] for r in rows}
        if db_cfg.get("embedding_model_id"):
            return {
                "mode": "api",
                "model_id": db_cfg["embedding_model_id"],
                "api_key": db_cfg.get("embedding_api_key", ""),
                "base_url": db_cfg.get("embedding_base_url", ""),
                "dimensions": int(db_cfg.get("embedding_dimensions", "1024")),
            }
    except Exception as e:
        print(f"[WARN] 读取 Embedding DB 配置失败，使用默认值: {e}")

    env_model = os.getenv("EMBEDDING_MODEL_ID", "")
    if env_model:
        return {
            "mode": "api",
            "model_id": env_model,
            "api_key": os.getenv("EMBEDDING_API_KEY", ""),
            "base_url": os.getenv("EMBEDDING_BASE_URL", ""),
            "dimensions": int(os.getenv("EMBEDDING_DIMENSIONS", "1024")),
        }
    return {"mode": "local", "model_id": "", "api_key": "", "base_url": "", "dimensions": 512}


def _get_reranker_config() -> dict:
    """从 DB 读取 Reranker 配置，无则回退到 .env。"""
    try:
        conn = _get_projects_conn()
        rows = conn.execute(
            "SELECT key, value FROM settings WHERE key LIKE 'reranker_%'"
        ).fetchall()
        conn.close()
        db_cfg = {r["key"]: r["value"] for r in rows}
        if db_cfg.get("reranker_model_id"):
            return {
                "enabled": db_cfg.get("reranker_enabled", "true").lower() == "true",
                "model_id": db_cfg["reranker_model_id"],
                "api_key": db_cfg.get("reranker_api_key", ""),
                "base_url": db_cfg.get("reranker_base_url", ""),
                "top_n": int(db_cfg.get("reranker_top_n", "5")),
            }
    except Exception as e:
        print(f"[WARN] 读取 Reranker DB 配置失败，使用默认值: {e}")

    env_model = os.getenv("RERANKER_MODEL_ID", "")
    if env_model:
        return {
            "enabled": True,
            "model_id": env_model,
            "api_key": os.getenv("RERANKER_API_KEY", ""),
            "base_url": os.getenv("RERANKER_BASE_URL", ""),
            "top_n": int(os.getenv("RERANKER_TOP_N", "5")),
        }
    return {"enabled": False, "model_id": "", "api_key": "", "base_url": "", "top_n": 5}


class OpenAICompatibleReranker(BaseReranker):
    """兼容 Jina/Cohere (/v1/rerank) 和 TEI (/rerank) 两种 rerank API 格式。"""
    model: str = "qw3-reranke-8b"
    api_key: str = ""
    base_url: str = ""
    top_n: int = 5

    def _call_rerank(self, query: str, documents: list[str]) -> list[dict]:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        base = self.base_url.rstrip("/")
        if base.endswith("/v1"):
            base = base[:-3]

        jina_url = f"{base}/v1/rerank"
        jina_body = {
            "model": self.model,
            "query": query,
            "documents": documents,
            "top_n": self.top_n,
        }
        try:
            resp = httpx.post(jina_url, json=jina_body, headers=headers, timeout=30)
            if resp.status_code != 404:
                resp.raise_for_status()
                data = resp.json()
                return data.get("results", [])
        except httpx.HTTPStatusError as e:
            if e.response.status_code != 404:
                raise
        except httpx.ConnectError:
            pass
        except ValueError:
            pass

        tei_url = f"{base}/rerank"
        tei_body = {"query": query, "texts": documents, "truncate": True}
        resp = httpx.post(tei_url, json=tei_body, headers=headers, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        if isinstance(data, list):
            return [{"index": item.get("index", i), "relevance_score": item.get("score", 0)} for i, item in enumerate(data)]
        return data.get("results", [])

    def rerank(self, query: str, documents: list[AgnoDocument]) -> list[AgnoDocument]:
        if not documents:
            return []
        try:
            doc_texts = [doc.content for doc in documents]
            results = self._call_rerank(query, doc_texts)
            scored: list[AgnoDocument] = []
            for r in results:
                idx = r.get("index", 0)
                if idx < len(documents):
                    doc = documents[idx]
                    doc.reranking_score = r.get("relevance_score", 0)
                    scored.append(doc)
            scored.sort(
                key=lambda x: x.reranking_score if x.reranking_score is not None else float("-inf"),
                reverse=True,
            )
            return scored[:self.top_n] if self.top_n else scored
        except Exception as e:
            print(f"[WARN] Reranker 调用失败，返回原始文档: {e}")
            return documents
