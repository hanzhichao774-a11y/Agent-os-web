import json
import asyncio
import re
import time

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from agno.run.agent import RunEvent

from schemas import ChatRequest
from database import _save_chat_message
from utils import clean_content, clean_delta
from agents import AGENT_CONFIGS, get_agent
from llm import _get_llm_config
from skill_manager import _skill_registry
from knowledge import list_documents
from context import current_project_id, current_task_id
from config import KNOWLEDGE_DOCS_DIR

router = APIRouter()

# 需要 SubAgent 重计算的关键词（文件生成、数据分析、代码执行等）
_ORCHESTRATE_KEYWORDS = [
    "生成", "制作", "创建文件", "导出", "做一个", "画一个",
    "图表", "柱状图", "折线图", "饼图", "散点图",
    "PDF", "pdf", "报告", "Excel", "excel", "xlsx",
    "分析数据", "统计分析", "数据清洗",
    "执行代码", "运行代码", "写代码",
    "处理图片", "图片处理", "缩放", "裁剪", "水印",
    "调用API", "HTTP请求", "http",
    "知识库", "检索", "查询", "搜索", "查找",
    "供热", "热力", "分公司", "运行数据",
    "文档", "资料", "方案",
    "实体", "图谱", "抽取", "提取实体", "排除实体",
]


def _needs_orchestration(message: str) -> bool:
    """判断消息是否需要 SubAgent 编排（文件生成、数据分析等重计算任务）。
    简单问答、系统查询、闲聊等直接由 BizAgent 处理。"""
    return any(kw in message for kw in _ORCHESTRATE_KEYWORDS)


_DIRECT_ENTITY_KEYWORDS = [
    "提取实体", "抽取实体", "实体抽取",
    "构建图谱", "生成图谱", "抽取知识图谱",
    "生产实体", "生成实体", "创建实体", "抽取图谱",
    "实体提取", "实体生成", "知识图谱",
]

_ENTITY_EXCLUSION_KEYWORDS = [
    "不要抽取", "不要提取", "不抽取", "不提取",
    "排除实体", "删除实体", "移除实体",
    "修正实体", "修正抽取", "修正提取",
    "不要抽成实体", "不要生成实体",
    "恢复实体", "还原实体", "取消排除",
]


def _is_entity_exclusion(message: str) -> bool:
    """检测消息是否为实体排除/修正类请求"""
    if any(kw in message for kw in _ENTITY_EXCLUSION_KEYWORDS):
        return True
    if ("排除" in message or "恢复" in message or "还原" in message) and "实体" in message:
        return True
    return False


def _is_entity_extraction(message: str) -> bool:
    if _is_entity_exclusion(message):
        return False
    return any(kw in message for kw in _DIRECT_ENTITY_KEYWORDS)


# ---------------------------------------------------------------------------
# LLM 意图分类器 + 关键词降级
# ---------------------------------------------------------------------------

_CLASSIFY_PROMPT = """你是意图分类器。将用户消息分类为以下 5 类之一：
- direct_answer: 简单问答、闲聊、问候、系统查询（查项目/技能/状态）
- entity_extraction: 要求从文档中提取/抽取/生成实体或知识图谱
- entity_exclusion: 要求排除/删除/恢复/还原实体，修正实体抽取结果，管理实体的显示与隐藏
- orchestrate: 需要生成文件、数据分析、图表、代码执行、知识库检索等复杂任务
- create_skill: 用户要求将某个操作/流程封装/沉淀为技能(Skill)

仅返回 JSON：{"intent": "分类名"}"""

_VALID_INTENTS = ("direct_answer", "entity_extraction", "entity_exclusion", "orchestrate", "create_skill")

_CREATE_SKILL_KEYWORDS = [
    "封装成skill", "封装成技能", "封装为skill", "封装为技能",
    "做成技能", "做成skill", "生成技能", "沉淀技能", "沉淀为技能",
    "保存为技能", "保存为skill",
]


