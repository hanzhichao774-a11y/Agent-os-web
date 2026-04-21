import { useState } from 'react';
import {
  Home, Bot, Wrench, Settings, HelpCircle, Plus,
  ChevronLeft, ChevronRight, GitBranch, Trash2
} from 'lucide-react';
import { createProject, deleteProject } from '../services/api';
import type { ProjectInfo } from '../services/api';

interface SidebarProps {
  activeView: string;
  activeProjectId: string | null;
  onNavigate: (view: string, projectId?: string) => void;
  projects: ProjectInfo[];
  onRefreshProjects: () => void;
}

const navItems = [
  { key: 'home', label: '主页', icon: Home },
  { key: 'agent', label: '智能体', icon: Bot },
  { key: 'skill', label: '技能', icon: Wrench },
  { key: 'workflow', label: '工作流', icon: GitBranch },
];

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    const now = Date.now();
    const diffMs = now - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return '刚刚';
    if (diffMin < 60) return `${diffMin}分钟前`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH}小时前`;
    const diffD = Math.floor(diffH / 24);
    if (diffD < 7) return `${diffD}天前`;
    return `${Math.floor(diffD / 7)}周前`;
  } catch {
    return '';
  }
}

export default function Sidebar({ activeView, activeProjectId, onNavigate, projects, onRefreshProjects }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!newName.trim() || creating) return;
    setCreating(true);
    try {
      const proj = await createProject(newName.trim(), newDesc.trim());
      onRefreshProjects();
      setShowCreateDialog(false);
      setNewName('');
      setNewDesc('');
      onNavigate('project', proj.id);
    } catch {
      // ignore
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteProject = async (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation();
    if (!confirm('确认删除此项目？')) return;
    await deleteProject(projectId);
    if (activeProjectId === projectId) {
      onNavigate('home');
    }
    onRefreshProjects();
  };

  return (
    <aside
      className={`bg-surface border-r border-border flex flex-col shrink-0 transition-all duration-300 ${
        collapsed ? 'w-14' : 'w-48'
      }`}
    >
      <div className={`flex items-center h-10 border-b border-border-light ${collapsed ? 'justify-center' : 'justify-end px-2'}`}>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-1 hover:bg-bg rounded-md transition-colors text-text-muted"
          title={collapsed ? '展开导航栏' : '收起导航栏'}
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden py-2">
        <nav className="px-1.5 space-y-0.5 mb-3">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeView === item.key;
            return (
              <button
                key={item.key}
                onClick={() => onNavigate(item.key)}
                title={collapsed ? item.label : undefined}
                className={`w-full flex items-center rounded-lg text-sm font-medium transition-colors ${
                  collapsed ? 'justify-center px-2 py-2' : 'gap-2.5 px-2.5 py-1.5'
                } ${
                  isActive
                    ? 'bg-primary-light text-primary-dark'
                    : 'text-text-secondary hover:bg-bg hover:text-text'
                }`}
              >
                <Icon className="w-[18px] h-[18px] shrink-0" />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </button>
            );
          })}
        </nav>

        {!collapsed && (
          <div className="px-3 mb-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">项目</span>
              <button
                onClick={() => setShowCreateDialog(true)}
                className="p-0.5 hover:bg-bg rounded transition-colors"
                title="创建项目"
              >
                <Plus className="w-3.5 h-3.5 text-text-muted" />
              </button>
            </div>
          </div>
        )}
        <div className={`space-y-0.5 ${collapsed ? 'px-1.5' : 'px-1.5'}`}>
          {projects.map((project) => {
            const isActive = activeView === 'project' && activeProjectId === project.id;
            return (
              <button
                key={project.id}
                onClick={() => onNavigate('project', project.id)}
                title={collapsed ? project.name : undefined}
                className={`w-full flex items-center rounded-lg text-left transition-colors group/proj ${
                  collapsed
                    ? 'justify-center px-2 py-2'
                    : 'items-start gap-2 px-2 py-1.5'
                } ${
                  isActive ? 'bg-primary-light' : 'hover:bg-bg'
                }`}
              >
                <div className={`rounded-full shrink-0 ${
                  collapsed ? 'w-2 h-2' : 'w-2 h-2 mt-1'
                } ${
                  project.status === 'active' ? 'bg-success' :
                  project.status === 'idle' ? 'bg-warning' : 'bg-text-muted'
                }`} />
                {!collapsed && (
                  <div className="min-w-0 flex-1">
                    <div className={`text-sm font-medium truncate ${isActive ? 'text-primary-dark' : 'text-text'}`}>
                      {project.name}
                    </div>
                    <div className="text-[11px] text-text-muted truncate">{formatTime(project.updated_at)}</div>
                  </div>
                )}
                {!collapsed && (
                  <button
                    onClick={(e) => handleDeleteProject(e, project.id)}
                    className="p-0.5 rounded hover:bg-error/10 text-text-muted hover:text-error opacity-0 group-hover/proj:opacity-100 transition-all shrink-0 mt-0.5"
                    title="删除项目"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="border-t border-border p-1.5 space-y-0.5">
        <button
          className={`w-full flex items-center rounded-lg text-sm text-text-secondary hover:bg-bg transition-colors ${
            collapsed ? 'justify-center px-2 py-2' : 'gap-2.5 px-2.5 py-1.5'
          }`}
          title={collapsed ? '设置' : undefined}
        >
          <Settings className="w-[18px] h-[18px] shrink-0" />
          {!collapsed && <span>设置</span>}
        </button>
        <button
          className={`w-full flex items-center rounded-lg text-sm text-text-secondary hover:bg-bg transition-colors ${
            collapsed ? 'justify-center px-2 py-2' : 'gap-2.5 px-2.5 py-1.5'
          }`}
          title={collapsed ? '帮助' : undefined}
        >
          <HelpCircle className="w-[18px] h-[18px] shrink-0" />
          {!collapsed && <span>帮助</span>}
        </button>
      </div>

      {showCreateDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-surface border border-border rounded-xl shadow-lg w-80 p-5">
            <h3 className="text-sm font-semibold text-text mb-3">创建新项目</h3>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="项目名称"
              autoFocus
              className="w-full text-sm bg-bg border border-border rounded-lg px-3 py-2 mb-2 outline-none focus:border-primary text-text"
            />
            <input
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="项目描述（可选）"
              className="w-full text-sm bg-bg border border-border rounded-lg px-3 py-2 mb-4 outline-none focus:border-primary text-text"
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setShowCreateDialog(false); setNewName(''); setNewDesc(''); }}
                className="px-3 py-1.5 text-xs text-text-secondary hover:bg-bg rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleCreate}
                disabled={!newName.trim() || creating}
                className="px-3 py-1.5 text-xs bg-primary text-white rounded-lg hover:bg-primary-dark transition-colors disabled:opacity-50"
              >
                {creating ? '创建中...' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
