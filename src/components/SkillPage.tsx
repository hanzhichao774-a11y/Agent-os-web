import { useState, useEffect } from 'react';
import { Plus, Play, Pause, MessageSquare, Settings, Loader2, X } from 'lucide-react';
import { fetchSkills, createSkill } from '../services/api';
import type { SkillInfo } from '../services/api';

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
  const [showCreate, setShowCreate] = useState(false);
  const [createDesc, setCreateDesc] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  const loadSkills = async () => {
    setLoading(true);
    const data = await fetchSkills();
    setSkillList(data);
    setLoading(false);
  };

  useEffect(() => { loadSkills(); }, []);

  const handleCreate = async () => {
    if (!createDesc.trim() || creating) return;
    setCreating(true);
    setCreateError('');
    const result = await createSkill(createDesc);
    if (result.success) {
      setShowCreate(false);
      setCreateDesc('');
      await loadSkills();
    } else {
      setCreateError(result.error || '创建失败');
    }
    setCreating(false);
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
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-dark transition-colors"
          >
            <Plus className="w-4 h-4" />
            新增 Skill
          </button>
        </div>

        {/* 创建弹窗 */}
        {showCreate && (
          <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
            <div className="bg-surface border border-border rounded-2xl shadow-xl w-[480px] p-6 animate-fade-in">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-text">创建新技能</h3>
                <button onClick={() => { setShowCreate(false); setCreateError(''); }} className="p-1 hover:bg-bg rounded-lg">
                  <X className="w-5 h-5 text-text-muted" />
                </button>
              </div>
              <p className="text-sm text-text-secondary mb-3">
                用自然语言描述你想要的技能，AI 会自动生成代码并注册。
              </p>
              <textarea
                value={createDesc}
                onChange={(e) => setCreateDesc(e.target.value)}
                placeholder="例如：创建一个能根据年利率和本金计算复利的技能"
                rows={3}
                className="w-full bg-bg border border-border rounded-xl px-4 py-3 text-sm text-text outline-none focus:border-primary transition-colors resize-none mb-3"
              />
              {createError && (
                <div className="text-xs text-error bg-error/10 border border-error/20 rounded-lg px-3 py-2 mb-3">{createError}</div>
              )}
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => { setShowCreate(false); setCreateError(''); }}
                  className="px-4 py-2 text-sm text-text-secondary hover:bg-bg rounded-lg transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleCreate}
                  disabled={creating || !createDesc.trim()}
                  className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-dark transition-colors disabled:opacity-50"
                >
                  {creating && <Loader2 className="w-4 h-4 animate-spin" />}
                  {creating ? 'AI 生成中...' : '创建技能'}
                </button>
              </div>
            </div>
          </div>
        )}

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
            暂无技能，点击「新增 Skill」用 AI 创建第一个技能
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
                    <button onClick={(e) => e.stopPropagation()} className="p-1.5 hover:bg-bg rounded-lg transition-colors text-text-muted">
                      <Settings className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
