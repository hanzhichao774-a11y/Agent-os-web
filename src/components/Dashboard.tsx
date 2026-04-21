import { useState, useEffect } from 'react';
import { Bot, Wrench, FileText, FolderOpen, Layers } from 'lucide-react';
import { fetchStats, fetchAgents, fetchSkills } from '../services/api';
import type { StatsData, AgentInfo, SkillInfo } from '../services/api';

interface StatCardProps {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  color: string;
  barPercent: number;
}

function StatCard({ label, value, icon, color, barPercent }: StatCardProps) {
  return (
    <div className="bg-surface border border-border rounded-xl p-3.5 relative overflow-hidden group hover:border-primary/30 transition-colors">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs text-text-secondary">{label}</span>
        {icon}
      </div>
      <div className="text-2xl font-bold text-text mb-2">{value}</div>
      <div className="h-1 bg-bg rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${color}`}
          style={{ width: `${Math.min(100, barPercent)}%` }}
        />
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [skills, setSkills] = useState<SkillInfo[]>([]);

  useEffect(() => {
    fetchStats().then(setStats);
    fetchAgents().then(setAgents);
    fetchSkills().then(setSkills);
  }, []);

  const maxStat = Math.max(
    stats?.agents_count ?? 1,
    stats?.skills_count ?? 1,
    stats?.docs_count ?? 1,
    stats?.workspace_files ?? 1,
    1,
  );

  const skillCountByAgent = (agentId: string): number => {
    return skills.filter(s => s.mounted_agents?.some(a => a.id === agentId)).length;
  };

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="max-w-5xl mx-auto space-y-5">
        {/* Stats Cards */}
        <div>
          <h2 className="text-sm font-semibold text-text mb-3">系统概览</h2>
          <div className="grid grid-cols-4 gap-3">
            <StatCard
              label="Agent"
              value={stats?.agents_count ?? '...'}
              icon={<Bot className="w-4 h-4 text-primary" />}
              color="bg-primary"
              barPercent={((stats?.agents_count ?? 0) / maxStat) * 100}
            />
            <StatCard
              label="技能"
              value={stats?.skills_count ?? '...'}
              icon={<Wrench className="w-4 h-4 text-emerald-500" />}
              color="bg-emerald-500"
              barPercent={((stats?.skills_count ?? 0) / maxStat) * 100}
            />
            <StatCard
              label="知识文档"
              value={stats?.docs_count ?? '...'}
              icon={<FileText className="w-4 h-4 text-blue-500" />}
              color="bg-blue-500"
              barPercent={((stats?.docs_count ?? 0) / maxStat) * 100}
            />
            <StatCard
              label="工作区文件"
              value={stats?.workspace_files ?? '...'}
              icon={<FolderOpen className="w-4 h-4 text-amber-500" />}
              color="bg-amber-500"
              barPercent={((stats?.workspace_files ?? 0) / maxStat) * 100}
            />
          </div>
        </div>

        {/* Agent Panorama */}
        <div>
          <h2 className="text-sm font-semibold text-text mb-3 flex items-center gap-1.5">
            <Bot className="w-4 h-4 text-primary" /> Agent 全景
          </h2>
          <div className="grid grid-cols-2 xl:grid-cols-3 gap-3">
            {agents.map((agent) => {
              const mountedSkills = skillCountByAgent(agent.id);
              return (
                <div
                  key={agent.id}
                  className="bg-surface border border-border rounded-xl p-3.5 hover:border-primary/30 hover:shadow-sm transition-all group"
                >
                  <div className="flex items-start justify-between mb-2.5">
                    <div className="flex items-center gap-2.5">
                      <span className="text-2xl">{agent.avatar}</span>
                      <div>
                        <div className="text-sm font-semibold text-text">{agent.name}</div>
                        <div className="text-[10px] text-text-muted mt-0.5 line-clamp-1">{agent.description}</div>
                      </div>
                    </div>
                    <span className="w-2 h-2 rounded-full bg-emerald-400 mt-1.5 shrink-0" title="就绪" />
                  </div>

                  {/* Capabilities */}
                  <div className="flex flex-wrap gap-1 mb-2">
                    {agent.capabilities.map((cap) => (
                      <span key={cap} className="text-[10px] bg-primary/8 text-primary-dark px-1.5 py-0.5 rounded-md">
                        {cap}
                      </span>
                    ))}
                  </div>

                  {/* Tools & Skills bar */}
                  <div className="flex items-center gap-2 text-[10px]">
                    {agent.builtin_tools.length > 0 && (
                      <div className="flex items-center gap-1 bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded">
                        <Wrench className="w-2.5 h-2.5" />
                        {agent.builtin_tools.length} 内置工具
                      </div>
                    )}
                    {mountedSkills > 0 && (
                      <div className="flex items-center gap-1 bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded">
                        <Layers className="w-2.5 h-2.5" />
                        {mountedSkills} 技能
                      </div>
                    )}
                    {agent.has_knowledge && (
                      <div className="flex items-center gap-1 bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">
                        <FileText className="w-2.5 h-2.5" />
                        知识库
                      </div>
                    )}
                  </div>

                  {/* Builtin tools detail */}
                  {agent.builtin_tools.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-border-light">
                      <div className="flex flex-wrap gap-1">
                        {agent.builtin_tools.map((t) => (
                          <span key={t} className="text-[9px] bg-bg text-text-muted px-1.5 py-0.5 rounded font-mono">
                            {t}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
