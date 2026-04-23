import { useState, useEffect, useCallback } from 'react';
import {
  Home, Bot, Wrench, Plus, Bell, Moon, Sun,
  ChevronLeft, ChevronRight, ChevronDown, Trash2, MoreHorizontal, MessageCircle, X
} from 'lucide-react';
import { createProject, deleteProject, fetchTasks, createTask, deleteTask } from '../services/api';
import { useDarkMode } from '../hooks/useDarkMode';
import type { ProjectInfo, TaskInfo } from '../services/api';

interface SidebarProps {
  activeView: string;
  activeProjectId: string | null;
  activeTaskId: string | null;
  onNavigate: (view: string, projectId?: string, taskId?: string | null) => void;
  projects: ProjectInfo[];
  onRefreshProjects: () => void;
}

const navItems = [
  { key: 'home', label: '主页', icon: Home },
  { key: 'agent', label: '数字员工', icon: Bot },
  { key: 'skill', label: 'Skills', icon: Wrench },
];

export default function Sidebar({ activeView, activeProjectId, activeTaskId, onNavigate, projects, onRefreshProjects }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [creating, setCreating] = useState(false);
  const { isDark, toggle: toggleDark } = useDarkMode();

  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());

  const toggleExpand = (projectId: string) => {
    setExpandedProjects(prev => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  };

  useEffect(() => {
    if (activeProjectId) {
      setExpandedProjects(prev => {
        const next = new Set(prev);
        next.add(activeProjectId);
        return next;
      });
    }
  }, [activeProjectId]);

  const handleCreate = async () => {
    if (!newName.trim() || creating) return;
    setCreating(true);
    try {
      const proj = await createProject(newName.trim(), newDesc.trim());
      onRefreshProjects();
      setShowCreateDialog(false);
      setNewName('');
      setNewDesc('');
      onNavigate('project', proj.id, null);
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
        collapsed ? 'w-14' : 'w-56'
      }`}
    >
      {/* Logo + Brand */}
      <div className={`flex items-center h-14 border-b border-border-light shrink-0 ${collapsed ? 'justify-center px-2' : 'px-3 gap-2.5'}`}>
        <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center text-white font-bold text-sm shrink-0">
          A
        </div>
        {!collapsed && (
          <span className="font-semibold text-text text-sm truncate">AgentOS</span>
        )}
        <div className={`${collapsed ? '' : 'ml-auto'}`}>
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="p-1 hover:bg-bg rounded-md transition-colors text-text-muted"
            title={collapsed ? '展开导航栏' : '收起导航栏'}
          >
            {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
          </button>
        </div>
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
                title="新建项目"
              >
                <Plus className="w-3.5 h-3.5 text-text-muted" />
              </button>
            </div>
          </div>
        )}

        <div className={`space-y-0.5 ${collapsed ? 'px-1.5' : 'px-1.5'}`}>
          {projects.map((project) => {
            const isExpanded = expandedProjects.has(project.id);
            const isProjectActive = activeView === 'project' && activeProjectId === project.id;

            return (
              <ProjectTreeItem
                key={project.id}
                project={project}
                isExpanded={isExpanded}
                isProjectActive={isProjectActive}
                activeTaskId={activeTaskId}
                collapsed={collapsed}
                onToggleExpand={() => toggleExpand(project.id)}
                onNavigate={onNavigate}
                onDelete={handleDeleteProject}
              />
            );
          })}
        </div>
      </div>

      {/* Bottom: Notifications + User + Dark mode */}
      <div className="border-t border-border p-1.5 space-y-0.5">
        <button
          className={`w-full flex items-center rounded-lg text-sm text-text-secondary hover:bg-bg transition-colors ${
            collapsed ? 'justify-center px-2 py-2' : 'gap-2.5 px-2.5 py-1.5'
          }`}
          title={collapsed ? '通知' : undefined}
        >
          <div className="relative shrink-0">
            <Bell className="w-[18px] h-[18px]" />
            <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-danger rounded-full text-[8px] text-white flex items-center justify-center font-bold">3</span>
          </div>
          {!collapsed && <span>通知</span>}
        </button>

        <div className={`flex items-center rounded-lg text-sm text-text-secondary ${
          collapsed ? 'justify-center px-2 py-2' : 'gap-2.5 px-2.5 py-1.5'
        }`}>
          <div className="w-[18px] h-[18px] bg-primary/20 rounded-full flex items-center justify-center shrink-0 relative">
            <span className="text-[9px] font-bold text-primary-dark">S</span>
            <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 bg-success rounded-full border border-surface" />
          </div>
          {!collapsed && <span className="truncate text-text">samhar</span>}
        </div>

        <button
          onClick={toggleDark}
          className={`w-full flex items-center rounded-lg text-sm text-text-secondary hover:bg-bg transition-colors ${
            collapsed ? 'justify-center px-2 py-1.5' : 'gap-2.5 px-2.5 py-1.5'
          }`}
          title={isDark ? '日间模式' : '深夜模式'}
        >
          {isDark
            ? <Sun className="w-[18px] h-[18px] text-warning shrink-0" />
            : <Moon className="w-[18px] h-[18px] shrink-0" />
          }
          {!collapsed && <span>{isDark ? '日间模式' : '深夜模式'}</span>}
        </button>
      </div>

      {showCreateDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-surface border border-border rounded-xl shadow-lg w-80 p-5">
            <h3 className="text-sm font-semibold text-text mb-3">新建项目</h3>
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
              placeholder="描述（可选）"
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


function ProjectTreeItem({
  project, isExpanded, isProjectActive, activeTaskId, collapsed,
  onToggleExpand, onNavigate, onDelete,
}: {
  project: ProjectInfo;
  isExpanded: boolean;
  isProjectActive: boolean;
  activeTaskId: string | null;
  collapsed: boolean;
  onToggleExpand: () => void;
  onNavigate: (view: string, projectId?: string, taskId?: string | null) => void;
  onDelete: (e: React.MouseEvent, projectId: string) => void;
}) {
  const [tasks, setTasks] = useState<TaskInfo[]>([]);
  const [showMenu, setShowMenu] = useState(false);
  const [addingTask, setAddingTask] = useState(false);
  const [newTaskName, setNewTaskName] = useState('');

  const loadTasks = useCallback(() => {
    if (isExpanded) {
      fetchTasks(project.id).then(setTasks).catch(() => {});
    }
  }, [isExpanded, project.id]);

  useEffect(() => { loadTasks(); }, [loadTasks]);

  const handleAddTask = async () => {
    if (!newTaskName.trim()) return;
    await createTask(project.id, newTaskName.trim());
    setNewTaskName('');
    setAddingTask(false);
    loadTasks();
  };

  const handleDeleteTask = async (e: React.MouseEvent, taskId: string) => {
    e.stopPropagation();
    await deleteTask(taskId);
    loadTasks();
  };

  if (collapsed) {
    return (
      <button
        onClick={() => onNavigate('project', project.id, null)}
        title={project.name}
        className={`w-full flex justify-center px-2 py-2 rounded-lg transition-colors ${
          isProjectActive ? 'bg-primary-light' : 'hover:bg-bg'
        }`}
      >
        <div className={`w-2 h-2 rounded-full ${
          project.status === 'active' ? 'bg-success' :
          project.status === 'idle' ? 'bg-warning' : 'bg-text-muted'
        }`} />
      </button>
    );
  }

  const isMainChatActive = isProjectActive && activeTaskId === null;

  return (
    <div>
      {/* Project header row */}
      <div
        className={`w-full flex items-center gap-1 px-1.5 py-1 rounded-lg text-left transition-colors group/proj cursor-pointer ${
          isProjectActive ? 'bg-primary-light/50' : 'hover:bg-bg'
        }`}
      >
        <button
          onClick={onToggleExpand}
          className="p-0.5 shrink-0 text-text-muted hover:text-text transition-colors"
        >
          <ChevronDown className={`w-3 h-3 transition-transform ${isExpanded ? '' : '-rotate-90'}`} />
        </button>

        <div
          className={`w-4 h-4 border rounded shrink-0 flex items-center justify-center ${
            project.status === 'active' ? 'border-primary/40' : 'border-border'
          }`}
        >
          <MessageCircle className="w-2.5 h-2.5 text-text-muted" />
        </div>

        <span
          onClick={() => { if (!isExpanded) onToggleExpand(); onNavigate('project', project.id, null); }}
          className={`flex-1 text-sm font-medium truncate ${isProjectActive ? 'text-primary-dark' : 'text-text'}`}
        >
          {project.name}
        </span>

        <div className="flex items-center gap-0.5 opacity-0 group-hover/proj:opacity-100 transition-opacity shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); setAddingTask(true); }}
            className="p-0.5 hover:bg-bg rounded transition-colors text-text-muted"
            title="新增任务"
          >
            <Plus className="w-3 h-3" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu); }}
            className="p-0.5 hover:bg-bg rounded transition-colors text-text-muted"
          >
            <MoreHorizontal className="w-3 h-3" />
          </button>
        </div>

        <div className={`w-2 h-2 rounded-full shrink-0 ${
          project.status === 'active' ? 'bg-success' :
          project.status === 'idle' ? 'bg-warning' : 'bg-text-muted'
        }`} />
      </div>

      {/* Menu dropdown */}
      {showMenu && (
        <div className="ml-6 mb-1">
          <button
            onClick={(e) => { setShowMenu(false); onDelete(e, project.id); }}
            className="flex items-center gap-1.5 px-2 py-1 text-xs text-danger hover:bg-danger/10 rounded-lg transition-colors w-full"
          >
            <Trash2 className="w-3 h-3" /> 删除项目
          </button>
        </div>
      )}

      {/* Expanded children */}
      {isExpanded && (
        <div className="ml-4 border-l border-border-light pl-2 space-y-0.5 mt-0.5">
          {/* Main chat */}
          <button
            onClick={() => onNavigate('project', project.id, null)}
            className={`w-full flex items-center gap-2 px-2 py-1 rounded-lg text-left text-sm transition-colors ${
              isMainChatActive ? 'bg-primary-light text-primary-dark font-medium' : 'text-text-secondary hover:bg-bg hover:text-text'
            }`}
          >
            <MessageCircle className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">主对话</span>
          </button>

          {/* Tasks */}
          {tasks.map((task) => {
            const isTaskActive = isProjectActive && activeTaskId === task.id;
            return (
              <div key={task.id} className="flex items-center group/task">
                <button
                  onClick={() => onNavigate('project', project.id, task.id)}
                  className={`flex-1 flex items-center gap-2 px-2 py-1 rounded-lg text-left text-sm transition-colors min-w-0 ${
                    isTaskActive ? 'bg-primary-light text-primary-dark font-medium' : 'text-text-secondary hover:bg-bg hover:text-text'
                  }`}
                >
                  <MessageCircle className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{task.name}</span>
                </button>
                <button
                  onClick={(e) => handleDeleteTask(e, task.id)}
                  className="p-0.5 rounded hover:bg-danger/10 text-text-muted hover:text-danger opacity-0 group-hover/task:opacity-100 transition-all shrink-0"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            );
          })}

          {/* Inline add task */}
          {addingTask ? (
            <div className="flex items-center gap-1 px-1">
              <input
                value={newTaskName}
                onChange={(e) => setNewTaskName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAddTask(); if (e.key === 'Escape') { setAddingTask(false); setNewTaskName(''); } }}
                placeholder="任务名称"
                autoFocus
                className="flex-1 text-xs bg-bg border border-border rounded px-2 py-1 outline-none focus:border-primary text-text min-w-0"
              />
              <button onClick={handleAddTask} className="text-[10px] text-primary hover:text-primary-dark px-1 shrink-0">确定</button>
              <button onClick={() => { setAddingTask(false); setNewTaskName(''); }} className="text-[10px] text-text-muted hover:text-text px-1 shrink-0">取消</button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
