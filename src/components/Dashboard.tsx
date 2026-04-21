import { useState, useEffect } from 'react';
import { Zap, AlertTriangle, Puzzle, Activity, BarChart3, Bot, Wrench, FileText, FolderOpen } from 'lucide-react';
import { fetchStats, fetchAgents } from '../services/api';
import type { StatsData, AgentInfo } from '../services/api';

export default function Dashboard() {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [agents, setAgents] = useState<AgentInfo[]>([]);

  useEffect(() => {
    fetchStats().then(setStats);
    fetchAgents().then(setAgents);
  }, []);

  const toolAgents = agents.filter(a => a.builtin_tools.length > 0).length;

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="max-w-5xl mx-auto">
        <h2 className="text-base font-semibold text-text mb-4">效能管理仪表盘</h2>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="bg-surface border border-border rounded-xl p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-text-secondary">Agent 总数</span>
              <Bot className="w-3.5 h-3.5 text-primary" />
            </div>
            <div className="text-xl font-bold text-text">{stats?.agents_count ?? '...'}</div>
            <div className="text-[11px] text-text-muted mt-0.5">{toolAgents} 个配置了工具</div>
          </div>
          <div className="bg-surface border border-border rounded-xl p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-text-secondary">技能数量</span>
              <Wrench className="w-3.5 h-3.5 text-success" />
            </div>
            <div className="text-xl font-bold text-text">{stats?.skills_count ?? '...'}</div>
            <div className="text-[11px] text-text-muted mt-0.5">自定义 Python 技能</div>
          </div>
          <div className="bg-surface border border-border rounded-xl p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-text-secondary">知识文档</span>
              <FileText className="w-3.5 h-3.5 text-info" />
            </div>
            <div className="text-xl font-bold text-text">{stats?.docs_count ?? '...'}</div>
            <div className="text-[11px] text-text-muted mt-0.5">已入库文档</div>
          </div>
          <div className="bg-surface border border-border rounded-xl p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-text-secondary">工作区文件</span>
              <FolderOpen className="w-3.5 h-3.5 text-warning" />
            </div>
            <div className="text-xl font-bold text-text">{stats?.workspace_files ?? '...'}</div>
            <div className="text-[11px] text-text-muted mt-0.5">Agent 生成的文件</div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 mb-4">
          <div className="bg-surface border border-border rounded-xl p-3">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-text">Agno 工具矩阵</h3>
              <Zap className="w-3.5 h-3.5 text-warning" />
            </div>
            <div className="space-y-2">
              {agents.filter(a => a.builtin_tools.length > 0).map(agent => (
                <div key={agent.id} className="flex items-center gap-3">
                  <span className="text-base">{agent.avatar}</span>
                  <span className="text-xs font-medium text-text w-28 shrink-0">{agent.name}</span>
                  <div className="flex flex-wrap gap-1">
                    {agent.builtin_tools.map(t => (
                      <span key={t} className="text-[10px] bg-primary-light text-primary-dark px-1.5 py-0.5 rounded">
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-surface border border-border rounded-xl p-3">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-text">系统能力覆盖</h3>
              <Activity className="w-3.5 h-3.5 text-success" />
            </div>
            <div className="space-y-2">
              {[
                { label: 'Agno 内置工具', done: true, detail: 'Pandas, DuckDB, Python, File, Calculator' },
                { label: 'Knowledge RAG', done: true, detail: 'LanceDb + FastEmbed + RecursiveChunking' },
                { label: 'Team 多 Agent 协作', done: true, detail: 'Coordinate 模式' },
                { label: '自定义 Skill 创建', done: true, detail: 'AI 生成 + 动态加载' },
                { label: 'PPT 自动生成', done: true, detail: 'python-pptx' },
                { label: 'Guardrails 安全护栏', done: false, detail: '计划中' },
                { label: 'Workflow 工作流', done: false, detail: '计划中' },
              ].map(item => (
                <div key={item.label} className="flex items-center gap-2 text-xs">
                  <span className={`w-1.5 h-1.5 rounded-full ${item.done ? 'bg-success' : 'bg-border'}`} />
                  <span className={`font-medium ${item.done ? 'text-text' : 'text-text-muted'}`}>{item.label}</span>
                  <span className="text-text-muted">— {item.detail}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="bg-surface border border-border rounded-xl overflow-hidden">
          <div className="px-3 py-2.5 border-b border-border-light flex items-center justify-between">
            <h3 className="text-sm font-semibold text-text">Agent 概览</h3>
            <BarChart3 className="w-3.5 h-3.5 text-text-muted" />
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-bg text-text-secondary">
                <th className="text-left px-3 py-2 font-medium">Agent</th>
                <th className="text-left px-3 py-2 font-medium">能力</th>
                <th className="text-left px-3 py-2 font-medium">内置工具</th>
                <th className="text-left px-3 py-2 font-medium">状态</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((a) => (
                <tr key={a.id} className="border-t border-border-light hover:bg-bg transition-colors">
                  <td className="px-3 py-2 font-medium text-text">
                    <span className="mr-1.5">{a.avatar}</span>{a.name}
                  </td>
                  <td className="px-3 py-2 text-text-secondary">{a.capabilities.slice(0, 3).join(', ')}</td>
                  <td className="px-3 py-2 text-text-secondary">{a.builtin_tools.length > 0 ? a.builtin_tools.join(', ') : '-'}</td>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-success/10 text-success">
                      <span className="w-1 h-1 rounded-full bg-success" />就绪
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
