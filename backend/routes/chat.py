import ast
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
from llm import _get_llm_config, create_model
from llm_invoker import safe_llm_call_sync, LLMCallError
from skill_manager import _skill_registry, scan_skills
from knowledge import list_documents
from context import current_project_id, current_task_id
from config import KNOWLEDGE_DOCS_DIR, SKILLS_DIR

router = APIRouter()

# ---------------------------------------------------------------------------
# LLM 意图分类器（F001 原则 1/2/5：意图理解、任务路由、兜底失败均由 LLM 完成）
#
# 历史上此处存在 4 套硬编码关键词列表 + _keyword_fallback，违反 F001 原则。
# 已于修复 Issue 005 + 006 时全部移除。详见 docs/KNOWN_ISSUES.md。
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Issue 007 修复：意图类别由 Skill 注册表动态构建，不再写死常量
# _CORE_INTENTS：不依赖任何 Skill 的内置路径，永远存在
# Skill 可在 SKILL_META 中声明 intent + intent_description，自动纳入分类系统
# ---------------------------------------------------------------------------

_CORE_INTENTS: dict[str, str] = {
    "direct_answer": "简单问答、闲聊、问候、系统查询（查项目/技能/状态）",
    "rule_learning": '用户希望系统记住/学习一条抽取规则（如"不要抽取章节标题"、"以后忽略页码"）',
    "orchestrate": "需要生成文件、数据分析、图表、代码执行、知识库检索等复杂任务",
    "create_skill": "用户要求将某个操作/流程封装/沉淀为技能(Skill)",
}


def build_intent_registry() -> dict[str, str]:
    """合并核心意图 + _skill_registry 中各 Skill 声明的意图，返回 {intent_key: description}。

    F001 原则 1/3：意图集合由注册表动态生成，新增 Skill 不需要修改 chat.py。
    """
    registry = dict(_CORE_INTENTS)
    for skill_id, skill in _skill_registry.items():
        meta = skill.get("meta", {})
        intent = meta.get("intent")
        intent_desc = meta.get("intent_description", meta.get("description", ""))
        if intent and isinstance(intent, str) and intent not in registry:
            registry[intent] = intent_desc
    return registry


def build_classify_prompt(simplified: bool = False) -> str:
    """从 build_intent_registry() 动态构建意图分类 prompt。"""
    registry = build_intent_registry()
    if simplified:
        keys = " / ".join(registry.keys())
        return f'将用户消息分类为以下 {len(registry)} 类之一，仅返回 JSON {{"intent": "分类名"}}：{keys}'
    lines = [f"- {k}: {v}" for k, v in registry.items()]
    intent_list = "\n".join(lines)
    return (
        f"你是意图分类器。将用户消息分类为以下 {len(registry)} 类之一：\n"
        f"{intent_list}\n\n"
        '仅返回 JSON：{"intent": "分类名"}'
    )


# 向后兼容：保留模块级变量（不用于分类逻辑，仅供历史代码引用）
_CLASSIFY_PROMPT = build_classify_prompt(simplified=False)
_CLASSIFY_PROMPT_SIMPLIFIED = build_classify_prompt(simplified=True)
_VALID_INTENTS = tuple(build_intent_registry().keys())


async def _classify_with_llm(
    message: str,
    context: str = "",
    timeout: int = 10,
    simplified: bool = False,
) -> str | None:
    """单次 LLM 意图分类调用，可控超时与是否简化 prompt。失败返回 None。"""
    from agno.agent import Agent
    from llm import create_model

    try:
        prompt = build_classify_prompt(simplified=simplified)
        valid_intents = build_intent_registry()
        if context and not simplified:
            prompt += f"\n\n以下是最近对话上下文（帮助理解指代关系）：\n{context}"

        classifier = Agent(
            name="IntentClassifier",
            model=create_model(),
            instructions=[prompt],
            markdown=False,
        )
        response = await asyncio.wait_for(
            classifier.arun(message, stream=False),
            timeout=timeout,
        )
        raw = (response.content or "").strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[-1]
        if raw.endswith("```"):
            raw = raw.rsplit("```", 1)[0]
        data = json.loads(raw.strip())
        intent = data.get("intent", "")
        if intent in build_intent_registry():
            return intent
        print(f"[INTENT] LLM 返回未知意图(simplified={simplified}): {intent}")
    except asyncio.TimeoutError:
        print(f"[INTENT] LLM 分类超时({timeout}s, simplified={simplified})")
    except (json.JSONDecodeError, KeyError, TypeError) as e:
        print(f"[INTENT] LLM 输出解析失败 (simplified={simplified}): {e}")
    except Exception as e:
        print(f"[INTENT] 分类异常 (simplified={simplified}): {e}")
    return None


