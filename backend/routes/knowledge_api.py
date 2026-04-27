from pathlib import Path

from fastapi import APIRouter, UploadFile, File

from config import KNOWLEDGE_DOCS_DIR
from knowledge import ingest_document, _uploaded_docs, list_documents
from agents import invalidate_agent

router = APIRouter()


@router.post("/api/knowledge/upload")
async def api_upload_document(file: UploadFile = File(...)):
    content = await file.read()
    doc_name = file.filename or "unknown.txt"
    suffix = Path(doc_name).suffix.lower()

    doc_path = KNOWLEDGE_DOCS_DIR / doc_name

    if suffix == ".pdf":
        import fitz
        doc_path.write_bytes(content)
        pdf = fitz.open(stream=content, filetype="pdf")
        _end_puncts = set('。；！？.;!?\n')
        parts: list[str] = []
        for page in pdf:
            t = page.get_text().strip()
            if not t:
                continue
            if parts and parts[-1] and parts[-1][-1] not in _end_puncts:
                parts.append(' ' + t)
            else:
                parts.append('\n\n' + t if parts else t)
        pdf.close()
        text = ''.join(parts).strip()
    else:
        text = content.decode("utf-8", errors="ignore")
        doc_path.write_text(text, encoding="utf-8")

    if not text.strip():
        return {"success": False, "error": "文件内容为空，无法解析"}

    try:
        chunk_count = ingest_document(doc_name, text)
        _uploaded_docs[doc_name] = chunk_count
        invalidate_agent("a2")
        return {"success": True, "doc_name": doc_name, "chunks": chunk_count}
    except Exception as e:
        return {"success": False, "error": f"解析失败: {e}"}


@router.get("/api/knowledge/docs")
async def api_list_docs():
    return list_documents()
