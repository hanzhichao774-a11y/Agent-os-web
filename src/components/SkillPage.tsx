import { useState, useEffect } from 'react';
import { Plus, Loader2 } from 'lucide-react';
import { fetchSkills } from '../services/api';
import type { SkillInfo } from '../services/api';

interface SkillPageProps {
  selectedSkillId: string | null;
  onSelectSkill: (id: string | null) => void;
}

const categoryConfig: Record<string, { label: string; color: string }> = {
  search: { label: '搜索', color: 'bg-blue-100 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400' },
  code: { label: '代码', color: 'bg-purple-100 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400' },
  data: { label: '数据服务', color: 'bg-emerald-100 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400' },
  analysis: { label: '分析', color: 'bg-amber-100 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400' },
  api: { label: 'API', color: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400' },
};

const MOCK_PROVIDERS: Record<string, string> = {
  'SQL执行器': '管理智能体',
  'Python沙箱': 'samhar',
  '企业搜索': '管理智能体',
  '图表生成': '管理智能体',
  '飞书通知': 'samhar',
  'Jira操作': 'samhar',
  '邮件发送': '管理智能体',
  'PDF解析': '管理智能体',
};

const MOCK_USAGE: Record<string, number> = {
  'SQL执行器': 2340,
  'Python沙箱': 1856,
  '企业搜索': 4120,
  '图表生成': 980,
  '飞书通知': 567,
  'Jira操作': 342,
  '邮件发送': 1230,
  'PDF解析': 890,
};

export default function SkillPage({ selectedSkillId, onSelectSkill }: SkillPageProps) {
  const [skillList, setSkillList] = useState<SkillInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSkills().then(data => {
      setSkillList(data);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-semibold text-text">Skills</h1>
          <button
            onClick={() => onSelectSkill('_new')}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-dark transition-colors"
          >
            <Plus className="w-4 h-4" />
            添加技能
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-text-muted" />
          </div>
        ) : skillList.length === 0 ? (
          <div className="text-center py-20 text-text-muted text-sm">
            暂无技能，点击「添加技能」创建
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-5">
            {skillList.map((skill) => {
              const cat = categoryConfig[skill.category] || categoryConfig.api;
              const provider = MOCK_PROVIDERS[skill.name] || '管理智能体';
              const usage = MOCK_USAGE[skill.name] ?? Math.floor(Math.random() * 3000 + 100);
              const isSelected = selectedSkillId === skill.id;

              return (
                <div
                  key={skill.id}
                  onClick={() => onSelectSkill(isSelected ? null : skill.id)}
                  className={`bg-surface border rounded-xl p-5 cursor-pointer transition-all group ${
                    isSelected
                      ? 'border-primary shadow-sm ring-1 ring-primary/20'
                      : 'border-border hover:shadow-sm hover:border-primary/30'
                  }`}
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-bg border border-border rounded-xl flex items-center justify-center text-xl">
                        {skill.icon}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <h3 className="font-semibold text-text text-sm">{skill.name}</h3>
                        <span className="w-2 h-2 rounded-full bg-success shrink-0" />
                      </div>
                    </div>
                    <span className={`text-[11px] px-2.5 py-1 rounded-full font-medium shrink-0 ${cat.color}`}>
                      {cat.label}
                    </span>
                  </div>

                  <div className="space-y-2 mb-4">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-text-muted">来源</span>
                      <span className="text-text-secondary font-medium">来自任务#{usage}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-text-muted">作者</span>
                      <span className="text-text-secondary font-medium">{provider}</span>
                    </div>
                  </div>

                  <p className="text-xs text-primary leading-relaxed line-clamp-2">
                    {skill.description}
                  </p>
                </div>
              );
            })}

            {/* Add New Skill Card */}
            <div
              onClick={() => onSelectSkill('_new')}
              className="border-2 border-dashed border-border rounded-xl p-5 flex flex-col items-center justify-center gap-3 cursor-pointer hover:border-primary/40 hover:bg-bg/50 transition-colors min-h-[180px]"
            >
              <div className="w-12 h-12 rounded-full border-2 border-border flex items-center justify-center">
                <Plus className="w-5 h-5 text-text-muted" />
              </div>
              <span className="text-sm text-text-muted font-medium">新增 Skill</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
