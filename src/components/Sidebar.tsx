import { useState } from 'react';
import {
  Home, Bot, Wrench, Settings, HelpCircle, Plus,
  ChevronLeft, ChevronRight
} from 'lucide-react';
import { projects } from '../data/mockData';

interface SidebarProps {
  activeView: string;
  activeProjectId: string | null;
  onNavigate: (view: string, projectId?: string) => void;
}

const navItems = [
  { key: 'home', label: '主页', icon: Home },
  { key: 'agent', label: '智能体', icon: Bot },
  { key: 'skill', label: '技能', icon: Wrench },
];

export default function Sidebar({ activeView, activeProjectId, onNavigate }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={`bg-surface border-r border-border flex flex-col shrink-0 transition-all duration-300 ${
        collapsed ? 'w-14' : 'w-48'
      }`}
    >
      {/* Toggle Button */}
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
        {/* Main Nav */}
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

        {/* Projects Section */}
        {!collapsed && (
          <div className="px-3 mb-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">项目</span>
              <button className="p-0.5 hover:bg-bg rounded transition-colors">
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
                className={`w-full flex items-center rounded-lg text-left transition-colors ${
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
                    <div className="text-[11px] text-text-muted truncate">{project.updatedAt}</div>
                  </div>
                )}
                {!collapsed && project.unread && (
                  <span className="w-1.5 h-1.5 bg-primary rounded-full shrink-0 mt-1.5" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Bottom Actions */}
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
    </aside>
  );
}
