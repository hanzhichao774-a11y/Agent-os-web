import time
import uuid
import sqlite3
from datetime import datetime, timezone

from config import PROJECTS_DB


def _get_projects_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(PROJECTS_DB)
    conn.row_factory = sqlite3.Row
    return conn


def _init_projects_db():
    conn = _get_projects_conn()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'active',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS tasks (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            name TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS chat_messages (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL DEFAULT '',
            agent_name TEXT DEFAULT '',
            created_at REAL NOT NULL
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_chat_session ON chat_messages(session_id, created_at)")
    conn.commit()
    count = conn.execute("SELECT COUNT(*) FROM projects").fetchone()[0]
    if count == 0:
        now = datetime.now(timezone.utc).isoformat()
        seed = [
            ("p1", "Q3 财报分析", "季度财务数据汇总与可视化", "active", now, now),
            ("p2", "供应链优化", "物流路径与库存优化方案", "active", now, now),
            ("p3", "客户流失预警", "高价值客户流失风险评估", "idle", now, now),
        ]
        conn.executemany(
            "INSERT INTO projects (id, name, description, status, created_at, updated_at) VALUES (?,?,?,?,?,?)",
            seed,
        )
        conn.commit()
    conn.close()


_init_projects_db()


def _save_chat_message(session_id: str, role: str, content: str, agent_name: str = ""):
    """将一条聊天消息写入 chat_messages 表。"""
    msg_id = f"msg_{uuid.uuid4().hex[:12]}"
    conn = _get_projects_conn()
    conn.execute(
        "INSERT OR IGNORE INTO chat_messages (id, session_id, role, content, agent_name, created_at) VALUES (?,?,?,?,?,?)",
        (msg_id, session_id, role, content, agent_name, time.time()),
    )
    conn.commit()
    conn.close()
    return msg_id


def _load_chat_messages(session_id: str) -> list[dict]:
    """从 chat_messages 表加载指定 session 的消息。"""
    conn = _get_projects_conn()
    rows = conn.execute(
        "SELECT id, role, content, agent_name, created_at FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC",
        (session_id,),
    ).fetchall()
    conn.close()
    return [{"id": r["id"], "role": r["role"], "content": r["content"], "agent_name": r["agent_name"], "timestamp": r["created_at"]} for r in rows]
