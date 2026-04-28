from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Agent OS API", version="3.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from routes.settings import router as settings_router
from routes.sessions import router as sessions_router
from routes.chat import router as chat_router
from routes.skills import router as skills_router
from routes.agents_api import router as agents_router
from routes.projects import router as projects_router
from routes.knowledge_api import router as knowledge_router
from routes.stats import router as stats_router
from routes.workflows import router as workflows_router
from routes.workers import router as workers_router
from routes.entity_api import router as entity_router

app.include_router(settings_router)
app.include_router(sessions_router)
app.include_router(chat_router)
app.include_router(skills_router)
app.include_router(agents_router)
app.include_router(projects_router)
app.include_router(knowledge_router)
app.include_router(stats_router)
app.include_router(workflows_router)
app.include_router(workers_router)
app.include_router(entity_router)
