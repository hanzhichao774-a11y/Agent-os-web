import { useState, useCallback, useEffect, useRef } from 'react';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import Dashboard from './components/Dashboard';
import GlobalChat from './components/GlobalChat';
import ProjectChat from './components/ProjectChat';
import AgentPage from './components/AgentPage';
import AgentChat from './components/AgentChat';
import SkillPage from './components/SkillPage';
import SkillChat from './components/SkillChat';
import RightPanel from './components/RightPanel';
import WorkflowPage from './components/WorkflowPage';
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

type ViewType = 'home' | 'project' | 'agent' | 'skill' | 'workflow';

function App() {
  const [activeView, setActiveView] = useState<ViewType>('home');
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);

  const [teamAgents, setTeamAgents] = useState<TeamAgentStatus[]>([]);
  const [teamSteps, setTeamSteps] = useState<TeamTaskStep[]>([]);

  const [projects, setProjects] = useState<ProjectInfo[]>([]);

  const loadProjects = useCallback(() => {
    fetchProjects().then(setProjects).catch(() => {});
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const handleNavigate = (view: string, projectId?: string) => {
    setActiveView(view as ViewType);
    if (projectId) {
      setActiveProjectId(projectId);
    }
    if (view !== 'agent') setSelectedAgentId(null);
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
  const isAgentView = activeView === 'agent';
  const isSkillView = activeView === 'skill';
  const isWorkflowView = activeView === 'workflow';

  const hasAgentSelected = isAgentView && selectedAgentId;
  const hasSkillSelected = isSkillView && selectedSkillId;

  // Resizable splitter for home view
  const [homeSplitPercent, setHomeSplitPercent] = useState(70);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const handleMouseDown = useCallback(() => {
    dragging.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      setHomeSplitPercent(Math.min(85, Math.max(30, pct)));
    };
    const handleMouseUp = () => {
      if (dragging.current) {
        dragging.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  return (
    <div className="h-screen flex flex-col bg-bg">
      <Header />
      <div className="flex-1 flex overflow-hidden" ref={containerRef}>
        <Sidebar
          activeView={activeView}
          activeProjectId={activeProjectId}
          onNavigate={handleNavigate}
          projects={projects}
          onRefreshProjects={loadProjects}
        />

        {isHomeView ? (
          <>
            <div className="min-w-0 overflow-hidden" style={{ width: `${homeSplitPercent}%` }}>
              <Dashboard />
            </div>
            <div
              onMouseDown={handleMouseDown}
              className="w-1 shrink-0 bg-border hover:bg-primary cursor-col-resize transition-colors"
            />
            <div className="min-w-0 overflow-hidden flex-1">
              <GlobalChat />
            </div>
          </>
        ) : isProjectView ? (
          <>
            <div className="flex-[3] min-w-0 overflow-hidden">
              <ProjectChat
                projectId={activeProjectId!}
                projectName={projects.find(p => p.id === activeProjectId)?.name || activeProjectId!}
                projectDescription={projects.find(p => p.id === activeProjectId)?.description || ''}
                onResetTeamState={handleResetTeamState}
                onUpdateTeamAgents={handleUpdateTeamAgents}
                onUpdateTeamSteps={handleUpdateTeamSteps}
              />
            </div>
            <div className="flex-[2] min-w-0 overflow-hidden">
              <RightPanel
                activeView={activeView}
                activeProjectId={activeProjectId}
                teamAgents={teamAgents}
                teamSteps={teamSteps}
              />
            </div>
          </>
        ) : isAgentView ? (
          <>
            <div className={`min-w-0 overflow-hidden ${hasAgentSelected ? 'flex-[3]' : 'flex-1'}`}>
              <AgentPage
                selectedAgentId={selectedAgentId}
                onSelectAgent={setSelectedAgentId}
              />
            </div>
            {hasAgentSelected && (
              <div className="flex-1 min-w-0 overflow-hidden">
                <AgentChat agentId={selectedAgentId!} onClose={() => setSelectedAgentId(null)} />
              </div>
            )}
          </>
        ) : isSkillView ? (
          <>
            <div className={`min-w-0 overflow-hidden ${hasSkillSelected ? 'flex-[3]' : 'flex-1'}`}>
              <SkillPage
                selectedSkillId={selectedSkillId}
                onSelectSkill={setSelectedSkillId}
              />
            </div>
            {hasSkillSelected && (
              <div className="flex-1 min-w-0 overflow-hidden">
                <SkillChat skillId={selectedSkillId!} onClose={() => setSelectedSkillId(null)} />
              </div>
            )}
          </>
        ) : isWorkflowView ? (
          <main className="flex-1 min-w-0 overflow-hidden">
            <WorkflowPage />
          </main>
        ) : (
          <main className="flex-1 min-w-0 overflow-hidden">
            {activeView === 'project' && !activeProjectId && <Dashboard />}
          </main>
        )}
      </div>
    </div>
  );
}

export default App;
