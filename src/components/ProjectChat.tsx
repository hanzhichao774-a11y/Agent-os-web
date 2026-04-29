import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Send, Loader2, Paperclip, Plus, FolderOpen, Download, ExternalLink, Cpu } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { streamOrchestratorChat, uploadDocument, fetchTasks, fetchSessionMessages, getWorkspaceFileUrl } from '../services/api';
import type { TeamChatEvent, TaskInfo } from '../services/api';
import type { TeamAgentStatus, TeamTaskStep, OutputItem } from '../App';

export interface ActivePlanState {
  subtasks: Array<{ slot_id: number; description: string; status: string }>;
}

interface ProjectChatProps {
  projectId: string;
  taskId: string | null;
  projectName: string;
  projectDescription: string;
  onResetTeamState: () => void;
  onUpdateTeamAgents: (updater: (prev: TeamAgentStatus[]) => TeamAgentStatus[]) => void;
  onUpdateTeamSteps: (updater: (prev: TeamTaskStep[]) => TeamTaskStep[]) => void;
  onOutputsChange: (items: OutputItem[]) => void;
  onActivePlanChange?: (plan: ActivePlanState | null) => void;
}

interface ChatMsg {
  id: string;
  role: 'system' | 'leader' | 'member' | 'delegation' | 'human' | 'plan';
  agentName?: string;
  content: string;
  timestamp: string;
}

function stripThinkTags(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<\/?member[^>]*>/g, '').trim();
}

function MarkdownContent({ content }: { content: string }) {
  const cleaned = useMemo(() => stripThinkTags(content), [content]);
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
        ul: ({ children }) => <ul className="list-disc pl-4 mb-2">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal pl-4 mb-2">{children}</ol>,
        li: ({ children }) => <li className="mb-0.5">{children}</li>,
        h1: ({ children }) => <h1 className="text-base font-bold mb-2">{children}</h1>,
        h2: ({ children }) => <h2 className="text-sm font-bold mb-1.5">{children}</h2>,
        h3: ({ children }) => <h3 className="text-sm font-semibold mb-1">{children}</h3>,
        code: ({ children, className }) => {
          const isBlock = className?.startsWith('language-');
          if (isBlock) {
            return (
              <pre className="bg-gray-100 dark:bg-gray-800 rounded-lg p-3 overflow-x-auto text-xs mb-2">
                <code>{children}</code>
              </pre>
            );
          }
          return <code className="bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded text-xs">{children}</code>;
        },
        pre: ({ children }) => <>{children}</>,
        table: ({ children }) => (
          <div className="overflow-x-auto mb-2">
            <table className="min-w-full text-xs border-collapse border border-gray-200 dark:border-gray-700">{children}</table>
          </div>
        ),
        thead: ({ children }) => <thead className="bg-gray-50 dark:bg-gray-800">{children}</thead>,
        th: ({ children }) => <th className="px-2 py-1 border border-gray-200 dark:border-gray-700 font-semibold text-left">{children}</th>,
        td: ({ children }) => <td className="px-2 py-1 border border-gray-200 dark:border-gray-700">{children}</td>,
        strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
        blockquote: ({ children }) => (
          <blockquote className="border-l-3 border-gray-300 dark:border-gray-600 pl-3 italic text-text-muted mb-2">{children}</blockquote>
        ),
        hr: () => <hr className="my-2 border-gray-200 dark:border-gray-700" />,
      }}
    >
      {cleaned}
    </ReactMarkdown>
  );
}

const OUTPUT_FILE_PATTERN = /(?:已生成|文件名称|文件名|文件路径|生成文件)\**[：:\s]+`?(\S+?\.(pdf|xlsx|xls|csv|png|jpg|pptx?|docx?|txt|md))`?/gi;

