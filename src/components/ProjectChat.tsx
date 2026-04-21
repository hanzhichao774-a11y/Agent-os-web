import { useState, useRef, useEffect, useMemo } from 'react';
import { Send, Loader2, Users, UserCheck, ArrowRight, Paperclip } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { streamTeamChat, uploadDocument } from '../services/api';
import type { TeamChatEvent } from '../services/api';
import type { TeamAgentStatus, TeamTaskStep } from '../App';

interface ProjectChatProps {
  projectId: string;
  projectName: string;
  projectDescription: string;
  onResetTeamState: () => void;
  onUpdateTeamAgents: (updater: (prev: TeamAgentStatus[]) => TeamAgentStatus[]) => void;
  onUpdateTeamSteps: (updater: (prev: TeamTaskStep[]) => TeamTaskStep[]) => void;
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

export default function ProjectChat({ projectId, projectName, projectDescription, onResetTeamState, onUpdateTeamAgents, onUpdateTeamSteps }: ProjectChatProps) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const sessionId = useRef(`team_${projectId}_${Date.now()}`);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    sessionId.current = `team_${projectId}_${Date.now()}`;
    setMessages([
      {
        id: 'sys',
        role: 'system',
        content: `已进入「${projectName}」项目群聊。Team Leader 将协调 7 个专家 Agent 协同工作。\n\n你可以提出任何需求，Leader 会自动分配给最合适的 Agent 处理。`,
        timestamp: now(),
      },
    ]);
  }, [projectId, projectName]);

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
    const memberMsgIds = new Map<string, string>();
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
          if (!memberMsgIds.has(agentName)) {
            const msgId = `member_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
            memberMsgIds.set(agentName, msgId);
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
          let msgId = memberMsgIds.get(agentName);
          if (!msgId) {
            msgId = `member_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
            memberMsgIds.set(agentName, msgId);
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
          let msgId = memberMsgIds.get(agentName);
          if (!msgId) {
            msgId = `member_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
            memberMsgIds.set(agentName, msgId);
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
      const result = await uploadDocument(file);
      const msg = result.success
        ? `已上传 ${result.doc_name}，共 ${result.chunks} 个段落已入库。知识检索 Agent 可检索此文档。`
        : `上传失败：${result.error || '未知错误'}`;
      setMessages(prev => [...prev, { id: `upload_done_${Date.now()}`, role: 'system', content: msg, timestamp: now() }]);
    } catch {
      setMessages(prev => [...prev, { id: `upload_err_${Date.now()}`, role: 'system', content: '上传失败，请确认后端服务已启动。', timestamp: now() }]);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="h-full flex flex-col bg-bg">
      <div className="h-14 bg-surface border-b border-border flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-primary-light flex items-center justify-center">
            <Users className="w-4 h-4 text-primary-dark" />
          </div>
          <div>
            <h2 className="font-semibold text-text text-sm">{projectName}</h2>
            <p className="text-xs text-text-muted">{projectDescription} · Team Coordinate 模式</p>
          </div>
        </div>
        <div className="flex items-center gap-1 text-xs text-text-muted">
          <span className="w-2 h-2 rounded-full bg-success" />
          7 Agent 就绪
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((msg) => {
          if (msg.role === 'delegation') {
            return (
              <div key={msg.id} className="flex items-start gap-2 px-4 py-1.5">
                <ArrowRight className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                <span className="text-xs text-text-muted">
                  <MarkdownContent content={msg.content} />
                </span>
              </div>
            );
          }

          const avatarBg =
            msg.role === 'leader' ? 'bg-amber-100 dark:bg-amber-900/20' :
            msg.role === 'member' ? 'bg-indigo-100 dark:bg-indigo-900/20' :
            msg.role === 'human' ? 'bg-primary/15' :
            'bg-bg border border-border';

          const avatar =
            msg.role === 'leader' ? '👑' :
            msg.role === 'human' ? '👤' :
            msg.role === 'system' ? '🔔' :
            (msg.agentName?.match(/^(\S+)/)?.[1] || '🤖');

          const labelColor =
            msg.role === 'leader' ? 'text-amber-700 dark:text-amber-400' :
            msg.role === 'member' ? 'text-indigo-700 dark:text-indigo-400' :
            msg.role === 'human' ? 'text-primary-dark' :
            'text-text-muted';

          const label =
            msg.role === 'leader' ? 'Team Leader' :
            msg.role === 'member' ? (msg.agentName?.replace(/^\S+\s/, '') || '成员') :
            msg.role === 'human' ? '你' : '系统';

          const bubbleBg =
            msg.role === 'leader' ? 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800/30' :
            msg.role === 'member' ? 'bg-indigo-50 dark:bg-indigo-900/10 border-indigo-200 dark:border-indigo-800/30' :
            msg.role === 'human' ? 'bg-primary-light border-primary/20' :
            'bg-bg border-border';

          return (
            <div key={msg.id} className={`flex gap-3 ${msg.role === 'human' ? 'flex-row-reverse' : ''}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm shrink-0 ${avatarBg}`}>
                {avatar}
              </div>
              <div className="max-w-[75%] min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-xs font-semibold ${labelColor}`}>{label}</span>
                  {msg.role === 'member' && (
                    <span className="inline-flex items-center gap-0.5 text-[10px] bg-indigo-100 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 px-1.5 py-0.5 rounded-full">
                      <UserCheck className="w-2.5 h-2.5" />
                      成员响应
                    </span>
                  )}
                  <span className="text-xs text-text-muted">{msg.timestamp}</span>
                </div>
                <div className={`rounded-xl px-4 py-2.5 text-sm border ${bubbleBg}`}>
                  <div className="text-text prose prose-sm max-w-none dark:prose-invert">
                    {msg.role === 'human' ? (
                      <div className="whitespace-pre-wrap">{msg.content}</div>
                    ) : msg.content === '' && msg.role === 'member' ? (
                      <div className="flex items-center gap-2 text-text-muted text-xs">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        正在思考...
                      </div>
                    ) : (
                      <MarkdownContent content={msg.content} />
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        {isLoading && messages[messages.length - 1]?.content === '' && (
          <div className="flex items-center gap-2 text-xs text-text-muted pl-11">
            <Loader2 className="w-3 h-3 animate-spin" />
            Team Leader 正在协调各 Agent...
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="bg-surface border-t border-border p-3 shrink-0">
        <div className="flex items-end gap-2 bg-bg border border-border rounded-xl px-3 py-2 focus-within:border-primary transition-colors">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="p-1.5 hover:bg-border-light rounded-lg transition-colors shrink-0"
            title="上传文档到知识库"
          >
            {isUploading ? <Loader2 className="w-4 h-4 text-text-muted animate-spin" /> : <Paperclip className="w-4 h-4 text-text-muted" />}
          </button>
          <input ref={fileInputRef} type="file" accept=".txt,.md,.markdown,.text,.pdf" onChange={handleFileUpload} className="hidden" />
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            placeholder="输入需求，Team Leader 会协调多个 Agent 协同完成..."
            rows={1}
            disabled={isLoading}
            className="flex-1 bg-transparent resize-none outline-none text-sm text-text max-h-32 py-1.5 disabled:opacity-50"
            style={{ minHeight: '24px' }}
          />
          <button
            onClick={handleSend}
            disabled={isLoading || !input.trim()}
            className="p-2 bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors shrink-0 disabled:opacity-50"
          >
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
        <div className="text-xs text-text-muted mt-1.5 px-1">
          按 Enter 发送 · Team 将自动分配任务给最合适的 Agent
        </div>
      </div>
    </div>
  );
}
