import { useState, useEffect, useCallback, useMemo } from 'react';
import { Circle, FileText, Network, Download, ExternalLink, X, RefreshCw } from 'lucide-react';
import { fetchTaskFiles, getWorkspaceFileUrl, fetchTopEntities, expandEntity, excludeEntity } from '../services/api';
import type { TaskFile, EntityNode, EntityRelation } from '../services/api';
import type { OutputItem } from '../App';
import WorkflowPanel from './WorkflowPanel';
import ForceGraph, { makeForceNode, TYPE_COLORS, TYPE_LABELS } from './ForceGraph';
import type { ForceNode, ForceEdge } from './ForceGraph';

interface ActivePlanData {
  subtasks: Array<{ slot_id: number; description: string; status: string }>;
}

interface RightPanelProps {
  activeView: string;
  activeProjectId: string | null;
  activeTaskId: string | null;
  teamAgents: unknown[];
  teamSteps: unknown[];
  outputs: OutputItem[];
  activePlan?: ActivePlanData | null;
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

function KnowledgeGraph({ projectId, taskId }: { projectId: string; taskId: string | null }) {
  const [visibleEntities, setVisibleEntities] = useState<EntityNode[]>([]);
  const [visibleRelations, setVisibleRelations] = useState<EntityRelation[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [topIds, setTopIds] = useState<Set<string>>(new Set());
  const [totalEntities, setTotalEntities] = useState(0);
  const [totalRelations, setTotalRelations] = useState(0);
  const [loading, setLoading] = useState(false);
  const [expandingId, setExpandingId] = useState<string | null>(null);

  const loadTop = useCallback(() => {
    setLoading(true);
    fetchTopEntities(projectId, taskId, 10)
      .then(data => {
        setVisibleEntities(data.entities);
        setVisibleRelations(data.relations);
        setTotalEntities(data.total_entities);
        setTotalRelations(data.total_relations);
        setExpandedIds(new Set());
        setTopIds(new Set(data.entities.map(e => e.id)));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [projectId, taskId]);

  useEffect(() => { loadTop(); }, [loadTop]);

  const handleNodeClick = useCallback(async (nodeId: string) => {
    if (expandedIds.has(nodeId) || expandingId) return;
    setExpandingId(nodeId);
    try {
      const data = await expandEntity(projectId, nodeId);
      setVisibleEntities(prev => {
        const existingIds = new Set(prev.map(e => e.id));
        const newEnts = data.entities.filter(e => !existingIds.has(e.id));
        return [...prev, ...newEnts];
      });
      setVisibleRelations(prev => {
        const existingIds = new Set(prev.map(r => r.id));
        const newRels = data.relations.filter(r => !existingIds.has(r.id));
        return [...prev, ...newRels];
      });
      setExpandedIds(prev => new Set([...prev, nodeId]));
    } catch {
      // ignore
    } finally {
      setExpandingId(null);
    }
  }, [projectId, expandedIds, expandingId]);

  const handleNodeDoubleClick = useCallback((nodeId: string) => {
    if (!expandedIds.has(nodeId)) return;

    const directChildIds = new Set<string>();
    visibleRelations.forEach(r => {
      if (r.source_entity_id === nodeId) directChildIds.add(r.target_entity_id);
      if (r.target_entity_id === nodeId) directChildIds.add(r.source_entity_id);
    });

    const protectedIds = new Set<string>([...topIds, ...expandedIds]);
    protectedIds.delete(nodeId);

    const otherExpandedIds = new Set(expandedIds);
    otherExpandedIds.delete(nodeId);
    const linkedToOthers = new Set<string>();
    visibleRelations.forEach(r => {
      if (otherExpandedIds.has(r.source_entity_id)) linkedToOthers.add(r.target_entity_id);
      if (otherExpandedIds.has(r.target_entity_id)) linkedToOthers.add(r.source_entity_id);
    });

    const toRemove = new Set<string>();
    directChildIds.forEach(cid => {
      if (!protectedIds.has(cid) && !linkedToOthers.has(cid) && !topIds.has(cid)) {
        toRemove.add(cid);
      }
    });

    setVisibleEntities(prev => prev.filter(e => !toRemove.has(e.id)));
    setVisibleRelations(prev => prev.filter(r =>
      !toRemove.has(r.source_entity_id) && !toRemove.has(r.target_entity_id)
    ));
    setExpandedIds(prev => {
      const next = new Set(prev);
      next.delete(nodeId);
      return next;
    });
  }, [expandedIds, visibleRelations, topIds]);

  const handleExclude = async (ent: EntityNode) => {
    await excludeEntity(ent.id, true);
    setVisibleEntities(prev => prev.filter(e => e.id !== ent.id));
    setVisibleRelations(prev => prev.filter(r =>
      r.source_entity_id !== ent.id && r.target_entity_id !== ent.id
    ));
  };

  const expandableIds = useMemo(() => {
    const ids = new Set<string>();
    if (totalEntities > visibleEntities.length) {
      visibleEntities.forEach(e => {
        if (!expandedIds.has(e.id)) ids.add(e.id);
      });
    }
    return ids;
  }, [visibleEntities, expandedIds, totalEntities]);

  const stableExpandedIds = useMemo(() => expandedIds, [expandedIds]);

  const forceNodes: ForceNode[] = useMemo(() =>
    visibleEntities.map(e => {
      const degree = visibleRelations.filter(r => r.source_entity_id === e.id || r.target_entity_id === e.id).length;
      const isTop = topIds.has(e.id);
      const radius = isTop ? (degree >= 4 ? 14 : 12) : (degree >= 2 ? 8 : 6);
      return makeForceNode(e.id, e.name, e.type, radius, 1 + degree * 0.3, isTop ? 0 : 1, e.description, { 类型: TYPE_LABELS[e.type] || e.type, 来源: e.source || '' });
    }),
  [visibleEntities, visibleRelations, topIds]);

  const forceEdges: ForceEdge[] = useMemo(() =>
    visibleRelations.map(r => ({
      source: r.source_entity_id,
      target: r.target_entity_id,
      label: r.relation,
    })),
  [visibleRelations]);

  const grouped = useMemo(() =>
    visibleEntities.reduce<Record<string, EntityNode[]>>((acc, e) => {
      const key = e.type;
      if (!acc[key]) acc[key] = [];
      acc[key].push(e);
      return acc;
    }, {}),
  [visibleEntities]);

  return (
    <div className="h-full flex flex-col px-2 py-3">
      <div className="flex items-center justify-between px-2 mb-2 shrink-0">
        <h3 className="text-sm font-semibold text-text">知识图谱</h3>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-text-muted">
            已展示 {visibleEntities.length} / 总计 {totalEntities} 实体
          </span>
          <button onClick={loadTop} className="p-0.5 rounded hover:bg-border transition-colors" title="重置图谱">
            <RefreshCw className={`w-3 h-3 text-text-muted ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <div className="flex-1 flex min-h-0 gap-2">
        {/* Entity tag cloud - only visible entities */}
        <div className="w-[35%] shrink-0 overflow-y-auto pr-2" style={{ scrollbarWidth: 'thin' }}>
          {Object.keys(grouped).length === 0 ? (
            <p className="text-[10px] text-text-muted py-4 text-center">暂无实体</p>
          ) : (
            Object.entries(grouped).map(([type, ents]) => {
              const color = TYPE_COLORS[type] || '#52525b';
              return (
                <div key={type} className="mb-3">
                  <div className="flex items-center gap-1.5 mb-1.5 px-0.5">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                    <span className="text-[10px] font-semibold text-text-secondary">{TYPE_LABELS[type] || type}</span>
                    <span className="text-[9px] text-text-muted">({ents.length})</span>
                  </div>
                  <div className="flex flex-wrap gap-1 px-0.5">
                    {ents.map(ent => {
                      const isExpanded = expandedIds.has(ent.id);
                      return (
                        <span
                          key={ent.id}
                          className={`group inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-medium transition-all hover:shadow-sm hover:brightness-95 ${isExpanded ? 'ring-1' : ''}`}
                          style={{
                            background: `${color}18`,
                            color: color,
                            border: `1px solid ${color}30`,
                            cursor: expandableIds.has(ent.id) ? 'pointer' : 'default',
                            ringColor: isExpanded ? color : undefined,
                          }}
                          title={ent.description || ent.name}
                          onClick={() => {
                            if (expandableIds.has(ent.id)) handleNodeClick(ent.id);
                          }}
                        >
                          <span className="max-w-[100px] truncate">{ent.name}</span>
                          {expandableIds.has(ent.id) && !isExpanded && (
                            <span className="text-[8px] opacity-60">+</span>
                          )}
                          <button
                            onClick={(e) => { e.stopPropagation(); handleExclude(ent); }}
                            className="opacity-0 group-hover:opacity-100 -mr-0.5 p-0 rounded-full transition-opacity"
                            title="排除此实体"
                          >
                            <X className="w-2.5 h-2.5" style={{ color }} />
                          </button>
                        </span>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Force graph */}
        <div className="flex-1 bg-bg rounded-xl border border-border overflow-hidden min-h-0 relative">
          <ForceGraph
            nodes={forceNodes}
            edges={forceEdges}
            expandedIds={stableExpandedIds}
            expandableIds={expandableIds}
            onNodeClick={handleNodeClick}
            onNodeDoubleClick={handleNodeDoubleClick}
            className="w-full h-full"
          />
          {expandingId && (
            <div className="absolute top-2 right-2 text-[10px] text-text-muted bg-surface/80 px-2 py-1 rounded-md">
              展开中…
            </div>
          )}
          {/* Legend */}
          {visibleEntities.length > 0 && (
            <div className="absolute bottom-2 left-2 flex flex-wrap gap-x-2 gap-y-0.5">
              {Object.keys(grouped).map(type => (
                <div key={type} className="flex items-center gap-0.5">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: TYPE_COLORS[type] || '#52525b' }} />
                  <span className="text-[9px] text-text-secondary">{TYPE_LABELS[type] || type}</span>
                </div>
              ))}
            </div>
          )}
          <div className="absolute bottom-2 right-2 text-[9px] text-text-muted bg-surface/70 px-1.5 py-0.5 rounded">
            单击展开 · 双击收起
          </div>
        </div>
      </div>
    </div>
  );
}

export default function RightPanel({ activeView, activeProjectId, activeTaskId, outputs, activePlan }: RightPanelProps) {
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
        {activeTab === 'data' && (
          <div className="h-full flex flex-col overflow-hidden">
            <WorkflowPanel activePlan={activePlan ?? null} />
            <div className="flex-1 min-h-0 overflow-y-auto">
              <DataOutputPanel outputs={outputs} />
            </div>
          </div>
        )}
        {activeTab === 'files' && <FilesPanel outputs={outputs} projectId={activeProjectId!} taskId={activeTaskId} />}
        {activeTab === 'graph' && <KnowledgeGraph projectId={activeProjectId!} taskId={activeTaskId} />}
      </div>
    </div>
  );
}
