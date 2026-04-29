import { useState, useEffect, useCallback } from 'react';
import { Zap, Activity, CheckCircle2, Cpu, Clock, AlertCircle } from 'lucide-react';
import { fetchStats, fetchProjects, fetchWorkerStatus, fetchWorkerStats } from '../services/api';
import type { StatsData, ProjectInfo, WorkerSlotStatus } from '../services/api';

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

function HorizontalBar({ label, value, maxValue }: { label: string; value: number; maxValue: number }) {
  const pct = maxValue > 0 ? (value / maxValue) * 100 : 0;
  const display = value >= 1000 ? `${(value / 1000).toFixed(0)}K` : String(value);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-text">{label}</span>
        <span className="text-text-secondary tabular-nums">{display}</span>
      </div>
      <div className="h-2 bg-bg rounded-full overflow-hidden">
        <div className="h-full bg-primary rounded-full transition-all duration-700" style={{ width: `${Math.max(2, pct)}%` }} />
      </div>
    </div>
  );
}

const STATUS_CONFIG: Record<string, { color: string; bg: string; icon: typeof Cpu; label: string }> = {
  idle: { color: 'text-gray-400', bg: 'bg-gray-50 dark:bg-gray-800/50', icon: Clock, label: '空闲' },
  working: { color: 'text-blue-500', bg: 'bg-blue-50 dark:bg-blue-500/10', icon: Cpu, label: '工作中' },
  completed: { color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-500/10', icon: CheckCircle2, label: '已完成' },
  error: { color: 'text-red-500', bg: 'bg-red-50 dark:bg-red-500/10', icon: AlertCircle, label: '出错' },
};

function SlotCard({ slot }: { slot: WorkerSlotStatus }) {
  const config = STATUS_CONFIG[slot.status] || STATUS_CONFIG.idle;
  const Icon = config.icon;
  const elapsed = slot.started_at && slot.status === 'working'
    ? `${((Date.now() / 1000 - slot.started_at)).toFixed(0)}s`
    : slot.started_at && slot.completed_at
      ? `${(slot.completed_at - slot.started_at).toFixed(1)}s`
      : null;

  return (
    <div className={`border border-border rounded-xl p-4 transition-all ${slot.status === 'working' ? 'ring-2 ring-blue-300 dark:ring-blue-500/40' : ''}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={`w-9 h-9 rounded-lg ${config.bg} flex items-center justify-center`}>
            <Icon className={`w-4.5 h-4.5 ${config.color}`} />
          </div>
          <div>
            <div className="text-sm font-semibold text-text">SubAgent #{slot.slot_id}</div>
            <div className={`text-[11px] font-medium ${config.color}`}>{config.label}</div>
          </div>
        </div>
        <div className={`w-2.5 h-2.5 rounded-full ${
          slot.status === 'idle' ? 'bg-gray-300' :
          slot.status === 'working' ? 'bg-blue-500 animate-pulse' :
          slot.status === 'completed' ? 'bg-emerald-500' : 'bg-red-500'
        }`} />
      </div>

      {slot.current_task && (
        <div className="text-xs text-text-secondary mb-2 line-clamp-2">
          {slot.current_task}
        </div>
      )}

      <div className="flex items-center gap-3 text-[11px] text-text-muted">
        {elapsed && <span>耗时 {elapsed}</span>}
        <span>累计 {slot.cumulative_total_tokens.toLocaleString()} tokens</span>
        <span>{slot.tasks_completed} 个任务</span>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [slots, setSlots] = useState<WorkerSlotStatus[]>([]);
  const [globalStats, setGlobalStats] = useState<{ input_tokens: number; output_tokens: number; total_tokens: number; tasks_completed: number }>({
    input_tokens: 0, output_tokens: 0, total_tokens: 0, tasks_completed: 0,
  });

  const loadWorkerData = useCallback(() => {
    fetchWorkerStatus().then(d => setSlots(d.slots));
    fetchWorkerStats().then(d => setGlobalStats(d.global));
  }, []);

  useEffect(() => {
    fetchStats().then(setStats);
    fetchProjects().then(setProjects);
    loadWorkerData();
    const timer = setInterval(loadWorkerData, 3000);
    return () => clearInterval(timer);
  }, [loadWorkerData]);

  const activeProjects = projects.filter(p => p.status === 'active').length;
  const workingSlots = slots.filter(s => s.status === 'working').length;

  const projectTokens = projects.map(p => ({
    name: p.name,
    tokens: Math.floor(Math.random() * 300 + 50) * 1000,
  })).sort((a, b) => b.tokens - a.tokens);

  const maxProjectTokens = Math.max(...projectTokens.map(p => p.tokens), 1);
  const totalTokens = globalStats.total_tokens;
  const inputPct = totalTokens > 0 ? Math.round((globalStats.input_tokens / totalTokens) * 100) : 50;

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
              <div className="text-xl font-bold text-text tabular-nums">
                {totalTokens >= 1000000
                  ? `${(totalTokens / 1000000).toFixed(1)}M`
                  : totalTokens >= 1000
                    ? `${(totalTokens / 1000).toFixed(0)}K`
                    : totalTokens}
              </div>
              <div className="text-[11px] text-text-muted">Token 总消耗</div>
            </div>
          </div>

          <div className="bg-surface border border-border rounded-xl p-4 flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-50 dark:bg-blue-500/10 rounded-xl flex items-center justify-center">
              <Cpu className="w-5 h-5 text-blue-500" />
            </div>
            <div>
              <div className="text-xl font-bold text-text tabular-nums">{workingSlots}/3</div>
              <div className="text-[11px] text-text-muted">工作中 SubAgent</div>
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
              <div className="text-xl font-bold text-text tabular-nums">{globalStats.tasks_completed}</div>
              <div className="text-[11px] text-text-muted">已完成任务 · 文档 {stats?.docs_count ?? 0}</div>
            </div>
          </div>
        </div>

        {/* SubAgent Worker Slots */}
        <div>
          <h3 className="text-sm font-semibold text-text mb-3 flex items-center gap-1.5">
            <Cpu className="w-3.5 h-3.5 text-primary" /> SubAgent 工位
          </h3>
          <div className="grid grid-cols-3 gap-4">
            {slots.length > 0 ? slots.map(slot => (
              <SlotCard key={slot.slot_id} slot={slot} />
            )) : (
              <>
                {[1, 2, 3].map(id => (
                  <SlotCard key={id} slot={{
                    slot_id: id, status: 'idle', current_task: null, result: null, error: null,
                    input_tokens: 0, output_tokens: 0, total_tokens: 0,
                    started_at: null, completed_at: null,
                    cumulative_input_tokens: 0, cumulative_output_tokens: 0, cumulative_total_tokens: 0,
                    tasks_completed: 0,
                  }} />
                ))}
              </>
            )}
          </div>
        </div>

        {/* Bottom Row: Token Stats + Project Ranking */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-surface border border-border rounded-xl p-4">
            <h3 className="text-sm font-semibold text-text mb-4 flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-primary" /> Token 消耗分布
            </h3>
            <DonutChart percent={inputPct} label1="输入 Token" label2="输出 Token" v1={`${inputPct}%`} v2={`${100 - inputPct}%`} />
            <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
              <div className="bg-bg rounded-lg p-2">
                <div className="text-text font-semibold tabular-nums">{globalStats.input_tokens.toLocaleString()}</div>
                <div className="text-text-muted">输入</div>
              </div>
              <div className="bg-bg rounded-lg p-2">
                <div className="text-text font-semibold tabular-nums">{globalStats.output_tokens.toLocaleString()}</div>
                <div className="text-text-muted">输出</div>
              </div>
              <div className="bg-bg rounded-lg p-2">
                <div className="text-text font-semibold tabular-nums">{globalStats.total_tokens.toLocaleString()}</div>
                <div className="text-text-muted">总计</div>
              </div>
            </div>
          </div>

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
      </div>
    </div>
  );
}
