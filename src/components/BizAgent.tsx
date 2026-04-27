import { useState, useRef, useEffect, useMemo } from 'react';
import { Send, Loader2, Sparkles, AtSign, X, Bot, Wrench } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { streamAgentChat, streamSkillChat, fetchSkills, fetchSessionMessages } from '../services/api';
import type { SkillInfo } from '../services/api';

interface ChatMsg {
  id: string;
  role: 'assistant' | 'human' | 'system';
  content: string;
  timestamp: string;
}

function stripThinkTags(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<\/?member[^>]*>/g, '').trim();
}

function MarkdownContent({ content }: { content: string }) {
  const cleaned = useMemo(() => stripThinkTags(content), [content]);
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <p className="mb-1.5 last:mb-0">{children}</p>,
        ul: ({ children }) => <ul className="list-disc pl-4 mb-1.5">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal pl-4 mb-1.5">{children}</ol>,
        li: ({ children }) => <li className="mb-0.5">{children}</li>,
        h1: ({ children }) => <h1 className="text-base font-bold mb-2">{children}</h1>,
        h2: ({ children }) => <h2 className="text-sm font-bold mb-1.5">{children}</h2>,
        h3: ({ children }) => <h3 className="text-sm font-semibold mb-1">{children}</h3>,
        code: ({ children, className }) => {
          const isBlock = className?.startsWith('language-');
          if (isBlock) {
            return (
              <pre className="bg-gray-100 dark:bg-gray-800 rounded-lg p-3 overflow-x-auto text-xs mb-2">
                <code>{children}</code>
              </pre>
            );
          }
          return <code className="bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded text-xs">{children}</code>;
        },
        pre: ({ children }) => <>{children}</>,
        table: ({ children }) => (
          <div className="overflow-x-auto mb-2">
            <table className="min-w-full text-xs border-collapse border border-gray-200 dark:border-gray-700">{children}</table>
          </div>
        ),
        thead: ({ children }) => <thead className="bg-gray-50 dark:bg-gray-800">{children}</thead>,
        th: ({ children }) => <th className="px-2 py-1 border border-gray-200 dark:border-gray-700 font-semibold text-left">{children}</th>,
        td: ({ children }) => <td className="px-2 py-1 border border-gray-200 dark:border-gray-700">{children}</td>,
        strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
        blockquote: ({ children }) => (
          <blockquote className="border-l-3 border-gray-300 dark:border-gray-600 pl-3 italic text-text-muted mb-2">{children}</blockquote>
        ),
        hr: () => <hr className="my-2 border-gray-200 dark:border-gray-700" />,
      }}
    >
      {cleaned}
    </ReactMarkdown>
  );
}

const MOCK_SKILL_META: Record<string, { source: string; scope: string; version: string; author: string; agentTag: string }> = {};

