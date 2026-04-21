import { useState, useRef, useEffect, useMemo } from 'react';
import { Send, Paperclip, AtSign, ArrowRight, Search, TrendingUp, CheckCircle2, BarChart3, FolderOpen, Bot, Wrench, Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { streamAgentChat, uploadDocument } from '../services/api';

interface ChatMsg {
  id: string;
  role: 'system' | 'assistant' | 'human';
  senderName: string;
  avatar: string;
  content: string;
  timestamp: string;
  cards?: Array<{
    type: 'project' | 'agent' | 'skill' | 'insight';
    title: string;
    desc: string;
    meta?: string;
    action?: string;
  }>;
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

const initialMessages: ChatMsg[] = [
  {
    id: 'd1',
    role: 'system',
    senderName: '系统',
    avatar: '🔔',
    content: '效能管理智能体 "全局助手" 已就绪',
    timestamp: '09:00',
  },
  {
    id: 'd2',
    role: 'assistant',
    senderName: '全局助手',
    avatar: '🧠',
    content: '你好 samhar，我是效能管理智能体。我可以帮你：\n• 全局搜索项目、Agent 和 Skill\n• 查看企业效能指标和风险预警\n• 快速创建新项目并分配 Agent\n• 分析能力缺口和自动化覆盖情况\n\n有什么可以帮你的？',
    timestamp: '09:00',
  },
  {
    id: 'd3',
    role: 'human',
    senderName: 'samhar',
    avatar: '👤',
    content: '帮我搜索一下和数据分析相关的 Agent 和 Skill',
    timestamp: '09:05',
  },
  {
    id: 'd4',
    role: 'assistant',
    senderName: '全局助手',
    avatar: '🧠',
    content: '找到以下与数据分析相关的资源：',
    timestamp: '09:05',
    cards: [
      { type: 'agent', title: '数据分析Agent', desc: '擅长SQL查询、数据清洗、统计建模', meta: '官方 · 1,240 次调用', action: '查看详情 →' },
      { type: 'skill', title: 'SQL执行器', desc: '连接企业数据仓库执行SQL查询', meta: '系统内置 · 已启用', action: '查看详情 →' },
      { type: 'skill', title: 'Python沙箱', desc: '安全执行Python代码进行数据分析', meta: '系统内置 · 已启用', action: '查看详情 →' },
      { type: 'skill', title: '图表生成', desc: '基于数据自动生成多种类型图表', meta: '系统内置 · 已启用', action: '查看详情 →' },
    ],
  },
  {
    id: 'd5',
    role: 'human',
    senderName: 'samhar',
    avatar: '👤',
    content: '最近有什么风险需要注意吗？',
    timestamp: '09:08',
  },
  {
    id: 'd6',
    role: 'assistant',
    senderName: '全局助手',
    avatar: '🧠',
    content: '当前有 3 个风险事件需要关注：',
    timestamp: '09:08',
    cards: [
      { type: 'insight', title: '⚠️ 消费者业务连续下滑', desc: 'Q3 消费者业务营收同比下降 5%，已连续两个季度下滑', meta: '建议：发起专项分析项目', action: '创建项目 →' },
      { type: 'insight', title: '⚠️ 舆情监控Agent 离线', desc: '舆情监控Agent 已离线 3 小时，可能影响品牌风险感知', meta: '建议：检查Agent运行状态', action: '检查状态 →' },
      { type: 'insight', title: '⚠️ 自动化覆盖率未达标', desc: '供应链优化项目自动化覆盖率仅 45%，低于 70% 目标线', meta: '建议：扩充 Skill 配置', action: '查看详情 →' },
    ],
  },
];

function renderMentions(text: string) {
  const parts = text.split(/(@\S+)/g);
  return parts.map((part, i) => {
    if (part.startsWith('@')) {
      return (
        <span key={i} className="inline-flex items-center gap-0.5 bg-primary/10 text-primary px-1.5 py-0.5 rounded-md font-medium text-xs">
          <AtSign className="w-3 h-3" />
          {part.slice(1)}
        </span>
      );
    }
    return part;
  });
}

export default function GlobalChat() {
  const [messages, setMessages] = useState<ChatMsg[]>(initialMessages);
  const [input, setInput] = useState('');
  const [showMention, setShowMention] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const sessionId = useRef(`global_${Date.now()}`);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function now() {
    return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMsg: ChatMsg = {
      id: Date.now().toString(),
      role: 'human',
      senderName: 'samhar',
      avatar: '👤',
      content: input,
      timestamp: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
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
      timestamp: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
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
          ? { ...m, content: '⚠️ 连接后端失败，请确认后端服务已启动（http://localhost:8000）。' }
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

  return (
    <div className="h-full flex flex-col bg-bg">
      {/* Chat Header */}
      <div className="h-12 bg-surface border-b border-border flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 bg-agent-host/10 rounded-lg flex items-center justify-center text-sm">🧠</div>
          <div>
            <h2 className="font-semibold text-text text-sm">全局助手</h2>
            <p className="text-[11px] text-text-muted">效能管理智能体 · 全局视角</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-text-muted bg-bg px-2 py-0.5 rounded-full border border-border">搜索模式</span>
          <span className="w-2 h-2 rounded-full bg-success animate-pulse-dot" />
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg) => (
          <div key={msg.id} className="flex gap-3 animate-slide-in">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm shrink-0 ${
              msg.role === 'assistant' ? 'bg-agent-host/15' :
              msg.role === 'human' ? 'bg-primary/15' : 'bg-bg'
            }`}>
              {msg.avatar}
            </div>
            <div className="max-w-[85%]">
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-xs font-semibold ${
                  msg.role === 'assistant' ? 'text-agent-host' : msg.role === 'human' ? 'text-primary-dark' : 'text-text-muted'
                }`}>
                  {msg.senderName}
                </span>
                <span className="text-xs text-text-muted">{msg.timestamp}</span>
              </div>
              <div className={`rounded-xl px-4 py-2.5 text-sm border ${
                msg.role === 'assistant' ? 'bg-agent-host/5 border-agent-host/15' :
                msg.role === 'human' ? 'bg-primary-light border-primary/20' :
                'bg-bg border-border'
              }`}>
                <div className="text-text prose prose-sm max-w-none dark:prose-invert">
                  {msg.role === 'human' ? (
                    <div className="whitespace-pre-wrap">{renderMentions(msg.content)}</div>
                  ) : (
                    <MarkdownContent content={msg.content} />
                  )}
                </div>

                {/* Cards */}
                {msg.cards && (
                  <div className="grid grid-cols-1 gap-2 mt-3">
                    {msg.cards.map((card, i) => (
                      <div
                        key={i}
                        className="bg-white/70 border border-border rounded-lg p-3 hover:border-primary/30 hover:shadow-sm transition-all cursor-pointer group"
                      >
                        <div className="flex items-center gap-1.5 mb-1">
                          {card.type === 'project' && <FolderOpen className="w-3.5 h-3.5 text-primary" />}
                          {card.type === 'agent' && <Bot className="w-3.5 h-3.5 text-agent-normal" />}
                          {card.type === 'skill' && <Wrench className="w-3.5 h-3.5 text-skill" />}
                          {card.type === 'insight' && <BarChart3 className="w-3.5 h-3.5 text-warning" />}
                          <span className="text-sm font-medium text-text">{card.title}</span>
                        </div>
                        <p className="text-xs text-text-secondary mb-2 line-clamp-2">{card.desc}</p>
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-text-muted">{card.meta}</span>
                          <span className="text-[10px] text-primary font-medium flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            {card.action} <ArrowRight className="w-3 h-3" />
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
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
              {isUploading ? <Loader2 className="w-4.5 h-4.5 text-text-muted animate-spin" /> : <Paperclip className="w-4.5 h-4.5 text-text-muted" />}
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
                if (e.key === '@') setShowMention(true);
              }}
              placeholder={isLoading ? '等待回复中...' : '搜索项目、Agent、Skill，或询问效能分析...'}
              disabled={isLoading}
              rows={1}
              className="flex-1 bg-transparent resize-none outline-none text-sm text-text max-h-32 py-1.5 disabled:opacity-50"
              style={{ minHeight: '24px' }}
            />
            <button className="p-1.5 hover:bg-border-light rounded-lg transition-colors shrink-0" onClick={() => setShowMention(!showMention)}>
              <AtSign className="w-4.5 h-4.5 text-text-muted" />
            </button>
            <button
              onClick={handleSend}
              disabled={isLoading || !input.trim()}
              className="p-2 bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </div>

          {showMention && (
            <div className="absolute bottom-full left-0 mb-2 w-64 bg-surface border border-border rounded-xl shadow-lg overflow-hidden animate-fade-in">
              <div className="px-3 py-2 text-xs font-semibold text-text-muted border-b border-border-light">全局搜索</div>
              {[
                { name: 'Q3 财报分析', type: '项目', icon: '📁' },
                { name: '数据分析Agent', type: 'Agent', icon: '🤖' },
                { name: '图表生成', type: 'Skill', icon: '🔧' },
                { name: '供应链优化', type: '项目', icon: '📁' },
              ].map((item) => (
                <button
                  key={item.name}
                  onClick={() => { setInput(input + item.name + ' '); setShowMention(false); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-bg transition-colors text-left"
                >
                  <span className="text-base">{item.icon}</span>
                  <div>
                    <div className="text-sm text-text">{item.name}</div>
                    <div className="text-xs text-text-muted">{item.type}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center justify-between mt-1.5 px-1">
          <div className="text-xs text-text-muted">按 Enter 发送，Shift + Enter 换行</div>
          <div className="flex items-center gap-3 text-[11px] text-text-muted">
            <span className="flex items-center gap-1"><Search className="w-3 h-3" /> 全局搜索</span>
            <span className="flex items-center gap-1"><TrendingUp className="w-3 h-3" /> 效能分析</span>
            <span className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> 任务创建</span>
          </div>
        </div>
      </div>
    </div>
  );
}
