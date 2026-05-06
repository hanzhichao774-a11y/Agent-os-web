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

const STATUS_MAP: Record<string, { color: string; bg: string; border: string; dot: string; label: string; Icon: typeof Cpu }> = {
  idle:      { color: 'text-gray-400',    bg: 'bg-gray-50 dark:bg-gray-800/60',       border: 'border-gray-200 dark:border-gray-700', dot: 'bg-gray-300 dark:bg-gray-600',   label: '待命',   Icon: Clock },
  pending:   { color: 'text-amber-500',   bg: 'bg-amber-50 dark:bg-amber-500/10',     border: 'border-amber-200 dark:border-amber-700', dot: 'bg-amber-400',                 label: '等待中', Icon: Clock },
  working:   { color: 'text-blue-500',    bg: 'bg-blue-50 dark:bg-blue-500/10',       border: 'border-blue-300 dark:border-blue-600', dot: 'bg-blue-500',                    label: '执行中', Icon: Cpu },
  completed: { color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-500/10', border: 'border-emerald-200 dark:border-emerald-700', dot: 'bg-emerald-500',           label: '已完成', Icon: CheckCircle2 },
  failed:    { color: 'text-red-500',     bg: 'bg-red-50 dark:bg-red-500/10',         border: 'border-red-200 dark:border-red-700', dot: 'bg-red-500',                       label: '失败',   Icon: AlertCircle },
  error:     { color: 'text-red-500',     bg: 'bg-red-50 dark:bg-red-500/10',         border: 'border-red-200 dark:border-red-700', dot: 'bg-red-500',                       label: '出错',   Icon: AlertCircle },
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

  const allSlots: SlotDisplay[] = useMemo(() => {
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

  // Only show workers that are not idle
  const activeSlots = allSlots.filter(s => s.status !== 'idle');
  const hasActiveWorkers = activeSlots.length > 0;
  const isCoordinating = allSlots.some(s => s.status === 'working' || s.status === 'pending');

  return (
    <div className="px-4 pt-3 pb-3 border-b border-border shrink-0">
      {/* WorkAgent status row */}
      <div className="flex items-center gap-2">
        <BrainCircuit className={`w-4 h-4 shrink-0 ${isCoordinating ? 'text-blue-500' : 'text-text-muted'}`} />
        <span className="text-xs font-semibold text-text">WorkAgent</span>
        <span className={`w-2 h-2 rounded-full shrink-0 ${isCoordinating ? 'bg-emerald-500 animate-pulse' : 'bg-gray-300 dark:bg-gray-600'}`} />
        <span className={`text-xs ${isCoordinating ? 'text-emerald-600 dark:text-emerald-400' : 'text-text-muted'}`}>
          {isCoordinating ? '协调中' : '就绪'}
        </span>
      </div>

      {/* Dynamic worker cards — only shown when active */}
      {hasActiveWorkers && (
        <div className="mt-3 space-y-2">
          {/* Connector line from WorkAgent */}
          <div className="flex items-start gap-2 pl-[7px]">
            <div className="flex flex-col items-center">
              <div className="w-px h-2 bg-border" />
            </div>
          </div>

          <div className={`grid gap-2 ${activeSlots.length === 1 ? 'grid-cols-1' : activeSlots.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
            {activeSlots.map(slot => {
              const cfg = STATUS_MAP[slot.status] || STATUS_MAP.idle;
              const Icon = cfg.Icon;
              return (
                <div
                  key={slot.slot_id}
                  className={`border rounded-lg p-2 transition-all duration-300 ${cfg.border} ${cfg.bg} ${
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
                      <span className="text-[11px] font-semibold text-text">数字员工#{slot.slot_id}</span>
                    </div>
                    <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot} ${slot.status === 'working' ? 'animate-pulse' : ''}`} />
                  </div>

                  <div className={`text-[10px] font-medium ${cfg.color} mb-0.5`}>{cfg.label}</div>

                  {slot.description && (
                    <div className="text-[10px] text-text-secondary line-clamp-2 leading-tight mb-1">
                      {slot.description}
                    </div>
                  )}

                  <div className="text-[9px] text-text-muted flex items-center gap-1">
                    <span>{slot.tokens.toLocaleString()} tokens</span>
                    <span>·</span>
                    <span>{slot.tasksCompleted} 任务</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
