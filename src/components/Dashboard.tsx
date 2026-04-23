import { useState, useEffect } from 'react';
import { Zap, Users, Activity, CheckCircle2 } from 'lucide-react';
import { fetchStats, fetchAgents, fetchProjects } from '../services/api';
import type { StatsData, AgentInfo, ProjectInfo } from '../services/api';

function DonutChart({ percent, label1, label2, v1, v2 }: { percent: number; label1: string; label2: string; v1: string; v2: string }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const filled = c * (percent / 100);

  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 128 128" className="w-28 h-28 shrink-0">
        <circle cx="64" cy="64" r={r} fill="none" stroke="currentColor" className="text-border" strokeWidth="14" />
        <circle cx="64" cy="64" r={r} fill="none" stroke="currentColor" className="text-primary" strokeWidth="14"
          strokeDasharray={`${filled} ${c - filled}`} strokeDashoffset={c / 4} strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 0.8s ease' }}
        />
      </svg>
      <div className="space-y-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-primary" />
          <span className="text-text-secondary">{label1} {v1}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-border" />
          <span className="text-text-secondary">{label2} {v2}</span>
        </div>
      </div>
    </div>
  );
}

function AreaChart({ data }: { data: number[] }) {
  if (data.length === 0) return null;
  const max = Math.max(...data, 1);
  const w = 320;
  const h = 100;
  const padX = 0;
  const padY = 4;
  const stepX = (w - padX * 2) / (data.length - 1);

  const points = data.map((v, i) => ({
    x: padX + i * stepX,
    y: h - padY - ((v / max) * (h - padY * 2)),
  }));

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
  const areaPath = `${linePath} L${points[points.length - 1].x},${h} L${points[0].x},${h} Z`;

  const days = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h + 16}`} className="w-full" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.25" />
            <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#areaFill)" />
        <path d={linePath} fill="none" stroke="var(--color-primary)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="3" fill="var(--color-surface)" stroke="var(--color-primary)" strokeWidth="2" />
        ))}
        {points.map((p, i) => (
          <text key={`label-${i}`} x={p.x} y={h + 14} textAnchor="middle" fill="var(--color-text-muted)" fontSize="9">
            {days[i] || ''}
          </text>
        ))}
      </svg>
    </div>
  );
}

function HorizontalBar({ label, value, maxValue, sub }: { label: string; value: number; maxValue: number; sub?: string }) {
  const pct = maxValue > 0 ? (value / maxValue) * 100 : 0;
  const display = value >= 1000 ? `${(value / 1000).toFixed(0)}K` : String(value);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-text">{label}</span>
        <span className="text-text-secondary tabular-nums">{display}{sub ? ` ${sub}` : ''}</span>
      </div>
      <div className="h-2 bg-bg rounded-full overflow-hidden">
        <div className="h-full bg-primary rounded-full transition-all duration-700" style={{ width: `${Math.max(2, pct)}%` }} />
      </div>
    </div>
  );
}

const TOKEN_DATA = [128, 85, 142, 210, 178, 246, 195];

const AGENT_WORKLINES: Record<string, string> = {
  '知识检索Agent': 'Q3 财报分析',
  '数据分析Agent': '供应链优化',
  '代码助手': '技术中台',
  'PPT制作Agent': '自动化报表重构',
  '写作Agent': '新品市场调研',
};

const AGENT_TOKENS: Record<string, number> = {
  '知识检索Agent': 322000,
  '数据分析Agent': 186000,
  '代码助手': 718000,
  'PPT制作Agent': 45000,
  '写作Agent': 95000,
};

export default function Dashboard() {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);

  useEffect(() => {
    fetchStats().then(setStats);
    fetchAgents().then(setAgents);
    fetchProjects().then(setProjects);
  }, []);

  const totalTokens = Object.values(AGENT_TOKENS).reduce((a, b) => a + b, 0);
  const onlineAgents = agents.length;
  const activeProjects = projects.filter(p => p.status === 'active').length;

  const projectTokens = projects.map(p => ({
    name: p.name,
    tokens: Math.floor(Math.random() * 300 + 50) * 1000,
  })).sort((a, b) => b.tokens - a.tokens);

  const maxProjectTokens = Math.max(...projectTokens.map(p => p.tokens), 1);

  const agentMaxTokens = Math.max(...Object.values(AGENT_TOKENS), 1);

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="max-w-6xl mx-auto space-y-5">
        {/* Stats Row */}
        <div className="grid grid-cols-4 gap-4">
          <div className="bg-surface border border-border rounded-xl p-4 flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-50 dark:bg-emerald-500/10 rounded-xl flex items-center justify-center">
              <Zap className="w-5 h-5 text-emerald-500" />
            </div>
            <div>
              <div className="text-xl font-bold text-text tabular-nums">{(totalTokens / 1000000).toFixed(1)}M</div>
              <div className="text-[11px] text-text-muted">Token 总消耗</div>
            </div>
          </div>

          <div className="bg-surface border border-border rounded-xl p-4 flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-50 dark:bg-blue-500/10 rounded-xl flex items-center justify-center">
              <Users className="w-5 h-5 text-blue-500" />
            </div>
            <div>
              <div className="text-xl font-bold text-text tabular-nums">{onlineAgents}/{stats?.agents_count ?? onlineAgents}</div>
              <div className="text-[11px] text-text-muted">在线员工</div>
            </div>
          </div>

          <div className="bg-surface border border-border rounded-xl p-4 flex items-center gap-3">
            <div className="w-10 h-10 bg-cyan-50 dark:bg-cyan-500/10 rounded-xl flex items-center justify-center">
              <Activity className="w-5 h-5 text-cyan-500" />
            </div>
            <div>
              <div className="text-xl font-bold text-text tabular-nums">{activeProjects || projects.length}</div>
              <div className="text-[11px] text-text-muted">活跃项目</div>
            </div>
          </div>

          <div className="bg-surface border border-border rounded-xl p-4 flex items-center gap-3">
            <div className="w-10 h-10 bg-purple-50 dark:bg-purple-500/10 rounded-xl flex items-center justify-center">
              <CheckCircle2 className="w-5 h-5 text-purple-500" />
            </div>
            <div>
              <div className="text-xl font-bold text-text tabular-nums">98%</div>
              <div className="text-[11px] text-text-muted">任务成功率</div>
            </div>
          </div>
        </div>

        {/* Middle Row: Agent Table + Workline Ranking */}
        <div className="grid grid-cols-2 gap-4">
          {/* Agent Token Table */}
          <div className="bg-surface border border-border rounded-xl p-4">
            <h3 className="text-sm font-semibold text-text mb-3 flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-primary" /> Agent Token 消耗
            </h3>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-text-muted uppercase tracking-wider">
                  <th className="text-left pb-2 font-semibold">Agent</th>
                  <th className="text-left pb-2 font-semibold">状态</th>
                  <th className="text-left pb-2 font-semibold">项目</th>
                  <th className="text-right pb-2 font-semibold">Token 消耗</th>
                </tr>
              </thead>
              <tbody>
                {agents.slice(0, 5).map((agent) => {
                  const tokens = AGENT_TOKENS[agent.name] || Math.floor(Math.random() * 500 + 50) * 1000;
                  const workline = AGENT_WORKLINES[agent.name] || '—';
                  const barPct = (tokens / agentMaxTokens) * 100;
                  return (
                    <tr key={agent.id} className="border-b border-border-light last:border-0">
                      <td className="py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="text-base">{agent.avatar}</span>
                          <span className="text-text font-medium">{agent.name}</span>
                        </div>
                      </td>
                      <td className="py-2.5 text-text-secondary">{workline !== '—' ? workline.split(' ')[0] : '—'}</td>
                      <td className="py-2.5 text-text-secondary">{workline}</td>
                      <td className="py-2.5">
                        <div className="flex items-center gap-2 justify-end">
                          <div className="w-16 h-1.5 bg-bg rounded-full overflow-hidden">
                            <div className="h-full bg-primary rounded-full" style={{ width: `${barPct}%` }} />
                          </div>
                          <span className="text-text-secondary tabular-nums w-10 text-right">
                            {tokens >= 1000 ? `${Math.floor(tokens / 1000)}K` : tokens}
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Workline Ranking */}
          <div className="bg-surface border border-border rounded-xl p-4">
            <h3 className="text-sm font-semibold text-text mb-3 flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-primary" /> 项目消耗排行
            </h3>
            <div className="space-y-3">
              {projectTokens.slice(0, 5).map(({ name, tokens }) => (
                <HorizontalBar key={name} label={name} value={tokens} maxValue={maxProjectTokens} />
              ))}
              {projectTokens.length === 0 && (
                <div className="text-xs text-text-muted text-center py-4">暂无项目</div>
              )}
            </div>
          </div>
        </div>

        {/* Bottom Row: Donut + Trend */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-surface border border-border rounded-xl p-4">
            <h3 className="text-sm font-semibold text-text mb-4 flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-primary" /> 消耗占比
            </h3>
            <DonutChart percent={67} label1="主实例" label2="完毕实例" v1="67%" v2="33%" />
          </div>

          <div className="bg-surface border border-border rounded-xl p-4">
            <h3 className="text-sm font-semibold text-text mb-3 flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-primary" /> 近 7 日 Token 消耗走势
            </h3>
            <AreaChart data={TOKEN_DATA} />
          </div>
        </div>
      </div>
    </div>
  );
}
