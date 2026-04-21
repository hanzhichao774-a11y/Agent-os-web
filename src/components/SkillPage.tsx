import { useState, useEffect } from 'react';
import { Plus, MessageSquare, Settings, Loader2, X, Trash2 } from 'lucide-react';
import { fetchSkills, deleteSkill, fetchAgents } from '../services/api';
import type { SkillInfo, AgentInfo } from '../services/api';

interface SkillPageProps {
  selectedSkillId: string | null;
  onSelectSkill: (id: string | null) => void;
}

const categoryConfig: Record<string, { label: string; color: string }> = {
  search: { label: '搜索', color: 'bg-info/10 text-info' },
  code: { label: '代码', color: 'bg-agent-host/10 text-agent-host' },
  data: { label: '数据', color: 'bg-success/10 text-success' },
  analysis: { label: '分析', color: 'bg-warning/10 text-warning' },
  api: { label: 'API', color: 'bg-text-muted/10 text-text-muted' },
};

export default function SkillPage({ selectedSkillId, onSelectSkill }: SkillPageProps) {
  const [skillList, setSkillList] = useState<SkillInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailSkill, setDetailSkill] = useState<SkillInfo | null>(null);
  const [agents, setAgents] = useState<AgentInfo[]>([]);

  const loadSkills = async () => {
    setLoading(true);
    const data = await fetchSkills();
    setSkillList(data);
    setLoading(false);
  };

  useEffect(() => { loadSkills(); }, []);

  const openDetail = async (skill: SkillInfo) => {
    setDetailSkill(skill);
    const agentData = await fetchAgents();
    setAgents(agentData);
  };

  const handleDelete = async (skillId: string) => {
    if (!confirm('确认删除此技能？已挂载到 Agent 的绑定也会自动解除。')) return;
    await deleteSkill(skillId);
    setDetailSkill(null);
    if (selectedSkillId === skillId) onSelectSkill(null);
    await loadSkills();
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold text-text">技能管理</h1>
            <p className="text-sm text-text-secondary mt-1">
              {loading ? '加载中...' : `共 ${skillList.length} 个技能，点击进入交互模式`}
            </p>
          </div>
          <button
            onClick={() => onSelectSkill('_new')}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-dark transition-colors"
          >
            <Plus className="w-4 h-4" />
            新增 Skill
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-surface border border-border rounded-xl p-4">
            <div className="text-2xl font-bold text-text">{skillList.length}</div>
            <div className="text-xs text-text-secondary mt-1">已注册</div>
          </div>
          <div className="bg-surface border border-border rounded-xl p-4">
            <div className="text-2xl font-bold text-text">{new Set(skillList.map(s => s.category)).size}</div>
            <div className="text-xs text-text-secondary mt-1">分类</div>
          </div>
          <div className="bg-surface border border-border rounded-xl p-4">
            <div className="text-2xl font-bold text-text">{skillList.reduce((a, s) => a + s.params.length, 0)}</div>
            <div className="text-xs text-text-secondary mt-1">总参数</div>
          </div>
        </div>

        {/* Skill List */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-text-muted" />
          </div>
        ) : skillList.length === 0 ? (
          <div className="text-center py-20 text-text-muted text-sm">
            暂无技能，点击「新增 Skill」在右侧对话中创建
          </div>
        ) : (
          <div className="bg-surface border border-border rounded-xl overflow-hidden">
            <div className="grid grid-cols-12 gap-4 px-4 py-3 bg-bg text-xs font-semibold text-text-secondary uppercase tracking-wider border-b border-border-light">
              <div className="col-span-4">Skill</div>
              <div className="col-span-2">分类</div>
              <div className="col-span-3">参数</div>
              <div className="col-span-3 text-right">操作</div>
            </div>
            {skillList.map((skill) => {
              const cat = categoryConfig[skill.category] || categoryConfig.api;
              const isSelected = selectedSkillId === skill.id;
              const mountCount = skill.mounted_agents?.length || 0;
              return (
                <div
                  key={skill.id}
                  onClick={() => onSelectSkill(skill.id)}
                  className={`grid grid-cols-12 gap-4 px-4 py-3 border-t border-border-light items-center cursor-pointer transition-colors ${
                    isSelected ? 'bg-primary-light/50 ring-1 ring-primary/20' : 'hover:bg-bg'
                  }`}
                >
                  <div className="col-span-4 flex items-center gap-3">
                    <span className="text-lg">{skill.icon}</span>
                    <div>
                      <div className="text-sm font-medium text-text">{skill.name}</div>
                      <div className="text-xs text-text-muted truncate max-w-[220px]">{skill.description}</div>
                    </div>
                  </div>
                  <div className="col-span-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cat.color}`}>
                      {cat.label}
                    </span>
                    {mountCount > 0 && (
                      <span className="ml-1.5 text-[10px] text-text-muted">{mountCount} Agent</span>
                    )}
                  </div>
                  <div className="col-span-3 flex flex-wrap gap-1">
                    {skill.params.map((p) => (
                      <span key={p.name} className="text-xs bg-bg text-text-muted px-1.5 py-0.5 rounded border border-border-light">
                        {p.name}: {p.type}
                      </span>
                    ))}
                  </div>
                  <div className="col-span-3 flex items-center justify-end gap-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); onSelectSkill(skill.id); }}
                      className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-colors ${
                        isSelected ? 'bg-primary-light text-primary-dark' : 'hover:bg-bg text-text-muted'
                      }`}
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      交互
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); openDetail(skill); }}
                      className="p-1.5 hover:bg-bg rounded-lg transition-colors text-text-muted"
                      title="技能设置"
                    >
                      <Settings className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Skill Detail Modal */}
      {detailSkill && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setDetailSkill(null)}>
          <div className="bg-surface border border-border rounded-2xl shadow-xl w-[480px] max-h-[70vh] flex flex-col animate-fade-in" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-border shrink-0">
              <div className="flex items-center gap-3">
                <span className="text-2xl">{detailSkill.icon}</span>
                <div>
                  <h3 className="font-semibold text-text">{detailSkill.name}</h3>
                  <span className="text-xs text-text-muted">{detailSkill.id} · {detailSkill.category}</span>
                </div>
              </div>
              <button onClick={() => setDetailSkill(null)} className="p-1.5 hover:bg-bg rounded-lg transition-colors text-text-muted">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4 min-h-0">
              <div>
                <label className="text-xs font-semibold text-text-secondary block mb-1">描述</label>
                <p className="text-sm text-text">{detailSkill.description}</p>
              </div>

              <div>
                <label className="text-xs font-semibold text-text-secondary block mb-1.5">参数</label>
                {detailSkill.params.length > 0 ? (
                  <div className="space-y-1.5">
                    {detailSkill.params.map(p => (
                      <div key={p.name} className="flex items-center justify-between bg-bg rounded-lg px-3 py-2 text-xs border border-border">
                        <span className="text-text font-medium">{p.name}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-text-muted">{p.type}</span>
                          {p.default && <span className="text-text-muted">默认: {p.default}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-text-muted">无参数</p>
                )}
              </div>

              <div>
                <label className="text-xs font-semibold text-text-secondary block mb-1.5">已挂载 Agent</label>
                {(detailSkill.mounted_agents && detailSkill.mounted_agents.length > 0) ? (
                  <div className="flex flex-wrap gap-2">
                    {detailSkill.mounted_agents.map(a => {
                      const agent = agents.find(ag => ag.id === a.id);
                      return (
                        <span key={a.id} className="text-xs bg-primary-light text-primary-dark px-2 py-1 rounded-lg flex items-center gap-1">
                          {agent?.avatar || '🤖'} {a.name}
                        </span>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-text-muted">未挂载到任何 Agent</p>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between p-5 border-t border-border shrink-0">
              <button
                onClick={() => handleDelete(detailSkill.id)}
                className="flex items-center gap-1.5 px-3 py-2 text-sm text-error hover:bg-error/10 rounded-lg transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                删除技能
              </button>
              <button onClick={() => setDetailSkill(null)} className="px-4 py-2 text-sm text-text-secondary hover:bg-bg rounded-lg transition-colors">
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