function parseOutputItems(content: string, msgId: string, agentName?: string, timestamp?: string): OutputItem[] {
  const items: OutputItem[] = [];
  const seen = new Set<string>();

  let match: RegExpExecArray | null;

  const fileRe = new RegExp(OUTPUT_FILE_PATTERN.source, 'gi');
  while ((match = fileRe.exec(content)) !== null) {
    const fileName = match[1];
    const ext = match[2].toUpperCase();
    const key = `file:${fileName}`;
    if (!seen.has(key)) {
      seen.add(key);
      items.push({ id: `${msgId}_file_${items.length}`, title: fileName, type: ext, agentName, timestamp: timestamp || '' });
    }
  }

  return items;
}

function OutputCards({ items }: { items: OutputItem[] }) {
  if (items.length === 0) return null;

  const isPreviewable = (name: string) =>
    /\.(pdf|png|jpe?g|gif|webp|svg|txt|md|json|csv)$/i.test(name);

  const handleClick = (title: string) => {
    const url = getWorkspaceFileUrl(title);
    if (isPreviewable(title)) {
      window.open(url, '_blank');
    } else {
      fetch(url).then(r => r.blob()).then(blob => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = title;
        a.click();
        URL.revokeObjectURL(a.href);
      });
    }
  };

  return (
    <div className="mt-3 space-y-2">
      {items.map((item) => (
        <div
          key={item.id}
          onClick={() => handleClick(item.title)}
          className="flex items-center gap-3 border border-border rounded-lg px-4 py-3 hover:bg-primary/5 transition-colors cursor-pointer group"
        >
          {isPreviewable(item.title)
            ? <ExternalLink className="w-4 h-4 text-primary shrink-0" />
            : <Download className="w-4 h-4 text-primary shrink-0" />
          }
          <span className="flex-1 text-sm font-medium text-primary truncate">{item.title}</span>
          <span className="text-xs text-primary font-medium shrink-0">{item.type}</span>
        </div>
      ))}
    </div>
  );
}

