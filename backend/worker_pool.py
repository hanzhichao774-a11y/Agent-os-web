"""SubAgent 工位池：管理 3 个固定工位的状态、token 统计。"""

from __future__ import annotations

import time
from dataclasses import dataclass, field, asdict


@dataclass
class SubAgentSlot:
    slot_id: int
    status: str = "idle"  # idle | working | completed | error
    current_task: str | None = None
    result: str | None = None
    error: str | None = None
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    started_at: float | None = None
    completed_at: float | None = None
    # 累计统计（不会被 reset 清零）
    cumulative_input_tokens: int = 0
    cumulative_output_tokens: int = 0
    cumulative_total_tokens: int = 0
    tasks_completed: int = 0


_slots: list[SubAgentSlot] = [
    SubAgentSlot(slot_id=1),
    SubAgentSlot(slot_id=2),
    SubAgentSlot(slot_id=3),
]


def get_slot(slot_id: int) -> SubAgentSlot | None:
    for s in _slots:
        if s.slot_id == slot_id:
            return s
    return None


def get_available_slots() -> list[SubAgentSlot]:
    return [s for s in _slots if s.status == "idle"]


def assign_slot(slot_id: int, task_desc: str) -> SubAgentSlot:
    slot = get_slot(slot_id)
    if not slot:
        raise ValueError(f"工位 {slot_id} 不存在")
    slot.status = "working"
    slot.current_task = task_desc
    slot.result = None
    slot.error = None
    slot.input_tokens = 0
    slot.output_tokens = 0
    slot.total_tokens = 0
    slot.started_at = time.time()
    slot.completed_at = None
    return slot


def release_slot(slot_id: int, result: str, token_usage: dict | None = None):
    slot = get_slot(slot_id)
    if not slot:
        return
    slot.status = "completed"
    slot.result = result
    slot.completed_at = time.time()
    if token_usage:
        slot.input_tokens = token_usage.get("input_tokens", 0)
        slot.output_tokens = token_usage.get("output_tokens", 0)
        slot.total_tokens = token_usage.get("total_tokens", 0)
        slot.cumulative_input_tokens += slot.input_tokens
        slot.cumulative_output_tokens += slot.output_tokens
        slot.cumulative_total_tokens += slot.total_tokens
    slot.tasks_completed += 1


def fail_slot(slot_id: int, error: str):
    slot = get_slot(slot_id)
    if not slot:
        return
    slot.status = "error"
    slot.error = error
    slot.completed_at = time.time()


def reset_slot(slot_id: int):
    slot = get_slot(slot_id)
    if not slot:
        return
    slot.status = "idle"
    slot.current_task = None
    slot.result = None
    slot.error = None
    slot.input_tokens = 0
    slot.output_tokens = 0
    slot.total_tokens = 0
    slot.started_at = None
    slot.completed_at = None


def get_all_status() -> list[dict]:
    return [asdict(s) for s in _slots]


def get_token_stats() -> dict:
    total_in = sum(s.cumulative_input_tokens for s in _slots)
    total_out = sum(s.cumulative_output_tokens for s in _slots)
    total_all = sum(s.cumulative_total_tokens for s in _slots)
    total_tasks = sum(s.tasks_completed for s in _slots)
    return {
        "global": {
            "input_tokens": total_in,
            "output_tokens": total_out,
            "total_tokens": total_all,
            "tasks_completed": total_tasks,
        },
        "slots": [
            {
                "slot_id": s.slot_id,
                "input_tokens": s.cumulative_input_tokens,
                "output_tokens": s.cumulative_output_tokens,
                "total_tokens": s.cumulative_total_tokens,
                "tasks_completed": s.tasks_completed,
            }
            for s in _slots
        ],
    }
