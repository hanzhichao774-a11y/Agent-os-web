import { useState, useRef, useEffect } from 'react';
import { Send, Paperclip, X, CheckCircle2, MinusCircle, XCircle, Settings, Loader2, Upload } from 'lucide-react';
import { agents } from '../data/mockData';
import { streamAgentChat, uploadDocument } from '../services/api';

interface AgentChatProps {
  agentId: string;
  onClose: () => void;
}

interface ChatMsg {
  id: string;
  role: 'system' | 'agent' | 'human';
  content: string;
  timestamp: string;
  card?: {
    type: 'result' | 'config';
    title: string;
    data: Record<string, string>;
  };
}

const mockConversations: Record<string, ChatMsg[]> = {
  a1: [
    { id: '1', role: 'system', content: '已进入 数据分析Agent 交互模式', timestamp: '10:00' },
    { id: '2', role: 'agent', content: '你好 samhar，我是数据分析Agent。我可以帮你执行 SQL 查询、数据清洗、统计建模。需要分析什么数据？', timestamp: '10:00' },
    { id: '3', role: 'human', content: '帮我查一下 Q3 各业务线的营收对比', timestamp: '10:01' },
    { id: '4', role: 'agent', content: '正在执行查询...', timestamp: '10:01' },
    { id: '5', role: 'agent', content: '查询完成，结果如下：', timestamp: '10:02', card: { type: 'result', title: 'Q3 营收对比', data: { '云服务': '3,240万 (+18%)', '企业服务': '2,890万 (+12%)', '消费者业务': '1,560万 (-5%)', '海外市场': '980万 (+34%)' } } },
    { id: '6', role: 'human', content: '消费者业务下滑了，帮我做个下钻分析', timestamp: '10:03' },
    { id: '7', role: 'agent', content: '收到，正在对消费者业务进行下钻分析，提取地区、产品线和渠道维度的数据...', timestamp: '10:03' },
  ],
  a2: [
    { id: '1', role: 'system', content: '已进入 知识检索Agent 交互模式', timestamp: '10:00' },
    { id: '2', role: 'agent', content: '你好，我是知识检索Agent。我可以帮你搜索企业内部的知识库、文档和邮件。你想查什么？', timestamp: '10:00' },
  ],
  a3: [
    { id: '1', role: 'system', content: '已进入 代码助手Agent 交互模式', timestamp: '10:00' },
    { id: '2', role: 'agent', content: '你好，我是代码助手Agent。我可以帮你生成、审查和重构代码。当前状态：忙碌中（正在处理其他任务）', timestamp: '10:00' },
  ],
  default: [
    { id: '1', role: 'system', content: '已进入交互模式', timestamp: '10:00' },
    { id: '2', role: 'agent', content: '你好，有什么可以帮你的？', timestamp: '10:00' },
  ],
};

