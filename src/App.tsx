import { useState } from 'react';
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

type ViewType = 'home' | 'project' | 'agent' | 'skill';

function App() {
  const [activeView, setActiveView] = useState<ViewType>('home');
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);

  const handleNavigate = (view: string, projectId?: string) => {
    setActiveView(view as ViewType);
    if (projectId) {
      setActiveProjectId(projectId);
    }
    // 切换视图时重置选中状态
    if (view !== 'agent') setSelectedAgentId(null);
    if (view !== 'skill') setSelectedSkillId(null);
  };

  const isProjectView = activeView === 'project' && activeProjectId;
  const isHomeView = activeView === 'home';
  const isAgentView = activeView === 'agent';
  const isSkillView = activeView === 'skill';

  const hasAgentSelected = isAgentView && selectedAgentId;
  const hasSkillSelected = isSkillView && selectedSkillId;

  return (
    <div className="h-screen flex flex-col bg-bg">
      <Header />
      <div className="flex-1 flex overflow-hidden">
        <Sidebar
          activeView={activeView}
          activeProjectId={activeProjectId}
          onNavigate={handleNavigate}
        />

        {isHomeView ? (
          // 主页：可视化 3 : 聊天 1
          <>
            <div className="flex-[3] min-w-0 overflow-hidden">
              <Dashboard />
            </div>
            <div className="flex-1 min-w-0 overflow-hidden">
              <GlobalChat />
            </div>
          </>
        ) : isProjectView ? (
          // 项目群聊视图：可视化 3 : 聊天 2
          <>
            <div className="flex-[3] min-w-0 overflow-hidden">
              <RightPanel activeView={activeView} activeProjectId={activeProjectId} />
            </div>
            <div className="flex-[2] min-w-0 overflow-hidden">
              <ProjectChat projectId={activeProjectId!} />
            </div>
          </>
        ) : isAgentView ? (
          // Agent 视图：列表 3 : 交互 1（选中时）
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
          // Skill 视图：列表 3 : 交互 1（选中时）
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
