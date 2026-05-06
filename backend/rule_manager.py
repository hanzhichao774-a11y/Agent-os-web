"""
规则学习管理器（F001 原则 4：规则约束必须由大模型从对话中学习并持久化）。

提供三个核心能力：
1. parse_rule_from_feedback  — LLM 理解用户反馈 → 结构化规则 dict
2. save_rule                 — 持久化规则到 extraction_rules 表
3. load_rules                — 按 project_id 加载项目规则
4. rules_to_prompt_text      — 规则列表 → 可注入 LLM prompt 的文字描述

Issue 002 + 004 修复核心实现。
"""
from __future__ import annotations

import json
import uuid
import time
from typing import Optional

from database import _get_projects_conn
from llm import create_model
from llm_invoker import safe_llm_call_sync, LLMCallError

_RULE_PARSE_SYSTEM_PROMPT = """你是一个规则理解器。用户希望对实体抽取设置约束或引导。

从用户反馈中提取结构化规则，以 JSON 返回（不加 markdown 围栏）：
{
  "rule_type": "exclude_entity_type" | "exclude_source" | "exclude_pattern" | "focus_on" | "strategy" | "custom",
  "description": "用一句话描述这条规则",
  "rule_data": {
    // exclude_entity_type: {"entity_types": [...], "patterns": [...]}
    // exclude_source:       {"sources": [...]}            // 文档文件名列表
    // exclude_pattern:      {"patterns": [...]}           // 文字模式
    // focus_on:             {"entity_types": [...], "keywords": [...]}  // 优先抽取的类型/关键词
    // strategy:             {"doc_type": "...", "priority_types": [...], "hint": "..."}  // 整体抽取策略
    // custom:               {}
  }
}

规则类型说明：
- exclude_entity_type: 某类实体不应被抽取（如"章节标题"、"页码"、"日期"）
- exclude_source:      特定来源文档的实体不应被抽取
- exclude_pattern:     匹配特定文字模式的实体不应被抽取
- focus_on:            用户希望重点关注/优先抽取某类实体（如"重点抽取财务指标"、"优先提取人名"）
- strategy:            用户描述文档特征或整体抽取策略（如"这是学术论文，关注概念和方法论"）
- custom:              其它自定义规则

判断依据：
- 用户说"不要"、"忽略"、"排除"、"跳过" → exclude_*
- 用户说"重点"、"优先"、"关注"、"着重"、"只抽取" → focus_on
- 用户描述文档类型/领域特征 → strategy
- 混合指令 → 选最主要的一类

只返回 JSON，不要任何解释。"""


def parse_rule_from_feedback(
    message: str,
    project_id: str,
) -> Optional[dict]:
    """用 LLM 解析用户反馈，返回结构化规则 dict，解析失败返回 None。

    F001 原则 4：规则理解必须由大模型完成，禁止正则或关键词列表。
    """
    from agno.agent import Agent

    agent = Agent(
        name="RuleParser",
        model=create_model(),
        instructions=[_RULE_PARSE_SYSTEM_PROMPT],
        markdown=False,
    )

    try:
        result = safe_llm_call_sync(
            agent,
            f"用户反馈：{message}\n项目 ID：{project_id}",
            max_retries=2,
            initial_backoff=0.5,
        )
    except LLMCallError as e:
        print(f"[RULE_MGR] LLM 规则解析失败: {e.reason}")
        return {"error": e.reason}

    raw = (result.content or "").strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[-1]
    if raw.endswith("```"):
        raw = raw.rsplit("```", 1)[0]
    raw = raw.strip()

    try:
        parsed = json.loads(raw)
        return {
            "rule_type": parsed.get("rule_type", "custom"),
            "description": parsed.get("description", message[:100]),
            "rule_data": parsed.get("rule_data", {}),
        }
    except (json.JSONDecodeError, AttributeError) as e:
        print(f"[RULE_MGR] JSON 解析失败: {e}, raw={raw[:200]}")
        return None


