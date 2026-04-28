"""Thread-safe context variables for tracking the current project/task scope."""

from contextvars import ContextVar

current_project_id: ContextVar[str | None] = ContextVar("current_project_id", default=None)
current_task_id: ContextVar[str | None] = ContextVar("current_task_id", default=None)