async def classify_intent(message: str, context: str = "") -> str:
    """LLM 意图分类，遵循 F001 原则 2 + 5：兜底必须仍是 LLM。

    流程：
    1. 主调用：完整 prompt + 对话上下文，10 秒超时
    2. 兜底 LLM：简化 prompt + 去除上下文 + 5 秒超时
    3. 兜底 LLM 也失败：默认 'direct_answer' 让 BizAgent 自主响应

    始终返回 _VALID_INTENTS 中的合法意图，绝不返回 None，
    上游不应再有任何"意图为 None 时降级到关键词"的代码路径。
    """
    intent = await _classify_with_llm(message, context, timeout=10, simplified=False)
    if intent in build_intent_registry():
        return intent

    intent = await _classify_with_llm(message, context="", timeout=5, simplified=True)
    if intent in build_intent_registry():
        print("[INTENT] 主调用失败，已通过简化 LLM 兜底成功分类")
        return intent

    print("[INTENT] 主+兜底 LLM 均失败，默认 direct_answer 让 BizAgent 自主响应")
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


_EXCLUSION_INTENT_SYSTEM_PROMPT = """你是一个意图解析器。用户想对知识图谱中的实体执行排除或恢复操作。

从用户消息中提取以下信息，以 JSON 格式返回（不加 markdown 围栏）：
{
  "action": "exclude" | "restore",   // 排除实体 or 恢复已排除的实体
  "source": "文档文件名或 null"         // 目标文档名，如果用户没有指定则为 null
}

规则：
- action: 含"恢复"/"还原"/"取消排除"/"重新加入"/"加回"等含义时 → "restore"；其余默认 → "exclude"
- source: 从消息中识别文件名（如 report.pdf、test.md 等），没有明确文件名时返回 null
- 只返回 JSON，不要任何解释
"""


def _parse_exclusion_intent(message: str, context: str, project_id: str) -> dict:
    """用 LLM 解析实体排除/恢复意图，返回 {action: str|None, source: str|None}。

    F001 原则 1：意图理解必须由大模型完成，禁止正则或关键词列表。
    LLM 失败时返回 {"action": None, "source": None, "error": "<reason>"}。
    """
    from agno.agent import Agent

    agent = Agent(
        name="ExclusionIntentParser",
        model=create_model(),
        instructions=[_EXCLUSION_INTENT_SYSTEM_PROMPT],
        markdown=False,
    )
    prompt = f"用户消息：{message}"
    if context:
        prompt += f"\n\n近期对话上下文：{context}"
    if project_id:
        prompt += f"\n项目 ID：{project_id}"

    try:
        result = safe_llm_call_sync(agent, prompt, max_retries=2, initial_backoff=0.5)
    except LLMCallError as e:
        print(f"[EXCLUSION_INTENT] LLM 解析失败: {e.reason}")
        return {"action": None, "source": None, "error": e.reason}

    raw = (result.content or "").strip()
    # 去掉可能的 markdown 围栏
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[-1]
    if raw.endswith("```"):
        raw = raw.rsplit("```", 1)[0]
    raw = raw.strip()

    try:
        parsed = json.loads(raw)
        return {
            "action": parsed.get("action"),
            "source": parsed.get("source"),
        }
    except (json.JSONDecodeError, AttributeError) as e:
        print(f"[EXCLUSION_INTENT] JSON 解析失败: {e}, raw={raw[:200]}")
        return {"action": None, "source": None, "error": f"JSON 解析失败: {e}"}