async def classify_intent(message: str, context: str = "") -> str | None:
    """LLM 意图分类，10秒超时返回 None 触发降级。context 为最近对话摘要。"""
    from agno.agent import Agent
    from llm import create_model

    try:
        prompt = _CLASSIFY_PROMPT
        if context:
            prompt += f"\n\n以下是最近对话上下文（帮助理解指代关系）：\n{context}"

        classifier = Agent(
            name="IntentClassifier",
            model=create_model(),
            instructions=[prompt],
            markdown=False,
        )
        response = await asyncio.wait_for(
            classifier.arun(message, stream=False),
            timeout=10,
        )
        raw = (response.content or "").strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[-1]
        if raw.endswith("```"):
            raw = raw.rsplit("```", 1)[0]
        raw = raw.strip()
        data = json.loads(raw)
        intent = data.get("intent", "")
        if intent in _VALID_INTENTS:
            return intent
        print(f"[INTENT] LLM 返回未知意图: {intent}")
    except asyncio.TimeoutError:
        print("[INTENT] LLM 分类超时(10s)，降级到关键词")
    except (json.JSONDecodeError, KeyError, TypeError) as e:
        print(f"[INTENT] LLM 输出解析失败: {e}")
    except Exception as e:
        print(f"[INTENT] 分类异常: {e}")
    return None


def _keyword_fallback(message: str) -> str:
    """关键词匹配降级路由。"""
    if any(kw in message for kw in _CREATE_SKILL_KEYWORDS):
        return "create_skill"
    if _is_entity_extraction(message):
        return "entity_extraction"
    if _is_entity_exclusion(message):
        return "entity_exclusion"
    if _needs_orchestration(message):
        return "orchestrate"
    return "direct_answer"