function SubTaskCard({ slotId, description, status }: { slotId: number; description: string; status: 'pending' | 'working' | 'completed' | 'failed' }) {
  const statusConfig = {
    pending: { color: 'text-gray-400', bg: 'bg-gray-100 dark:bg-gray-800', label: '等待中' },
    working: { color: 'text-blue-500', bg: 'bg-blue-50 dark:bg-blue-500/10', label: '执行中' },
    completed: { color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-500/10', label: '已完成' },
    failed: { color: 'text-red-500', bg: 'bg-red-50 dark:bg-red-500/10', label: '失败' },
  };
  const cfg = statusConfig[status];
  return (
    <div className={`flex items-center gap-3 ${cfg.bg} rounded-lg px-3 py-2 text-xs`}>
      <div className="flex items-center gap-1.5">
        <Cpu className={`w-3.5 h-3.5 ${cfg.color}`} />
        <span className="font-medium text-text">数字员工#{slotId}</span>
      </div>
      <span className="flex-1 text-text-secondary truncate">{description}</span>
      <span className={`font-medium ${cfg.color} shrink-0`}>
        {status === 'working' && <Loader2 className="w-3 h-3 animate-spin inline mr-1" />}
        {cfg.label}
      </span>
    </div>
  );
}

export default function ProjectChat({ projectId, taskId, projectName, projectDescription, onResetTeamState, onUpdateTeamAgents, onUpdateTeamSteps, onOutputsChange, onActivePlanChange }: ProjectChatProps) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [taskName, setTaskName] = useState<string | null>(null);
  const [activePlan, setActivePlan] = useState<{ subtasks: Array<{ slot_id: number; description: string; status: string }> } | null>(null);
  const sessionId = useRef(`team_${projectId}_task_${taskId || 'main'}`);
  const msgCache = useRef(new Map<string, ChatMsg[]>());
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, activePlan]);

  const extractOutputs = useCallback(() => {
    const allOutputs: OutputItem[] = [];
    for (const msg of messagesRef.current) {
      if (msg.role === 'leader') {
        const items = parseOutputItems(msg.content, msg.id, msg.agentName, msg.timestamp);
        allOutputs.push(...items);
      }
    }
    return allOutputs;
  }, []);

  useEffect(() => {
    const outputs = extractOutputs();
    onOutputsChange(outputs);
  }, [messages, extractOutputs, onOutputsChange]);

  useEffect(() => {
    onActivePlanChange?.(activePlan);
  }, [activePlan, onActivePlanChange]);

  useEffect(() => {
    const newSessionId = `team_${projectId}_task_${taskId || 'main'}`;

    if (sessionId.current !== newSessionId) {
      msgCache.current.set(sessionId.current, messagesRef.current);
    }

    sessionId.current = newSessionId;

    if (taskId) {
      fetchTasks(projectId).then((tasks: TaskInfo[]) => {
        const t = tasks.find(t => t.id === taskId);
        setTaskName(t?.name || null);
      });
    } else {
      setTaskName(null);
    }

    const cached = msgCache.current.get(newSessionId);
    if (cached && cached.length > 0) {
      setMessages(cached);
    } else {
      const backendSessionId = `orch_${projectId}_${newSessionId}`;
      fetchSessionMessages(backendSessionId).then(history => {
        if (history.length > 0) {
          const restored: ChatMsg[] = history.map(m => ({
            id: m.id,
            role: m.role === 'user' ? 'human' : (m.role === 'assistant' ? 'member' : m.role) as ChatMsg['role'],
            content: m.content,
            agentName: m.agent_name,
            timestamp: m.timestamp
              ? new Date(m.timestamp * 1000).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
              : '',
          }));
          setMessages(restored);
        } else {
          setMessages([
            {
              id: `sys_${newSessionId}`,
              role: 'system',
              content: `管理智能体已就绪，项目：${projectName}`,
              timestamp: now(),
            },
          ]);
        }
      });
    }
  }, [projectId, projectName, taskId]);

  function now() {
    return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }

  const handleSend = async (overrideMessage?: string) => {
    const msg = overrideMessage || input.trim();
    if (!msg || isLoading) return;

    const userMsg: ChatMsg = { id: Date.now().toString(), role: 'human', content: msg, timestamp: now() };
    setMessages(prev => [...prev, userMsg]);
    if (!overrideMessage) setInput('');
    setIsLoading(true);
    setActivePlan(null);

    onResetTeamState();

    const contentMsgId = `content_${Date.now()}`;
    const summaryMsgId = `summary_${Date.now()}`;

    try {
      await streamOrchestratorChat(projectId, userMsg.content, sessionId.current, (event: TeamChatEvent) => {
        if (event.type === 'content') {
          setMessages(prev => {
            const existing = prev.find(m => m.id === contentMsgId);
            if (!existing) {
              return [...prev, {
                id: contentMsgId,
                role: 'leader' as const,
                content: event.content || '',
                timestamp: now(),
              }];
            }
            return prev.map(m =>
              m.id === contentMsgId ? { ...m, content: m.content + (event.content || '') } : m
            );
          });

        } else if (event.type === 'plan_created') {
          const subtasks = (event.subtasks || []).map(st => ({ ...st, status: 'pending' }));
          setActivePlan({ subtasks });

          setMessages(prev => [...prev, {
            id: `plan_${Date.now()}`,
            role: 'plan' as const,
            content: `${event.reasoning || ''}`,
            timestamp: now(),
          }]);

          onUpdateTeamSteps(() => subtasks.map(st => ({
            name: `数字员工#${st.slot_id}`,
            agent: `数字员工#${st.slot_id}`,
            status: 'pending' as const,
            time: now(),
          })));

        } else if (event.type === 'subtask_started') {
          setActivePlan(prev => {
            if (!prev) return prev;
            return {
              subtasks: prev.subtasks.map(st =>
                st.slot_id === event.slot_id ? { ...st, status: 'working' } : st
              ),
            };
          });

          onUpdateTeamSteps(prev => prev.map(s =>
            s.agent === `数字员工#${event.slot_id}` ? { ...s, status: 'in-progress' as const, startedAt: Date.now() } : s
          ));
          onUpdateTeamAgents(prev => {
            const name = `数字员工#${event.slot_id}`;
            if (!prev.some(a => a.name === name)) {
              return [...prev, { name, status: 'working', currentTask: event.description || '' }];
            }
            return prev.map(a => a.name === name ? { ...a, status: 'working', currentTask: event.description || '' } : a);
          });

        } else if (event.type === 'subtask_completed') {
          setActivePlan(prev => {
            if (!prev) return prev;
            return {
              subtasks: prev.subtasks.map(st =>
                st.slot_id === event.slot_id ? { ...st, status: 'completed' } : st
              ),
            };
          });

          onUpdateTeamSteps(prev => prev.map(s =>
            s.agent === `数字员工#${event.slot_id}`
              ? { ...s, status: 'completed' as const, duration: s.startedAt ? `${((Date.now() - s.startedAt) / 1000).toFixed(1)}s` : undefined, tokens: event.token_usage?.total_tokens }
              : s
          ));
          onUpdateTeamAgents(prev => prev.map(a =>
            a.name === `数字员工#${event.slot_id}` ? { ...a, status: 'done', currentTask: '已完成' } : a
          ));

        } else if (event.type === 'subtask_failed') {
          setActivePlan(prev => {
            if (!prev) return prev;
            return {
              subtasks: prev.subtasks.map(st =>
                st.slot_id === event.slot_id ? { ...st, status: 'failed' } : st
              ),
            };
          });

        } else if (event.type === 'summary') {
          setMessages(prev => {
            const existing = prev.find(m => m.id === summaryMsgId);
            if (!existing) {
              return [...prev, {
                id: summaryMsgId,
                role: 'leader' as const,
                agentName: '管理智能体',
                content: event.content || '',
                timestamp: now(),
              }];
            }
            return prev.map(m =>
              m.id === summaryMsgId ? { ...m, content: m.content + (event.content || '') } : m
            );
          });

        } else if (event.type === 'plan_completed') {
          setActivePlan(null);
          setMessages(prev => prev.filter(m => m.role !== 'plan'));

        } else if (event.type === 'error') {
          setMessages(prev => [...prev, {
            id: `err_${Date.now()}`,
            role: 'system' as const,
            content: event.content || '编排出错',
            timestamp: now(),
          }]);

        } else if (event.type === 'skill_hint') {
          const skillDisplayNames: Record<string, string> = {
            entity_extract: '实体抽取',
            entity_exclude: '实体排除',
          };
          const displayName = skillDisplayNames[event.skill_key || ''] || event.skill_key || '技能';
          setMessages(prev => [...prev, {
            id: `skill_hint_${Date.now()}`,
            role: 'system' as const,
            content: `__SKILL_HINT__${displayName}`,
            timestamp: now(),
          }]);

        } else if (event.type === 'done') {
          // finished
        }
      });
    } catch {
      setMessages(prev => [...prev, {
        id: `error_${Date.now()}`,
        role: 'system',
        content: '编排失败，请确认后端服务已启动。',
        timestamp: now(),
      }]);
    } finally {
      setIsLoading(false);
      setActivePlan(null);
      setMessages(prev => prev.filter(m => m.role !== 'plan'));
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setIsUploading(true);
    setMessages(prev => [...prev, { id: `upload_${Date.now()}`, role: 'system', content: `正在上传 ${file.name}...`, timestamp: now() }]);
    try {
      const result = await uploadDocument(file, projectId, taskId || undefined);
      const msg = result.success
        ? `已上传 ${result.doc_name}，共 ${result.chunks} 个段落已入库。`
        : `上传失败：${result.error || '未知错误'}`;
      setMessages(prev => [...prev, { id: `upload_done_${Date.now()}`, role: 'system', content: msg, timestamp: now() }]);
    } catch {
      setMessages(prev => [...prev, { id: `upload_err_${Date.now()}`, role: 'system', content: '上传失败，请确认后端服务已启动。', timestamp: now() }]);
    } finally {
      setIsUploading(false);
    }
  };

  const chatTitle = taskId ? (taskName || '任务对话') : '主对话';

  return (
    <div className="h-full flex flex-col bg-bg">
      {/* Header */}
      <div className="h-14 bg-surface border-b border-border flex items-center justify-between px-5 shrink-0">
        <h2 className="font-semibold text-text text-base">{chatTitle}</h2>
        <div className="flex items-center gap-2 text-sm text-text-muted">
          <Cpu className="w-4 h-4" />
          <span>管理智能体 + 3 数字员工</span>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        <div className="flex justify-center">
          <span className="text-xs text-text-muted bg-bg px-3 py-1 rounded-full">Today</span>
        </div>

        {messages.map((msg) => {
          if (msg.role === 'plan') {
            return (
              <div key={msg.id} className="flex justify-start">
                <div className="bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30 rounded-lg px-4 py-2 max-w-lg">
                  <div className="flex items-center gap-2 text-xs text-blue-600 dark:text-blue-400 font-medium mb-1">
                    <Cpu className="w-3.5 h-3.5" /> 任务规划
                  </div>
                  <div className="text-xs text-text-secondary">{msg.content}</div>
                </div>
              </div>
            );
          }

          if (msg.role === 'delegation') {
            return (
              <div key={msg.id} className="flex justify-center">
                <span className="text-xs text-text-muted italic">
                  <MarkdownContent content={msg.content} />
                </span>
              </div>
            );
          }

          if (msg.role === 'system') {
            if (msg.content.startsWith('__SKILL_HINT__')) {
              const skillName = msg.content.replace('__SKILL_HINT__', '');
              return (
                <div key={msg.id} className="flex justify-start">
                  <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-lg px-4 py-3 max-w-lg">
                    <div className="text-xs text-amber-700 dark:text-amber-400 mb-2">
                      管理智能体发现「{skillName}」能力可沉淀为技能，后续将自动通过 Skill 执行，提升效率。
                    </div>
                    <button
                      onClick={() => handleSend(`帮我把${skillName}封装成技能`)}
                      className="text-xs bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded-lg transition-colors"
                    >
                      封装为技能
                    </button>
                  </div>
                </div>
              );
            }

            return (
              <div key={msg.id} className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center shrink-0 text-xs font-bold text-gray-500 dark:text-gray-400">
                  系
                </div>
                <div>
                  <div className="text-xs text-text-muted mb-1">系统</div>
                  <div className="bg-surface border border-border rounded-xl rounded-tl-sm px-4 py-2.5 text-sm text-text max-w-md">
                    <MarkdownContent content={msg.content} />
                  </div>
                </div>
              </div>
            );
          }

          if (msg.role === 'human') {
            return (
              <div key={msg.id} className="flex gap-3 flex-row-reverse">
                <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center shrink-0 text-xs font-bold text-white">
                  S
                </div>
                <div className="flex flex-col items-end">
                  <div className="bg-primary text-white rounded-xl rounded-tr-sm px-4 py-2.5 text-sm max-w-md">
                    <div className="whitespace-pre-wrap">{msg.content}</div>
                  </div>
                  <div className="flex items-center gap-2 mt-1 text-xs text-text-muted">
                    <span>{msg.timestamp}</span>
                  </div>
                </div>
              </div>
            );
          }

          if (msg.role === 'leader') {
            const leaderOutputs = parseOutputItems(msg.content, msg.id, msg.agentName, msg.timestamp);
            return (
              <div key={msg.id} className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-amber-500 flex items-center justify-center shrink-0">
                  <span className="text-xs font-bold text-white">B</span>
                </div>
                <div className="max-w-[75%] min-w-0">
                  <div className="text-xs text-text-muted mb-1">管理智能体</div>
                  <div className="bg-surface border border-border rounded-xl rounded-tl-sm px-4 py-2.5 text-sm">
                    <div className="text-text prose prose-sm max-w-none dark:prose-invert">
                      {msg.content === '' ? (
                        <div className="flex items-center gap-2 text-text-muted text-xs">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          正在处理...
                        </div>
                      ) : (
                        <MarkdownContent content={msg.content} />
                      )}
                    </div>
                    <OutputCards items={leaderOutputs} />
                  </div>
                </div>
              </div>
            );
          }

          if (msg.role === 'member') {
            const agentLabel = msg.agentName || '成员';
            const slotNum = agentLabel.match(/#(\d)/)?.[1] || '?';
            const memberOutputs = parseOutputItems(msg.content, msg.id, msg.agentName, msg.timestamp);

            return (
              <div key={msg.id} className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-indigo-500 flex items-center justify-center shrink-0">
                  <span className="text-xs font-bold text-white">{slotNum}</span>
                </div>
                <div className="max-w-[75%] min-w-0">
                  <div className="text-xs text-text-muted mb-1">{agentLabel}</div>
                  <div className="bg-surface border border-border rounded-xl rounded-tl-sm px-4 py-2.5 text-sm">
                    <div className="text-text prose prose-sm max-w-none dark:prose-invert">
                      {msg.content === '' ? (
                        <div className="flex items-center gap-2 text-text-muted text-xs">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          SubAgent 执行中...
                        </div>
                      ) : (
                        <MarkdownContent content={msg.content} />
                      )}
                    </div>
                    <OutputCards items={memberOutputs} />
                  </div>
                </div>
              </div>
            );
          }

          return null;
        })}

        {/* Active plan subtask status cards */}
        {activePlan && activePlan.subtasks.length > 0 && (
          <div className="space-y-1.5">
            {activePlan.subtasks.map((st) => (
              <SubTaskCard
                key={st.slot_id}
                slotId={st.slot_id}
                description={st.description}
                status={st.status as 'pending' | 'working' | 'completed' | 'failed'}
              />
            ))}
          </div>
        )}

        {isLoading && !activePlan && (
          <div className="flex justify-center">
            <div className="flex items-center gap-2 text-xs text-text-muted bg-bg px-3 py-1.5 rounded-full">
              <Loader2 className="w-3 h-3 animate-spin" />
              管理智能体正在分析任务...
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="bg-surface border-t border-border px-5 py-3 shrink-0">
        <div className="flex items-center gap-2 bg-bg border border-border rounded-xl px-3 py-2.5 focus-within:border-primary transition-colors">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="p-1 hover:bg-border-light rounded-lg transition-colors shrink-0"
            title="上传文档"
          >
            {isUploading ? <Loader2 className="w-4 h-4 text-text-muted animate-spin" /> : <Paperclip className="w-4 h-4 text-text-muted" />}
          </button>
          <input ref={fileInputRef} type="file" accept=".txt,.md,.markdown,.text,.pdf,.docx,.xlsx,.xls,.csv" onChange={handleFileUpload} className="hidden" />
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            placeholder="输入消息，管理智能体将自动编排数字员工执行..."
            disabled={isLoading}
            className="flex-1 bg-transparent outline-none text-sm text-text disabled:opacity-50"
          />
          <button
            onClick={() => handleSend()}
            disabled={isLoading || !input.trim()}
            className="p-2 bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors shrink-0 disabled:opacity-50"
          >
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
        <div className="flex items-center gap-3 mt-2 px-1">
          <button className="flex items-center gap-1 text-xs text-text-muted hover:text-text transition-colors">
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text transition-colors">
            <FolderOpen className="w-3.5 h-3.5" />
            <span>project</span>
          </button>
          <div className="flex-1" />
          <span className="text-xs text-text-muted">管理智能体</span>
        </div>
      </div>
    </div>
  );
}