def _run_entity_exclusion_sync(project_id: str, message: str) -> str:
    """根据用户消息排除或恢复指定来源的实体。

    F001 原则 1：通过 _parse_exclusion_intent（LLM）解析用户意图，
    禁止正则或关键词列表。
    """
    from entity_extractor import list_entities, exclude_entity

    intent = _parse_exclusion_intent(message, "", project_id)
    action = intent.get("action")       # "exclude" | "restore" | None
    doc_name = intent.get("source")     # 文件名 | None

    all_entities = list_entities(project_id)
    if not all_entities:
        return "当前项目没有已抽取的实体。"

    all_sources = set(e.get("source", "") for e in all_entities if e.get("source"))

    if not doc_name:
        if intent.get("error"):
            action_hint = "排除"
        else:
            action_hint = "恢复" if action == "restore" else "排除"
        return (
            f"请指定要{action_hint}的文档名称。\n\n"
            f"当前实体来源：{', '.join(sorted(all_sources))}\n\n"
        )

    matched_source = None
    if doc_name in all_sources:
        matched_source = doc_name
    else:
        for src in all_sources:
            if src in doc_name or doc_name in src:
                matched_source = src
                break

    if not matched_source:
        return f"未找到来源为「{doc_name}」的实体。当前实体来源包括：{', '.join(sorted(all_sources))}"

    if action == "restore":
        targets = [e for e in all_entities if e.get("source") == matched_source and e.get("excluded")]
        if not targets:
            return f"来源「{matched_source}」没有被排除的实体，无需恢复。"
        for ent in targets:
            exclude_entity(ent["id"], False)
        return (
            f"已恢复来源为「{matched_source}」的 **{len(targets)}** 个实体。\n\n"
            f"图谱将重新显示这些实体。"
        )
    else:
        targets = [e for e in all_entities if e.get("source") == matched_source and not e.get("excluded")]
        if not targets:
            return f"来源「{matched_source}」的所有实体已被排除，无需重复操作。"
        for ent in targets:
            exclude_entity(ent["id"], True)

        # F001 原则 4：排除操作同时学习规则，下次抽取自动生效（Issue 004）
        import rule_manager
        rule_manager.save_rule(project_id, {
            "rule_type": "exclude_source",
            "description": f"忽略来源「{matched_source}」的所有实体",
            "rule_data": {"sources": [matched_source]},
            "source_message": message,
        })

        return (
            f"已将来源为「{matched_source}」的 **{len(targets)}** 个实体标记为排除。\n\n"
            f"已同时记录规则：下次从该文档抽取时将自动忽略其实体。\n\n"
            f"图谱将不再显示这些实体。如需恢复，请在右侧图谱面板的「已排除」区域点击恢复。"
        )


def _run_rule_learning_sync(project_id: str, message: str) -> str:
    """用 LLM 理解用户的规则学习意图，保存到 extraction_rules 表。

    F001 原则 4：规则约束必须由大模型从对话中学习并持久化。
    """
    import rule_manager

    rule = rule_manager.parse_rule_from_feedback(message, project_id)

    if rule is None or rule.get("error"):
        return (
            "抱歉，我无法理解你想设置的规则，请用更清晰的方式描述。\n\n"
            "示例：「不要把章节标题抽成实体」、「以后忽略日期类的实体」"
        )

    rule["source_message"] = message
    rule_manager.save_rule(project_id, rule)

    desc = rule.get("description", "")
    rtype = rule.get("rule_type", "custom")
    type_labels = {
        "exclude_entity_type": "排除实体类型",
        "exclude_source": "忽略来源",
        "exclude_pattern": "排除匹配模式",
        "custom": "自定义规则",
    }
    return (
        f"✅ 已记录规则：**{desc}**\n\n"
        f"规则类型：{type_labels.get(rtype, rtype)}\n\n"
        "此规则将在下次实体抽取时自动生效。"
    )


async def _extract_doc_name_llm(message: str, context: str = "") -> str | None:
    """用 LLM 从用户消息中识别目标文档名称。

    F001 原则 1：意图理解必须由大模型完成，禁止正则或文件名子串匹配。
    LLM 失败或用户未指定特定文档时返回 None（表示处理全部文档）。
    """
    from agno.agent import Agent

    files: list[str] = []
    if KNOWLEDGE_DOCS_DIR.exists():
        files = [f.name for f in KNOWLEDGE_DOCS_DIR.iterdir() if f.is_file() and not f.name.startswith(".")]

    file_list_str = "\n".join(f"- {f}" for f in files) if files else "（暂无文档）"

    system_prompt = (
        "你是文档名提取器。\n\n"
        f"知识库中的文档列表：\n{file_list_str}\n\n"
        "从用户消息中判断用户是否指定了某个具体文档：\n"
        '- 若用户指明了特定文档（文件名、部分名称或描述），从列表中找到最匹配的文件，返回 {"target": "完整文件名"}\n'
        '- 若用户使用泛指（"所有文档"/"知识库"/"上面的文档" 等），返回 {"target": null}\n'
        "只返回 JSON，不要任何解释。"
    )
    user_prompt = f"用户消息：{message}"
    if context:
        user_prompt += f"\n\n近期对话（供参考）：\n{context[:500]}"

    extractor = Agent(
        name="DocNameExtractor",
        model=create_model(),
        instructions=[system_prompt],
        markdown=False,
    )
    try:
        response = await asyncio.wait_for(
            extractor.arun(user_prompt, stream=False),
            timeout=8,
        )
        raw = (response.content or "").strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[-1]
        if raw.endswith("```"):
            raw = raw.rsplit("```", 1)[0]
        data = json.loads(raw.strip())
        return data.get("target") or None
    except Exception as e:
        print(f"[DOC_NAME] LLM 提取文档名失败，将处理全部文档: {e}")
        return None


