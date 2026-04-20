import { useState } from 'react';
import {
  Bot, Shield, Network, CheckCircle2, Circle, Loader2, Terminal,
  ArrowRight
} from 'lucide-react';
import { taskFlow, activeAgents, auditLogs } from '../data/mockData';

interface RightPanelProps {
  activeView: string;
  activeProjectId: string | null;
}

type BottomTabKey = 'agents' | 'knowledge' | 'audit';

const bottomTabs: { key: BottomTabKey; label: string; icon: React.ElementType }[] = [
  { key: 'agents', label: 'Agent 状态', icon: Bot },
  { key: 'knowledge', label: '知识图谱', icon: Network },
  { key: 'audit', label: '审计日志', icon: Shield },
];

// 横向任务流组件
function TaskFlowHorizontal() {
  return (
    <div className="h-full flex flex-col px-4 py-3">
      <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3 shrink-0">任务执行流</h3>
      <div className="flex-1 flex items-center justify-center min-h-0">
        <div className="flex items-center gap-2 w-full overflow-x-auto pb-1">
          {taskFlow.map((step, i) => {
            const isLast = i === taskFlow.length - 1;
            return (
              <div key={i} className="flex items-center gap-2 shrink-0">
                {/* Step Node */}
                <div className="flex flex-col items-center min-w-[90px]">
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center border-2 mb-1.5 ${
                    step.status === 'completed'
                      ? 'bg-success/10 border-success text-success'
                      : step.status === 'in-progress'
                      ? 'bg-warning/10 border-warning text-warning'
                      : 'bg-bg border-border text-text-muted'
                  }`}>
                    {step.status === 'completed' && <CheckCircle2 className="w-4.5 h-4.5" />}
                    {step.status === 'in-progress' && <Loader2 className="w-4.5 h-4.5 animate-spin" />}
                    {step.status === 'pending' && <Circle className="w-4.5 h-4.5" />}
                  </div>
                  <span className={`text-xs font-medium text-center leading-tight ${
                    step.status === 'completed' ? 'text-success' :
                    step.status === 'in-progress' ? 'text-warning' : 'text-text-muted'
                  }`}>
                    {step.name}
                  </span>
                  <span className="text-[10px] text-text-muted mt-0.5 text-center leading-tight">{step.agent}</span>
                  {step.time !== '-' && (
                    <span className="text-[10px] text-text-muted/60 mt-0.5">{step.time}</span>
                  )}
                </div>

                {/* Arrow */}
                {!isLast && (
                  <div className="flex flex-col items-center px-1">
                    <ArrowRight className={`w-4 h-4 shrink-0 ${
                      step.status === 'completed' ? 'text-success/50' : 'text-border'
                    }`} />
                    <div className={`h-0.5 w-full mt-1 rounded ${
                      step.status === 'completed' ? 'bg-success/40' : 'bg-border'
                    }`} style={{ minWidth: '24px' }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// 知识图谱组件
function KnowledgeGraph() {
  // 模拟知识图谱数据：节点和边
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
          {/* Edges */}
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
                stroke="#e5e7eb"
                strokeWidth={1.5}
              />
            );
          })}

          {/* Nodes */}
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

        {/* Legend */}
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

// Agent 状态面板
function AgentStatusPanel() {
  return (
    <div className="h-full flex flex-col px-4 py-3 space-y-3 overflow-y-auto">
      <h3 className="text-sm font-semibold text-text shrink-0">活跃 Agent</h3>
      {activeAgents.map((a) => (
        <div key={a.id} className="bg-bg border border-border rounded-lg p-3">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${
                a.status === 'running' ? 'bg-warning animate-pulse-dot' :
                a.status === 'idle' ? 'bg-success' : 'bg-text-muted'
              }`} />
              <span className="text-sm font-medium text-text">{a.name}</span>
            </div>
            <span className={`text-xs px-1.5 py-0.5 rounded ${
              a.role === 'host' ? 'bg-agent-host/10 text-agent-host' : 'bg-agent-normal/10 text-agent-normal'
            }`}>
              {a.role === 'host' ? '群主' : '执行'}
            </span>
          </div>
          <div className="text-xs text-text-secondary">{a.currentTask}</div>
        </div>
      ))}

      <div className="pt-2 border-t border-border-light shrink-0">
        <h4 className="text-xs font-semibold text-text-secondary mb-2">上下文占用</h4>
        <div className="flex items-center gap-2">
          <div className="flex-1 bg-border-light rounded-full h-2">
            <div className="bg-primary h-2 rounded-full" style={{ width: '32%' }} />
          </div>
          <span className="text-xs text-text-muted">32%</span>
        </div>
        <div className="text-xs text-text-muted mt-1">12 个事件 / 200K tokens</div>
      </div>
    </div>
  );
}

// 审计日志面板
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

export default function RightPanel({ activeView, activeProjectId }: RightPanelProps) {
  const [bottomTab, setBottomTab] = useState<BottomTabKey>('agents');

  const isProjectView = activeView === 'project' && activeProjectId;
  if (!isProjectView) return null;

  return (
    <div className="w-full h-full flex flex-col bg-surface border-l border-border">
      {/* 上半部分：横向任务流 */}
      <div className="h-[15%] shrink-0 border-b border-border">
        <TaskFlowHorizontal />
      </div>

      {/* 下半部分：选项卡切换 */}
      <div className="flex-1 min-h-0 flex flex-col">
        {/* Tab Bar */}
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

        {/* Tab Content */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {bottomTab === 'agents' && <AgentStatusPanel />}
          {bottomTab === 'knowledge' && <KnowledgeGraph />}
          {bottomTab === 'audit' && <AuditPanel />}
        </div>
      </div>
    </div>
  );
}
