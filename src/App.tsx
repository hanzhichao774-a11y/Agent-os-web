import { useState, useCallback, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import Dashboard from './components/Dashboard';
import BizAgent from './components/BizAgent';
import ProjectChat from './components/ProjectChat';
import ProjectDashboard from './components/ProjectDashboard';
import ProjectFilePanel from './components/ProjectFilePanel';
import AgentPage from './components/AgentPage';
import SkillPage from './components/SkillPage';
import RightPanel from './components/RightPanel';
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

type ViewType = 'home' | 'project' | 'agent' | 'skill';

function App() {
  const [activeView, setActiveView] = useState<ViewType>('home');
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [selectedAgentName, setSelectedAgentName] = useState<string | null>(null);

  const [teamAgents, setTeamAgents] = useState<TeamAgentStatus[]>([]);
  const [teamSteps, setTeamSteps] = useState<TeamTaskStep[]>([]);
  const [chatOutputs, setChatOutputs] = useState<OutputItem[]>([]);

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
    if (view !== 'agent') setSelectedAgentName(null);
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

  const isProjectDashboard = isProjectView && activeTaskId === null;
  const isTaskChat = isProjectView && activeTaskId !== null;
  const chatTaskId = activeTaskId === '_main' ? null : activeTaskId;

  const currentProject = projects.find(p => p.id === activeProjectId);
  const showBizAgent = !isProjectView;

  return (
    <div className="h-screen flex bg-bg">
      <Sidebar
        activeView={activeView}
        activeProjectId={activeProjectId}
        activeTaskId={activeTaskId}
        onNavigate={handleNavigate}
        projects={projects}
        onRefreshProjects={loadProjects}
      />

      {/* Center content area */}
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
            <div className="w-72 shrink-0 overflow-hidden">
              <ProjectFilePanel projectId={activeProjectId!} />
            </div>
          </>
        ) : isTaskChat ? (
          <>
            <div className="flex-[3] min-w-0 overflow-hidden">
              <ProjectChat
                projectId={activeProjectId!}
                taskId={chatTaskId}
                projectName={currentProject?.name || activeProjectId!}
                projectDescription={currentProject?.description || ''}
                onResetTeamState={handleResetTeamState}
                onUpdateTeamAgents={handleUpdateTeamAgents}
                onUpdateTeamSteps={handleUpdateTeamSteps}
                onOutputsChange={setChatOutputs}
              />
            </div>
            <div className="flex-[2] min-w-0 overflow-hidden">
              <RightPanel
                activeView={activeView}
                activeProjectId={activeProjectId}
                teamAgents={teamAgents}
                teamSteps={teamSteps}
                outputs={chatOutputs}
              />
            </div>
          </>
        ) : isAgentView ? (
          <div className="flex-1 min-w-0 overflow-hidden">
            <AgentPage onSelectAgent={setSelectedAgentName} selectedAgentName={selectedAgentName} />
          </div>
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

      {/* BizAgent: fixed right panel, hidden in project view */}
      {showBizAgent && (
        <div className="w-80 shrink-0">
          <BizAgent activeView={activeView} selectedAgentName={selectedAgentName} onClearAgent={() => setSelectedAgentName(null)} selectedSkillId={selectedSkillId} onClearSkill={() => setSelectedSkillId(null)} />
        </div>
      )}
    </div>
  );
}

export default App;