# ---------------------------------------------------------------------------
# LLM 驱动的 Skill 代码生成（F001 原则 3：Skill 必须由大模型生成）
#
# 历史上此处存在 _CAPABILITY_TEMPLATES 硬编码字典（entity_extract / entity_exclude 两个
# 固定模板）+ _handle_create_skill 关键词匹配 + 模板字符串复制，完全没有 LLM 参与生成。
# 已于 Issue 001 修复时移除，改为由 LLM 动态生成 Skill 代码。
# 详见 docs/KNOWN_ISSUES.md#001-系统使用硬编码模板而非动态生成技能
# ---------------------------------------------------------------------------

_SKILL_GENERATION_SYSTEM_PROMPT = """你是一个 AgentOS Skill 代码生成器。根据用户需求生成合法的 Python Skill 文件。

## Skill 文件规范

每个 Skill 文件必须包含：
1. `SKILL_META` 字典（必填）：
```python
SKILL_META = {
    "name": "技能显示名称（≤20字）",
    "icon": "单个 emoji",
    "category": "analysis" | "data" | "code" | "search" | "api",
    "description": "技能功能描述（5-200字）",
}
```

2. `run(**params)` 函数（必填）：
- 参数只能用 str / int / float / bool 类型注解（或无注解）
- 必须返回 str
- 函数内部可导入任何标准库；AgentOS 内部模块用 `sys.path.insert(0, ...)` 导入

## 可用的 AgentOS 内部工具

```python
# 实体相关
from entity_extractor import extract_entities_sync, list_entities, exclude_entity

# 知识库文档
from doc_parser import read_document_text
from config import KNOWLEDGE_DOCS_DIR

# LLM 调用（推荐）
from llm_invoker import safe_llm_call_sync, LLMCallError
from llm import create_model
from agno.agent import Agent
```

## 要求

- 只输出纯 Python 代码，不要 markdown 代码块（不要 ```python）
- 代码必须语法正确
- 不使用硬编码正则或关键词列表做意图解析，应通过 LLM 调用解析用户输入
- 文件名必须是合法的 Python 标识符加 .py 后缀
- 输出格式：先输出 <FILENAME>xxx.py</FILENAME>，换行后输出完整 Python 代码
"""

_SKILL_FILENAME_CHARS = frozenset(
    "abcdefghijklmnopqrstuvwxyz0123456789_"
)


