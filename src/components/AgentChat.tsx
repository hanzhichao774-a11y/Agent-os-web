import { useState, useRef, useEffect, useMemo } from 'react';
import { Send, Paperclip, X, Settings, Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { streamAgentChat, uploadDocument, fetchAgents } from '../services/api';
import type { AgentInfo } from '../services/api';

interface AgentChatProps {
  agentId: string;
  onClose: () => void;
}

interface ChatMsg {
  id: string;
  role: 'system' | 'agent' | 'human';
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
        h1: ({ children }) => <h1 className="text-sm font-bold mb-1.5">{children}</h1>,
        h2: ({ children }) => <h2 className="text-xs font-bold mb-1">{children}</h2>,
        h3: ({ children }) => <h3 className="text-xs font-semibold mb-1">{children}</h3>,
        code: ({ children, className }) => {
          const isBlock = className?.startsWith('language-');
          if (isBlock) {
            return (
              <pre className="bg-gray-100 dark:bg-gray-800 rounded-lg p-2 overflow-x-auto text-[11px] mb-1.5">
                <code>{children}</code>
              </pre>
            );
          }
          return <code className="bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded text-[11px]">{children}</code>;
        },
        pre: ({ children }) => <>{children}</>,
        table: ({ children }) => (
          <div className="overflow-x-auto mb-1.5">
            <table className="min-w-full text-[11px] border-collapse border border-gray-200 dark:border-gray-700">{children}</table>
          </div>
        ),
        thead: ({ children }) => <thead className="bg-gray-50 dark:bg-gray-800">{children}</thead>,
        th: ({ children }) => <th className="px-2 py-1 border border-gray-200 dark:border-gray-700 font-semibold text-left">{children}</th>,
        td: ({ children }) => <td className="px-2 py-1 border border-gray-200 dark:border-gray-700">{children}</td>,
        strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
        hr: () => <hr className="my-1.5 border-gray-200 dark:border-gray-700" />,
      }}
    >
      {cleaned}
    </ReactMarkdown>
  );
}

export default function AgentChat({ agentId, onClose }: AgentChatProps) {
  const [agent, setAgent] = useState<AgentInfo | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [showConfig, setShowConfig] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const sessionId = useRef(`${agentId}_${Date.now()}`);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    sessionId.current = `${agentId}_${Date.now()}`;
    fetchAgents().then(agents => {
      const found = agents.find(a => a.id === agentId);
      setAgent(found || null);
      if (found) {
        setMessages([
          { id: 'sys', role: 'system', content: `已进入 ${found.name} 交互模式`, timestamp: now() },
          { id: 'intro', role: 'agent', content: `你好，我是${found.name}。${found.description}。有什么可以帮你的？`, timestamp: now() },
        ]);
      }
    });
  }, [agentId]);

  function now() {
    return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMsg: ChatMsg = { id: Date.now().toString(), role: 'human', content: input, timestamp: now() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    const agentMsgId = `agent_${Date.now()}`;
    setMessages(prev => [...prev, { id: agentMsgId, role: 'agent', content: '', timestamp: now() }]);

    try {
      await streamAgentChat(agentId, userMsg.content, sessionId.current, (chunk) => {
        if (chunk.content) {
          setMessages(prev => prev.map(m =>
            m.id === agentMsgId ? { ...m, content: m.content + chunk.content } : m
          ));
        }
      });
    } catch {
      setMessages(prev => prev.map(m =>
        m.id === agentMsgId
          ? { ...m, content: '连接后端失败，请确认后端服务已启动。' }
          : m
      ));
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

  if (!agent) {
    return (
      <div className="h-full flex items-center justify-center bg-bg border-l border-border">
        <Loader2 className="w-5 h-5 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-bg border-l border-border">
      <div className="h-12 bg-surface border-b border-border flex items-center justify-between px-3 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-base">{agent.avatar}</span>
          <div>
            <div className="text-sm font-semibold text-text">{agent.name}</div>
            <div className="text-[10px] text-text-muted">
              {agent.builtin_tools.length > 0 ? `工具: ${agent.builtin_tools.join(', ')}` : agent.description}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowConfig(!showConfig)}
            className={`p-1.5 rounded-lg transition-colors ${showConfig ? 'bg-primary-light text-primary-dark' : 'hover:bg-bg text-text-muted'}`}
          >
            <Settings className="w-4 h-4" />
          </button>
          <button onClick={onClose} className="p-1.5 hover:bg-bg rounded-lg transition-colors text-text-muted">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {showConfig && (
        <div className="bg-surface border-b border-border p-3 shrink-0">
          <h4 className="text-xs font-semibold text-text mb-2">Agent 信息</h4>
          <div className="space-y-1.5 text-xs">
            <div className="flex justify-between"><span className="text-text-secondary">ID</span><span className="text-text font-mono">{agent.id}</span></div>
            <div className="flex justify-between"><span className="text-text-secondary">内置工具</span><span className="text-text">{agent.builtin_tools.join(', ') || '无'}</span></div>
            <div className="flex justify-between"><span className="text-text-secondary">知识库</span><span className="text-text">{agent.has_knowledge ? '已启用' : '未启用'}</span></div>
            <div className="flex flex-wrap gap-1 mt-1">
              {agent.capabilities.map(c => (
                <span key={c} className="text-[10px] bg-bg text-text-secondary px-1.5 py-0.5 rounded border border-border-light">{c}</span>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex gap-2 ${msg.role === 'human' ? 'flex-row-reverse' : ''}`}>
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs shrink-0 ${
              msg.role === 'agent' ? 'bg-agent-normal/15' : msg.role === 'human' ? 'bg-primary/15' : 'bg-bg'
            }`}>
              {msg.role === 'agent' ? agent.avatar : msg.role === 'human' ? '👤' : '🔔'}
            </div>
            <div className={`max-w-[85%] rounded-xl px-3 py-2 text-xs border ${
              msg.role === 'agent' ? 'bg-agent-normal/5 border-agent-normal/15' :
              msg.role === 'human' ? 'bg-primary-light border-primary/20' :
              'bg-bg border-border text-text-muted'
            }`}>
              <div className="text-text">
                {msg.role === 'agent' ? (
                  <MarkdownContent content={msg.content} />
                ) : (
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                )}
              </div>
              <div className="text-[10px] text-text-muted mt-1 text-right">{msg.timestamp}</div>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="bg-surface border-t border-border p-2 shrink-0">
        <div className="flex items-end gap-2 bg-bg border border-border rounded-lg px-2 py-1.5 focus-within:border-primary transition-colors">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="p-1 rounded transition-colors hover:bg-border-light cursor-pointer"
            title="上传文档到知识库"
            disabled={isUploading}
          >
            {isUploading ? <Loader2 className="w-3.5 h-3.5 text-text-muted animate-spin" /> : <Paperclip className="w-3.5 h-3.5 text-text-muted" />}
          </button>
          <input ref={fileInputRef} type="file" accept=".txt,.md,.markdown,.text,.pdf" onChange={handleFileUpload} className="hidden" />
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            placeholder={isLoading ? '等待回复中...' : `给 ${agent.name} 发消息...`}
            disabled={isLoading}
            rows={1}
            className="flex-1 bg-transparent resize-none outline-none text-xs text-text py-1 disabled:opacity-50"
            style={{ minHeight: '20px' }}
          />
          <button
            onClick={handleSend}
            disabled={isLoading || !input.trim()}
            className="p-1.5 bg-primary hover:bg-primary-dark text-white rounded transition-colors shrink-0 disabled:opacity-50"
          >
            {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
          </button>
        </div>
      </div>
    </div>
  );
}