export default function AgentChat({ agentId, onClose }: AgentChatProps) {
  const agent = agents.find(a => a.id === agentId);
  const [messages, setMessages] = useState<ChatMsg[]>(mockConversations[agentId] || mockConversations.default);
  const [input, setInput] = useState('');
  const [showConfig, setShowConfig] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const sessionId = useRef(`${agentId}_${Date.now()}`);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isKnowledgeAgent = agentId === 'a2';

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    setMessages(mockConversations[agentId] || mockConversations.default);
    sessionId.current = `${agentId}_${Date.now()}`;
  }, [agentId]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMsg: ChatMsg = {
      id: Date.now().toString(),
      role: 'human',
      content: input,
      timestamp: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
    };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    const agentMsgId = `agent_${Date.now()}`;
    setMessages(prev => [...prev, {
      id: agentMsgId,
      role: 'agent',
      content: '',
      timestamp: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
    }]);

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
          ? { ...m, content: '⚠️ 连接后端失败，请确认后端服务已启动（http://localhost:8000）。' }
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
    setMessages(prev => [...prev, {
      id: `upload_${Date.now()}`,
      role: 'system',
      content: `正在上传 ${file.name}...`,
      timestamp: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
    }]);

    try {
      const result = await uploadDocument(file);
      if (result.success) {
        setMessages(prev => [...prev, {
          id: `upload_done_${Date.now()}`,
          role: 'system',
          content: `✅ 已上传 ${result.doc_name}，共 ${result.chunks} 个段落已入库。你现在可以对这份文档提问了。`,
          timestamp: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
        }]);
      } else {
        setMessages(prev => [...prev, {
          id: `upload_err_${Date.now()}`,
          role: 'system',
          content: `❌ 上传失败：${result.error || '未知错误'}`,
          timestamp: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
        }]);
      }
    } catch {
      setMessages(prev => [...prev, {
        id: `upload_err_${Date.now()}`,
        role: 'system',
        content: '❌ 上传失败，请确认后端服务已启动。',
        timestamp: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
      }]);
    } finally {
      setIsUploading(false);
    }
  };

  if (!agent) return null;

  const statusIcon = agent.status === 'online' ? <CheckCircle2 className="w-3 h-3 text-success" /> : agent.status === 'busy' ? <MinusCircle className="w-3 h-3 text-warning" /> : <XCircle className="w-3 h-3 text-text-muted" />;

  return (
    <div className="h-full flex flex-col bg-bg border-l border-border">
      {/* Header */}
      <div className="h-12 bg-surface border-b border-border flex items-center justify-between px-3 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-base">{agent.avatar}</span>
          <div>
            <div className="text-sm font-semibold text-text">{agent.name}</div>
            <div className="flex items-center gap-1 text-[10px] text-text-muted">
              {statusIcon}
              {agent.status === 'online' ? '在线' : agent.status === 'busy' ? '忙碌' : '离线'} · {agent.calls.toLocaleString()} 次调用
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowConfig(!showConfig)}
            className={`p-1.5 rounded-lg transition-colors ${showConfig ? 'bg-primary-light text-primary-dark' : 'hover:bg-bg text-text-muted'}`}
            title="配置"
          >
            <Settings className="w-4 h-4" />
          </button>
          <button onClick={onClose} className="p-1.5 hover:bg-bg rounded-lg transition-colors text-text-muted">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Config Panel */}
      {showConfig && (
        <div className="bg-surface border-b border-border p-3 shrink-0 animate-fade-in">
          <h4 className="text-xs font-semibold text-text mb-2">Agent 配置</h4>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-text-secondary">超时时间</span>
              <select className="bg-bg border border-border rounded px-2 py-1 text-xs">
                <option>30 秒</option>
                <option>60 秒</option>
                <option>120 秒</option>
              </select>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-text-secondary">重试次数</span>
              <select className="bg-bg border border-border rounded px-2 py-1 text-xs">
                <option>1 次</option>
                <option>2 次</option>
                <option>3 次</option>
              </select>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-text-secondary">日志级别</span>
              <select className="bg-bg border border-border rounded px-2 py-1 text-xs">
                <option>INFO</option>
                <option>DEBUG</option>
                <option>WARN</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex gap-2 animate-slide-in ${msg.role === 'human' ? 'flex-row-reverse' : ''}`}>
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs shrink-0 ${
              msg.role === 'agent' ? 'bg-agent-normal/15 text-agent-normal' :
              msg.role === 'human' ? 'bg-primary/15 text-primary-dark' : 'bg-bg'
            }`}>
              {msg.role === 'agent' ? '🤖' : msg.role === 'human' ? '👤' : '🔔'}
            </div>
            <div className={`max-w-[85%] rounded-xl px-3 py-2 text-xs border ${
              msg.role === 'agent' ? 'bg-agent-normal/5 border-agent-normal/15' :
              msg.role === 'human' ? 'bg-primary-light border-primary/20' :
              'bg-bg border-border text-text-muted'
            }`}>
              <div className="text-text whitespace-pre-wrap">{msg.content}</div>
              {msg.card && (
                <div className="mt-2 bg-white/70 border border-border rounded-lg p-2">
                  <div className="text-[10px] font-semibold text-text-muted mb-1">{msg.card.title}</div>
                  <div className="space-y-1">
                    {Object.entries(msg.card.data).map(([k, v]) => (
                      <div key={k} className="flex items-center justify-between text-[11px]">
                        <span className="text-text-secondary">{k}</span>
                        <span className="font-medium text-text">{v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="text-[10px] text-text-muted mt-1 text-right">{msg.timestamp}</div>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="bg-surface border-t border-border p-2 shrink-0">
        <div className="flex items-end gap-2 bg-bg border border-border rounded-lg px-2 py-1.5 focus-within:border-primary transition-colors">
          <button
            onClick={() => isKnowledgeAgent && fileInputRef.current?.click()}
            className={`p-1 rounded transition-colors shrink-0 ${
              isKnowledgeAgent ? 'hover:bg-border-light cursor-pointer' : 'opacity-30 cursor-not-allowed'
            }`}
            title={isKnowledgeAgent ? '上传文档到知识库' : '仅知识检索Agent支持文件上传'}
            disabled={isUploading}
          >
            {isUploading ? <Loader2 className="w-3.5 h-3.5 text-text-muted animate-spin" /> : <Paperclip className="w-3.5 h-3.5 text-text-muted" />}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.md,.markdown,.text,.pdf"
            onChange={handleFileUpload}
            className="hidden"
          />
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={isLoading ? '等待回复中...' : `给 ${agent.name} 发消息...`}
            disabled={isLoading}
            rows={1}
            className="flex-1 bg-transparent resize-none outline-none text-xs text-text py-1 disabled:opacity-50"
            style={{ minHeight: '20px' }}
          />
          <button
            onClick={handleSend}
            disabled={isLoading || !input.trim()}
            className="p-1.5 bg-primary hover:bg-primary-dark text-white rounded transition-colors shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
          </button>
        </div>
      </div>
    </div>
  );
}
