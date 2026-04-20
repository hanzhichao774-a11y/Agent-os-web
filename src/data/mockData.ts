export interface Project {
  id: string;
  name: string;
  description: string;
  updatedAt: string;
  memberCount: number;
  unread: boolean;
  status: 'active' | 'idle' | 'completed';
}

export interface Agent {
  id: string;
  name: string;
  avatar: string;
  type: 'official' | 'third-party' | 'custom';
  description: string;
  status: 'online' | 'busy' | 'offline';
  calls: number;
  capabilities: string[];
}

export interface Skill {
  id: string;
  name: string;
  icon: string;
  category: 'search' | 'code' | 'data' | 'analysis' | 'api';
  description: string;
  provider: string;
  enabled: boolean;
  configFields: string[];
}

export interface ChatMessage {
  id: string;
  role: 'system' | 'host' | 'agent' | 'skill' | 'human';
  senderId: string;
  senderName: string;
  content: string;
  timestamp: string;
  mentions?: string[];
  status?: 'sending' | 'sent' | 'error';
  metadata?: {
    plan?: string[];
    result?: string;
    toolCall?: { name: string; input: string };
  };
}

export const projects: Project[] = [
  { id: 'p1', name: 'Q3 财报分析', description: '季度财务数据汇总与可视化', updatedAt: '10分钟前', memberCount: 4, unread: true, status: 'active' },
  { id: 'p2', name: '供应链优化', description: '物流路径与库存优化方案', updatedAt: '2小时前', memberCount: 3, unread: false, status: 'active' },
  { id: 'p3', name: '客户流失预警', description: '高价值客户流失风险评估', updatedAt: '昨天', memberCount: 5, unread: false, status: 'idle' },
  { id: 'p4', name: '新品市场调研', description: '东南亚市场竞品分析', updatedAt: '3天前', memberCount: 3, unread: false, status: 'completed' },
  { id: 'p5', name: '自动化报表重构', description: '日报周报生成流程改造', updatedAt: '1周前', memberCount: 2, unread: false, status: 'idle' },
];

export const agents: Agent[] = [
  { id: 'a1', name: '数据分析Agent', avatar: '📊', type: 'official', description: '擅长SQL查询、数据清洗、统计建模', status: 'online', calls: 1240, capabilities: ['SQL', 'Python', '可视化'] },
  { id: 'a2', name: '知识检索Agent', avatar: '🔍', type: 'official', description: '企业内部知识库问答与检索', status: 'online', calls: 892, capabilities: ['RAG', '文档解析', '语义搜索'] },
  { id: 'a3', name: '代码助手Agent', avatar: '💻', type: 'official', description: '代码生成、审查、重构与调试', status: 'busy', calls: 2103, capabilities: ['Code Review', 'Unit Test', 'Refactor'] },
  { id: 'a4', name: '合同审查Agent', avatar: '📄', type: 'third-party', description: '法律条款风险识别与比对', status: 'online', calls: 456, capabilities: ['NLP', '合规检查', 'OCR'] },
  { id: 'a5', name: '舆情监控Agent', avatar: '📡', type: 'third-party', description: '全网品牌舆情实时抓取与分析', status: 'offline', calls: 321, capabilities: ['爬虫', '情感分析', '告警'] },
  { id: 'a6', name: '私有数据治理Agent', avatar: '🛡️', type: 'custom', description: '企业自定义数据质量治理流程', status: 'online', calls: 128, capabilities: ['数据质量', '规则引擎', 'ETL'] },
];

export const skills: Skill[] = [
  { id: 's1', name: 'SQL执行器', icon: '🗄️', category: 'data', description: '连接企业数据仓库执行SQL查询', provider: '系统内置', enabled: true, configFields: ['数据源', '超时时间'] },
  { id: 's2', name: 'Python沙箱', icon: '🐍', category: 'code', description: '安全执行Python代码进行数据分析', provider: '系统内置', enabled: true, configFields: ['内存限制', '包白名单'] },
  { id: 's3', name: '企业搜索', icon: '🔎', category: 'search', description: '跨系统文档、邮件、聊天记录搜索', provider: '系统内置', enabled: true, configFields: ['索引范围', '权限过滤'] },
  { id: 's4', name: '图表生成', icon: '📈', category: 'analysis', description: '基于数据自动生成多种类型图表', provider: '系统内置', enabled: true, configFields: ['默认主题', '导出格式'] },
  { id: 's5', name: '飞书通知', icon: '📢', category: 'api', description: '向飞书群组或个人发送消息通知', provider: '第三方', enabled: true, configFields: ['Webhook', '签名密钥'] },
  { id: 's6', name: 'Jira操作', icon: '📋', category: 'api', description: '创建、查询、更新Jira工单', provider: '第三方', enabled: false, configFields: ['Base URL', 'API Token'] },
  { id: 's7', name: '邮件发送', icon: '✉️', category: 'api', description: '通过企业邮箱发送格式化邮件', provider: '系统内置', enabled: true, configFields: ['SMTP服务器', '发件人'] },
  { id: 's8', name: 'PDF解析', icon: '📑', category: 'analysis', description: '提取PDF中的表格、文本和结构化数据', provider: '第三方', enabled: true, configFields: ['OCR引擎', '语言'] },
];