def _run_entity_extraction_sync(project_id: str, task_id: str | None, target_file: str | None = None) -> str:
    """直接从知识库文档中抽取实体，写入数据库。
    target_file: 如果指定，则只抽取该文件。
    已有抽取结果的文件（任意项目）直接从数据库读取并复制到当前项目，不重复调用 LLM。
    """
    import time as _time
    import uuid as _uuid
    from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeout
    from doc_parser import read_document_text
    from entity_extractor import extract_entities_sync
    from database import _get_projects_conn

    if not KNOWLEDGE_DOCS_DIR.exists():
        return "知识库文档目录不存在"

    files = [f for f in KNOWLEDGE_DOCS_DIR.iterdir() if f.is_file() and not f.name.startswith(".")]
    if not files:
        return "知识库中暂无文档，请先上传文档到知识库。"

    if target_file:
        matched = [f for f in files if target_file in f.name or f.name in target_file]
        if not matched:
            return f"未找到文件「{target_file}」，当前知识库文件：{', '.join(f.name for f in files)}"
        files = matched

    conn = _get_projects_conn()
    file_names = [f.name for f in files]
    placeholders = ",".join("?" for _ in file_names)

    # 全局缓存：不限 project_id，按 source 聚合
    ent_rows = conn.execute(
        f"SELECT source, COUNT(*) as cnt FROM entities WHERE source IN ({placeholders}) GROUP BY source",
        file_names,
    ).fetchall()
    global_cache: dict[str, dict] = {}
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
    cached = 0
    failed = []

    for fpath in files:
        if fpath.name in global_cache:
            info = global_cache[fpath.name]

            # 检查当前 project 是否已有该 source 的实体
            cur_cnt = conn.execute(
                "SELECT COUNT(*) as cnt FROM entities WHERE project_id = ? AND source = ?",
                (project_id, fpath.name),
            ).fetchone()["cnt"]

            if cur_cnt == 0:
                # 从其他项目复制实体到当前项目
                donor = conn.execute(
                    "SELECT project_id FROM entities WHERE source = ? LIMIT 1",
                    (fpath.name,),
                ).fetchone()
                if donor:
                    donor_pid = donor["project_id"]
                    donor_ents = conn.execute(
                        "SELECT name, type, description, source, excluded, created_at FROM entities WHERE project_id = ? AND source = ?",
                        (donor_pid, fpath.name),
                    ).fetchall()

                    # 建立 donor entity name+type -> new_id 映射
                    old_to_new: dict[str, str] = {}
                    donor_id_rows = conn.execute(
                        "SELECT id, name, type FROM entities WHERE project_id = ? AND source = ?",
                        (donor_pid, fpath.name),
                    ).fetchall()
                    for de in donor_ents:
                        new_id = f"e_{_uuid.uuid4().hex[:12]}"
                        conn.execute(
                            "INSERT OR IGNORE INTO entities (id, project_id, task_id, name, type, description, source, excluded, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
                            (new_id, project_id, task_id, de["name"], de["type"], de["description"], de["source"], de["excluded"], de["created_at"]),
                        )
                        key = f"{de['name']}|{de['type']}"
                        old_to_new[key] = new_id

                    # 建立 donor old_id -> name+type 映射
                    old_id_to_key: dict[str, str] = {}
                    for dr in donor_id_rows:
                        old_id_to_key[dr["id"]] = f"{dr['name']}|{dr['type']}"

                    # 复制关系
                    donor_rels = conn.execute(
                        "SELECT source_entity_id, target_entity_id, relation, source, created_at FROM entity_relations WHERE project_id = ? AND source = ?",
                        (donor_pid, fpath.name),
                    ).fetchall()
                    for rel in donor_rels:
                        src_key = old_id_to_key.get(rel["source_entity_id"], "")
                        tgt_key = old_id_to_key.get(rel["target_entity_id"], "")
                        new_src = old_to_new.get(src_key)
                        new_tgt = old_to_new.get(tgt_key)
                        if new_src and new_tgt:
                            new_rel_id = f"r_{_uuid.uuid4().hex[:12]}"
                            conn.execute(
                                "INSERT OR IGNORE INTO entity_relations (id, project_id, task_id, source_entity_id, target_entity_id, relation, source, created_at) VALUES (?,?,?,?,?,?,?,?)",
                                (new_rel_id, project_id, task_id, new_src, new_tgt, rel["relation"], rel["source"], rel["created_at"]),
                            )
                    conn.commit()
                    print(f"[ENTITY] 跨项目复制 {fpath.name}: {donor_pid} -> {project_id}")

            # 重新统计当前项目下的实际数量
            cur_ents = conn.execute(
                "SELECT COUNT(*) as cnt FROM entities WHERE project_id = ? AND source = ?",
                (project_id, fpath.name),
            ).fetchone()["cnt"]
            cur_rels = conn.execute(
                "SELECT COUNT(*) as cnt FROM entity_relations WHERE project_id = ? AND source = ?",
                (project_id, fpath.name),
            ).fetchone()["cnt"]
            total_ents += cur_ents
            total_rels += cur_rels
            processed += 1
            cached += 1
            print(f"[ENTITY] 已有缓存 {fpath.name}: {cur_ents} 实体, {cur_rels} 关系")
            continue

        text = read_document_text(fpath)
        if not text.strip():
            continue
        text = text[:8000]
        print(f"[ENTITY] 开始抽取: {fpath.name} ({len(text)} 字符)")
        try:
            with ThreadPoolExecutor(max_workers=1) as executor:
                future = executor.submit(extract_entities_sync, text, project_id, task_id, fpath.name)
                result = future.result(timeout=180)
            total_ents += result.get("entities_count", 0)
            total_rels += result.get("relations_count", 0)
            processed += 1
            print(f"[ENTITY] 直接抽取成功 {fpath.name}: {result.get('entities_count', 0)} 实体, {result.get('relations_count', 0)} 关系")
        except FuturesTimeout:
            print(f"[ENTITY] 抽取超时 {fpath.name} (180s)")
            failed.append(f"{fpath.name}(超时)")
        except Exception as e:
            print(f"[ENTITY] 直接抽取失败 {fpath.name}: {e}")
            failed.append(fpath.name)

    conn.close()

    if cached > 0 and cached == processed:
        _time.sleep(3)
        print("[ENTITY] 全部命中缓存，模拟处理延迟 3 秒")

    result_msg = (
        f"实体抽取完成：已从 {processed} 个文档中提取了 **{total_ents}** 个实体和 **{total_rels}** 条关系。\n\n"
    )
    if failed:
        result_msg += f"处理失败/超时：{', '.join(failed)}\n\n"
    result_msg += "请切换到右侧「图谱」标签页查看知识图谱。"
    return result_msg