const CATEGORY_CONFIG: Record<string, { label: string; color: string }> = {
  search: { label: '搜索', color: 'bg-blue-100 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400' },
  code: { label: '代码', color: 'bg-purple-100 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400' },
  data: { label: '数据服务', color: 'bg-emerald-100 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400' },
  analysis: { label: '分析', color: 'bg-amber-100 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400' },
  api: { label: 'API', color: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400' },
};

function getSkillMeta(skill: SkillInfo) {
  return MOCK_SKILL_META[skill.name] || {
    source: '能力教学',
    scope: `${Math.floor(Math.random() * 5 + 1)} 个项目`,
    version: 'v1.0',
    author: skill.mounted_agents?.[0]?.name || 'BizAgent',
    agentTag: skill.mounted_agents?.[0]?.name || '通用工具',
  };
}

const MOCK_STEPS: Record<string, Array<{ title: string; desc: string }>> = {
  search: [
    { title: '意图识别', desc: '解析搜索关键词，识别用户真实检索意图' },
    { title: '权限过滤', desc: '根据用户身份过滤可访问的数据源范围' },
    { title: '多源检索', desc: '并行检索文档库、邮件、聊天记录、知识库' },
    { title: '相关性排序', desc: '基于语义相似度与关键词匹配度综合排序' },
    { title: '结果汇总', desc: '去重、摘要生成，按来源分组返回结果' },
  ],
  code: [
    { title: '代码解析', desc: '分析输入代码的语法树和上下文' },
    { title: '意图理解', desc: '识别编码任务类型：编写、审查、重构' },
    { title: '方案生成', desc: '基于最佳实践生成候选方案' },
    { title: '安全检查', desc: '检测潜在安全漏洞和代码质量问题' },
    { title: '输出格式化', desc: '生成标准化代码并附带说明' },
  ],
  data: [
    { title: '数据接入', desc: '连接目标数据源并验证权限' },
    { title: '质量校验', desc: '对数据进行完整性和一致性检查' },
    { title: '标准化处理', desc: '统一字段命名、格式和编码规范' },
    { title: '关系映射', desc: '建立数据实体间的关联关系' },
    { title: '结果输出', desc: '生成治理报告并同步到目标系统' },
  ],
  analysis: [
    { title: '数据加载', desc: '从指定源读取数据集' },
    { title: '预处理', desc: '清洗、转换和特征工程' },
    { title: '模型计算', desc: '执行统计分析或机器学习推理' },
    { title: '结果可视化', desc: '生成图表和摘要报告' },
    { title: '结论输出', desc: '归纳关键发现并给出建议' },
  ],
};

function getSteps(category: string) {
  return MOCK_STEPS[category] || MOCK_STEPS.data;
}

interface BizAgentProps {
  activeView?: string;
  selectedAgentName?: string | null;
  onClearAgent?: () => void;
  selectedSkillId?: string | null;
  onClearSkill?: () => void;
}

export default function BizAgent({ activeView, selectedAgentName, onClearAgent, selectedSkillId, onClearSkill }: BizAgentProps) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const sessionId = useRef('bizagent_main');
  const skillSessionId = useRef(`skill_new_${Date.now()}`);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [selectedSkill, setSelectedSkill] = useState<SkillInfo | null>(null);
  const [skillTab, setSkillTab] = useState<'overview' | 'steps'>('overview');

  const [createMessages, setCreateMessages] = useState<ChatMsg[]>([]);
  const [createLoading, setCreateLoading] = useState(false);

  const isCreateMode = selectedSkillId === '_new';
  const hasSkillDetail = selectedSkillId && !isCreateMode && selectedSkill;

  useEffect(() => {
    if (selectedSkillId && selectedSkillId !== '_new') {
      fetchSkills().then(skills => {
        const found = skills.find(s => s.id === selectedSkillId);
        setSelectedSkill(found || null);
        setSkillTab('overview');
      });
    } else {
      setSelectedSkill(null);
    }
  }, [selectedSkillId]);

  useEffect(() => {
    if (isCreateMode && createMessages.length === 0) {
      const ts = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
      setCreateMessages([
        { id: 'sys1', role: 'system', content: '技能创建模式', timestamp: ts },
        {
          id: 'assist1', role: 'assistant', timestamp: ts,
          content: '你好！我是技能管理助手。\n\n请用自然语言描述你想要创建的技能，例如：\n- 创建一个计算复利的技能\n- 帮我做一个查询天气的技能\n- 我需要一个文本翻译工具\n\n我会自动生成代码并注册到系统中。',
        },
      ]);
      skillSessionId.current = `skill_new_${Date.now()}`;
    }
    if (!isCreateMode) {
      setCreateMessages([]);
    }
  }, [isCreateMode]);

  useEffect(() => {
    if (selectedAgentName) {
      setInput(`@${selectedAgentName} `);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [selectedAgentName]);

  useEffect(() => {
    fetchSessionMessages(sessionId.current).then(history => {
      if (history.length > 0) {
        const restored: ChatMsg[] = history.map(m => ({
          id: m.id,
          role: m.role === 'user' ? 'human' : m.role as ChatMsg['role'],
          content: m.content,
          timestamp: m.timestamp
            ? new Date(m.timestamp * 1000).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
            : '',
        }));
        setMessages(restored);
      }
    });
  }, []);

  function now() {
    return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, createMessages]);

  const handleSend = async () => {
    const msg = input.trim();
    if (!msg || isLoading || createLoading) return;

    if (isCreateMode) {
      setInput('');
      const humanId = Date.now().toString();
      setCreateMessages(prev => [...prev, { id: humanId, role: 'human', content: msg, timestamp: now() }]);
      setCreateLoading(true);
      const assistantId = (Date.now() + 1).toString();
      setCreateMessages(prev => [...prev, { id: assistantId, role: 'assistant', content: '', timestamp: now() }]);
      try {
        await streamSkillChat('_new', msg, skillSessionId.current, (chunk) => {
          if (chunk.content) {
            setCreateMessages(prev => prev.map(m =>
              m.id === assistantId ? { ...m, content: m.content + chunk.content } : m
            ));
          }
        });
      } catch {
        setCreateMessages(prev => prev.map(m =>
          m.id === assistantId ? { ...m, content: '连接后端失败，请确认后端服务已启动。' } : m
        ));
      } finally {
        setCreateLoading(false);
      }
      return;
    }

    const userMsg: ChatMsg = { id: Date.now().toString(), role: 'human', content: msg, timestamp: now() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    const assistantMsgId = `biz_${Date.now()}`;
    setMessages(prev => [...prev, { id: assistantMsgId, role: 'assistant', content: '', timestamp: now() }]);

    try {
      if (hasSkillDetail) {
        await streamSkillChat(selectedSkillId!, msg, skillSessionId.current, (chunk) => {
          if (chunk.content) {
            setMessages(prev => prev.map(m =>
              m.id === assistantMsgId ? { ...m, content: m.content + chunk.content } : m
            ));
          }
        });
      } else {
        await streamAgentChat('global', userMsg.content, sessionId.current, (chunk) => {
          if (chunk.content) {
            setMessages(prev => prev.map(m =>
              m.id === assistantMsgId ? { ...m, content: m.content + chunk.content } : m
            ));
          }
        });
      }
    } catch {
      setMessages(prev => prev.map(m =>
        m.id === assistantMsgId ? { ...m, content: '连接后端失败，请确认后端服务已启动。' } : m
      ));
    } finally {
      setIsLoading(false);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    }
  };

  const hasMessages = messages.length > 0;
  const loading = isLoading || createLoading;

  const getPlaceholder = () => {
    if (loading) return '等待回复中...';
    if (isCreateMode) return '描述你想创建的技能...';
    if (hasSkillDetail) return `输入针对 ${selectedSkill!.name} 的指令...`;
    return '你想让我们聊什么呢?';
  };

  const renderSkillDetail = () => {
    if (!selectedSkill) return null;
    const meta = getSkillMeta(selectedSkill);
    const steps = getSteps(selectedSkill.category);
    const catConfig = CATEGORY_CONFIG[selectedSkill.category] || CATEGORY_CONFIG.api;

    return (
      <div className="flex-1 overflow-y-auto">
        {/* Skill Card Head */}
        <div className="px-4 py-4 flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-bg border border-border rounded-xl flex items-center justify-center text-xl">
              {selectedSkill.icon}
            </div>
            <div className="flex items-center gap-1.5">
              <h4 className="text-sm font-semibold text-text">{selectedSkill.name}</h4>
              <span className="w-2 h-2 rounded-full bg-success" />
            </div>
          </div>
          <span className={`text-[11px] px-2.5 py-1 rounded-full font-medium shrink-0 ${catConfig.color}`}>
            {catConfig.label}
          </span>
        </div>

        {/* Tab Bar */}
        <div className="flex border-b border-border mx-4">
          <button
            onClick={() => setSkillTab('overview')}
            className={`flex-1 py-2 text-sm font-medium text-center border-b-2 transition-colors ${
              skillTab === 'overview'
                ? 'border-primary text-primary-dark'
                : 'border-transparent text-text-secondary hover:text-text'
            }`}
          >
            概览
          </button>
          <button
            onClick={() => setSkillTab('steps')}
            className={`flex-1 py-2 text-sm font-medium text-center border-b-2 transition-colors ${
              skillTab === 'steps'
                ? 'border-primary text-primary-dark'
                : 'border-transparent text-text-secondary hover:text-text'
            }`}
          >
            执行步骤
          </button>
        </div>

        {/* Tab Content */}
        <div className="p-4">
          {skillTab === 'overview' ? (
            <div className="space-y-4">
              <div className="space-y-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-text-muted">来源</span>
                  <span className="text-text font-medium">{meta.source}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-text-muted">作者</span>
                  <span className="text-text font-medium">{meta.author}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-text-muted">版本</span>
                  <span className="text-text font-medium">{meta.version}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-text-muted">适用范围</span>
                  <span className="text-text font-medium">{meta.scope}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-text-muted">状态</span>
                  <span className="text-xs font-medium text-primary">已启用</span>
                </div>
              </div>

              <div className="pt-3 border-t border-border">
                <p className="text-xs text-primary leading-relaxed">{selectedSkill.description}</p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {steps.map((step, idx) => (
                <div key={idx} className="flex gap-3">
                  <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                    <span className="text-xs font-bold text-primary">{idx + 1}</span>
                  </div>
                  <div>
                    <h5 className="text-sm font-semibold text-text">{step.title}</h5>
                    <p className="text-xs text-text-secondary mt-0.5">{step.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderCreateMode = () => {
    return (
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {createMessages.map((msg) => (
          <div key={msg.id} className={`flex gap-2 ${msg.role === 'human' ? 'flex-row-reverse' : ''}`}>
            {msg.role === 'assistant' && (
              <div className="w-6 h-6 rounded-full bg-primary/15 flex items-center justify-center shrink-0 mt-0.5">
                <Sparkles className="w-3 h-3 text-primary" />
              </div>
            )}
            {msg.role === 'system' && (
              <div className="w-6 h-6 rounded-full bg-bg flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-[10px]">🔔</span>
              </div>
            )}
            <div className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
              msg.role === 'human'
                ? 'bg-primary text-white'
                : msg.role === 'system'
                  ? 'bg-bg border border-border text-text-muted'
                  : 'bg-bg border border-border'
            }`}>
              {msg.role === 'assistant' ? (
                <div className="text-text prose prose-sm max-w-none dark:prose-invert">
                  {msg.content === '' ? (
                    <div className="flex items-center gap-1.5 text-text-muted text-xs">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      思考中...
                    </div>
                  ) : (
                    <MarkdownContent content={msg.content} />
                  )}
                </div>
              ) : (
                <span className="whitespace-pre-wrap text-xs">{msg.content}</span>
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col bg-surface border-l border-border">
      {/* Agent Card Header */}
      <div className="px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary/15 rounded-xl flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-text">BizAgent</h3>
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-success" />
              <span className="text-[11px] text-text-muted">自管理运行中</span>
            </div>
          </div>
        </div>
      </div>

      {/* Selected Agent Hint */}
      {selectedAgentName && (
        <div className="px-4 py-2 bg-primary/5 border-b border-border shrink-0 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs">
            <AtSign className="w-3.5 h-3.5 text-primary" />
            <span className="text-text-secondary">已选中</span>
            <span className="font-semibold text-primary">{selectedAgentName}</span>
            <span className="text-text-muted">直接输入指令即可</span>
          </div>
          {onClearAgent && (
            <button onClick={onClearAgent} className="p-0.5 hover:bg-bg rounded transition-colors text-text-muted">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Main Content Area */}
      {hasSkillDetail ? (
        renderSkillDetail()
      ) : isCreateMode ? (
        renderCreateMode()
      ) : (
        <div className="flex-1 overflow-y-auto">
          {!hasMessages ? (
            activeView === 'agent' && !selectedAgentName ? (
              <div className="h-full flex flex-col items-center justify-center px-6 text-center">
                <div className="w-14 h-14 bg-primary/10 rounded-2xl flex items-center justify-center mb-4">
                  <Bot className="w-7 h-7 text-primary" />
                </div>
                <h3 className="text-base font-semibold text-text mb-2">选择数字员工</h3>
                <p className="text-xs text-text-secondary leading-relaxed">
                  点击左侧卡片，即可 @该员工并发送指令
                </p>
              </div>
            ) : activeView === 'skill' && !selectedSkillId ? (
              <div className="h-full flex flex-col items-center justify-center px-6 text-center">
                <div className="w-14 h-14 bg-primary/10 rounded-2xl flex items-center justify-center mb-4">
                  <Wrench className="w-7 h-7 text-primary" />
                </div>
                <h3 className="text-base font-semibold text-text mb-2">选择 Skill</h3>
                <p className="text-xs text-text-secondary leading-relaxed">
                  点击左侧卡片查看详情与执行步骤
                </p>
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center px-6 text-center">
                <div className="w-14 h-14 bg-primary/10 rounded-2xl flex items-center justify-center mb-4">
                  <Sparkles className="w-7 h-7 text-primary" />
                </div>
                <h3 className="text-base font-semibold text-text mb-2">让我们一起高效协作</h3>
                <p className="text-xs text-text-secondary leading-relaxed">
                  你可以问我任何问题——我可以帮你查找 Agent、Skill 或项目
                </p>
              </div>
            )
          ) : (
            <div className="p-3 space-y-3">
              {messages.map((msg) => (
                <div key={msg.id} className={`flex gap-2 ${msg.role === 'human' ? 'flex-row-reverse' : ''}`}>
                  {msg.role === 'assistant' && (
                    <div className="w-6 h-6 rounded-full bg-primary/15 flex items-center justify-center shrink-0 mt-0.5">
                      <Sparkles className="w-3 h-3 text-primary" />
                    </div>
                  )}
                  <div className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
                    msg.role === 'human'
                      ? 'bg-primary text-white'
                      : 'bg-bg border border-border'
                  }`}>
                    {msg.role === 'assistant' ? (
                      <div className="text-text prose prose-sm max-w-none dark:prose-invert">
                        {msg.content === '' ? (
                          <div className="flex items-center gap-1.5 text-text-muted text-xs">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            思考中...
                          </div>
                        ) : (
                          <MarkdownContent content={msg.content} />
                        )}
                      </div>
                    ) : (
                      <span className="whitespace-pre-wrap">{msg.content}</span>
                    )}
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
          )}
        </div>
      )}

      {/* Input */}
      <div className="p-3 border-t border-border shrink-0">
        <div className="flex items-center gap-2 bg-bg border border-border rounded-xl px-3 py-2 focus-within:border-primary transition-colors">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            placeholder={getPlaceholder()}
            disabled={loading}
            className="flex-1 bg-transparent outline-none text-sm text-text disabled:opacity-50"
          />
          <button
            onClick={handleSend}
            disabled={loading || !input.trim()}
            className="p-1.5 bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors shrink-0 disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
