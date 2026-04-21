const API_BASE = (import.meta.env.VITE_API_URL as string) || 'http://localhost:8000';

export interface ChatChunk {
  content?: string;
  done?: boolean;
  error?: string;
}

export interface SkillInfo {
  id: string;
  name: string;
  icon: string;
  category: string;
  description: string;
  params: Array<{ name: string; type: string; default?: string | null }>;
  mounted_agents?: Array<{ id: string; name: string }>;
}

export interface AgentInfo {
  id: string;
  name: string;
  avatar: string;
  description: string;
  capabilities: string[];
  builtin_tools: string[];
  custom_tools: string[];
  has_knowledge: boolean;
  instructions?: string[];
}

export interface StatsData {
  agents_count: number;
  skills_count: number;
  docs_count: number;
  workspace_files: number;
}

export interface WorkspaceFile {
  name: string;
  size: number;
  modified: number;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  steps: string[];
  icon: string;
}

export interface WorkflowRunStatus {
  run_id: string;
  workflow_id: string;
  status: 'running' | 'completed' | 'failed';
  current_step: number;
  total_steps: number;
  results: Array<{ step: string; status: string; output?: string }>;
}

export interface ProjectInfo {
  id: string;
  name: string;
  description: string;
  status: 'active' | 'idle' | 'completed';
  created_at: string;
  updated_at: string;
}

/**
 * 向指定 Agent 发送消息，通过 SSE 流式接收响应。
 */
export async function streamAgentChat(
  agentId: string,
  message: string,
  sessionId: string,
  onChunk: (chunk: ChatChunk) => void,
): Promise<void> {
  const response = await fetch(`${API_BASE}/api/agents/${agentId}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, session_id: sessionId }),
  });

  if (!response.ok) {
    throw new Error(`后端响应异常: ${response.status} ${response.statusText}`);
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const text = decoder.decode(value, { stream: true });
    for (const line of text.split('\n')) {
      if (line.startsWith('data: ')) {
        try {
          const data: ChatChunk = JSON.parse(line.slice(6));
          onChunk(data);
        } catch {
          // skip
        }
      }
    }
  }
}

export interface TeamChatEvent {
  type: 'leader_content' | 'member_delegated' | 'member_response' | 'member_streaming' | 'member_started' | 'done';
  content?: string;
  agent_name?: string;
  task?: string;
  done?: boolean;
}

/**
 * 向 Team 发送消息，通过 SSE 流式接收协作响应（含成员事件）。
 */
export async function streamTeamChat(
  projectId: string,
  message: string,
  sessionId: string,
  onEvent: (event: TeamChatEvent) => void,
): Promise<void> {
  const response = await fetch(`${API_BASE}/api/teams/${projectId}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, session_id: sessionId }),
  });

  if (!response.ok) {
    throw new Error(`后端响应异常: ${response.status} ${response.statusText}`);
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const text = decoder.decode(value, { stream: true });
    for (const line of text.split('\n')) {
      if (line.startsWith('data: ')) {
        try {
          const data: TeamChatEvent = JSON.parse(line.slice(6));
          onEvent(data);
        } catch {
          // skip
        }
      }
    }
  }
}

/** 检查后端健康状态 */
export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** 获取后端 Agent 列表 */
export async function fetchAgents(): Promise<AgentInfo[]> {
  const res = await fetch(`${API_BASE}/api/agents`);
  if (!res.ok) return [];
  return res.json();
}

/** 获取项目列表 */
export async function fetchProjects(): Promise<ProjectInfo[]> {
  const res = await fetch(`${API_BASE}/api/projects`);
  if (!res.ok) return [];
  return res.json();
}

/** 创建项目 */
export async function createProject(name: string, description: string): Promise<ProjectInfo> {
  const res = await fetch(`${API_BASE}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description }),
  });
  return res.json();
}

/** 删除项目 */
export async function deleteProject(id: string): Promise<void> {
  await fetch(`${API_BASE}/api/projects/${id}`, { method: 'DELETE' });
}

/** 获取后端技能列表 */
export async function fetchSkills(): Promise<SkillInfo[]> {
  const res = await fetch(`${API_BASE}/api/skills`);
  if (!res.ok) return [];
  return res.json();
}

/** 创建新技能 */
export async function createSkill(description: string): Promise<{ success: boolean; skill_id?: string; error?: string }> {
  const res = await fetch(`${API_BASE}/api/skills/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description }),
  });
  return res.json();
}