def _run_entity_exclusion_sync(project_id: str, message: str) -> str:
    """根据用户消息排除或恢复指定来源的实体。"""
    from entity_extractor import list_entities, exclude_entity

    doc_name = _extract_doc_name(message)
    is_restore = any(kw in message for kw in ("恢复", "还原", "取消排除", "重新加入", "加回"))

    all_entities = list_entities(project_id)
    if not all_entities:
        return "当前项目没有已抽取的实体。"

    if doc_name:
        all_sources = set(e.get("source", "") for e in all_entities if e.get("source"))
        matched_source = None
        if doc_name in all_sources:
            matched_source = doc_name
        else:
            for src in all_sources:
                if src in doc_name or doc_name in src:
                    matched_source = src
                    break

        if not matched_source:
            return f"未找到来源为「{doc_name}」的实体。当前实体来源包括：{', '.join(all_sources)}"

        if is_restore:
            targets = [e for e in all_entities if e.get("source") == matched_source and e.get("excluded")]
            if not targets:
                return f"来源「{matched_source}」没有被排除的实体，无需恢复。"
            restored_count = 0
            for ent in targets:
                exclude_entity(ent["id"], False)
                restored_count += 1
            return (
                f"已恢复来源为「{matched_source}」的 **{restored_count}** 个实体。\n\n"
                f"图谱将重新显示这些实体。"
            )
        else:
            targets = [e for e in all_entities if e.get("source") == matched_source and not e.get("excluded")]
            if not targets:
                return f"来源「{matched_source}」的所有实体已被排除，无需重复操作。"
            excluded_count = 0
            for ent in targets:
                exclude_entity(ent["id"], True)
                excluded_count += 1
            return (
                f"已将来源为「{matched_source}」的 **{excluded_count}** 个实体标记为排除。\n\n"
                f"图谱将不再显示这些实体。如需恢复，请在右侧图谱面板的「已排除」区域点击恢复。"
            )
    else:
        all_sources = set(e.get("source", "") for e in all_entities if e.get("source"))
        return (
            f"请指定要{'恢复' if is_restore else '排除'}的文档名称。\n\n"
            f"当前实体来源：{', '.join(all_sources)}\n\n"
            f"示例：「{'恢复' if is_restore else '排除'} test_company.md 的实体」"
        )


def _extract_doc_name(message: str, context: str = "") -> str | None:
    """从用户消息中提取文档名称。先匹配带扩展名的文件名，再模糊匹配知识库实际文件。
    如果从 message 中提取不到，回退到从 context（最近对话）中提取。
    """
    import re

    def _match(text: str) -> str | None:
        patterns = [
            r'([\w\(\)（）\-]+\.(?:pdf|md|docx|xlsx|csv|txt|doc|pptx))',
            r'([A-Za-z0-9_\-]+\.[A-Za-z0-9]+)',
            r'[「"\'](.*?)[」"\']',
        ]
        for pattern in patterns:
            matches = re.findall(pattern, text)
            for m in matches:
                if '.' in m and len(m) < 100:
                    return m

        if KNOWLEDGE_DOCS_DIR.exists():
            files = [f.name for f in KNOWLEDGE_DOCS_DIR.iterdir() if f.is_file() and not f.name.startswith(".")]
            for fname in files:
                stem = fname.rsplit(".", 1)[0] if "." in fname else fname
                if stem in text:
                    return fname
            for fname in files:
                stem = fname.rsplit(".", 1)[0] if "." in fname else fname
                if len(stem) >= 4:
                    for i in range(len(stem) - 3):
                        if stem[i:i+4] in text:
                            return fname
        return None

    result = _match(message)
    if result:
        return result

    if context:
        return _match(context)

    return None


