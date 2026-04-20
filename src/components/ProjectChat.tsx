import { useState, useRef, useEffect } from 'react';
import { Send, Paperclip, AtSign, ChevronDown, ChevronUp, Loader2, FileSpreadsheet } from 'lucide-react';
import { chatMessages, projects } from '../data/mockData';
import type { ChatMessage } from '../data/mockData';

interface ProjectChatProps {
  projectId: string;
}

const roleConfig = {
  system: { label: '系统', bg: 'bg-bg', text: 'text-text-muted', border: 'border-border', icon: '🔔' },
  human: { label: '人类员工', bg: 'bg-primary-light', text: 'text-primary-dark', border: 'border-primary/20', icon: '👤' },
  host: { label: '群主', bg: 'bg-agent-host/10', text: 'text-agent-host', border: 'border-agent-host/20', icon: '👑' },
  agent: { label: 'Agent', bg: 'bg-agent-normal/10', text: 'text-agent-normal', border: 'border-agent-normal/20', icon: '🤖' },
  skill: { label: 'Skill', bg: 'bg-skill/10', text: 'text-skill', border: 'border-skill/20', icon: '🔧' },
};

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const [showPlan, setShowPlan] = useState(false);
  const config = roleConfig[msg.role];
  const isHost = msg.role === 'host';

  return (
    <div className={`flex gap-3 animate-slide-in ${msg.role === 'human' ? 'flex-row-reverse' : ''}`}>
      {/* Avatar */}
      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm shrink-0 ${
        msg.role === 'host' ? 'bg-agent-host/15' :
        msg.role === 'agent' ? 'bg-agent-normal/15' :
        msg.role === 'skill' ? 'bg-skill/15' :
        msg.role === 'human' ? 'bg-primary/15' : 'bg-bg'
      }`}>
        {config.icon}
      </div>

      {/* Content */}
      <div className={`max-w-[70%] ${msg.role === 'human' ? 'items-end' : 'items-start'}`}>
        <div className="flex items-center gap-2 mb-1">
          <span className={`text-xs font-semibold ${config.text}`}>{msg.senderName}</span>
          <span className="text-xs text-text-muted">{msg.timestamp}</span>
          {msg.status === 'sending' && <Loader2 className="w-3 h-3 text-text-muted animate-spin" />}
        </div>

        <div className={`rounded-xl px-4 py-2.5 text-sm border ${config.bg} ${config.border}`}>
          {/* Plan Card */}
          {isHost && msg.metadata?.plan && (
            <div className="mb-2">
              <button
                onClick={() => setShowPlan(!showPlan)}
                className="flex items-center gap-1 text-xs font-medium text-agent-host mb-1 hover:opacity-80"
              >
                {showPlan ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                执行计划 ({msg.metadata.plan.length} 步)
              </button>
              {showPlan && (
                <div className="bg-white/60 rounded-lg p-2 space-y-1">
                  {msg.metadata.plan.map((step, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs">
                      <span className="w-4 h-4 rounded-full bg-agent-host/20 text-agent-host flex items-center justify-center text-[10px] font-bold shrink-0">
                        {i + 1}
                      </span>
                      <span className="text-text-secondary">{step}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Tool Call Indicator */}
          {msg.metadata?.toolCall && (
            <div className="mb-2 flex items-center gap-2 text-xs bg-white/60 rounded-lg px-2.5 py-1.5">
              <Loader2 className="w-3 h-3 text-info animate-spin" />
              <span className="text-text-secondary">调用</span>
              <span className="font-mono text-info bg-info/10 px-1 rounded">{msg.metadata.toolCall.name}</span>
            </div>
          )}

          {/* Result Card */}
          {msg.metadata?.result && (
            <div className="mb-2 p-2 bg-white/60 rounded-lg border border-border-light">
              <div className="text-xs text-text-muted mb-1">执行结果</div>
              <div className="h-16 bg-bg rounded border border-border flex items-center justify-center text-xs text-text-muted">
                📊 图表已渲染（模拟）
              </div>
            </div>
          )}

          {/* Message Text */}
          <div className="text-text whitespace-pre-wrap">{renderMentions(msg.content)}</div>
        </div>
      </div>
    </div>
  );
}

function renderMentions(text: string) {
  const parts = text.split(/(@\S+)/g);
  return parts.map((part, i) => {
    if (part.startsWith('@')) {
      return (
        <span key={i} className="inline-flex items-center gap-0.5 bg-primary/10 text-primary px-1.5 py-0.5 rounded-md font-medium">
          <AtSign className="w-3 h-3" />
          {part.slice(1)}
        </span>
      );
    }
    return part;
  });
}

export default function ProjectChat({ projectId }: ProjectChatProps) {
  const project = projects.find(p => p.id === projectId);
  const [messages] = useState<ChatMessage[]>(chatMessages);
  const [input, setInput] = useState('');
  const [showMention, setShowMention] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  const handleSend = () => {
    if (!input.trim()) return;
    setInput('');
  };

  if (!project) return <div className="flex items-center justify-center h-full text-text-muted">项目不存在</div>;

  return (
    <div className="h-full flex flex-col bg-bg">
      {/* Chat Header */}
      <div className="h-14 bg-surface border-b border-border flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-success" />
          <div>
            <h2 className="font-semibold text-text text-sm">{project.name}</h2>
            <p className="text-xs text-text-muted">{project.description} · {project.memberCount} 位成员</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {['👤', '🤖', '👑', '🤖'].map((a, i) => (
            <div key={i} className="w-7 h-7 rounded-full bg-bg border border-border flex items-center justify-center text-xs -ml-2 first:ml-0">
              {a}
            </div>
          ))}
          <span className="text-xs text-text-muted ml-1">+2</span>
        </div>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* File upload hint */}
        <div className="flex items-center justify-center py-2">
          <div className="flex items-center gap-2 text-xs text-text-muted bg-surface border border-border rounded-full px-3 py-1.5">
            <FileSpreadsheet className="w-3.5 h-3.5" />
            samhar 上传了 sales_q3.xlsx
          </div>
        </div>

        {messages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input Area */}
      <div className="bg-surface border-t border-border p-3 shrink-0">
        <div className="relative">
          <div className="flex items-end gap-2 bg-bg border border-border rounded-xl px-3 py-2 focus-within:border-primary transition-colors">
            <button className="p-1.5 hover:bg-border-light rounded-lg transition-colors shrink-0">
              <Paperclip className="w-4.5 h-4.5 text-text-muted" />
            </button>
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
              placeholder="输入消息，使用 @ 召唤 Agent 或 Skill..."
              rows={1}
              className="flex-1 bg-transparent resize-none outline-none text-sm text-text max-h-32 py-1.5"
              style={{ minHeight: '24px' }}
            />
            <button className="p-1.5 hover:bg-border-light rounded-lg transition-colors shrink-0" onClick={() => setShowMention(!showMention)}>
              <AtSign className="w-4.5 h-4.5 text-text-muted" />
            </button>
            <button
              onClick={handleSend}
              className="p-2 bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors shrink-0"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>

          {/* Mention Popup */}
          {showMention && (
            <div className="absolute bottom-full left-0 mb-2 w-64 bg-surface border border-border rounded-xl shadow-lg overflow-hidden animate-fade-in">
              <div className="px-3 py-2 text-xs font-semibold text-text-muted border-b border-border-light">快速召唤</div>
              {[
                { name: '项目管家', type: '群主', icon: '👑' },
                { name: '数据分析Agent', type: 'Agent', icon: '🤖' },
                { name: '图表生成', type: 'Skill', icon: '🔧' },
                { name: 'Python沙箱', type: 'Skill', icon: '🐍' },
              ].map((item) => (
                <button
                  key={item.name}
                  onClick={() => {
                    setInput(input + item.name + ' ');
                    setShowMention(false);
                  }}
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
        <div className="text-xs text-text-muted mt-1.5 px-1">
          按 Enter 发送，Shift + Enter 换行 · 支持 Markdown、@ 提及
        </div>
      </div>
    </div>
  );
}
