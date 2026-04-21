import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Send, Paperclip, AtSign, Search, Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { streamAgentChat, uploadDocument, fetchAgents, fetchSkills, fetchProjects } from '../services/api';
import type { AgentInfo, SkillInfo, ProjectInfo } from '../services/api';

interface ChatMsg {
  id: string;
  role: 'system' | 'assistant' | 'human';
  senderName: string;
  avatar: string;
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
        p: ({ children }) => <p className="mb-1.5 last:mb-0">{children}</p>,
        ul: ({ children }) => <ul className="list-disc pl-4 mb-1.5">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal pl-4 mb-1.5">{children}</ol>,
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

interface MentionItem {
  name: string;
  type: string;
  icon: string;
}

export default function GlobalChat() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [showMention, setShowMention] = useState(false);
  const [mentionItems, setMentionItems] = useState<MentionItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const sessionId = useRef(`global_${Date.now()}`);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function now() {
    return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }

  useEffect(() => {
    const ts = now();
    Promise.all([fetchAgents(), fetchSkills(), fetchProjects()]).then(([agents, skills, projects]) => {
      setMessages([
        {
          id: 'sys-1',
          role: 'system',
          senderName: '系统',
          avatar: '🔔',
          content: '全局助手已就绪',
          timestamp: ts,
        },
        {
          id: 'welcome',
          role: 'assistant',
          senderName: '全局助手',
          avatar: '🧠',
          content: `你好，我是全局助手。当前系统已接入 **${agents.length}** 个 Agent、**${skills.length}** 个技能、**${projects.length}** 个项目。\n\n你可以直接问我任何问题，也可以点击 **@** 快速引用资源。`,
          timestamp: ts,
        },
      ]);
    }).catch(() => {
      setMessages([
        {
          id: 'sys-1',
          role: 'system',
          senderName: '系统',
          avatar: '🔔',
          content: '全局助手已就绪',
          timestamp: ts,
        },
        {
          id: 'welcome',
          role: 'assistant',
          senderName: '全局助手',
          avatar: '🧠',
          content: '你好，我是全局助手。你可以向我提问，或使用 **@** 引用项目、Agent 和技能。',
          timestamp: ts,
        },
      ]);
    });
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const loadMentionItems = useCallback(async () => {
    try {
      const [agents, skills, projects] = await Promise.all([
        fetchAgents(),
        fetchSkills(),
        fetchProjects(),
      ]);
      const items: MentionItem[] = [
        ...projects.map((p: ProjectInfo) => ({ name: p.name, type: '项目', icon: '📁' })),
        ...agents.map((a: AgentInfo) => ({ name: a.name, type: 'Agent', icon: a.avatar })),
        ...skills.map((s: SkillInfo) => ({ name: s.name, type: '技能', icon: s.icon })),
      ];
      setMentionItems(items);
    } catch {
      setMentionItems([]);
    }
  }, []);

  const handleToggleMention = useCallback(() => {
    if (!showMention) {
      loadMentionItems();
    }
    setShowMention(prev => !prev);
  }, [showMention, loadMentionItems]);

  const handleSend = async (text?: string) => {
    const msg = (text || input).trim();
    if (!msg || isLoading) return;

    const userMsg: ChatMsg = {
      id: Date.now().toString(),
      role: 'human',
      senderName: '用户',
      avatar: '👤',
      content: msg,
      timestamp: now(),
    };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    const assistantMsgId = `assistant_${Date.now()}`;
    setMessages(prev => [...prev, {
      id: assistantMsgId,
      role: 'assistant',
      senderName: '全局助手',
      avatar: '🧠',
      content: '',
      timestamp: now(),
    }]);

    try {
      await streamAgentChat('global', userMsg.content, sessionId.current, (chunk) => {
        if (chunk.content) {
          setMessages(prev => prev.map(m =>
            m.id === assistantMsgId ? { ...m, content: m.content + chunk.content } : m
          ));
        }
      });
    } catch {
      setMessages(prev => prev.map(m =>
        m.id === assistantMsgId
          ? { ...m, content: '连接后端失败，请确认后端服务已启动。' }
          : m
      ));
    } finally {
      setIsLoading(false);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setIsUploading(true);
    setMessages(prev => [...prev, { id: `upload_${Date.now()}`, role: 'system', senderName: '系统', avatar: '🔔', content: `正在上传 ${file.name}...`, timestamp: now() }]);
    try {
      const result = await uploadDocument(file);
      const msg = result.success
        ? `已上传 ${result.doc_name}，共 ${result.chunks} 个段落已入库。知识检索 Agent 可检索此文档。`
        : `上传失败：${result.error || '未知错误'}`;
      setMessages(prev => [...prev, { id: `upload_done_${Date.now()}`, role: 'system', senderName: '系统', avatar: '🔔', content: msg, timestamp: now() }]);
    } catch {
      setMessages(prev => [...prev, { id: `upload_err_${Date.now()}`, role: 'system', senderName: '系统', avatar: '🔔', content: '上传失败，请确认后端服务已启动。', timestamp: now() }]);
    } finally {
      setIsUploading(false);
    }
  };

  const quickQuestions = [
    '当前有哪些 Agent 可用？',
    '帮我列出所有技能',
    '系统有哪些能力？',
  ];

  const showQuickActions = messages.length <= 2 && !isLoading;

  return (
    <div className="h-full flex flex-col bg-bg">
      {/* Header */}
      <div className="h-12 bg-surface border-b border-border flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 bg-agent-host/10 rounded-lg flex items-center justify-center text-sm">🧠</div>
          <div>
            <h2 className="font-semibold text-text text-sm">全局助手</h2>
            <p className="text-[11px] text-text-muted">搜索 · 问答 · 资源导航</p>
          </div>
        </div>
        <span className="w-2 h-2 rounded-full bg-success animate-pulse-dot" />
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex gap-3 animate-slide-in ${msg.role === 'human' ? 'flex-row-reverse' : ''}`}>
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-sm shrink-0 ${
              msg.role === 'assistant' ? 'bg-agent-host/15' :
              msg.role === 'human' ? 'bg-primary/15' : 'bg-bg'
            }`}>
              {msg.avatar}
            </div>
            <div className={`max-w-[85%] ${msg.role === 'human' ? 'text-right' : ''}`}>
              <div className={`flex items-center gap-2 mb-1 ${msg.role === 'human' ? 'justify-end' : ''}`}>
                <span className={`text-xs font-semibold ${
                  msg.role === 'assistant' ? 'text-agent-host' : msg.role === 'human' ? 'text-primary-dark' : 'text-text-muted'
                }`}>
                  {msg.senderName}
                </span>
                <span className="text-xs text-text-muted">{msg.timestamp}</span>
              </div>
              <div className={`rounded-xl px-3.5 py-2.5 text-sm border inline-block text-left ${
                msg.role === 'assistant' ? 'bg-agent-host/5 border-agent-host/15' :
                msg.role === 'human' ? 'bg-primary-light border-primary/20' :
                'bg-bg border-border'
              }`}>
                <div className="text-text prose prose-sm max-w-none dark:prose-invert">
                  {msg.role === 'assistant' ? (
                    <MarkdownContent content={msg.content || '思考中...'} />
                  ) : (
                    <span className="whitespace-pre-wrap">{msg.content}</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}

        {isLoading && messages[messages.length - 1]?.content === '' && (
          <div className="flex items-center gap-2 text-text-muted text-xs pl-10">
            <Loader2 className="w-3 h-3 animate-spin" />
            正在思考...
          </div>
        )}

        {/* Quick actions on initial state */}
        {showQuickActions && (
          <div className="flex flex-wrap gap-2 pl-10 pt-1">
            {quickQuestions.map((q, i) => (
              <button
                key={i}
                onClick={() => handleSend(q)}
                className="text-xs px-3 py-1.5 bg-surface border border-border rounded-full text-text-secondary hover:border-primary hover:text-primary-dark transition-colors"
              >
                {q}
              </button>
            ))}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="bg-surface border-t border-border p-3 shrink-0">
        <div className="relative">
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
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
                if (e.key === '@') {
                  loadMentionItems();
                  setShowMention(true);
                }
              }}
              placeholder={isLoading ? '等待回复中...' : '搜索项目、Agent、技能，或直接提问...'}
              disabled={isLoading}
              rows={1}
              className="flex-1 bg-transparent resize-none outline-none text-sm text-text max-h-32 py-1.5 disabled:opacity-50"
              style={{ minHeight: '24px' }}
            />
            <button className="p-1.5 hover:bg-border-light rounded-lg transition-colors shrink-0" onClick={handleToggleMention}>
              <AtSign className="w-4 h-4 text-text-muted" />
            </button>
            <button
              onClick={() => handleSend()}
              disabled={isLoading || !input.trim()}
              className="p-2 bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </div>

          {showMention && (
            <div className="absolute bottom-full left-0 mb-2 w-72 bg-surface border border-border rounded-xl shadow-lg overflow-hidden animate-fade-in z-10">
              <div className="px-3 py-2 text-xs font-semibold text-text-muted border-b border-border-light flex items-center gap-1.5">
                <Search className="w-3 h-3" /> 引用资源
              </div>
              <div className="max-h-60 overflow-y-auto">
                {mentionItems.length === 0 ? (
                  <div className="px-3 py-4 text-xs text-text-muted text-center">
                    <Loader2 className="w-4 h-4 animate-spin mx-auto mb-1" />
                    加载中...
                  </div>
                ) : (
                  mentionItems.map((item) => (
                    <button
                      key={`${item.type}-${item.name}`}
                      onClick={() => { setInput(prev => prev + '@' + item.name + ' '); setShowMention(false); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-bg transition-colors text-left"
                    >
                      <span className="text-sm">{item.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-text truncate">{item.name}</div>
                        <div className="text-[10px] text-text-muted">{item.type}</div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
        <div className="mt-1.5 px-1">
          <div className="text-[10px] text-text-muted">Enter 发送 / Shift+Enter 换行</div>
        </div>
      </div>
    </div>
  );
}