# ---------------------------------------------------------------------------
# 纯能力 Skill 模板（封装逻辑，不含用户数据）
# ---------------------------------------------------------------------------

_CAPABILITY_TEMPLATES: dict[str, dict] = {
    "entity_extract": {
        "triggers": ["实体抽取", "抽取实体", "提取实体", "实体提取"],
        "filename": "entity_extract.py",
        "display_name": "实体抽取",
        "content": '''\
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
        msg += f"\\n处理失败：{', '.join(failed)}"
    msg += "\\n请切换到右侧「图谱」标签页查看知识图谱。"
    return msg
''',
    },
    "entity_exclude": {
        "triggers": ["实体排除", "排除实体", "修正实体"],
        "filename": "entity_exclude.py",
        "display_name": "实体排除",
        "content": '''\
SKILL_META = {
    "name": "实体排除",
    "icon": "🚫",
    "category": "data",
    "description": "根据指令排除、恢复或修正知识图谱中的实体",
}


def run(project_id: str, instruction: str = "") -> str:
    """根据自然语言指令排除或恢复实体。instruction 为用户原始消息。"""
    import sys, os, re
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from entity_extractor import list_entities, exclude_entity

    all_entities = list_entities(project_id)
    if not all_entities:
        return "当前项目没有已抽取的实体。"

    is_restore = any(kw in instruction for kw in ("恢复", "还原", "取消排除", "重新加入", "加回"))

    doc_name = None
    patterns = [
        r'([\\w\\(\\)（）\\-]+\\.(?:pdf|md|docx|xlsx|csv|txt|doc|pptx))',
        r'([A-Za-z0-9_\\-]+\\.[A-Za-z0-9]+)',
        r'[「"](.*?)[」"]',
    ]
    for pattern in patterns:
        matches = re.findall(pattern, instruction)
        for m in matches:
            if '.' in m and len(m) < 100:
                doc_name = m
                break
        if doc_name:
            break

    if not doc_name:
        all_sources = set(e.get("source", "") for e in all_entities if e.get("source"))
        action = "恢复" if is_restore else "排除"
        return f"请指定要{action}的文档名称。当前实体来源：{', '.join(all_sources)}"

    all_sources = set(e.get("source", "") for e in all_entities if e.get("source"))
    matched_source = None
    if doc_name in all_sources:
        matched_source = doc_name
    else:
        for src in all_sources:
            if src in doc_name or doc_name in src:
                matched_source = src
                break

    if not matched_source:
        return f"未找到来源「{doc_name}」的实体。当前来源：{', '.join(all_sources)}"

    if is_restore:
        targets = [e for e in all_entities if e.get("source") == matched_source and e.get("excluded")]
        if not targets:
            return f"来源「{matched_source}」没有被排除的实体。"
        for ent in targets:
            exclude_entity(ent["id"], False)
        return f"已恢复来源「{matched_source}」的 {len(targets)} 个实体。"
    else:
        targets = [e for e in all_entities if e.get("source") == matched_source and not e.get("excluded")]
        if not targets:
            return f"来源「{matched_source}」的所有实体已被排除。"
        for ent in targets:
            exclude_entity(ent["id"], True)
        return f"已排除来源「{matched_source}」的 {len(targets)} 个实体。"
''',
    },
}