export const chatMessages: ChatMessage[] = [
  {
    id: 'm1',
    role: 'system',
    senderId: 'system',
    senderName: '系统',
    content: '群主 Agent "项目管家" 已创建任务：Q3 财报分析',
    timestamp: '10:02',
  },
  {
    id: 'm2',
    role: 'human',
    senderId: 'u1',
    senderName: 'samhar',
    content: '请帮我分析本季度各业务线的营收对比，我已经上传了 sales_q3.xlsx',
    timestamp: '10:03',
  },
  {
    id: 'm3',
    role: 'host',
    senderId: 'host1',
    senderName: '项目管家',
    content: '收到。我来分解这个任务：\n1. 提取 sales_q3.xlsx 中的关键指标\n2. 按业务线汇总对比\n3. 生成可视化图表\n\n@数据分析Agent 请先提取数据并计算各业务线营收',
    timestamp: '10:03',
    mentions: ['数据分析Agent'],
    metadata: {
      plan: ['提取 sales_q3.xlsx 关键指标', '按业务线汇总对比', '生成可视化图表'],
    },
  },
  {
    id: 'm4',
    role: 'agent',
    senderId: 'a1',
    senderName: '数据分析Agent',
    content: '正在执行数据提取...',
    timestamp: '10:04',
    status: 'sending',
    metadata: {
      toolCall: { name: 'SQL执行器', input: 'SELECT * FROM sales_q3' },
    },
  },
  {
    id: 'm5',
    role: 'agent',
    senderId: 'a1',
    senderName: '数据分析Agent',
    content: '数据提取完成。Q3 各业务线营收（万元）：\n• 云服务：3,240（+18%）\n• 企业服务：2,890（+12%）\n• 消费者业务：1,560（-5%）\n• 海外市场：980（+34%）',
    timestamp: '10:05',
    status: 'sent',
  },
  {
    id: 'm6',
    role: 'host',
    senderId: 'host1',
    senderName: '项目管家',
    content: '@图表生成 请基于以上数据生成柱状图和趋势图',
    timestamp: '10:05',
    mentions: ['图表生成'],
  },
  {
    id: 'm7',
    role: 'skill',
    senderId: 's4',
    senderName: '图表生成',
    content: '[图表渲染结果]\n已生成柱状图：各业务线 Q3 营收对比\n已生成折线图：Q1-Q3 营收趋势',
    timestamp: '10:06',
    metadata: {
      result: 'chart-rendered',
    },
  },
  {
    id: 'm8',
    role: 'host',
    senderId: 'host1',
    senderName: '项目管家',
    content: '分析完成。@samhar 请查看右侧的数据面板，我已为你整理好关键结论：\n\n1. 云服务和企业服务是增长双引擎\n2. 消费者业务下滑 5%，需要关注\n3. 海外市场增速最高（34%），但基数较小\n\n如需下钻分析某个业务线，请告诉我。',
    timestamp: '10:06',
    mentions: ['samhar'],
  },
];

export const taskFlow = [
  { step: 1, name: '计划', agent: '项目管家', status: 'completed', time: '10:03' },
  { step: 2, name: '数据提取', agent: '数据分析Agent', status: 'completed', time: '10:05' },
  { step: 3, name: '图表生成', agent: '图表生成', status: 'completed', time: '10:06' },
  { step: 4, name: '审查确认', agent: '项目管家', status: 'in-progress', time: '10:06' },
  { step: 5, name: '任务完成', agent: '-', status: 'pending', time: '-' },
];

export const activeAgents = [
  { id: 'host1', name: '项目管家', role: 'host', status: 'running', currentTask: '审查确认' },
  { id: 'a1', name: '数据分析Agent', role: 'agent', status: 'idle', currentTask: '等待调度' },
  { id: 's4', name: '图表生成', role: 'skill', status: 'idle', currentTask: '等待调度' },
];

export const auditLogs = [
  { time: '10:06:23', event: '项目管家 @提及 samhar', type: 'mention' },
  { time: '10:06:01', event: '图表生成 Skill 返回结果', type: 'skill' },
  { time: '10:05:58', event: '项目管家 调用 图表生成', type: 'tool_call' },
  { time: '10:05:12', event: '数据分析Agent 完成数据提取', type: 'agent' },
  { time: '10:04:05', event: '项目管家 调用 数据分析Agent', type: 'tool_call' },
  { time: '10:03:45', event: '项目管家 创建执行计划（3步）', type: 'plan' },
  { time: '10:03:12', event: 'samhar 上传文件 sales_q3.xlsx', type: 'file' },
];
