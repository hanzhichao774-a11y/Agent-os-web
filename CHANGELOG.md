# Changelog

本项目所有重要变更记录。

---

## [2026-04-27] LLM 模型配置管理 + 连通性预检

### 新增
- **前端模型配置弹窗**（`SettingsModal`）：支持切换服务提供商（Kimi / MiniMax / OpenAI / 自定义），配置 Model ID、API Key、Base URL，带连通测试和保存功能
- **Sidebar 入口**：底部新增「模型配置」按钮（齿轮图标）
- **后端配置接口**：`GET/PUT /api/settings/llm` 配置读写，`POST /api/settings/llm/test` 连通测试
- **持久化配置**：`settings` 表存储 LLM 配置，优先级 DB > `.env`
- **自定义提供商**（`custom`）：支持千问等 OpenAI 兼容的私有化部署服务
- **部署预检脚本**（`preflight_check.py`）：可批量验证多模型连通性（SDK 直连 + Agno Agent 全链路）
- **后端开发规则**（`.cursor/rules/backend.mdc`）：记录虚拟环境、启动命令等约定

### 修复
- **角色映射兼容**：修复 Agno 2.5.17 默认将 `system` 角色映射为 `developer`，导致 Kimi / MiniMax / 千问等非 OpenAI 服务返回 `tokenization failed` 的问题；通过 `_COMPAT_ROLE_MAP` 为非 OpenAI 提供商自动使用标准角色映射
- **脱敏 Key 回退**：修复连通测试使用前端传来的脱敏 API Key（`sk-b14...1vrX`）导致认证失败的问题，增加 DB → `.env` 多级回退查找真实密钥
- **错误检测增强**：修复连通测试对 LLM 返回的错误响应误报「连接成功」的问题，扩展错误关键词匹配范围

### 重构
- **统一模型工厂**：`create_model()` 合并为单一 `OpenAIChat` 入口，通过 `_PROVIDER_EXTRA_KWARGS` 配置映射注入各提供商的特殊参数（`role_map`、`extra_body` 等），消除 `if/elif` 硬编码分支
- **移除 Anthropic**：移除 Claude 相关代码，仅保留 OpenAI 兼容模型

### 文档
- `README.md` 更新技术栈说明，新增自定义提供商配置指南和 API 接口文档

---

## [2026-04-23] 对齐 Demo 配色与图谱 + 产出文件卡片 + 任务创建弹窗

### 新增
- 产出文件卡片组件
- 任务创建弹窗
- Demo 配色方案对齐与图谱可视化优化

---

## [2026-04-23] 项目子任务体系 + UI 全面改版

### 新增
- 项目子任务管理体系
- UI 全面改版，优化布局和交互体验

---

## [2026-04-22] 深夜模式一键切换

### 新增
- 深夜模式（Dark Mode）一键切换
- 科技风深蓝黑配色方案

---

## [2026-04-22] Team 多轮对话记忆 + 路由指令优化

### 优化
- Team 多轮对话记忆保持
- 路由指令优化，提升 Agent 调度准确性

---

## [2026-04-21] 全面升级知识检索 + Team Route 模式 + Kimi k2.6 集成

### 新增
- 知识库检索全面升级
- Team Route 模式（多 Agent 路由协作）
- Kimi k2.6 模型集成

---

## [2026-04-21] 全局助手优化

### 优化
- 去除 mock 数据，接入真实资源查询
- 可拖拽布局

---

## [2026-04-21] 技能对话式管理

### 新增
- 自然语言管理技能全流程（创建、编辑、删除、查询）

---

## [2026-04-21] Team 多 Agent 协作

### 新增
- Team 多 Agent 协作框架
- 工具集成
- Markdown 渲染与全面优化

---

## [2026-04-20] MVP 初始版本

### 新增
- Agent OS Web MVP，双闭环核心功能
- 项目 README 及 API 文档
