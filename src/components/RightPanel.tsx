import { useState } from 'react';
import {
  Bot, Shield, Network, CheckCircle2, Circle, Loader2, Terminal,
  ArrowRight, Clock
} from 'lucide-react';
import type { TeamAgentStatus, TeamTaskStep } from '../App';
import { auditLogs } from '../data/mockData';

interface RightPanelProps {
  activeView: string;
  activeProjectId: string | null;
  teamAgents: TeamAgentStatus[];
  teamSteps: TeamTaskStep[];
}

type BottomTabKey = 'agents' | 'knowledge' | 'audit';

const bottomTabs: { key: BottomTabKey; label: string; icon: React.ElementType }[] = [
  { key: 'agents', label: 'Agent 状态', icon: Bot },
  { key: 'knowledge', label: '知识图谱', icon: Network },
  { key: 'audit', label: '审计日志', icon: Shield },
];

function TaskFlowHorizontal({ steps }: { steps: TeamTaskStep[] }) {
  if (steps.length === 0) {
    return (
      <div className="h-full flex flex-col px-4 py-2">
        <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2 shrink-0">任务执行流</h3>
        <div className="flex-1 flex items-center justify-center min-h-0">
          <div className="flex flex-col items-center gap-1.5 text-text-muted">
            <Clock className="w-4 h-4 opacity-40" />
            <span className="text-[10px]">等待任务开始...</span>
          </div>
        </div>
      </div>
    );
  }

  const completedCount = steps.filter(s => s.status === 'completed').length;

  return (
    <div className="h-full flex flex-col px-4 py-2">
      <div className="flex items-center justify-between mb-2 shrink-0">
        <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider">任务执行流</h3>
        <span className="text-[10px] text-text-muted">{completedCount}/{steps.length} 完成</span>
      </div>
      <div className="flex-1 flex items-center min-h-0">
        <div className="flex items-center gap-0.5 w-full overflow-x-auto pb-1">
          {steps.map((step, i) => {
            const isLast = i === steps.length - 1;
            return (
              <div key={`${step.agent}-${i}`} className="flex items-center gap-0.5 shrink-0">
                <div className="flex flex-col items-center min-w-[64px] max-w-[72px]">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center border-[1.5px] mb-1 ${
                    step.status === 'completed'
                      ? 'bg-success/10 border-success text-success'
                      : step.status === 'in-progress'
                      ? 'bg-warning/10 border-warning text-warning'
                      : 'bg-bg border-border text-text-muted'
                  }`}>
                    {step.status === 'completed' && <CheckCircle2 className="w-3 h-3" />}
                    {step.status === 'in-progress' && <Loader2 className="w-3 h-3 animate-spin" />}
                    {step.status === 'pending' && <Circle className="w-3 h-3" />}
                  </div>
                  <span className={`text-[10px] font-medium text-center leading-tight truncate w-full ${
                    step.status === 'completed' ? 'text-success' :
                    step.status === 'in-progress' ? 'text-warning' : 'text-text-muted'
                  }`} title={step.name}>
                    {step.name}
                  </span>
                  {step.status === 'completed' && step.duration && (
                    <span className="text-[9px] text-text-muted/70 mt-0.5 flex items-center gap-0.5">
                      <Clock className="w-2 h-2" />{step.duration}
                    </span>
                  )}
                  {step.status === 'completed' && step.tokens && (
                    <span className="text-[9px] text-text-muted/70 flex items-center gap-0.5">
                      <Terminal className="w-2 h-2" />{step.tokens > 1000 ? `${(step.tokens / 1000).toFixed(1)}k` : step.tokens}
                    </span>
                  )}
                  {step.status === 'in-progress' && (
                    <span className="text-[9px] text-warning/70 mt-0.5">执行中...</span>
                  )}
                </div>

                {!isLast && (
                  <ArrowRight className={`w-3 h-3 shrink-0 mx-0.5 ${
                    step.status === 'completed' ? 'text-success/40' : 'text-border'
                  }`} />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function KnowledgeGraph() {
  const nodes = [
    { id: 'project', label: 'Q3财报分析', x: 200, y: 140, type: 'project', color: '#4f46e5' },
    { id: 'file', label: 'sales_q3.xlsx', x: 80, y: 80, type: 'file', color: '#059669' },
    { id: 'agent1', label: '数据分析Agent', x: 320, y: 80, type: 'agent', color: '#7c3aed' },
    { id: 'skill1', label: '图表生成', x: 320, y: 200, type: 'skill', color: '#6b7280' },
    { id: 'metric1', label: '云服务\n3,240万', x: 120, y: 200, type: 'metric', color: '#3b82f6' },
    { id: 'metric2', label: '企业服务\n2,890万', x: 200, y: 240, type: 'metric', color: '#3b82f6' },
    { id: 'metric3', label: '消费者业务\n1,560万', x: 80, y: 260, type: 'metric', color: '#f59e0b' },
    { id: 'metric4', label: '海外市场\n980万', x: 280, y: 260, type: 'metric', color: '#10b981' },
    { id: 'insight', label: '增长双引擎', x: 360, y: 140, type: 'insight', color: '#ef4444' },
  ];

  const edges = [
    { from: 'project', to: 'file' },
    { from: 'project', to: 'agent1' },
    { from: 'agent1', to: 'skill1' },
    { from: 'agent1', to: 'metric1' },
    { from: 'agent1', to: 'metric2' },
    { from: 'agent1', to: 'metric3' },
    { from: 'agent1', to: 'metric4' },
    { from: 'metric1', to: 'insight' },
    { from: 'metric2', to: 'insight' },
    { from: 'metric3', to: 'insight' },
    { from: 'metric4', to: 'insight' },
    { from: 'file', to: 'agent1' },
  ];

  const nodeById = Object.fromEntries(nodes.map(n => [n.id, n]));

  return (
    <div className="h-full flex flex-col px-4 py-3">
      <div className="flex items-center justify-between mb-2 shrink-0">
        <h3 className="text-sm font-semibold text-text">项目知识图谱</h3>
        <span className="text-[10px] text-text-muted">{nodes.length} 实体 · {edges.length} 关系</span>
      </div>
      <div className="flex-1 bg-bg rounded-xl border border-border overflow-hidden relative min-h-0">
        <svg viewBox="0 0 440 320" className="w-full h-full" preserveAspectRatio="xMidYMid meet">
          {edges.map((edge, i) => {
            const from = nodeById[edge.from];
            const to = nodeById[edge.to];
            if (!from || !to) return null;
            return (
              <line
                key={i}
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke="currentColor"
                className="text-border"
                strokeWidth={1.5}
              />
            );
          })}

          {nodes.map((node) => (
            <g key={node.id}>
              <circle
                cx={node.x}
                cy={node.y}
                r={node.type === 'project' ? 28 : 22}
                fill={node.color + '15'}
                stroke={node.color}
                strokeWidth={2}
              />
              <text
                x={node.x}
                y={node.y}
                textAnchor="middle"
                dominantBaseline="middle"
                fill={node.color}
                fontSize={node.type === 'project' ? 11 : 10}
                fontWeight={600}
              >
                {node.label.split('\n').map((line, i) => (
                  <tspan key={i} x={node.x} dy={i === 0 ? '0.3em' : '1.1em'}>
                    {line}
                  </tspan>
                ))}
              </text>
            </g>
          ))}
        </svg>

        <div className="absolute bottom-2 left-2 flex flex-wrap gap-x-3 gap-y-1">
          {[
            { label: '项目', color: '#4f46e5' },
            { label: '文件', color: '#059669' },
            { label: 'Agent', color: '#7c3aed' },
            { label: 'Skill', color: '#6b7280' },
            { label: '指标', color: '#3b82f6' },
            { label: '洞察', color: '#ef4444' },
          ].map(item => (
            <div key={item.label} className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full" style={{ background: item.color }} />
              <span className="text-[10px] text-text-secondary">{item.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AgentStatusPanel({ agents }: { agents: TeamAgentStatus[] }) {
  const LEADER: TeamAgentStatus = { name: '👑 Team Leader', status: 'idle', currentTask: '待命中，随时协调任务' };
  const hasLeader = agents.some(a => a.name.includes('Leader'));
  const displayAgents = hasLeader ? agents : [LEADER, ...agents];

  const workingCount = displayAgents.filter(a => a.status === 'working').length;
  const doneCount = displayAgents.filter(a => a.status === 'done').length;
  const onlineCount = displayAgents.length;

  return (
    <div className="h-full flex flex-col px-4 py-3 space-y-3 overflow-y-auto">
      <div className="flex items-center justify-between shrink-0">
        <h3 className="text-sm font-semibold text-text">活跃 Agent</h3>
        <span className="text-[10px] text-text-muted">
          {onlineCount} 在线{workingCount > 0 ? ` · ${workingCount} 执行中` : ''}{doneCount > 0 ? ` · ${doneCount} 已完成` : ''}
        </span>
      </div>
      {displayAgents.map((a, i) => {
        const isLeader = a.name.includes('Leader');
        return (
          <div key={`${a.name}-${i}`} className={`border rounded-lg p-3 ${isLeader ? 'bg-amber-50/50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800/30' : 'bg-bg border-border'}`}>
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${
                  a.status === 'working' ? 'bg-warning animate-pulse' :
                  a.status === 'done' ? 'bg-success' :
                  isLeader ? 'bg-success' : 'bg-text-muted'
                }`} />
                <span className="text-sm font-medium text-text">{a.name}</span>
              </div>
              <span className={`text-xs px-1.5 py-0.5 rounded ${
                a.status === 'working' ? 'bg-warning/10 text-warning' :
                a.status === 'done' ? 'bg-success/10 text-success' :
                isLeader ? 'bg-success/10 text-success' :
                'bg-agent-normal/10 text-agent-normal'
              }`}>
                {a.status === 'working' ? '执行中' : a.status === 'done' ? '已完成' : isLeader ? '在线' : '等待'}
              </span>
            </div>
            <div className="text-xs text-text-secondary">{a.currentTask}</div>
          </div>
        );
      })}
    </div>
  );
}

