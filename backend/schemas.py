from pydantic import BaseModel


class ChatRequest(BaseModel):
    message: str
    session_id: str = "default"


class SkillCreateRequest(BaseModel):
    description: str


class SkillRunRequest(BaseModel):
    params: dict


class AgentToolsRequest(BaseModel):
    skill_ids: list[str]


class LLMSettingsRequest(BaseModel):
    provider: str
    model_id: str = ""
    api_key: str = ""
    base_url: str = ""


class EmbeddingSettingsRequest(BaseModel):
    mode: str = "local"
    model_id: str = ""
    api_key: str = ""
    base_url: str = ""
    dimensions: int = 1024


class RerankerSettingsRequest(BaseModel):
    enabled: bool = False
    model_id: str = ""
    api_key: str = ""
    base_url: str = ""
    top_n: int = 5


class ProjectCreateRequest(BaseModel):
    name: str
    description: str = ""


class TaskCreateRequest(BaseModel):
    name: str


class CreateAgentRequest(BaseModel):
    name: str
    avatar: str = "🤖"
    description: str = ""
    instructions: list[str] | None = None
    skill_ids: list[str] | None = None
    builtin_tools: list[str] | None = None
    join_team: bool = False


class AgentConfigRequest(BaseModel):
    description: str | None = None
    instructions: list[str] | None = None


class WorkflowRunRequest(BaseModel):
    input: str
