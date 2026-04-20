import { useState, useRef, useEffect } from 'react';
import { Send, X, Settings, Loader2 } from 'lucide-react';
import { fetchSkills, runSkill } from '../services/api';
import type { SkillInfo } from '../services/api';

interface SkillChatProps {
  skillId: string;
  onClose: () => void;
}

interface ChatMsg {
  id: string;
  role: 'system' | 'skill' | 'human';
  content: string;
  timestamp: string;
}

export default function SkillChat({ skillId, onClose }: SkillChatProps) {
  const [skill, setSkill] = useState<SkillInfo | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const [isRunning, setIsRunning] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    fetchSkills().then((skills) => {
      const found = skills.find(s => s.id === skillId);
      if (found) {
        setSkill(found);
        setMessages([
          { id: '1', role: 'system', content: `已进入 ${found.name} 交互模式`, timestamp: now() },
          { id: '2', role: 'skill', content: `${found.name} 已就绪。\n\n${found.description}\n\n请在下方填写参数后点击执行。`, timestamp: now() },
        ]);
        const defaults: Record<string, string> = {};
        found.params.forEach(p => { defaults[p.name] = p.default || ''; });
        setParamValues(defaults);
      }
    });
  }, [skillId]);

  const now = () => new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

  const handleRun = async () => {
    if (isRunning || !skill) return;

    const paramStr = skill.params.map(p => `${p.name}=${paramValues[p.name] || '(空)'}`).join(', ');
    setMessages(prev => [...prev, {
      id: Date.now().toString(),
      role: 'human',
      content: `执行 ${skill.name}(${paramStr})`,
      timestamp: now(),
    }]);

    setIsRunning(true);
    const castParams: Record<string, string | number> = {};
    for (const p of skill.params) {
      const val = paramValues[p.name] || '';
      castParams[p.name] = p.type === 'number' ? parseFloat(val) || 0 : val;
    }

    const result = await runSkill(skillId, castParams);

    setMessages(prev => [...prev, {
      id: (Date.now() + 1).toString(),
      role: 'skill',
      content: result.success ? `执行成功：\n\n${result.result}` : `执行失败：${result.error}`,
      timestamp: now(),
    }]);
    setIsRunning(false);
  };

  if (!skill) return <div className="h-full flex items-center justify-center text-text-muted text-sm">加载中...</div>;

  return (
    <div className="h-full flex flex-col bg-bg border-l border-border">
      {/* Header */}
      <div className="h-12 bg-surface border-b border-border flex items-center justify-between px-3 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-base">{skill.icon}</span>
          <div>
            <div className="text-sm font-semibold text-text">{skill.name}</div>
            <div className="text-[10px] text-text-muted">{skill.category} · {skill.params.length} 个参数</div>
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

      {/* Config / Params Panel */}
      {showConfig && (
        <div className="bg-surface border-b border-border p-3 shrink-0 animate-fade-in">
          <h4 className="text-xs font-semibold text-text mb-2">技能信息</h4>
          <p className="text-xs text-text-secondary mb-2">{skill.description}</p>
          <div className="text-xs text-text-muted">ID: {skill.id}</div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex gap-2 animate-slide-in ${msg.role === 'human' ? 'flex-row-reverse' : ''}`}>
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs shrink-0 ${
              msg.role === 'skill' ? 'bg-skill/15 text-skill' :
              msg.role === 'human' ? 'bg-primary/15 text-primary-dark' : 'bg-bg'
            }`}>
              {msg.role === 'skill' ? '🔧' : msg.role === 'human' ? '👤' : '🔔'}
            </div>
            <div className={`max-w-[85%] rounded-xl px-3 py-2 text-xs border ${
              msg.role === 'skill' ? 'bg-skill/5 border-skill/15' :
              msg.role === 'human' ? 'bg-primary-light border-primary/20' :
              'bg-bg border-border text-text-muted'
            }`}>
              <div className="text-text whitespace-pre-wrap">{msg.content}</div>
              <div className="text-[10px] text-text-muted mt-1 text-right">{msg.timestamp}</div>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Param Input + Run Button */}
      <div className="bg-surface border-t border-border p-3 shrink-0 space-y-2">
        {skill.params.map((p) => (
          <div key={p.name} className="flex items-center gap-2">
            <label className="text-xs text-text-secondary w-24 shrink-0 text-right">{p.name}:</label>
            <input
              type={p.type === 'number' ? 'number' : 'text'}
              step={p.type === 'number' ? 'any' : undefined}
              value={paramValues[p.name] || ''}
              onChange={(e) => setParamValues(prev => ({ ...prev, [p.name]: e.target.value }))}
              placeholder={`${p.type}${p.default ? ` (默认: ${p.default})` : ''}`}
              className="flex-1 bg-bg border border-border rounded-lg px-3 py-1.5 text-xs text-text outline-none focus:border-primary transition-colors"
              onKeyDown={(e) => { if (e.key === 'Enter') handleRun(); }}
            />
          </div>
        ))}
        <button
          onClick={handleRun}
          disabled={isRunning}
          className="w-full flex items-center justify-center gap-2 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
        >
          {isRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          {isRunning ? '执行中...' : '执行'}
        </button>
      </div>
    </div>
  );
}
