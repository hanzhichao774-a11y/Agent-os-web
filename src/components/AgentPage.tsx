import { useState, useEffect, useCallback } from 'react';
import { Plus, Settings, TrendingUp, CheckCircle2, MessageSquare, Loader2, X, Save, Wrench, Unlink } from 'lucide-react';
import { fetchAgents, fetchSkills, setAgentTools, updateAgentConfig } from '../services/api';
import type { AgentInfo, SkillInfo } from '../services/api';

interface AgentPageProps {
  selectedAgentId: string | null;
  onSelectAgent: (id: string | null) => void;
}

export default function AgentPage({ selectedAgentId, onSelectAgent }: AgentPageProps) {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'tools' | 'knowledge'>('all');
  const [configAgent, setConfigAgent] = useState<AgentInfo | null>(null);
  const [allSkills, setAllSkills] = useState<SkillInfo[]>([]);

  const loadAgents = useCallback(() => {
    fetchAgents().then(data => {
      setAgents(data);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  useEffect(() => { loadAgents(); }, [loadAgents]);

  const openConfig = async (agent: AgentInfo) => {
    setConfigAgent(agent);
    const skills = await fetchSkills();
    setAllSkills(skills);
  };

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
          <button
            onClick={() => alert('动态创建 Agent 功能即将上线，敬请期待！')}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-dark transition-colors"
          >
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
                      onClick={(e) => { e.stopPropagation(); openConfig(agent); }}
                      className="p-1.5 hover:bg-bg rounded-lg transition-colors text-text-muted opacity-0 group-hover:opacity-100"
                      title="Agent 设置"
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

      {configAgent && (
        <AgentConfigModal
          agent={configAgent}
          allSkills={allSkills}
          onClose={() => setConfigAgent(null)}
          onSaved={() => {
            setConfigAgent(null);
            loadAgents();
          }}
        />
      )}
    </div>
  );
}


interface AgentConfigModalProps {
  agent: AgentInfo;
  allSkills: SkillInfo[];
  onClose: () => void;
  onSaved: () => void;
}

function AgentConfigModal({ agent, allSkills, onClose, onSaved }: AgentConfigModalProps) {
  const [description, setDescription] = useState(agent.description);
  const [instructions, setInstructions] = useState((agent.instructions || []).join('\n'));
  const [mountedSkills, setMountedSkills] = useState<string[]>([...agent.custom_tools]);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<'config' | 'skills'>('config');

  const handleSave = async () => {
    setSaving(true);
    await Promise.all([
      updateAgentConfig(agent.id, {
        description,
        instructions: instructions.split('\n').filter(l => l.trim()),
      }),
      setAgentTools(agent.id, mountedSkills),
    ]);
    setSaving(false);
    onSaved();
  };

  const toggleSkill = (skillId: string) => {
    setMountedSkills(prev =>
      prev.includes(skillId) ? prev.filter(s => s !== skillId) : [...prev, skillId]
    );
  };

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-surface border border-border rounded-2xl shadow-xl w-[560px] max-h-[80vh] flex flex-col animate-fade-in" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-bg border border-border rounded-xl flex items-center justify-center text-xl">
              {agent.avatar}
            </div>
            <div>
              <h3 className="font-semibold text-text">{agent.name}</h3>
              <span className="text-xs text-text-muted">{agent.id}</span>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-bg rounded-lg transition-colors text-text-muted">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border shrink-0">
          <button
            onClick={() => setTab('config')}
            className={`flex-1 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === 'config' ? 'border-primary text-primary-dark' : 'border-transparent text-text-secondary hover:text-text'
            }`}
          >
            角色配置
          </button>
          <button
            onClick={() => setTab('skills')}
            className={`flex-1 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === 'skills' ? 'border-primary text-primary-dark' : 'border-transparent text-text-secondary hover:text-text'
            }`}
          >
            技能管理 ({mountedSkills.length})
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4 min-h-0">
          {tab === 'config' ? (
            <>
              <div>
                <label className="text-xs font-semibold text-text-secondary block mb-1.5">描述</label>
                <textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  rows={2}
                  className="w-full bg-bg border border-border rounded-xl px-3 py-2 text-sm text-text outline-none focus:border-primary transition-colors resize-none"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-text-secondary block mb-1.5">角色指令（每行一条）</label>
                <textarea
                  value={instructions}
                  onChange={e => setInstructions(e.target.value)}
                  rows={8}
                  className="w-full bg-bg border border-border rounded-xl px-3 py-2 text-sm text-text outline-none focus:border-primary transition-colors resize-none font-mono leading-relaxed"
                  placeholder="输入角色指令，每行一条..."
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-text-secondary block mb-1.5">内置工具</label>
                <div className="flex flex-wrap gap-1.5">
                  {agent.builtin_tools.length > 0 ? agent.builtin_tools.map(t => (
                    <span key={t} className="text-xs bg-primary-light text-primary-dark px-2 py-0.5 rounded-md">{t}</span>
                  )) : (
                    <span className="text-xs text-text-muted">无内置工具</span>
                  )}
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-text-secondary block mb-1.5">能力标签</label>
                <div className="flex flex-wrap gap-1.5">
                  {agent.capabilities.map(c => (
                    <span key={c} className="text-xs bg-bg text-text-secondary px-2 py-0.5 rounded-md border border-border-light">{c}</span>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <>
              {/* Mounted Skills */}
              {mountedSkills.length > 0 && (
                <div>
                  <label className="text-xs font-semibold text-text-secondary block mb-2">已挂载技能</label>
                  <div className="space-y-2">
                    {mountedSkills.map(sid => {
                      const skill = allSkills.find(s => s.id === sid);
                      return (
                        <div key={sid} className="flex items-center justify-between bg-bg border border-border rounded-lg px-3 py-2">
                          <div className="flex items-center gap-2">
                            <span className="text-base">{skill?.icon || '🔧'}</span>
                            <div>
                              <div className="text-sm font-medium text-text">{skill?.name || sid}</div>
                              <div className="text-xs text-text-muted">{skill?.description || ''}</div>
                            </div>
                          </div>
                          <button
                            onClick={() => toggleSkill(sid)}
                            className="p-1.5 hover:bg-error/10 rounded-lg transition-colors text-text-muted hover:text-error"
                            title="卸载技能"
                          >
                            <Unlink className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Available Skills */}
              <div>
                <label className="text-xs font-semibold text-text-secondary block mb-2">
                  可用技能 {allSkills.length > 0 ? `(${allSkills.length})` : ''}
                </label>
                {allSkills.length === 0 ? (
                  <div className="text-xs text-text-muted py-4 text-center">暂无可用技能，请先在技能管理页面创建</div>
                ) : (
                  <div className="space-y-1.5">
                    {allSkills.map(skill => {
                      const isMounted = mountedSkills.includes(skill.id);
                      return (
                        <div
                          key={skill.id}
                          onClick={() => toggleSkill(skill.id)}
                          className={`flex items-center justify-between rounded-lg px-3 py-2 cursor-pointer transition-colors border ${
                            isMounted
                              ? 'bg-primary-light/50 border-primary/20'
                              : 'bg-bg border-border hover:border-primary/30'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-base">{skill.icon}</span>
                            <div>
                              <div className="text-sm font-medium text-text">{skill.name}</div>
                              <div className="text-xs text-text-muted">{skill.category} · {skill.params.length} 参数</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5">
                            {isMounted ? (
                              <span className="text-xs bg-primary-light text-primary-dark px-2 py-0.5 rounded-full font-medium">已挂载</span>
                            ) : (
                              <span className="text-xs text-text-muted flex items-center gap-1">
                                <Wrench className="w-3 h-3" />点击挂载
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 p-5 border-t border-border shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm text-text-secondary hover:bg-bg rounded-lg transition-colors">
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-dark transition-colors disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? '保存中...' : '保存配置'}
          </button>
        </div>
      </div>
    </div>
  );
}
