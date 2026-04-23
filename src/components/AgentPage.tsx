import { useState, useEffect, useCallback } from 'react';
import { Plus, Loader2, X, Bot, Trash2 } from 'lucide-react';
import { fetchAgents, fetchSkills, createAgent, deleteAgent } from '../services/api';
import type { AgentInfo, SkillInfo } from '../services/api';

const TAG_COLORS = [
  'bg-orange-100 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400',
  'bg-emerald-100 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400',
  'bg-blue-100 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400',
  'bg-purple-100 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400',
  'bg-rose-100 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400',
];

const MOCK_CALLS: Record<string, number> = {
  '知识检索Agent': 1240,
  '数据分析Agent': 892,
  '代码助手': 3456,
};

export default function AgentPage({ onSelectAgent, selectedAgentName }: { onSelectAgent: (name: string | null) => void; selectedAgentName: string | null }) {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const loadAgents = useCallback(() => {
    setLoading(true);
    fetchAgents().then(data => {
      setAgents(data);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  useEffect(() => { loadAgents(); }, [loadAgents]);

  const handleDelete = async (e: React.MouseEvent, agent: AgentInfo) => {
    e.stopPropagation();
    if (!confirm(`确认删除「${agent.name}」？此操作不可撤销。`)) return;
    const result = await deleteAgent(agent.id);
    if (result.success) {
      if (selectedAgentName === agent.name) onSelectAgent(null);
      loadAgents();
    } else {
      alert(result.error || '删除失败');
    }
  };

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
        <h1 className="text-xl font-semibold text-text mb-6">数字员工</h1>

        <div className="grid grid-cols-3 gap-5">
          {agents.map((agent, idx) => {
            const skillCount = agent.builtin_tools.length + agent.custom_tools.length;
            const calls = MOCK_CALLS[agent.name] ?? Math.floor(Math.random() * 2000 + 200);
            const tagColor = TAG_COLORS[idx % TAG_COLORS.length];
            const isSelected = selectedAgentName === agent.name;
            const isCustom = agent.id.startsWith('custom_');

            return (
              <div
                key={agent.id}
                onClick={() => onSelectAgent(isSelected ? null : agent.name)}
                className={`bg-surface border rounded-xl p-5 cursor-pointer transition-all group relative ${
                  isSelected
                    ? 'border-primary shadow-sm ring-1 ring-primary/20'
                    : 'border-border hover:shadow-sm hover:border-primary/30'
                }`}
              >
                {isCustom && (
                  <button
                    onClick={(e) => handleDelete(e, agent)}
                    className="absolute top-3 right-3 p-1.5 rounded-lg hover:bg-danger/10 text-text-muted hover:text-danger transition-colors opacity-0 group-hover:opacity-100"
                    title="删除"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}

                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-bg border border-border rounded-xl flex items-center justify-center text-xl">
                      {agent.avatar}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <h3 className="font-semibold text-text text-sm">{agent.name}</h3>
                      <span className="w-2 h-2 rounded-full bg-success shrink-0" />
                    </div>
                  </div>
                  <span className={`text-[11px] px-2.5 py-0.5 rounded-full font-medium ${tagColor}`}>
                    {isCustom ? '自定义' : (agent.capabilities[0] || '通用')}
                  </span>
                </div>

                <div className="space-y-2 mb-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-text-secondary">已挂载 Skills</span>
                    <span className="font-medium text-text">{skillCount} skills</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-text-secondary">调用次数</span>
                    <span className="font-medium text-text">{calls.toLocaleString()} 次</span>
                  </div>
                </div>

                <p className="text-xs text-text-secondary leading-relaxed line-clamp-2">
                  {agent.description}
                </p>
              </div>
            );
          })}

          {/* Add New Card */}
          <div
            onClick={() => setShowCreate(true)}
            className="border-2 border-dashed border-border rounded-xl p-5 flex flex-col items-center justify-center gap-3 cursor-pointer hover:border-primary/40 hover:bg-bg/50 transition-colors min-h-[180px]"
          >
            <div className="w-12 h-12 rounded-full border-2 border-border flex items-center justify-center">
              <Plus className="w-5 h-5 text-text-muted" />
            </div>
            <span className="text-sm text-text-muted font-medium">新增数字员工</span>
          </div>
        </div>
      </div>

      {showCreate && (
        <CreateAgentModal
          onClose={() => setShowCreate(false)}
          onCreated={loadAgents}
        />
      )}
    </div>
  );
}

function CreateAgentModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(new Set());
  const [loadingSkills, setLoadingSkills] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchSkills().then(data => {
      setSkills(data);
      setLoadingSkills(false);
    }).catch(() => setLoadingSkills(false));
  }, []);

  const toggleSkill = (id: string) => {
    setSelectedSkills(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCreate = async () => {
    if (!name.trim() || creating) return;
    setCreating(true);
    setError('');
    try {
      const result = await createAgent({
        name: name.trim(),
        skill_ids: [...selectedSkills],
        join_team: true,
      });
      if (result.success) {
        onCreated();
        onClose();
      } else {
        setError(result.error || '创建失败，请重试');
      }
    } catch {
      setError('网络异常，请确认后端服务已启动');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-surface border border-border rounded-2xl shadow-xl w-[520px] max-h-[80vh] flex flex-col animate-fade-in"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center">
              <Bot className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold text-text">新建数字员工</h3>
              <span className="text-xs text-text-muted">输入名称并选择 Skills 即可创建</span>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-bg rounded-lg transition-colors text-text-muted">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5 min-h-0">
          {/* Name Input */}
          <div>
            <label className="text-sm font-semibold text-text block mb-2">员工名称</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="例如：智能客服"
              className="w-full bg-bg border border-border rounded-xl px-4 py-3 text-sm text-text outline-none focus:border-primary transition-colors"
            />
          </div>

          {/* Skills Selection */}
          <div>
            <label className="text-sm font-semibold text-text block mb-2">
              添加 Skills <span className="text-text-muted font-normal">（{selectedSkills.size} 个已选）</span>
            </label>
            {loadingSkills ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-text-muted" />
              </div>
            ) : skills.length === 0 ? (
              <div className="text-xs text-text-muted text-center py-8">暂无可用技能</div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {skills.map(skill => {
                  const isSelected = selectedSkills.has(skill.id);
                  return (
                    <div
                      key={skill.id}
                      onClick={() => toggleSkill(skill.id)}
                      className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                        isSelected
                          ? 'border-primary/40 bg-primary-light'
                          : 'border-border bg-surface hover:border-primary/20'
                      }`}
                    >
                      <span className="text-xl shrink-0">{skill.icon}</span>
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-text truncate">{skill.name}</div>
                        <div className="text-[11px] text-text-muted truncate">{skill.description}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {error && (
            <div className="text-xs text-danger bg-danger/10 rounded-lg px-3 py-2">{error}</div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-5 border-t border-border shrink-0">
          <button onClick={onClose} className="px-5 py-2.5 text-sm text-text-secondary hover:bg-bg rounded-lg transition-colors">
            取消
          </button>
          <button
            onClick={handleCreate}
            disabled={!name.trim() || creating}
            className="px-5 py-2.5 bg-primary text-white rounded-xl text-sm font-medium hover:bg-primary-dark transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {creating && <Loader2 className="w-4 h-4 animate-spin" />}
            {creating ? '创建中...' : '确认创建'}
          </button>
        </div>
      </div>
    </div>
  );
}
