import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, X, Settings, Loader2, Trash2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { fetchSkills, deleteSkill, streamSkillChat } from '../services/api';
import type { SkillInfo } from '../services/api';

interface SkillChatProps {
  skillId: string;
  onClose: () => void;
}

interface ChatMsg {
  id: string;
  role: 'system' | 'assistant' | 'human';
  content: string;
  timestamp: string;
}

const SUGGESTIONS_MAP: Record<string, string[]> = {
  mounted: ['把这个技能挂载到数据分析 Agent', '挂载到所有 Agent'],
  execute: ['执行一下这个技能', '用默认参数运行'],
  modify: ['优化一下这个技能的性能', '增加错误处理逻辑'],
  create: ['帮我创建一个新技能：查询天气', '创建一个计算BMI的技能'],
  delete: ['删除这个技能'],
};

function MarkdownContent({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <p className="mb-1.5 last:mb-0">{children}</p>,
        ul: ({ children }) => <ul className="list-disc pl-4 mb-1.5">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal pl-4 mb-1.5">{children}</ol>,
        code: ({ className, children }) => {
          const isBlock = className?.startsWith('language-');
          return isBlock ? (
            <pre className="bg-bg rounded-lg p-2 overflow-x-auto my-1.5">
              <code className="text-[11px]">{children}</code>
            </pre>
          ) : (
            <code className="bg-bg px-1 py-0.5 rounded text-[11px]">{children}</code>
          );
        },
        table: ({ children }) => (
          <div className="overflow-x-auto my-1.5">
            <table className="min-w-full text-xs border-collapse border border-border">{children}</table>
          </div>
        ),
        th: ({ children }) => <th className="border border-border bg-surface px-2 py-1 text-left font-semibold">{children}</th>,
        td: ({ children }) => <td className="border border-border px-2 py-1">{children}</td>,
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

export default function SkillChat({ skillId, onClose }: SkillChatProps) {
  const [skill, setSkill] = useState<SkillInfo | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [sessionId] = useState(() => `skill_${skillId}_${Date.now()}`);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    fetchSkills().then((skills) => {
      const found = skills.find(s => s.id === skillId);
      if (found) {
        setSkill(found);
        const mountedStr = found.mounted_agents && found.mounted_agents.length > 0
          ? `已挂载到：${found.mounted_agents.map(a => a.name).join('、')}`
          : '尚未挂载到任何 Agent';
        const paramsStr = found.params.length > 0
          ? `参数：${found.params.map(p => `${p.name}(${p.type})`).join('、')}`
          : '无需参数';
        setMessages([
          {
            id: '1',
            role: 'system',
            content: `已进入「${found.name}」管理模式`,
            timestamp: now(),
          },
          {
            id: '2',
            role: 'assistant',
            content: `你好！我是技能管理助手。\n\n**当前技能：${found.name}**\n- ${found.description}\n- ${paramsStr}\n- ${mountedStr}\n\n你可以用自然语言告诉我你想做什么，比如：\n- 挂载/卸载到某个 Agent\n- 执行技能\n- 修改/优化技能代码\n- 创建新技能\n- 删除技能`,
            timestamp: now(),
          },
        ]);
      }
    });
  }, [skillId]);

  const now = () => new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

  const refreshSkill = useCallback(() => {
    fetchSkills().then((skills) => {
      const found = skills.find(s => s.id === skillId);
      if (found) setSkill(found);
    });
  }, [skillId]);

  const handleSend = async (text?: string) => {
    const msg = (text || input).trim();
    if (!msg || isStreaming) return;

    setInput('');
    const humanId = Date.now().toString();
    setMessages(prev => [...prev, {
      id: humanId,
      role: 'human',
      content: msg,
      timestamp: now(),
    }]);

    setIsStreaming(true);
    const assistantId = (Date.now() + 1).toString();
    setMessages(prev => [...prev, {
      id: assistantId,
      role: 'assistant',
      content: '',
      timestamp: now(),
    }]);

    try {
      await streamSkillChat(skillId, msg, sessionId, (chunk) => {
        if (chunk.content) {
          setMessages(prev => prev.map(m =>
            m.id === assistantId ? { ...m, content: m.content + chunk.content } : m
          ));
        }
      });
    } catch (err) {
      setMessages(prev => prev.map(m =>
        m.id === assistantId ? { ...m, content: `出错了：${err}` } : m
      ));
    }

    setIsStreaming(false);
    refreshSkill();
  };

  const handleDelete = async () => {
    if (!confirm('确认删除此技能？已挂载到 Agent 的绑定也会自动解除。')) return;
    setDeleting(true);
    await deleteSkill(skillId);
    setDeleting(false);
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!skill) return <div className="h-full flex items-center justify-center text-text-muted text-sm">加载中...</div>;

  const quickActions = [
    ...SUGGESTIONS_MAP.mounted?.slice(0, 1) || [],
    ...SUGGESTIONS_MAP.execute?.slice(0, 1) || [],
    ...SUGGESTIONS_MAP.modify?.slice(0, 1) || [],
    ...SUGGESTIONS_MAP.create?.slice(0, 1) || [],
  ];

  return (
    <div className="h-full flex flex-col bg-bg border-l border-border">
      {/* Header */}
      <div className="h-12 bg-surface border-b border-border flex items-center justify-between px-3 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-base">{skill.icon}</span>
          <div>
            <div className="text-sm font-semibold text-text">{skill.name}</div>
            <div className="text-[10px] text-text-muted">{skill.category} · 对话管理</div>
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

      {/* Config Panel */}
      {showConfig && (
        <div className="bg-surface border-b border-border p-3 shrink-0 animate-fade-in space-y-3">
          <div>
            <h4 className="text-xs font-semibold text-text mb-1.5">技能信息</h4>
            <p className="text-xs text-text-secondary mb-1">{skill.description}</p>
            <div className="text-xs text-text-muted">ID: {skill.id}</div>
            {skill.params.length > 0 && (
              <div className="text-xs text-text-muted mt-1">
                参数: {skill.params.map(p => `${p.name}(${p.type})`).join(', ')}
              </div>
            )}
          </div>
          <div>
            <h4 className="text-xs font-semibold text-text mb-1.5">已挂载 Agent</h4>
            {skill.mounted_agents && skill.mounted_agents.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {skill.mounted_agents.map(a => (
                  <span key={a.id} className="text-[10px] bg-primary-light text-primary-dark px-2 py-0.5 rounded-full">{a.name}</span>
                ))}
              </div>
            ) : (
              <p className="text-[10px] text-text-muted">未挂载到任何 Agent</p>
            )}
          </div>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-error hover:bg-error/10 rounded-lg transition-colors disabled:opacity-50"
          >
            {deleting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
            删除此技能
          </button>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex gap-2 animate-slide-in ${msg.role === 'human' ? 'flex-row-reverse' : ''}`}>
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs shrink-0 ${
              msg.role === 'assistant' ? 'bg-skill/15 text-skill' :
              msg.role === 'human' ? 'bg-primary/15 text-primary-dark' : 'bg-bg'
            }`}>
              {msg.role === 'assistant' ? '🤖' : msg.role === 'human' ? '👤' : '🔔'}
            </div>
            <div className={`max-w-[85%] rounded-xl px-3 py-2 text-xs border ${
              msg.role === 'assistant' ? 'bg-skill/5 border-skill/15' :
              msg.role === 'human' ? 'bg-primary-light border-primary/20' :
              'bg-bg border-border text-text-muted'
            }`}>
              <div className="text-text">
                {msg.role === 'assistant' ? (
                  <MarkdownContent content={msg.content || '思考中...'} />
                ) : (
                  <span className="whitespace-pre-wrap">{msg.content}</span>
                )}
              </div>
              <div className="text-[10px] text-text-muted mt-1 text-right">{msg.timestamp}</div>
            </div>
          </div>
        ))}
        {isStreaming && messages[messages.length - 1]?.content === '' && (
          <div className="flex items-center gap-2 text-text-muted text-xs pl-8">
            <Loader2 className="w-3 h-3 animate-spin" />
            正在处理...
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Quick Actions */}
      {messages.length <= 3 && !isStreaming && (
        <div className="px-3 pb-1 flex flex-wrap gap-1.5">
          {quickActions.map((action, i) => (
            <button
              key={i}
              onClick={() => handleSend(action)}
              className="text-[10px] px-2.5 py-1 bg-surface border border-border rounded-full text-text-secondary hover:border-primary hover:text-primary-dark transition-colors"
            >
              {action}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="bg-surface border-t border-border p-3 shrink-0">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="用自然语言管理技能：挂载、执行、修改、创建、删除..."
            className="flex-1 bg-bg border border-border rounded-lg px-3 py-2 text-xs text-text outline-none focus:border-primary transition-colors resize-none max-h-20 overflow-y-auto"
            disabled={isStreaming}
          />
          <button
            onClick={() => handleSend()}
            disabled={isStreaming || !input.trim()}
            className="p-2 bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors disabled:opacity-50 shrink-0"
          >
            {isStreaming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