def _handle_create_skill(message: str) -> str:
    """用 LLM 动态生成 Skill 代码并注册到 skills/ 目录。

    流程：
    1. 调用 LLM 分析用户意图 + 生成完整 Skill Python 代码
    2. 解析 <FILENAME>xxx.py</FILENAME> 标签得到目标文件名
    3. ast.parse 语法校验
    4. 检查 SKILL_META + run 函数存在性
    5. 写入 SKILLS_DIR / filename，调用 scan_skills() 注册
    """
    from agno.agent import Agent

    existing_skills = ", ".join(_skill_registry.keys()) or "（暂无）"
    prompt = (
        f"用户需求：{message}\n\n"
        f"当前已注册技能：{existing_skills}\n\n"
        "请根据用户需求生成一个新的 Skill Python 文件。"
        "先输出 <FILENAME>合法文件名.py</FILENAME>，换行后输出完整 Python 代码（不加 markdown 围栏）。"
    )

    agent = Agent(
        name="SkillGenerator",
        model=create_model(),
        instructions=[_SKILL_GENERATION_SYSTEM_PROMPT],
        markdown=False,
    )

    try:
        result = safe_llm_call_sync(agent, prompt, max_retries=2, initial_backoff=1.0)
    except LLMCallError as e:
        return f"技能生成失败：LLM 调用异常（{e.reason}）。请稍后重试。"

    raw = (result.content or "").strip()

    # 解析文件名
    import re as _re
    filename_match = _re.search(r"<FILENAME>([\w\-]+\.py)</FILENAME>", raw)
    if filename_match:
        filename = filename_match.group(1)
        # 把代码部分（去掉 <FILENAME> 标签行）
        code = _re.sub(r"<FILENAME>.*?</FILENAME>\s*", "", raw, flags=_re.DOTALL).strip()
    else:
        # 尝试从注释或第一行推断文件名，或用通用名
        first_line = raw.split("\n")[0].strip()
        if first_line.endswith(".py") and all(c in _SKILL_FILENAME_CHARS for c in first_line[:-3]):
            filename = first_line
            code = "\n".join(raw.split("\n")[1:]).strip()
        else:
            filename = "custom_skill.py"
            code = raw

    # 去掉可能残留的 markdown 围栏
    if code.startswith("```"):
        code = code.split("\n", 1)[-1]
    if code.endswith("```"):
        code = code.rsplit("```", 1)[0]
    code = code.strip()

    # 语法校验
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        print(f"[SKILL_GEN] LLM 生成的代码语法错误: {e}")
        return (
            f"技能生成失败：大模型返回的代码存在语法错误（{e}）。\n\n"
            "请尝试重新描述你需要的技能，或提供更详细的功能说明。"
        )

    # 结构校验：必须有 SKILL_META 和 run
    assigns = [n for n in ast.walk(tree) if isinstance(n, ast.Assign)]
    has_meta = any(
        isinstance(t, ast.Name) and t.id == "SKILL_META"
        for a in assigns for t in a.targets
    )
    has_run = any(
        isinstance(n, ast.FunctionDef) and n.name == "run"
        for n in ast.walk(tree)
    )
    if not has_meta or not has_run:
        missing = []
        if not has_meta:
            missing.append("SKILL_META")
        if not has_run:
            missing.append("run() 函数")
        return (
            f"技能生成失败：大模型返回的代码缺少必要结构（{', '.join(missing)}）。\n\n"
            "请重试，或明确告诉我需要什么功能的技能。"
        )

    # 写入文件
    skill_file = SKILLS_DIR / filename
    skill_file.write_text(code, encoding="utf-8")
    print(f"[SKILL_GEN] 已写入 Skill 文件: {skill_file}")

    scan_skills()

    skill_id = filename.removesuffix(".py")
    if skill_id in _skill_registry:
        meta = _skill_registry[skill_id].get("meta", {})
        return (
            f"已成功生成并注册技能「{meta.get('name', skill_id)}」\n\n"
            f"- 文件：`skills/{filename}`\n"
            f"- 类别：{meta.get('category', '未知')}\n"
            f"- 说明：{meta.get('description', '—')}\n"
            f"- 后续执行相关操作时，系统将自动通过此技能执行"
        )
    else:
        return (
            f"技能文件已生成（`skills/{filename}`），但注册验证未通过。\n\n"
            f"可能原因：run() 参数类型不在允许范围，或 SKILL_META 字段不完整。\n"
            f"请查看后端日志了解详情。"
        )


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

    async def _stream_biz_direct(message: str, *, session_id: str | None = None):
        """BizAgent 直接回答（不经过编排）。

        session_id=None 时不加载历史，用于 thinking 模型的降级重试。
        """
        biz_agent = get_agent("global")
        if not biz_agent:
            yield _sse({"type": "content", "content": "BizAgent 未就绪", "done": True})
            return

        sid = session_id if session_id is not None else f"biz_{project_id}_{request.session_id}"
        collected: list[str] = []
        try:
            async with asyncio.timeout(180):
                async for chunk in biz_agent.arun(
                    message,
                    stream=True,
                    session_id=sid,
                ):
                    if chunk.content:
                        cleaned = clean_delta(chunk.content)
                        if cleaned:
                            collected.append(cleaned)
                            yield _sse({"type": "content", "content": cleaned, "done": False})
        except Exception as e:
            err_str = str(e)
            if "reasoning_content" in err_str or "thinking is enabled" in err_str:
                # Kimi/Claude thinking 模型在多轮工具调用时 reasoning_content 丢失；
                # 回退到不带 session 历史的单次调用，避免错误消息直接暴露给用户
                print(f"[BIZ] thinking reasoning_content 错误，降级为无历史单次重试: {err_str}")
                if session_id is not None:
                    # 已经是降级重试，不再递归
                    yield _sse({
                        "type": "content",
                        "content": "抱歉，当前模型在处理复杂请求时遇到内部错误，请直接描述你的问题。",
                        "done": False,
                    })
                else:
                    async for ev in _stream_biz_direct(message, session_id=f"biz_notool_{project_id}_{request.session_id}"):
                        yield ev
                return
            raise

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

            intent = await classify_intent(request.message, context_str)
            print(f"[INTENT] => {intent}")

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
                target_file = await _extract_doc_name_llm(request.message, context_str)
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
                    import inspect as _inspect

                    sig = _inspect.signature(skill["run_fn"])
                    supports_progress = "progress_cb" in sig.parameters

                    if supports_progress:
                        loop = asyncio.get_running_loop()
                        progress_queue: asyncio.Queue = asyncio.Queue()

                        def _thread_progress_cb(current, total, label, status):
                            loop.call_soon_threadsafe(
                                progress_queue.put_nowait,
                                {"current": current, "total": total,
                                 "label": label, "status": status},
                            )

                        async def _run_skill_with_done_marker():
                            try:
                                return await asyncio.to_thread(
                                    skill["run_fn"],
                                    project_id, _parsed_task_id or "", target_file or "",
                                    progress_cb=_thread_progress_cb,
                                )
                            finally:
                                loop.call_soon_threadsafe(progress_queue.put_nowait, None)

                        skill_task = asyncio.create_task(_run_skill_with_done_marker())
                        while True:
                            event = await progress_queue.get()
                            if event is None:
                                break
                            yield _sse({
                                "type": "progress",
                                "current": event["current"],
                                "total": event["total"],
                                "label": event["label"],
                                "status": event["status"],
                                "done": False,
                            })
                        result_text = await skill_task
                    else:
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

            # --- 规则学习路径 ---
            if intent == "rule_learning":
                import rule_manager
                yield _sse({
                    "type": "plan_created",
                    "plan_id": f"rule_learn_{int(time.time())}",
                    "execution_mode": "single",
                    "reasoning": "正在学习用户设置的规则...",
                    "subtasks": [{"slot_id": 1, "description": "理解并记录规则"}],
                    "done": False,
                })
                yield _sse({"type": "subtask_started", "slot_id": 1, "description": "理解并记录规则", "done": False})

                result_text = await asyncio.to_thread(
                    _run_rule_learning_sync, project_id, request.message
                )

                yield _sse({"type": "subtask_completed", "slot_id": 1, "done": False})
                yield _sse({"type": "summary", "content": result_text, "done": False})
                _save_chat_message(chat_session_id, "assistant", result_text, "BizAgent")
                yield _sse({"type": "done", "content": "", "done": True})
                return

            # --- 通用 Skill 意图分发路径（Issue 007）---
            # 若 intent 匹配某 Skill 的声明 intent，直接调用该 Skill run_fn
            # 新 Skill 只需在 SKILL_META 中声明 intent，无需修改本文件
            skill_intent_map = {
                skill["meta"].get("intent"): (skill_key, skill)
                for skill_key, skill in _skill_registry.items()
                if skill.get("meta", {}).get("intent")
            }
            if intent in skill_intent_map and intent not in (
                "entity_extraction", "entity_exclusion"  # 保留专属路径兼容已有行为
            ):
                matched_key, matched_skill = skill_intent_map[intent]
                desc = matched_skill["meta"].get("description", matched_key)
                yield _sse({
                    "type": "plan_created",
                    "plan_id": f"skill_intent_{int(time.time())}",
                    "execution_mode": "single",
                    "reasoning": f"正在通过 Skill「{matched_skill['meta']['name']}」处理...",
                    "subtasks": [{"slot_id": 1, "description": desc}],
                    "done": False,
                })
                yield _sse({"type": "subtask_started", "slot_id": 1, "description": desc, "done": False})
                result_text = await asyncio.to_thread(
                    matched_skill["run_fn"], project_id, request.message
                )
                yield _sse({"type": "subtask_completed", "slot_id": 1, "done": False})
                yield _sse({"type": "summary", "content": result_text, "done": False})
                _save_chat_message(chat_session_id, "assistant", result_text, "BizAgent")
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