def _handle_create_skill(message: str) -> str:
    """根据用户消息识别要封装的能力，模板化生成 Skill 文件并注册。"""
    from skill_manager import scan_skills, _skill_registry
    from config import SKILLS_DIR

    matched_key = None
    for key, tpl in _CAPABILITY_TEMPLATES.items():
        if any(trigger in message for trigger in tpl["triggers"]):
            matched_key = key
            break

    if not matched_key:
        available = "、".join(tpl["display_name"] for tpl in _CAPABILITY_TEMPLATES.values())
        return (
            f"未识别到要封装的能力。目前支持封装以下技能：{available}\n\n"
            f"请明确说明，例如：「帮我把实体抽取封装成技能」"
        )

    tpl = _CAPABILITY_TEMPLATES[matched_key]

    if matched_key in _skill_registry:
        return f"技能「{tpl['display_name']}」已存在，无需重复封装。"

    skill_file = SKILLS_DIR / tpl["filename"]
    skill_file.write_text(tpl["content"], encoding="utf-8")
    scan_skills()

    if matched_key in _skill_registry:
        return (
            f"已成功生成技能「{tpl['display_name']}」\n\n"
            f"- 文件：`skills/{tpl['filename']}`\n"
            f"- 类型：纯能力封装（不含用户数据）\n"
            f"- 效果：后续执行相关操作时，系统将自动通过此技能执行"
        )
    else:
        return f"技能文件已生成但注册失败，请检查 `skills/{tpl['filename']}` 文件。"


@router.get("/health")
async def health():
    cfg = _get_llm_config()
    return {
        "status": "ok",
        "model_provider": cfg["provider"],
        "model_id": cfg["model_id"],
        "skills_count": len(_skill_registry),
        "docs_count": len(list_documents()),
    }


@router.post("/api/agents/{agent_id}/chat")
async def agent_chat(agent_id: str, request: ChatRequest):
    agent = get_agent(agent_id)

    async def generate():
        if not agent:
            yield f"data: {json.dumps({'content': f'Agent [{agent_id}] 未找到。', 'done': True})}\n\n"
            return

        chat_session_id = request.session_id
        _save_chat_message(chat_session_id, "user", request.message)
        collected_chunks: list[str] = []

        try:
            async with asyncio.timeout(180):
                async for chunk in agent.arun(
                    request.message,
                    stream=True,
                    session_id=request.session_id,
                ):
                    if chunk.content:
                        cleaned = clean_delta(chunk.content)
                        if cleaned:
                            collected_chunks.append(cleaned)
                            yield f"data: {json.dumps({'content': cleaned, 'done': False}, ensure_ascii=False)}\n\n"

            full_reply = clean_content("".join(collected_chunks))
            if full_reply:
                agent_name = AGENT_CONFIGS.get(agent_id, {}).get("name", agent_id)
                _save_chat_message(chat_session_id, "assistant", full_reply, agent_name)

            yield f"data: {json.dumps({'content': '', 'done': True})}\n\n"
        except TimeoutError:
            print(f"[ERROR] Agent chat {agent_id}: timeout after 180s")
            yield f"data: {json.dumps({'content': 'Agent 响应超时（3分钟），请简化问题后重试。', 'done': True})}\n\n"
        except Exception as e:
            err = str(e)
            if "api_key" in err.lower() or "authentication" in err.lower():
                msg = "未检测到有效的 API Key，请在 backend/.env 中配置。"
            else:
                msg = f"请求出错：{err}"
            yield f"data: {json.dumps({'content': msg, 'done': True})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ---------------------------------------------------------------------------
# 编排聊天 — 替代原 team_chat
# ---------------------------------------------------------------------------

