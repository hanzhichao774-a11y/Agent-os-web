import { useState, useCallback, useEffect, useRef } from 'react';
import Sidebar from './components/Sidebar';
import Dashboard from './components/Dashboard';
import BizAgent from './components/BizAgent';
import ProjectChat from './components/ProjectChat';
import type { ActivePlanState } from './components/ProjectChat';
import ProjectDashboard from './components/ProjectDashboard';
import SkillPage from './components/SkillPage';
import RightPanel from './components/RightPanel';
import SettingsModal from './components/SettingsModal';
import { fetchProjects } from './services/api';
import type { ProjectInfo } from './services/api';

export interface TeamAgentStatus {
  name: string;
  status: 'working' | 'done' | 'idle';
  currentTask: string;
}

export interface TeamTaskStep {
  name: string;
  agent: string;
  status: 'completed' | 'in-progress' | 'pending';
  time: string;
  startedAt?: number;
  duration?: string;
  tokens?: number;
}

export interface OutputItem {
  id: string;
  title: string;
  type: string;
  agentName?: string;
  timestamp: string;
}

type ViewType = 'home' | 'project' | 'skill';

function App() {
  const [activeView, setActiveView] = useState<ViewType>('home');
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);

  const [teamAgents, setTeamAgents] = useState<TeamAgentStatus[]>([]);
  const [teamSteps, setTeamSteps] = useState<TeamTaskStep[]>([]);
  const [chatOutputs, setChatOutputs] = useState<OutputItem[]>([]);
  const [activePlan, setActivePlan] = useState<ActivePlanState | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const [projects, setProjects] = useState<ProjectInfo[]>([]);

  const loadProjects = useCallback(() => {
    fetchProjects().then(setProjects).catch(() => {});
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const handleNavigate = (view: string, projectId?: string, taskId?: string | null) => {
    setActiveView(view as ViewType);
    if (projectId) {
      setActiveProjectId(projectId);
    }
    if (view === 'project') {
      setActiveTaskId(taskId ?? null);
    } else {
      setActiveTaskId(null);
    }
    if (view !== 'skill') setSelectedSkillId(null);
  };

  const handleResetTeamState = useCallback(() => {
    setTeamAgents([]);
    setTeamSteps([]);
  }, []);

  const handleUpdateTeamAgents = useCallback((updater: (prev: TeamAgentStatus[]) => TeamAgentStatus[]) => {
    setTeamAgents(updater);
  }, []);

  const handleUpdateTeamSteps = useCallback((updater: (prev: TeamTaskStep[]) => TeamTaskStep[]) => {
    setTeamSteps(updater);
  }, []);

  const isProjectView = activeView === 'project' && activeProjectId;
  const isHomeView = activeView === 'home';
  const isSkillView = activeView === 'skill';

  const isProjectDashboard = isProjectView && activeTaskId === null;
  const isTaskChat = isProjectView && activeTaskId !== null;
  const chatTaskId = activeTaskId === '_main' ? null : activeTaskId;

  const currentProject = projects.find(p => p.id === activeProjectId);
  const showBizAgent = !isProjectView;

  const [rightPanelWidth, setRightPanelWidth] = useState(320);
  const draggingRef = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(320);

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    draggingRef.current = true;
    startXRef.current = e.clientX;
    startWidthRef.current = rightPanelWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [rightPanelWidth]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      const delta = startXRef.current - e.clientX;
      const newWidth = Math.min(600, Math.max(240, startWidthRef.current + delta));
      setRightPanelWidth(newWidth);
    };
    const onUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  return (
    <div className="h-screen flex bg-bg">
      <Sidebar
        activeView={activeView}
        activeProjectId={activeProjectId}
        activeTaskId={activeTaskId}
        onNavigate={handleNavigate}
        projects={projects}
        onRefreshProjects={loadProjects}
        onOpenSettings={() => setShowSettings(true)}
      />

      <div className="flex-1 flex min-w-0 overflow-hidden">
        {isHomeView ? (
          <div className="flex-1 min-w-0 overflow-hidden">
            <Dashboard />
          </div>
        ) : isProjectDashboard ? (
          <>
            <div className="flex-1 min-w-0 overflow-hidden">
              <ProjectDashboard
                projectId={activeProjectId!}
                projectName={currentProject?.name || activeProjectId!}
                projectDescription={currentProject?.description || ''}
              />
            </div>
            <div
              onMouseDown={onResizeStart}
              className="w-1 shrink-0 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 transition-colors"
            />
            <div className="shrink-0 overflow-hidden" style={{ width: rightPanelWidth }}>
              <BizAgent
                activeView="project"
                projectId={activeProjectId!}
                projectName={currentProject?.name || activeProjectId!}
              />
            </div>
          </>
        ) : isTaskChat ? (
          <>
            <div className="flex-1 min-w-0 overflow-hidden">
              <ProjectChat
                projectId={activeProjectId!}
                taskId={chatTaskId}
                projectName={currentProject?.name || activeProjectId!}
                projectDescription={currentProject?.description || ''}
                onResetTeamState={handleResetTeamState}
                onUpdateTeamAgents={handleUpdateTeamAgents}
                onUpdateTeamSteps={handleUpdateTeamSteps}
                onOutputsChange={setChatOutputs}
                onActivePlanChange={setActivePlan}
              />
            </div>
            <div
              onMouseDown={onResizeStart}
              className="w-1 shrink-0 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 transition-colors"
            />
            <div className="shrink-0 min-w-0 overflow-hidden" style={{ width: rightPanelWidth }}>
              <RightPanel
                activeView={activeView}
                activeProjectId={activeProjectId}
                activeTaskId={chatTaskId}
                teamAgents={teamAgents}
                teamSteps={teamSteps}
                outputs={chatOutputs}
                activePlan={activePlan}
              />
            </div>
          </>
        ) : isSkillView ? (
          <div className="flex-1 min-w-0 overflow-hidden">
            <SkillPage
              selectedSkillId={selectedSkillId}
              onSelectSkill={setSelectedSkillId}
            />
          </div>
        ) : (
          <div className="flex-1 min-w-0 overflow-hidden">
            <Dashboard />
          </div>
        )}
      </div>

      {showBizAgent && (
        <>
          <div
            onMouseDown={onResizeStart}
            className="w-1 shrink-0 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 transition-colors"
          />
          <div className="shrink-0" style={{ width: rightPanelWidth }}>
            <BizAgent activeView={activeView} selectedSkillId={selectedSkillId} onClearSkill={() => setSelectedSkillId(null)} />
          </div>
        </>
      )}

      <SettingsModal open={showSettings} onClose={() => setShowSettings(false)} />
    </div>
  );
}

export default App;
