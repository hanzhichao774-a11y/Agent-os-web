import { useState, useEffect } from 'react';
import { Plus, Settings, TrendingUp, CheckCircle2, MessageSquare, Loader2 } from 'lucide-react';
import { fetchAgents } from '../services/api';
import type { AgentInfo } from '../services/api';

interface AgentPageProps {
  selectedAgentId: string | null;
  onSelectAgent: (id: string | null) => void;
}

export default function AgentPage({ selectedAgentId, onSelectAgent }: AgentPageProps) {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'tools' | 'knowledge'>('all');

  useEffect(() => {
    fetchAgents().then(data => {
      setAgents(data);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const filtered = filter === 'all'
    ? agents
    : filter === 'tools'
      ? agents.filter(a => a.builtin_tools.length > 0)
      : agents.filter(a => a.has_knowledge);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold text-text">智能体广场</h1>
            <p className="text-sm text-text-secondary mt-1">
              共 {agents.length} 个 Agent，点击卡片进入交互
            </p>
          </div>
          <button className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-dark transition-colors">
            <Plus className="w-4 h-4" />
            接入 Agent
          </button>
        </div>

        <div className="flex items-center gap-2 mb-6">
          {([
            { key: 'all', label: '全部' },
            { key: 'tools', label: '有工具' },
            { key: 'knowledge', label: '知识库' },
          ] as const).map((tab) => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                filter === tab.key
                  ? 'bg-primary-light text-primary-dark'
                  : 'text-text-secondary hover:bg-bg'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-3 gap-4">
          {filtered.map((agent) => {
            const isSelected = selectedAgentId === agent.id;
            const toolCount = agent.builtin_tools.length + agent.custom_tools.length;
            return (
              <div
                key={agent.id}
                onClick={() => onSelectAgent(agent.id)}
                className={`bg-surface border rounded-xl p-4 cursor-pointer transition-all group ${
                  isSelected
                    ? 'border-primary shadow-sm ring-1 ring-primary/20'
                    : 'border-border hover:border-primary/30 hover:shadow-sm'
                }`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-bg border border-border rounded-xl flex items-center justify-center text-xl">
                      {agent.avatar}
                    </div>
                    <div>
                      <h3 className="font-semibold text-text text-sm">{agent.name}</h3>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-success" />
                        <span className="text-xs text-text-muted">就绪</span>
                      </div>
                    </div>
                  </div>
                  {toolCount > 0 && (
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-primary-light text-primary-dark">
                      {toolCount} 工具
                    </span>
                  )}
                </div>

                <p className="text-sm text-text-secondary mb-3 line-clamp-2">{agent.description}</p>

                <div className="flex flex-wrap gap-1.5 mb-4">
                  {agent.capabilities.map((cap) => (
                    <span key={cap} className="text-xs bg-bg text-text-secondary px-2 py-0.5 rounded-md border border-border-light">
                      {cap}
                    </span>
                  ))}
                </div>

                <div className="flex items-center justify-between pt-3 border-t border-border-light">
                  <div className="flex items-center gap-1 text-xs text-text-muted">
                    <TrendingUp className="w-3 h-3" />
                    {agent.builtin_tools.join(', ') || '无内置工具'}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={(e) => { e.stopPropagation(); onSelectAgent(agent.id); }}
                      className={`p-1.5 rounded-lg transition-colors ${
                        isSelected ? 'bg-primary-light text-primary-dark' : 'hover:bg-bg text-text-muted opacity-0 group-hover:opacity-100'
                      }`}
                      title="进入交互"
                    >
                      <MessageSquare className="w-4 h-4" />
                    </button>
                    <button
                      onClick={(e) => e.stopPropagation()}
                      className="p-1.5 hover:bg-bg rounded-lg transition-colors text-text-muted opacity-0 group-hover:opacity-100"
                    >
                      <Settings className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