/** 执行技能 */
export async function runSkill(skillId: string, params: Record<string, string | number>): Promise<{ success: boolean; result?: string; error?: string }> {
  const res = await fetch(`${API_BASE}/api/skills/${skillId}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ params }),
  });
  return res.json();
}

/** 删除技能 */
export async function deleteSkill(skillId: string): Promise<{ success: boolean; error?: string }> {
  const res = await fetch(`${API_BASE}/api/skills/${skillId}`, { method: 'DELETE' });
  return res.json();
}

/** 设置 Agent 挂载的技能列表 */
export async function setAgentTools(agentId: string, skillIds: string[]): Promise<{ success: boolean; error?: string }> {
  const res = await fetch(`${API_BASE}/api/agents/${agentId}/tools`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ skill_ids: skillIds }),
  });
  return res.json();
}

/** 更新 Agent 配置（描述、指令） */
export async function updateAgentConfig(
  agentId: string,
  config: { description?: string; instructions?: string[] },
): Promise<{ success: boolean; error?: string }> {
  const res = await fetch(`${API_BASE}/api/agents/${agentId}/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  return res.json();
}

/** 上传文档到知识库 */
export async function uploadDocument(file: File): Promise<{ success: boolean; doc_name?: string; chunks?: number; error?: string }> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${API_BASE}/api/knowledge/upload`, {
    method: 'POST',
    body: formData,
  });
  return res.json();
}

/** 获取统计数据 */
export async function fetchStats(): Promise<StatsData> {
  const res = await fetch(`${API_BASE}/api/stats`);
  if (!res.ok) return { agents_count: 0, skills_count: 0, docs_count: 0, workspace_files: 0 };
  return res.json();
}

/** 获取工作区文件列表 */
export async function fetchWorkspaceFiles(): Promise<WorkspaceFile[]> {
  const res = await fetch(`${API_BASE}/api/workspace/files`);
  if (!res.ok) return [];
  return res.json();
}

/** 获取工作区文件下载 URL */
export function getWorkspaceFileUrl(filename: string): string {
  return `${API_BASE}/api/workspace/files/${encodeURIComponent(filename)}`;
}

/** 获取知识库文档列表 */
export async function fetchKnowledgeDocs(): Promise<Array<{ doc_name: string; chunks: number }>> {
  const res = await fetch(`${API_BASE}/api/knowledge/docs`);
  if (!res.ok) return [];
  return res.json();
}

/** 获取工作流模板列表 */
export async function fetchWorkflows(): Promise<WorkflowTemplate[]> {
  const res = await fetch(`${API_BASE}/api/workflows`);
  if (!res.ok) return [];
  return res.json();
}

/** 执行工作流 */
export async function runWorkflow(
  workflowId: string,
  input: Record<string, unknown>,
  onChunk: (chunk: ChatChunk) => void,
): Promise<void> {
  const response = await fetch(`${API_BASE}/api/workflows/${workflowId}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(`工作流执行失败: ${response.status}`);
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const text = decoder.decode(value, { stream: true });
    for (const line of text.split('\n')) {
      if (line.startsWith('data: ')) {
        try {
          const data: ChatChunk = JSON.parse(line.slice(6));
          onChunk(data);
        } catch {
          // skip
        }
      }
    }
  }
}

/**
 * 技能对话式管理：向技能管理 Agent 发消息，SSE 流式接收响应。
 */
export async function streamSkillChat(
  skillId: string,
  message: string,
  sessionId: string,
  onChunk: (chunk: ChatChunk) => void,
): Promise<void> {
  const response = await fetch(`${API_BASE}/api/skills/${skillId}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, session_id: sessionId }),
  });

  if (!response.ok) {
    throw new Error(`后端响应异常: ${response.status} ${response.statusText}`);
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const text = decoder.decode(value, { stream: true });
    for (const line of text.split('\n')) {
      if (line.startsWith('data: ')) {
        try {
          const data: ChatChunk = JSON.parse(line.slice(6));
          onChunk(data);
        } catch {
          // skip
        }
      }
    }
  }
}
