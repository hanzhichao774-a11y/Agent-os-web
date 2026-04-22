import { Bell, User, Moon, Sun } from 'lucide-react';
import { useDarkMode } from '../hooks/useDarkMode';

export default function Header() {
  const { isDark, toggle } = useDarkMode();

  return (
    <header className="h-14 bg-surface border-b border-border flex items-center justify-between px-4 shrink-0 z-20">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center text-white font-bold text-sm">
          A
        </div>
        <span className="font-semibold text-text">AgentOS</span>
        <span className="text-xs text-text-muted bg-bg px-2 py-0.5 rounded-full border border-border">企业版</span>
      </div>
      <div className="flex items-center gap-4">
        <button
          onClick={toggle}
          className="relative p-2 hover:bg-bg rounded-lg transition-colors group"
          title={isDark ? '切换到日间模式' : '切换到深夜模式'}
        >
          {isDark ? (
            <Sun className="w-5 h-5 text-warning transition-transform group-hover:rotate-45" />
          ) : (
            <Moon className="w-5 h-5 text-text-secondary transition-transform group-hover:-rotate-12" />
          )}
        </button>
        <button className="relative p-2 hover:bg-bg rounded-lg transition-colors">
          <Bell className="w-5 h-5 text-text-secondary" />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-danger rounded-full" />
        </button>
        <button className="flex items-center gap-2 p-1.5 hover:bg-bg rounded-lg transition-colors">
          <div className="w-7 h-7 bg-primary-light rounded-full flex items-center justify-center">
            <User className="w-4 h-4 text-primary-dark" />
          </div>
          <span className="text-sm text-text">samhar</span>
        </button>
      </div>
    </header>
  );
}
