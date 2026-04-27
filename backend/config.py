import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).parent
SKILLS_DIR = BASE_DIR / "skills"
KNOWLEDGE_DOCS_DIR = BASE_DIR / "knowledge" / "docs"
WORKSPACE_DIR = BASE_DIR / "workspace"
DATA_DIR = BASE_DIR / "data"
SESSIONS_DB = str(DATA_DIR / "sessions.db")
PROJECTS_DB = str(DATA_DIR / "projects.db")

SKILLS_DIR.mkdir(exist_ok=True)
KNOWLEDGE_DOCS_DIR.mkdir(parents=True, exist_ok=True)
DATA_DIR.mkdir(exist_ok=True)
WORKSPACE_DIR.mkdir(exist_ok=True)
