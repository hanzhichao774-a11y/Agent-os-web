import { useState } from 'react';
import { Play, FileText, BarChart3, Presentation, Loader2, CheckCircle2, Clock } from 'lucide-react';
import { runWorkflow } from '../services/api';

interface WorkflowStep {
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  output?: string;
}

interface WorkflowRun {
  id: string;
  workflowId: string;
  workflowName: string;
  input: string;
  steps: WorkflowStep[];
  status: 'running' | 'completed' | 'failed';
  output: string;
}

const WORKFLOW_TEMPLATES = [
  {
    id: 'doc_pipeline',
    name: '文档处理流水线',
    description: '上传文档 → 解析内容 → AI 分析摘要 → 生成报告',
    icon: FileText,
    steps: ['文档解析', '知识入库', 'AI 分析摘要', '生成报告'],
    inputLabel: '请描述要分析的文档主题或上传需求',
    inputPlaceholder: '例如：请分析公司Q3财报的关键指标和风险点',
  },
  {
    id: 'data_pipeline',
    name: '数据分析流水线',
    description: '接收数据需求 → 数据查询 → 统计分析 → 图表生成 → 导出报告',
    icon: BarChart3,
    steps: ['需求理解', '数据查询', '统计分析', '生成报告'],
    inputLabel: '描述你的数据分析需求',
    inputPlaceholder: '例如：分析过去6个月各产品线的销售趋势，找出增长最快的产品',
  },
  {
    id: 'ppt_pipeline',
    name: 'PPT 生成流水线',
    description: '描述主题 → AI 生成大纲 → 逐页生成内容 → 输出 .pptx 文件',
    icon: Presentation,
    steps: ['主题分析', '大纲生成', '内容填充', '生成文件'],
    inputLabel: '描述 PPT 的主题和要求',
    inputPlaceholder: '例如：制作一个关于AI在企业数字化转型中的应用的演示文稿，10页左右',
  },
];

export default function WorkflowPage() {
  const [selectedWorkflow, setSelectedWorkflow] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [currentRun, setCurrentRun] = useState<WorkflowRun | null>(null);

  const template = WORKFLOW_TEMPLATES.find(w => w.id === selectedWorkflow);

  const handleRun = async () => {
    if (!template || !input.trim()) return;

    const run: WorkflowRun = {
      id: Date.now().toString(),
      workflowId: template.id,
      workflowName: template.name,
      input: input,
      steps: template.steps.map(name => ({ name, status: 'pending' })),
      status: 'running',
      output: '',
    };

    run.steps[0].status = 'running';
    setCurrentRun({ ...run });
    setInput('');

    try {
      let stepIndex = 0;
      await runWorkflow(template.id, { input: input }, (chunk) => {
        if (chunk.content) {
          if (chunk.content.startsWith('[STEP:')) {
            const match = chunk.content.match(/\[STEP:(\d+)\]/);
            if (match) {
              stepIndex = parseInt(match[1]) - 1;
              setCurrentRun(prev => {
                if (!prev) return prev;
                const steps = [...prev.steps];
                steps.forEach((s, i) => {
                  if (i < stepIndex) s.status = 'completed';
                  else if (i === stepIndex) s.status = 'running';
                });
                return { ...prev, steps };
              });
            }
          } else {
            setCurrentRun(prev => prev ? { ...prev, output: prev.output + chunk.content } : prev);
          }
        }
        if (chunk.done) {
          setCurrentRun(prev => {
            if (!prev) return prev;
            const steps = prev.steps.map(s => ({ ...s, status: 'completed' as const }));
            return { ...prev, steps, status: 'completed' };
          });
        }
      });
    } catch {
      setCurrentRun(prev => prev ? { ...prev, status: 'failed', output: prev.output + '\n\n执行失败，请检查后端服务。' } : prev);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-5xl mx-auto">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-text">工作流引擎</h1>
          <p className="text-sm text-text-secondary mt-1">
            选择预定义工作流模板，自动编排多个 Agent 协同完成任务
          </p>
        </div>

        {!currentRun ? (
          <>
            <div className="grid grid-cols-3 gap-4 mb-6">
              {WORKFLOW_TEMPLATES.map(wf => {
                const Icon = wf.icon;
                const isSelected = selectedWorkflow === wf.id;
                return (
                  <div
                    key={wf.id}
                    onClick={() => setSelectedWorkflow(wf.id)}
                    className={`bg-surface border rounded-xl p-5 cursor-pointer transition-all ${
                      isSelected
                        ? 'border-primary shadow-sm ring-1 ring-primary/20'
                        : 'border-border hover:border-primary/30 hover:shadow-sm'
                    }`}
                  >
                    <div className="flex items-center gap-3 mb-3">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                        isSelected ? 'bg-primary-light' : 'bg-bg border border-border'
                      }`}>
                        <Icon className={`w-5 h-5 ${isSelected ? 'text-primary-dark' : 'text-text-muted'}`} />
                      </div>
                      <h3 className="font-semibold text-text text-sm">{wf.name}</h3>
                    </div>
                    <p className="text-xs text-text-secondary mb-4">{wf.description}</p>
                    <div className="flex items-center gap-1.5">
                      {wf.steps.map((step, i) => (
                        <div key={i} className="flex items-center gap-1.5">
                          <span className="text-[10px] bg-bg text-text-muted px-1.5 py-0.5 rounded border border-border-light">
                            {step}
                          </span>
                          {i < wf.steps.length - 1 && <span className="text-text-muted text-[10px]">→</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            {template && (
              <div className="bg-surface border border-border rounded-xl p-5">
                <h3 className="text-sm font-semibold text-text mb-3">{template.inputLabel}</h3>
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={template.inputPlaceholder}
                  rows={3}
                  className="w-full bg-bg border border-border rounded-lg px-4 py-3 text-sm text-text outline-none focus:border-primary transition-colors resize-none mb-4"
                />
                <button
                  onClick={handleRun}
                  disabled={!input.trim()}
                  className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-dark transition-colors disabled:opacity-50"
                >
                  <Play className="w-4 h-4" />
                  执行工作流
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-text">{currentRun.workflowName}</h2>
              <button
                onClick={() => setCurrentRun(null)}
                className="text-xs text-primary hover:text-primary-dark"
              >
                返回工作流列表
              </button>
            </div>

            <div className="bg-surface border border-border rounded-xl p-4">
              <div className="text-xs text-text-muted mb-3">输入: {currentRun.input}</div>
              <div className="flex items-center gap-4">
                {currentRun.steps.map((step, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border ${
                      step.status === 'completed' ? 'bg-success/10 border-success/20 text-success' :
                      step.status === 'running' ? 'bg-primary-light border-primary/20 text-primary-dark' :
                      step.status === 'failed' ? 'bg-danger/10 border-danger/20 text-danger' :
                      'bg-bg border-border text-text-muted'
                    }`}>
                      {step.status === 'completed' ? <CheckCircle2 className="w-3 h-3" /> :
                       step.status === 'running' ? <Loader2 className="w-3 h-3 animate-spin" /> :
                       <Clock className="w-3 h-3" />}
                      {step.name}
                    </div>
                    {i < currentRun.steps.length - 1 && (
                      <span className="text-text-muted">→</span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-surface border border-border rounded-xl p-4">
              <h3 className="text-xs font-semibold text-text-muted mb-2">执行输出</h3>
              <div className="text-sm text-text whitespace-pre-wrap min-h-[200px] max-h-[500px] overflow-y-auto">
                {currentRun.output || (
                  <div className="flex items-center gap-2 text-text-muted">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    正在执行工作流...
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
