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

/** 检查后端健康状态 */
export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
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
