import { useState, useEffect } from 'react';
import { Circle, FileText, Network, Download, ExternalLink } from 'lucide-react';
import { fetchTaskFiles, getWorkspaceFileUrl } from '../services/api';
import type { TaskFile } from '../services/api';
import type { OutputItem } from '../App';

interface RightPanelProps {
  activeView: string;
  activeProjectId: string | null;
  activeTaskId: string | null;
  teamAgents: unknown[];
  teamSteps: unknown[];
  outputs: OutputItem[];
}

type TabKey = 'data' | 'files' | 'graph';

const tabs: { key: TabKey; label: string; icon: React.ElementType }[] = [
  { key: 'data', label: '数据', icon: Circle },
  { key: 'files', label: '文件', icon: FileText },
  { key: 'graph', label: '图谱', icon: Network },
];

const EXT_COLORS: Record<string, { bg: string; text: string }> = {
  xlsx: { bg: 'bg-emerald-100 dark:bg-emerald-900/30', text: 'text-emerald-600 dark:text-emerald-400' },
  xls: { bg: 'bg-emerald-100 dark:bg-emerald-900/30', text: 'text-emerald-600 dark:text-emerald-400' },
  csv: { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-600 dark:text-red-400' },
  md: { bg: 'bg-purple-100 dark:bg-purple-900/30', text: 'text-purple-600 dark:text-purple-400' },
  txt: { bg: 'bg-gray-100 dark:bg-gray-800', text: 'text-gray-600 dark:text-gray-400' },
  pdf: { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-600 dark:text-red-400' },
  png: { bg: 'bg-pink-100 dark:bg-pink-900/30', text: 'text-pink-600 dark:text-pink-400' },
  jpg: { bg: 'bg-pink-100 dark:bg-pink-900/30', text: 'text-pink-600 dark:text-pink-400' },
  json: { bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-600 dark:text-amber-400' },
  py: { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-600 dark:text-blue-400' },
};

const DEFAULT_EXT_COLOR = { bg: 'bg-gray-100 dark:bg-gray-800', text: 'text-gray-500 dark:text-gray-400' };

const OUTPUT_TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  '柱状图': { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-600 dark:text-blue-400' },
  '折线图': { bg: 'bg-emerald-100 dark:bg-emerald-900/30', text: 'text-emerald-600 dark:text-emerald-400' },
  '饼图': { bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-600 dark:text-amber-400' },
  '散点图': { bg: 'bg-violet-100 dark:bg-violet-900/30', text: 'text-violet-600 dark:text-violet-400' },
  '热力图': { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-600 dark:text-red-400' },
  '雷达图': { bg: 'bg-cyan-100 dark:bg-cyan-900/30', text: 'text-cyan-600 dark:text-cyan-400' },
  '表格': { bg: 'bg-emerald-100 dark:bg-emerald-900/30', text: 'text-emerald-600 dark:text-emerald-400' },
  '报告': { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-600 dark:text-red-400' },
  '文档': { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-600 dark:text-blue-400' },
  'PPT': { bg: 'bg-orange-100 dark:bg-orange-900/30', text: 'text-orange-600 dark:text-orange-400' },
  'PDF': { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-600 dark:text-red-400' },
};

const DEFAULT_OUTPUT_COLOR = { bg: 'bg-gray-100 dark:bg-gray-800', text: 'text-gray-500 dark:text-gray-400' };

function getExtLabel(name: string) {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  const colors = EXT_COLORS[ext] || DEFAULT_EXT_COLOR;
  return { ext: ext.toUpperCase() || 'FILE', colors };
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function isPreviewable(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  return ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'txt', 'md', 'json', 'csv'].includes(ext);
}

async function downloadFile(filename: string) {
  const url = getWorkspaceFileUrl(filename);
  try {
    const resp = await fetch(url);
    if (!resp.ok) return;
    const blob = await resp.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
  } catch {
    window.open(url, '_blank');
  }
}


function DataOutputPanel({ outputs }: { outputs: OutputItem[] }) {
  return (
    <div className="h-full overflow-y-auto px-4 py-4">
      <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">数据产出</h4>
      {outputs.length === 0 ? (
        <p className="text-xs text-text-muted py-6 text-center">对话中尚无产出</p>
      ) : (
        <div className="space-y-3">
          {outputs.map((item) => (
            <div key={item.id} className="border border-border rounded-xl p-4 hover:border-primary/30 transition-colors cursor-pointer">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h5 className="text-sm font-semibold text-text mb-1">{item.title}</h5>
                  {item.agentName && <p className="text-xs text-text-muted">由 {item.agentName.replace(/^\S+\s/, '')} 生成</p>}
                </div>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium shrink-0">
                  {item.type}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FilesPanel({ outputs, projectId, taskId }: { outputs: OutputItem[]; projectId: string; taskId: string | null }) {
  const [uploadedFiles, setUploadedFiles] = useState<TaskFile[]>([]);
  const [outputFiles, setOutputFiles] = useState<TaskFile[]>([]);

  const effectiveTaskId = taskId || 'main';

  useEffect(() => {
    fetchTaskFiles(projectId, effectiveTaskId, 'upload').then(setUploadedFiles).catch(() => {});
    fetchTaskFiles(projectId, effectiveTaskId, 'output').then(setOutputFiles).catch(() => {});
  }, [projectId, effectiveTaskId]);

  return (
    <div className="h-full overflow-y-auto px-4 py-4 space-y-6">
      {/* Uploaded docs */}
      <div>
        <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">上传文件</h4>
        <div className="space-y-1">
          {uploadedFiles.length === 0 && (
            <p className="text-xs text-text-muted py-3 text-center">暂无上传文件</p>
          )}
          {uploadedFiles.map(f => {
            const { ext, colors } = getExtLabel(f.file_name);
            return (
              <div key={f.file_name + f.created_at} className="flex items-center gap-3 px-2 py-2.5 rounded-lg hover:bg-bg transition-colors">
                <span className={`text-[10px] font-bold px-2 py-1 rounded-md ${colors.bg} ${colors.text} shrink-0 min-w-[40px] text-center`}>
                  {ext}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-text font-medium truncate">{f.file_name}</p>
                  <p className="text-[10px] text-text-muted">{f.size ? formatSize(f.size) : ''}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Generated workspace files */}
      <div>
        <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">产出文件</h4>
        <div className="space-y-1">
          {outputFiles.length === 0 ? (
            <p className="text-xs text-text-muted py-3 text-center">暂无产出文件</p>
          ) : (
            outputFiles.map(f => {
              const { ext, colors } = getExtLabel(f.file_name);
              const previewable = isPreviewable(f.file_name);
              return (
                <div key={f.file_name + f.created_at} className="flex items-center gap-3 px-2 py-2.5 rounded-lg hover:bg-bg transition-colors group">
                  <span className={`text-[10px] font-bold px-2 py-1 rounded-md ${colors.bg} ${colors.text} shrink-0 min-w-[40px] text-center`}>
                    {ext}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-text font-medium truncate">{f.file_name}</p>
                    <p className="text-[10px] text-text-muted">{f.size ? formatSize(f.size) : ''}</p>
                  </div>
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    {previewable && (
                      <button
                        onClick={() => window.open(getWorkspaceFileUrl(f.file_name), '_blank')}
                        className="p-1 rounded hover:bg-border transition-colors"
                        title="预览"
                      >
                        <ExternalLink className="w-3.5 h-3.5 text-text-muted" />
                      </button>
                    )}
                    <button
                      onClick={() => downloadFile(f.file_name)}
                      className="p-1 rounded hover:bg-border transition-colors"
                      title="下载"
                    >
                      <Download className="w-3.5 h-3.5 text-text-muted" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

function KnowledgeGraph() {
  const nodes = [
    { id: 'project', label: 'Q3财报分析', x: 200, y: 140, type: 'project', color: '#1e3a5f' },
    { id: 'file', label: 'sales_q3.xlsx', x: 80, y: 80, type: 'file', color: '#475569' },
    { id: 'agent1', label: '数据分析Agent', x: 320, y: 80, type: 'agent', color: '#0d9488' },
    { id: 'skill1', label: '图表生成', x: 320, y: 200, type: 'skill', color: '#7c3aed' },
    { id: 'metric1', label: '云服务\n3,240万', x: 120, y: 200, type: 'metric', color: '#57534e' },
    { id: 'metric2', label: '企业服务\n2,890万', x: 200, y: 240, type: 'metric', color: '#57534e' },
    { id: 'metric3', label: '消费者业务\n1,560万', x: 80, y: 260, type: 'metric', color: '#d97706' },
    { id: 'metric4', label: '海外市场\n980万', x: 280, y: 260, type: 'metric', color: '#059669' },
    { id: 'insight', label: '增长双引擎', x: 360, y: 140, type: 'insight', color: '#dc2626' },
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
        <h3 className="text-sm font-semibold text-text">项目关系图谱</h3>
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
            { label: '项目', color: '#1e3a5f' },
            { label: '文件', color: '#475569' },
            { label: 'Agent', color: '#0d9488' },
            { label: 'Skill', color: '#7c3aed' },
            { label: '指标', color: '#57534e' },
            { label: '洞察', color: '#dc2626' },
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

export default function RightPanel({ activeView, activeProjectId, activeTaskId, outputs }: RightPanelProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('data');

  const isProjectView = activeView === 'project' && activeProjectId;
  if (!isProjectView) return null;

  return (
    <div className="w-full h-full flex flex-col bg-surface border-l border-border">
      {/* Tab bar */}
      <div className="flex items-center border-b border-border shrink-0">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium border-b-2 transition-colors ${
                activeTab === tab.key
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

      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === 'data' && <DataOutputPanel outputs={outputs} />}
        {activeTab === 'files' && <FilesPanel outputs={outputs} projectId={activeProjectId!} taskId={activeTaskId} />}
        {activeTab === 'graph' && <KnowledgeGraph />}
      </div>
    </div>
  );
}
