import { TrendingUp, AlertTriangle, Puzzle, Activity, BarChart3, Users, Zap, Clock } from 'lucide-react';
import { projects, agents } from '../data/mockData';

export default function Dashboard() {
  const activeProjects = projects.filter(p => p.status === 'active').length;
  const onlineAgents = agents.filter(a => a.status === 'online').length;

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="max-w-5xl mx-auto">
        <h2 className="text-base font-semibold text-text mb-4">效能管理仪表盘</h2>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="bg-surface border border-border rounded-xl p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-text-secondary">自动化覆盖率</span>
              <Zap className="w-3.5 h-3.5 text-warning" />
            </div>
            <div className="text-xl font-bold text-text">78.5%</div>
            <div className="text-[11px] text-success mt-0.5 flex items-center gap-1">
              <TrendingUp className="w-3 h-3" /> +5.2% 较上月
            </div>
          </div>
          <div className="bg-surface border border-border rounded-xl p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-text-secondary">风险事件</span>
              <AlertTriangle className="w-3.5 h-3.5 text-danger" />
            </div>
            <div className="text-xl font-bold text-text">3</div>
            <div className="text-[11px] text-text-muted mt-0.5">待处理告警</div>
          </div>
          <div className="bg-surface border border-border rounded-xl p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-text-secondary">能力缺口</span>
              <Puzzle className="w-3.5 h-3.5 text-info" />
            </div>
            <div className="text-xl font-bold text-text">2</div>
            <div className="text-[11px] text-text-muted mt-0.5">建议新增 Skill</div>
          </div>
          <div className="bg-surface border border-border rounded-xl p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-text-secondary">活跃项目</span>
              <Activity className="w-3.5 h-3.5 text-success" />
            </div>
            <div className="text-xl font-bold text-text">{activeProjects}</div>
            <div className="text-[11px] text-text-muted mt-0.5">共 {projects.length} 个项目</div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 mb-4">
          {/* Project Activity */}
          <div className="bg-surface border border-border rounded-xl p-3">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-text">项目活跃度趋势</h3>
              <select className="text-xs border border-border rounded-lg px-2 py-0.5 bg-bg">
                <option>近7天</option>
                <option>近30天</option>
              </select>
            </div>
            <div className="h-32 flex items-end gap-1.5">
              {[45, 62, 38, 75, 56, 88, 72].map((h, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <div
                    className="w-full bg-primary-light rounded-t-md transition-all"
                    style={{ height: `${h * 1.2}px`, opacity: 0.6 + (h / 200) }}
                  />
                  <span className="text-[10px] text-text-muted">{['一','二','三','四','五','六','日'][i]}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Agent Status */}
          <div className="bg-surface border border-border rounded-xl p-3">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-text">Agent 状态</h3>
              <Users className="w-3.5 h-3.5 text-text-muted" />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-text-secondary">在线</span>
                <span className="text-xs font-semibold text-success">{onlineAgents}</span>
              </div>
              <div className="w-full bg-bg rounded-full h-1.5">
                <div className="bg-success h-1.5 rounded-full" style={{ width: `${(onlineAgents / agents.length) * 100}%` }} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-text-secondary">忙碌</span>
                <span className="text-xs font-semibold text-warning">1</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-text-secondary">离线</span>
                <span className="text-xs font-semibold text-text-muted">1</span>
              </div>
              <div className="pt-2 border-t border-border-light">
                <div className="flex items-center gap-2 text-[11px] text-text-muted">
                  <Clock className="w-3 h-3" />
                  今日调用 {agents.reduce((sum, a) => sum + a.calls, 0).toLocaleString()} 次
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Recent Projects Table */}
        <div className="bg-surface border border-border rounded-xl overflow-hidden">
          <div className="px-3 py-2.5 border-b border-border-light flex items-center justify-between">
            <h3 className="text-sm font-semibold text-text">项目概览</h3>
            <BarChart3 className="w-3.5 h-3.5 text-text-muted" />
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-bg text-text-secondary">
                <th className="text-left px-3 py-2 font-medium">项目名称</th>
                <th className="text-left px-3 py-2 font-medium">状态</th>
                <th className="text-left px-3 py-2 font-medium">成员</th>
                <th className="text-left px-3 py-2 font-medium">更新</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id} className="border-t border-border-light hover:bg-bg transition-colors">
                  <td className="px-3 py-2 font-medium text-text">{p.name}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full ${
                      p.status === 'active' ? 'bg-success/10 text-success' :
                      p.status === 'idle' ? 'bg-warning/10 text-warning' :
                      'bg-text-muted/10 text-text-muted'
                    }`}>
                      <span className={`w-1 h-1 rounded-full ${
                        p.status === 'active' ? 'bg-success' :
                        p.status === 'idle' ? 'bg-warning' : 'bg-text-muted'
                      }`} />
                      {p.status === 'active' ? '进行中' : p.status === 'idle' ? '待机' : '已完成'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-text-secondary">{p.memberCount} 人</td>
                  <td className="px-3 py-2 text-text-muted">{p.updatedAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