@router.post("/api/orchestrator/{project_id}/chat")
async def orchestrator_chat(project_id: str, request: ChatRequest):
    """BizAgent 编排入口：简单查询直接回答，复杂任务走 SubAgent 编排。"""
    from orchestrator import plan_task, execute_plan

    _task_match = re.search(r"_task_(.+)$", request.session_id)
    _parsed_task_id = _task_match.group(1) if _task_match else None
    if _parsed_task_id == "main":
        _parsed_task_id = None
    current_project_id.set(project_id)
    current_task_id.set(_parsed_task_id)

    chat_session_id = f"orch_{project_id}_{request.session_id}"

    def _sse(payload: dict) -> str:
        return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"

    async def _stream_biz_direct(message: str):
        """BizAgent 直接回答（不经过编排）。"""
        biz_agent = get_agent("global")
        if not biz_agent:
            yield _sse({"type": "content", "content": "BizAgent 未就绪", "done": True})
            return

        collected: list[str] = []
        async with asyncio.timeout(180):
            async for chunk in biz_agent.arun(
                message,
                stream=True,
                session_id=f"biz_{project_id}_{request.session_id}",
            ):
                if chunk.content:
                    cleaned = clean_delta(chunk.content)
                    if cleaned:
                        collected.append(cleaned)
                        yield _sse({"type": "content", "content": cleaned, "done": False})

        full_reply = clean_content("".join(collected))
        if full_reply:
            _save_chat_message(chat_session_id, "assistant", full_reply, "BizAgent")
        yield _sse({"type": "done", "content": "", "done": True})

    async def generate():
        _save_chat_message(chat_session_id, "user", request.message)

        try:
            # 加载最近 6 条对话作为上下文
            from database import _load_chat_messages
            recent = _load_chat_messages(chat_session_id)[-6:]
            context_lines = []
            for m in recent:
                role_label = "用户" if m["role"] == "user" else "助手"
                context_lines.append(f"{role_label}: {m['content'][:200]}")
            context_str = "\n".join(context_lines)

            # LLM 意图分类优先，失败降级到关键词
            intent = await classify_intent(request.message, context_str)
            if intent is None:
                intent = _keyword_fallback(request.message)
                print(f"[INTENT] 降级关键词 => {intent}")
            else:
                print(f"[INTENT] LLM 分类 => {intent}")

            if intent == "direct_answer":
                async for chunk in _stream_biz_direct(request.message):
                    yield chunk
                return

            # --- create_skill: 用户要求封装技能 ---
            if intent == "create_skill":
                result_text = await asyncio.to_thread(
                    _handle_create_skill, request.message
                )
                yield _sse({"type": "summary", "content": result_text, "done": False})
                _save_chat_message(chat_session_id, "assistant", result_text, "BizAgent")
                yield _sse({"type": "done", "content": "", "done": True})
                return

            # --- 实体抽取直接执行路径 ---
            if intent == "entity_extraction":
                target_file = _extract_doc_name(request.message, context_str)
                skill = _skill_registry.get("entity_extract")
                desc = f"从 {target_file} 抽取实体" if target_file else "扫描知识库文档并抽取实体和关系"
                if skill:
                    desc += "（Skill）"
                yield _sse({
                    "type": "plan_created",
                    "plan_id": f"entity_{int(time.time())}",
                    "execution_mode": "single",
                    "reasoning": f"正在{'从 ' + target_file + ' 中' if target_file else '从知识库文档中'}提取实体，构建知识图谱...",
                    "subtasks": [{"slot_id": 1, "description": desc}],
                    "done": False,
                })
                yield _sse({"type": "subtask_started", "slot_id": 1, "description": desc, "done": False})

                if skill:
                    print(f"[ENTITY] 使用已注册Skill: entity_extract")
                    result_text = await asyncio.to_thread(
                        skill["run_fn"], project_id, _parsed_task_id or "", target_file or ""
                    )
                else:
                    result_text = await asyncio.to_thread(
                        _run_entity_extraction_sync, project_id, _parsed_task_id, target_file
                    )

                yield _sse({"type": "subtask_completed", "slot_id": 1, "done": False})
                yield _sse({"type": "summary", "content": result_text, "done": False})
                _save_chat_message(chat_session_id, "assistant", result_text, "BizAgent")
                if "entity_extract" not in _skill_registry:
                    yield _sse({
                        "type": "skill_hint",
                        "skill_key": "entity_extract",
                        "content": "实体抽取能力可沉淀为技能，下次将自动通过 Skill 执行。是否封装？",
                        "done": False,
                    })
                yield _sse({"type": "done", "content": "", "done": True})
                return

            # --- 实体排除/修正直接执行路径 ---
            if intent == "entity_exclusion":
                skill = _skill_registry.get("entity_exclude")
                desc = "排除指定来源的实体"
                if skill:
                    desc += "（Skill）"
                yield _sse({
                    "type": "plan_created",
                    "plan_id": f"entity_excl_{int(time.time())}",
                    "execution_mode": "single",
                    "reasoning": "正在处理实体排除请求...",
                    "subtasks": [{"slot_id": 1, "description": desc}],
                    "done": False,
                })
                yield _sse({"type": "subtask_started", "slot_id": 1, "description": desc, "done": False})

                if skill:
                    print(f"[ENTITY] 使用已注册Skill: entity_exclude")
                    result_text = await asyncio.to_thread(
                        skill["run_fn"], project_id, request.message
                    )
                else:
                    result_text = await asyncio.to_thread(
                        _run_entity_exclusion_sync, project_id, request.message
                    )

                yield _sse({"type": "subtask_completed", "slot_id": 1, "done": False})
                yield _sse({"type": "summary", "content": result_text, "done": False})
                _save_chat_message(chat_session_id, "assistant", result_text, "BizAgent")
                if "entity_exclude" not in _skill_registry:
                    yield _sse({
                        "type": "skill_hint",
                        "skill_key": "entity_exclude",
                        "content": "实体排除能力可沉淀为技能，下次将自动通过 Skill 执行。是否封装？",
                        "done": False,
                    })
                yield _sse({"type": "done", "content": "", "done": True})
                return

            # --- intent == "orchestrate": 编排路径 ---
            plan = await plan_task(
                user_message=request.message,
                project_id=project_id,
                task_id=_parsed_task_id,
            )

            if plan.status == "failed" or not plan.subtasks:
                async for chunk in _stream_biz_direct(request.message):
                    yield chunk
                return

            event_queue: asyncio.Queue = asyncio.Queue()
            exec_task = asyncio.create_task(execute_plan(plan, event_queue))

            while True:
                try:
                    event = await asyncio.wait_for(event_queue.get(), timeout=300)
                except asyncio.TimeoutError:
                    yield _sse({"type": "error", "content": "编排执行超时", "done": True})
                    break

                yield _sse({**event, "done": False})

                if event.get("type") == "plan_completed":
                    break

            await exec_task

            if plan.summary:
                biz_agent = get_agent("global")
                if biz_agent:
                    summary_prompt = (
                        f"以下是各 SubAgent 的执行结果，请综合整理成一个简洁的最终回答给用户。\n"
                        f"**只关注以下 SubAgent 结果，不要使用其他上下文。**\n\n"
                        f"用户原始问题：{request.message}\n\n"
                        f"SubAgent 结果：\n{plan.summary}"
                    )
                    summary_session_id = f"summary_{project_id}_{int(time.time())}"
                    summary_chunks: list[str] = []
                    async with asyncio.timeout(120):
                        async for chunk in biz_agent.arun(
                            summary_prompt,
                            stream=True,
                            session_id=summary_session_id,
                        ):
                            if chunk.content:
                                cleaned = clean_delta(chunk.content)
                                if cleaned:
                                    summary_chunks.append(cleaned)
                                    yield _sse({"type": "summary", "content": cleaned, "done": False})

                    full_summary = clean_content("".join(summary_chunks))
                    if full_summary:
                        _save_chat_message(chat_session_id, "assistant", full_summary, "BizAgent")

            yield _sse({"type": "done", "content": "", "done": True})

        except TimeoutError:
            print("[ERROR] Orchestrator chat: timeout")
            yield _sse({"type": "error", "content": "编排超时，请简化任务后重试。", "done": True})
        except Exception as e:
            print(f"[ERROR] Orchestrator chat: {e}")
            yield _sse({"type": "error", "content": f"编排出错：{str(e)}", "done": True})

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