def save_rule(project_id: str, rule: dict) -> str:
    """将规则持久化到 extraction_rules 表，返回新规则 ID。"""
    conn = _get_projects_conn()
    rule_id = str(uuid.uuid4())
    now = time.time()

    rule_data = rule.get("rule_data", {})
    if isinstance(rule_data, dict):
        rule_data_str = json.dumps(rule_data, ensure_ascii=False)
    else:
        rule_data_str = str(rule_data)

    conn.execute(
        """
        INSERT INTO extraction_rules (id, project_id, rule_type, description, rule_data, source_message, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            rule_id,
            project_id,
            rule.get("rule_type", "custom"),
            rule.get("description", ""),
            rule_data_str,
            rule.get("source_message", ""),
            now,
        ),
    )
    conn.commit()
    conn.close()
    print(f"[RULE_MGR] 已保存规则: {rule_id} [{rule.get('rule_type')}] {rule.get('description')[:40]}")
    return rule_id


def load_rules(project_id: str) -> list[dict]:
    """加载指定项目的所有规则，按创建时间排序。"""
    conn = _get_projects_conn()
    rows = conn.execute(
        """
        SELECT id, project_id, rule_type, description, rule_data, source_message, created_at
        FROM extraction_rules
        WHERE project_id = ?
        ORDER BY created_at ASC
        """,
        (project_id,),
    ).fetchall()
    conn.close()

    result = []
    for row in rows:
        try:
            rule_data = json.loads(row["rule_data"]) if row["rule_data"] else {}
        except (json.JSONDecodeError, TypeError):
            rule_data = {}
        result.append({
            "id": row["id"],
            "project_id": row["project_id"],
            "rule_type": row["rule_type"],
            "description": row["description"],
            "rule_data": rule_data,
            "source_message": row["source_message"],
            "created_at": row["created_at"],
        })
    return result


def rules_to_prompt_text(rules: list[dict]) -> str:
    """将规则列表转换为可插入 LLM prompt 的文字描述。

    返回空字符串时表示无规则，调用方应使用默认 '（无）' 提示。
    """
    if not rules:
        return ""

    lines = []
    for rule in rules:
        rtype = rule.get("rule_type", "custom")
        desc = rule.get("description", "")
        rule_data = rule.get("rule_data", {})

        if rtype == "exclude_entity_type":
            patterns = rule_data.get("patterns", [])
            entity_types = rule_data.get("entity_types", [])
            parts = []
            if patterns:
                parts.append(f"模式：{', '.join(patterns)}")
            if entity_types:
                parts.append(f"类型：{', '.join(entity_types)}")
            suffix = f"（{'; '.join(parts)}）" if parts else ""
            lines.append(f"- 排除以下实体类型{suffix}：{desc}")

        elif rtype == "exclude_source":
            sources = rule_data.get("sources", [])
            src_str = "、".join(sources) if sources else ""
            lines.append(f"- 忽略来源 [{src_str}] 的实体：{desc}")

        elif rtype == "exclude_pattern":
            patterns = rule_data.get("patterns", [])
            ptn_str = "、".join(patterns) if patterns else ""
            lines.append(f"- 排除匹配以下模式的实体（{ptn_str}）：{desc}")

        elif rtype == "focus_on":
            entity_types = rule_data.get("entity_types", [])
            keywords = rule_data.get("keywords", [])
            parts = []
            if entity_types:
                parts.append(f"实体类型：{', '.join(entity_types)}")
            if keywords:
                parts.append(f"关键词：{', '.join(keywords)}")
            suffix = f"（{'; '.join(parts)}）" if parts else ""
            lines.append(f"- 重点关注/优先抽取{suffix}：{desc}")

        elif rtype == "strategy":
            doc_type = rule_data.get("doc_type", "")
            priority_types = rule_data.get("priority_types", [])
            hint = rule_data.get("hint", "")
            parts = []
            if doc_type:
                parts.append(f"文档类型：{doc_type}")
            if priority_types:
                parts.append(f"优先实体类型：{', '.join(priority_types)}")
            if hint:
                parts.append(hint)
            detail = "；".join(parts) if parts else ""
            lines.append(f"- 抽取策略（{detail}）：{desc}")

        else:
            lines.append(f"- {desc}")

    return "\n".join(lines)


_POSITIVE_RULE_TYPES = {"focus_on", "strategy"}
_NEGATIVE_RULE_TYPES = {"exclude_entity_type", "exclude_source", "exclude_pattern"}


def build_extraction_exclusion_text(project_id: str, base_excluded: str = "") -> str:
    """构建实体抽取的完整约束 + 策略提示文本，融合：
    - DB 已排除实体名单（base_excluded）
    - 用户学习的排除规则（exclude_*）
    - 用户学习的正向引导规则（focus_on / strategy）

    供 entity_extractor.py 和 entity_extract Skill 调用。
    F001 原则 4：规则应用必须覆盖正向与负向约束。
    """
    rules = load_rules(project_id)

    negative_rules = [r for r in rules if r.get("rule_type") in _NEGATIVE_RULE_TYPES]
    positive_rules = [r for r in rules if r.get("rule_type") in _POSITIVE_RULE_TYPES]
    other_rules = [r for r in rules if r.get("rule_type") not in _POSITIVE_RULE_TYPES | _NEGATIVE_RULE_TYPES]

    parts = []
    if base_excluded:
        parts.append(f"已排除实体名单：{base_excluded}")

    if negative_rules or other_rules:
        neg_text = rules_to_prompt_text(negative_rules + other_rules)
        if neg_text:
            parts.append(f"用户排除规则（必须遵守）：\n{neg_text}")

    if positive_rules:
        pos_text = rules_to_prompt_text(positive_rules)
        if pos_text:
            parts.append(f"用户抽取重点与策略（请着重关注）：\n{pos_text}")

    if not parts:
        parts.append("（无）")

    return "\n".join(parts)
