"""
实体排除/恢复 Skill。

F001 原则 1：用户意图（排除 vs 恢复、目标文档名）通过 LLM 解析，
禁止使用正则表达式或硬编码关键词列表。

Issue 008 修复：移除旧模板内的 3 条正则 + 5 个关键词判断，改为单次 LLM 调用
返回结构化 JSON {action, source}，再执行数据库操作。
"""

SKILL_META = {
    "name": "实体排除",
    "icon": "🚫",
    "category": "data",
    "description": "根据自然语言指令排除或恢复知识图谱中的实体（LLM 解析意图，无正则）",
    "intent": "entity_exclusion",
    "intent_description": "要求排除/删除/恢复/还原实体，修正实体抽取结果，管理实体的显示与隐藏",
}

_EXCLUSION_INTENT_PROMPT = """你是一个意图解析器。用户想对知识图谱中的实体执行排除或恢复操作。

从用户消息中提取以下信息，以 JSON 格式返回（不加 markdown 围栏）：
{
  "action": "exclude" | "restore",
  "source": "文档文件名 或 null"
}

规则：
- action: 含"恢复"/"还原"/"取消排除"/"重新加入"/"加回"等含义 → "restore"；其余默认 → "exclude"
- source: 识别文件名（如 report.pdf、test.md 等），没有明确文件名时返回 null
- 只返回 JSON，不要任何解释"""


def _parse_intent(instruction: str) -> dict:
    """调用 LLM 解析排除/恢复意图，返回 {action, source}。"""
    import sys
    import os
    import json as _json

    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from agno.agent import Agent
    from llm import create_model
    from llm_invoker import safe_llm_call_sync, LLMCallError

    agent = Agent(
        name="ExclusionIntentParser",
        model=create_model(),
        instructions=[_EXCLUSION_INTENT_PROMPT],
        markdown=False,
    )

    try:
        result = safe_llm_call_sync(agent, f"用户消息：{instruction}", max_retries=2, initial_backoff=0.5)
    except LLMCallError as e:
        print(f"[SKILL:entity_exclude] LLM 意图解析失败: {e.reason}")
        return {"action": None, "source": None, "error": e.reason}

    raw = (result.content or "").strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[-1]
    if raw.endswith("```"):
        raw = raw.rsplit("```", 1)[0]
    raw = raw.strip()

    try:
        parsed = _json.loads(raw)
        return {"action": parsed.get("action"), "source": parsed.get("source")}
    except (_json.JSONDecodeError, AttributeError) as e:
        print(f"[SKILL:entity_exclude] JSON 解析失败: {e}, raw={raw[:200]}")
        return {"action": None, "source": None, "error": str(e)}


def run(project_id: str, instruction: str = "") -> str:
    """根据自然语言指令排除或恢复实体。instruction 为用户原始消息。"""
    import sys
    import os

    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from entity_extractor import list_entities, exclude_entity

    print(f"[SKILL:entity_exclude] start: project={project_id}")

    all_entities = list_entities(project_id)
    if not all_entities:
        return "当前项目没有已抽取的实体。"

    all_sources = set(e.get("source", "") for e in all_entities if e.get("source"))

    intent = _parse_intent(instruction)
    action = intent.get("action")
    doc_name = intent.get("source")

    print(f"[SKILL:entity_exclude] intent={intent}")

    if not doc_name:
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
        return (
            f"未找到来源为「{doc_name}」的实体。\n\n"
            f"当前实体来源：{', '.join(sorted(all_sources))}"
        )

    if action == "restore":
        targets = [e for e in all_entities if e.get("source") == matched_source and e.get("excluded")]
        if not targets:
            return f"来源「{matched_source}」没有被排除的实体，无需恢复。"
        for ent in targets:
            exclude_entity(ent["id"], False)
        print(f"[SKILL:entity_exclude] restored {len(targets)} entities from {matched_source}")
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
        print(f"[SKILL:entity_exclude] excluded {len(targets)} entities from {matched_source}")
        return (
            f"已将来源为「{matched_source}」的 **{len(targets)}** 个实体标记为排除。\n\n"
            f"图谱将不再显示这些实体。如需恢复，请在右侧图谱面板的「已排除」区域点击恢复。"
        )
