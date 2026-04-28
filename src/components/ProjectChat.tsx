import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Send, Loader2, Paperclip, Plus, FolderOpen, Download, ExternalLink } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { streamTeamChat, uploadDocument, fetchTasks, fetchSessionMessages, getWorkspaceFileUrl } from '../services/api';
import type { TeamChatEvent, TaskInfo } from '../services/api';
import type { TeamAgentStatus, TeamTaskStep, OutputItem } from '../App';

interface ProjectChatProps {
  projectId: string;
  taskId: string | null;
  projectName: string;
  projectDescription: string;
  onResetTeamState: () => void;
  onUpdateTeamAgents: (updater: (prev: TeamAgentStatus[]) => TeamAgentStatus[]) => void;
  onUpdateTeamSteps: (updater: (prev: TeamTaskStep[]) => TeamTaskStep[]) => void;
  onOutputsChange: (items: OutputItem[]) => void;
}

interface ChatMsg {
  id: string;
  role: 'system' | 'leader' | 'member' | 'delegation' | 'human';
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

const MEMBER_COLORS = [
  { bg: 'bg-emerald-500', text: 'text-white' },
  { bg: 'bg-blue-500', text: 'text-white' },
  { bg: 'bg-amber-500', text: 'text-white' },
  { bg: 'bg-rose-500', text: 'text-white' },
  { bg: 'bg-violet-500', text: 'text-white' },
];

const OUTPUT_TYPE_PATTERN = /已生成\**\s*(柱状图|折线图|饼图|散点图|热力图|雷达图|表格|报告|文档|PPT|PDF|图表)\**[：:]\s*(.+)/g;
const OUTPUT_FILE_PATTERN = /(?:已生成|文件名称|文件名|文件路径|生成文件)\**[：:\s]+`?(\S+?\.(pdf|xlsx|xls|csv|png|jpg|pptx?|docx?|txt|md))`?/gi;

function parseOutputItems(content: string, msgId: string, agentName?: string, timestamp?: string): OutputItem[] {
  const items: OutputItem[] = [];
  const seen = new Set<string>();

  let match: RegExpExecArray | null;

  const typeRe = new RegExp(OUTPUT_TYPE_PATTERN.source, 'g');
  while ((match = typeRe.exec(content)) !== null) {
    const type = match[1];
    const title = match[2].trim();
    const key = `${type}:${title}`;
    if (!seen.has(key)) {
      seen.add(key);
      items.push({
        id: `${msgId}_out_${items.length}`,
        title,
        type,
        agentName,
        timestamp: timestamp || '',
      });
    }
  }

  const fileRe = new RegExp(OUTPUT_FILE_PATTERN.source, 'gi');
  while ((match = fileRe.exec(content)) !== null) {
    const fileName = match[1];
    const ext = match[2].toUpperCase();
    const key = `file:${fileName}`;
    if (!seen.has(key)) {
      seen.add(key);
      items.push({
        id: `${msgId}_file_${items.length}`,
        title: fileName,
        type: ext,
        agentName,
        timestamp: timestamp || '',
      });
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

export default function ProjectChat({ projectId, taskId, projectName, projectDescription, onResetTeamState, onUpdateTeamAgents, onUpdateTeamSteps, onOutputsChange }: ProjectChatProps) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [taskName, setTaskName] = useState<string | null>(null);
  const sessionId = useRef(`team_${projectId}_task_${taskId || 'main'}`);
  const msgCache = useRef(new Map<string, ChatMsg[]>());
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const memberMsgIds = useRef(new Map<string, string>());

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const extractOutputs = useCallback(() => {
    const allOutputs: OutputItem[] = [];
    for (const msg of messagesRef.current) {
      if (msg.role === 'member' || msg.role === 'leader') {
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
      const backendSessionId = `team_${projectId}_${newSessionId}`;
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
              content: `群主 BizAgent 已创建项目：${projectName}`,
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

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMsg: ChatMsg = { id: Date.now().toString(), role: 'human', content: input, timestamp: now() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    onResetTeamState();
    onUpdateTeamSteps(() => [{ name: 'Leader 分析', agent: 'Team Leader', status: 'in-progress', time: now(), startedAt: Date.now() }]);

    const leaderMsgId = `leader_${Date.now()}`;
    memberMsgIds.current = new Map<string, string>();
    let leaderStepAdded = false;

    try {
      await streamTeamChat(projectId, userMsg.content, sessionId.current, (event: TeamChatEvent) => {
        if (event.type === 'member_delegated') {
          const delegationId = `del_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
          const agentName = event.agent_name || '成员';
          setMessages(prev => [...prev, {
            id: delegationId,
            role: 'delegation',
            agentName,
            content: event.task
              ? `正在将任务分配给 **${agentName}**：${event.task}`
              : `正在将任务分配给 **${agentName}**`,
            timestamp: now(),
          }]);

          onUpdateTeamSteps(prev => {
            const t = Date.now();
            const updated = prev.map(s => s.name === 'Leader 分析' && s.status === 'in-progress'
              ? { ...s, status: 'completed' as const, duration: s.startedAt ? `${((t - s.startedAt) / 1000).toFixed(1)}s` : undefined }
              : s);
            if (!updated.some(s => s.agent === agentName)) {
              return [...updated, { name: agentName.replace(/^\S+\s/, ''), agent: agentName, status: 'pending' as const, time: now() }];
            }
            return updated;
          });
          onUpdateTeamAgents(prev => {
            if (!prev.some(a => a.name === agentName)) {
              return [...prev, { name: agentName, status: 'idle', currentTask: '等待执行' }];
            }
            return prev;
          });

        } else if (event.type === 'member_started') {
          const agentName = event.agent_name || '成员';
          if (!memberMsgIds.current.has(agentName)) {
            const msgId = `member_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
            memberMsgIds.current.set(agentName, msgId);
            setMessages(prev => [...prev, {
              id: msgId,
              role: 'member',
              agentName,
              content: '',
              timestamp: now(),
            }]);
          }

          onUpdateTeamSteps(prev => prev.map(s => s.agent === agentName ? { ...s, status: 'in-progress' as const, time: now(), startedAt: Date.now() } : s));
          onUpdateTeamAgents(prev => prev.map(a => a.name === agentName ? { ...a, status: 'working', currentTask: '正在执行...' } : a));

        } else if (event.type === 'member_streaming') {
          const agentName = event.agent_name || '成员';
          let msgId = memberMsgIds.current.get(agentName);
          if (!msgId) {
            msgId = `member_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
            memberMsgIds.current.set(agentName, msgId);
            setMessages(prev => [...prev, {
              id: msgId!,
              role: 'member',
              agentName,
              content: event.content || '',
              timestamp: now(),
            }]);
          } else {
            setMessages(prev => prev.map(m =>
              m.id === msgId ? { ...m, content: m.content + (event.content || '') } : m
            ));
          }

          onUpdateTeamAgents(prev => prev.map(a => a.name === agentName ? { ...a, status: 'working', currentTask: '回答中...' } : a));

        } else if (event.type === 'member_response') {
          const agentName = event.agent_name || '成员';
          let msgId = memberMsgIds.current.get(agentName);
          if (!msgId) {
            msgId = `member_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
            memberMsgIds.current.set(agentName, msgId);
            setMessages(prev => [...prev, {
              id: msgId!,
              role: 'member',
              agentName,
              content: event.content || '',
              timestamp: now(),
            }]);
          } else {
            setMessages(prev => prev.map(m =>
              m.id === msgId ? { ...m, content: m.content + (event.content || '') } : m
            ));
          }

          onUpdateTeamSteps(prev => prev.map(s => s.agent === agentName
            ? { ...s, status: 'completed' as const, duration: s.startedAt ? `${((Date.now() - s.startedAt) / 1000).toFixed(1)}s` : undefined }
            : s));
          onUpdateTeamAgents(prev => prev.map(a => a.name === agentName ? { ...a, status: 'done', currentTask: '已完成' } : a));

        } else if (event.type === 'leader_content') {
          if (!leaderStepAdded) {
            leaderStepAdded = true;
            onUpdateTeamSteps(prev => [...prev, { name: 'Leader 汇总', agent: 'Team Leader', status: 'in-progress', time: now(), startedAt: Date.now() }]);
          }
          setMessages(prev => {
            const existing = prev.find(m => m.id === leaderMsgId);
            if (!existing) {
              return [...prev, {
                id: leaderMsgId,
                role: 'leader',
                content: event.content || '',
                timestamp: now(),
              }];
            }
            return prev.map(m =>
              m.id === leaderMsgId ? { ...m, content: m.content + (event.content || '') } : m
            );
          });
        } else if (event.type === 'done') {
          onUpdateTeamSteps(prev => prev.map(s => s.status === 'in-progress'
            ? { ...s, status: 'completed' as const, duration: s.startedAt ? `${((Date.now() - s.startedAt) / 1000).toFixed(1)}s` : undefined }
            : s));
          onUpdateTeamAgents(prev => prev.map(a => a.status === 'working' ? { ...a, status: 'done', currentTask: '已完成' } : a));
        }
      });
    } catch {
      setMessages(prev => [...prev, {
        id: `error_${Date.now()}`,
        role: 'system',
        content: 'Team 协作失败，请确认后端服务已启动。',
        timestamp: now(),
      }]);
    } finally {
      setIsLoading(false);
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

  const getAgentInitial = (name?: string) => {
    if (!name) return '?';
    const clean = name.replace(/^\S+\s/, '');
    return clean.charAt(0);
  };

  return (
    <div className="h-full flex flex-col bg-bg">
      {/* Header */}
      <div className="h-14 bg-surface border-b border-border flex items-center justify-between px-5 shrink-0">
        <h2 className="font-semibold text-text text-base">{chatTitle}</h2>
        <div className="flex items-center gap-3">
          <div className="flex -space-x-1.5">
            {['S', 'B', 'A', 'K'].map((letter, i) => (
              <div
                key={letter}
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white border-2 border-surface ${MEMBER_COLORS[i].bg}`}
              >
                {letter}
              </div>
            ))}
          </div>
          <span className="text-sm text-text-muted">5 members</span>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {/* Date separator */}
        <div className="flex justify-center">
          <span className="text-xs text-text-muted bg-bg px-3 py-1 rounded-full">Today</span>
        </div>

        {messages.map((msg) => {
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
                  <div className="text-xs text-text-muted mb-1">BizAgent</div>
                  <div className="bg-surface border border-border rounded-xl rounded-tl-sm px-4 py-2.5 text-sm">
                    <div className="text-text prose prose-sm max-w-none dark:prose-invert">
                      {msg.content === '' ? (
                        <div className="flex items-center gap-2 text-text-muted text-xs">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          正在汇总...
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
            const initial = getAgentInitial(msg.agentName);
            const agentLabel = msg.agentName?.replace(/^\S+\s/, '') || '成员';
            const memberOutputs = parseOutputItems(msg.content, msg.id, msg.agentName, msg.timestamp);

            return (
              <div key={msg.id} className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-indigo-500 flex items-center justify-center shrink-0">
                  <span className="text-xs font-bold text-white">{initial}</span>
                </div>
                <div className="max-w-[75%] min-w-0">
                  <div className="text-xs text-text-muted mb-1">{agentLabel}</div>
                  <div className="bg-surface border border-border rounded-xl rounded-tl-sm px-4 py-2.5 text-sm">
                    <div className="text-text prose prose-sm max-w-none dark:prose-invert">
                      {msg.content === '' ? (
                        <div className="flex items-center gap-2 text-text-muted text-xs">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          正在执行数据提取...
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

        {isLoading && !memberMsgIds.current.size && (
          <div className="flex justify-center">
            <div className="flex items-center gap-2 text-xs text-text-muted bg-bg px-3 py-1.5 rounded-full">
              <Loader2 className="w-3 h-3 animate-spin" />
              Team Leader 正在分析并分配任务...
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
            placeholder="Message... (@ to mention or reference files)"
            disabled={isLoading}
            className="flex-1 bg-transparent outline-none text-sm text-text disabled:opacity-50"
          />
          <button
            onClick={handleSend}
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
          <span className="text-xs text-text-muted">Default Permission</span>
        </div>
      </div>
    </div>
  );
}
