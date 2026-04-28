import { useState, useEffect, useCallback, useMemo } from 'react';
import { Cpu, Loader2, CheckCircle2, AlertCircle, Clock, BrainCircuit } from 'lucide-react';
import { fetchWorkerStatus } from '../services/api';
import type { WorkerSlotStatus } from '../services/api';

export interface ActivePlan {
  subtasks: Array<{ slot_id: number; description: string; status: string }>;
}

interface WorkflowPanelProps {
  activePlan: ActivePlan | null;
}

type SlotDisplay = {
  slot_id: number;
  status: 'idle' | 'working' | 'completed' | 'failed' | 'error' | 'pending';
  description: string;
  tokens: number;
  tasksCompleted: number;
};

const STATUS_MAP: Record<string, { color: string; bg: string; border: string; line: string; label: string; Icon: typeof Cpu }> = {
  idle:      { color: 'text-gray-400',    bg: 'bg-gray-50 dark:bg-gray-800/60',       border: 'border-gray-200 dark:border-gray-700', line: 'stroke-gray-300 dark:stroke-gray-600', label: '待命', Icon: Clock },
  pending:   { color: 'text-amber-500',   bg: 'bg-amber-50 dark:bg-amber-500/10',     border: 'border-amber-200 dark:border-amber-700', line: 'stroke-amber-300 dark:stroke-amber-600', label: '等待中', Icon: Clock },
  working:   { color: 'text-blue-500',    bg: 'bg-blue-50 dark:bg-blue-500/10',       border: 'border-blue-300 dark:border-blue-600', line: 'stroke-blue-400 dark:stroke-blue-500', label: '执行中', Icon: Cpu },
  completed: { color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-500/10', border: 'border-emerald-200 dark:border-emerald-700', line: 'stroke-emerald-400 dark:stroke-emerald-600', label: '已完成', Icon: CheckCircle2 },
  failed:    { color: 'text-red-500',     bg: 'bg-red-50 dark:bg-red-500/10',         border: 'border-red-200 dark:border-red-700', line: 'stroke-red-400 dark:stroke-red-600', label: '失败', Icon: AlertCircle },
  error:     { color: 'text-red-500',     bg: 'bg-red-50 dark:bg-red-500/10',         border: 'border-red-200 dark:border-red-700', line: 'stroke-red-400 dark:stroke-red-600', label: '出错', Icon: AlertCircle },
};

function normalizeStatus(s: string): SlotDisplay['status'] {
  if (s === 'idle' || s === 'working' || s === 'completed' || s === 'failed' || s === 'error' || s === 'pending') return s;
  return 'idle';
}

export default function WorkflowPanel({ activePlan }: WorkflowPanelProps) {
  const [workerSlots, setWorkerSlots] = useState<WorkerSlotStatus[]>([]);

  const poll = useCallback(() => {
    fetchWorkerStatus().then(d => { if (d.slots.length > 0) setWorkerSlots(d.slots); }).catch(() => {});
  }, []);

  useEffect(() => {
    poll();
    const timer = setInterval(poll, 3000);
    return () => clearInterval(timer);
  }, [poll]);

  const slots: SlotDisplay[] = useMemo(() => {
    return [1, 2, 3].map(id => {
      const planSt = activePlan?.subtasks.find(st => st.slot_id === id);
      const workerSt = workerSlots.find(s => s.slot_id === id);

      if (planSt) {
        return {
          slot_id: id,
          status: normalizeStatus(planSt.status),
          description: planSt.description,
          tokens: workerSt?.cumulative_total_tokens ?? 0,
          tasksCompleted: workerSt?.tasks_completed ?? 0,
        };
      }

      if (workerSt) {
        return {
          slot_id: id,
          status: normalizeStatus(workerSt.status),
          description: workerSt.current_task || '',
          tokens: workerSt.cumulative_total_tokens,
          tasksCompleted: workerSt.tasks_completed,
        };
      }

      return { slot_id: id, status: 'idle' as const, description: '', tokens: 0, tasksCompleted: 0 };
    });
  }, [activePlan, workerSlots]);

  const hasActive = slots.some(s => s.status === 'working' || s.status === 'pending');
  const bizStatus = hasActive ? 'working' : 'idle';

  // SVG layout constants
  const svgW = 320;
  const bizCx = svgW / 2;
  const bizCy = 12;
  const slotY = 44;
  const slotXs = [svgW * 0.17, svgW * 0.5, svgW * 0.83];

  return (
    <div className="px-4 pt-3 pb-2 border-b border-border shrink-0">
      <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">编排工作流</h4>

      {/* BizAgent node */}
      <div className="flex justify-center mb-1">
        <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
          bizStatus === 'working'
            ? 'border-blue-300 dark:border-blue-600 bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400'
            : 'border-border bg-surface text-text-secondary'
        }`}>
          <BrainCircuit className={`w-3.5 h-3.5 ${bizStatus === 'working' ? 'text-blue-500' : 'text-text-muted'}`} />
          <span>BizAgent</span>
          <span className={`w-2 h-2 rounded-full shrink-0 ${
            bizStatus === 'working' ? 'bg-blue-500 animate-pulse' : 'bg-gray-300 dark:bg-gray-600'
          }`} />
        </div>
      </div>

      {/* SVG connection lines */}
      <svg viewBox={`0 0 ${svgW} 56`} className="w-full h-8 overflow-visible" preserveAspectRatio="xMidYMid meet">
        {slotXs.map((sx, i) => {
          const slot = slots[i];
          const cfg = STATUS_MAP[slot.status] || STATUS_MAP.idle;
          const isActive = slot.status === 'working';
          const isIdle = slot.status === 'idle';
          return (
            <g key={i}>
              <line
                x1={bizCx} y1={bizCy}
                x2={sx} y2={slotY}
                className={cfg.line}
                strokeWidth={isActive ? 2 : 1.2}
                strokeDasharray={isIdle ? '4 3' : 'none'}
                strokeLinecap="round"
              />
              {isActive && (
                <circle r="3" className="fill-blue-500" opacity="0.8">
                  <animateMotion dur="1.2s" repeatCount="indefinite"
                    path={`M${bizCx},${bizCy} L${sx},${slotY}`} />
                </circle>
              )}
            </g>
          );
        })}
      </svg>

      {/* SubAgent cards */}
      <div className="grid grid-cols-3 gap-2">
        {slots.map(slot => {
          const cfg = STATUS_MAP[slot.status] || STATUS_MAP.idle;
          const Icon = cfg.Icon;
          return (
            <div
              key={slot.slot_id}
              className={`border rounded-lg p-2 transition-all ${cfg.border} ${cfg.bg} ${
                slot.status === 'working' ? 'ring-1 ring-blue-300 dark:ring-blue-500/40' : ''
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1">
                  {slot.status === 'working' ? (
                    <Loader2 className={`w-3 h-3 ${cfg.color} animate-spin`} />
                  ) : (
                    <Icon className={`w-3 h-3 ${cfg.color}`} />
                  )}
                  <span className="text-[11px] font-semibold text-text">#{slot.slot_id}</span>
                </div>
                <span className={`w-1.5 h-1.5 rounded-full ${
                  slot.status === 'idle' ? 'bg-gray-300 dark:bg-gray-600' :
                  slot.status === 'working' ? 'bg-blue-500 animate-pulse' :
                  slot.status === 'completed' ? 'bg-emerald-500' :
                  slot.status === 'pending' ? 'bg-amber-400' : 'bg-red-500'
                }`} />
              </div>

              <div className={`text-[10px] font-medium ${cfg.color} mb-0.5`}>{cfg.label}</div>

              {slot.description && (
                <div className="text-[10px] text-text-secondary line-clamp-2 leading-tight mb-1">
                  {slot.description}
                </div>
              )}

              <div className="text-[9px] text-text-muted flex items-center gap-1.5">
                <span>{slot.tokens.toLocaleString()} tokens</span>
                <span>·</span>
                <span>{slot.tasksCompleted} 任务</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