function AuditPanel() {
  return (
    <div className="h-full flex flex-col px-4 py-3 overflow-y-auto">
      <h3 className="text-sm font-semibold text-text mb-2 shrink-0">审计日志</h3>
      <div className="space-y-2">
        {auditLogs.map((log, i) => (
          <div key={i} className="flex items-start gap-2 text-xs">
            <Terminal className="w-3 h-3 text-text-muted shrink-0 mt-0.5" />
            <div>
              <div className="text-text-muted">{log.time}</div>
              <div className="text-text-secondary">{log.event}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function RightPanel({ activeView, activeProjectId, teamAgents, teamSteps }: RightPanelProps) {
  const [bottomTab, setBottomTab] = useState<BottomTabKey>('agents');

  const isProjectView = activeView === 'project' && activeProjectId;
  if (!isProjectView) return null;

  return (
    <div className="w-full h-full flex flex-col bg-surface border-l border-border">
      <div className="h-[15%] shrink-0 border-b border-border">
        <TaskFlowHorizontal steps={teamSteps} />
      </div>

      <div className="flex-1 min-h-0 flex flex-col">
        <div className="flex items-center border-b border-border shrink-0">
          {bottomTabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.key}
                onClick={() => setBottomTab(tab.key)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium border-b-2 transition-colors ${
                  bottomTab === tab.key
                    ? 'border-primary text-primary-dark'
                    : 'border-transparent text-text-secondary hover:text-text'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="flex-1 min-h-0 overflow-hidden">
          {bottomTab === 'agents' && <AgentStatusPanel agents={teamAgents} />}
          {bottomTab === 'knowledge' && <KnowledgeGraph />}
          {bottomTab === 'audit' && <AuditPanel />}
        </div>
      </div>
    </div>
  );
}
