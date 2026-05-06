# CodingSkills 项目管理文档目录

> **创建时间**：2026-05-06
> **最近更新**：2026-05-06（路径与实际文件对齐；F001 升级为跨切面架构 Feature）
> **用途**：存放 CodingSkills 生成的项目管理文档

---

## 📂 目录结构说明（实际状态）

```
docs/
├── README.md                                              ← 本文件
├── FEATURE_LIST.md                                        ← 功能需求清单（CodingSkills 标准文件）
├── KNOWN_ISSUES.md                                        ← 已知问题追踪（CodingSkills 标准文件）
├── features/
│   └── F001_AgentOS大模型驱动的任务执行架构.md             ← F001 详细设计（跨切面架构 Feature）
├── designs/                                               ← 技术设计文档目录（手动创建，当前为空）
└── analysis/
    └── DRIFT_REPORT_2026-05-06.md                         ← AgentOS 任务执行架构漂移分析
```

**说明**：
- `CHANGELOG.md` 当前位于项目根目录（[`../CHANGELOG.md`](../CHANGELOG.md)），未放在 docs/ 内
- AgentOS 全量产品基线（32 个 Feature）位于 [`../feature/AgentOS_FEATURE_LIST_v0.1.0.md`](../feature/AgentOS_FEATURE_LIST_v0.1.0.md)，当前未纳入 docs/，docs/F001 中以引用方式指向

---

## 📋 CodingSkills 标准文件

### FEATURE_LIST.md
- **用途**：记录功能需求，防止开发漂移
- **生成方式**：`/add-feature "功能描述"`
- **更新方式**：`/start-next-feature`、`/complete-feature`
- **位置**：固定在 `docs/FEATURE_LIST.md`

### KNOWN_ISSUES.md
- **用途**：记录已知问题，系统化修复过程
- **生成方式**：`/add-issue "问题描述"`
- **更新方式**：`/resolve-next-issue`
- **位置**：CodingSkills 会自动检测，优先 `docs/KNOWN_ISSUES.md`

### CHANGELOG.md
- **用途**：记录版本变更历史
- **生成方式**：`/smart-changelog`
- **位置**：通常放在项目根目录，也可以放在 `docs/`

---

## 🗂️ 子目录说明

### features/ 目录
- **用途**：存放每个功能的详细设计文档
- **生成方式**：`/add-feature` 自动生成
- **命名规则**：`F001_功能名称.md`
- **当前内容**：[`F001_AgentOS大模型驱动的任务执行架构.md`](features/F001_AgentOS大模型驱动的任务执行架构.md)（跨切面架构 Feature）

### designs/ 目录
- **用途**：存放技术设计文档、架构文档
- **创建方式**：手动创建或 AI 辅助生成
- **命名规则**：自由命名，如 `architecture.md`、`api_design.md`

### analysis/ 目录
- **用途**：存放临时分析报告、调研文档
- **创建方式**：手动创建
- **命名规则**：建议带时间戳，如 `DRIFT_REPORT_2026-05-06.md`
- **当前内容**：[`DRIFT_REPORT_2026-05-06.md`](analysis/DRIFT_REPORT_2026-05-06.md) — AgentOS 任务执行架构漂移分析

---

## 🚀 使用 CodingSkills 时会自动生成以下文件：

1. **功能需求时**：
   - 更新 `docs/FEATURE_LIST.md`
   - 创建 `docs/features/F001_功能名称.md`

2. **问题追踪时**：
   - 更新 `docs/KNOWN_ISSUES.md`

3. **版本发布时**：
   - 更新 `CHANGELOG.md`（根目录）
   - 更新 `VERSION`（根目录）

4. **归档时**：
   - 创建 `docs/FEATURES_ARCHIVED.md`
   - 创建 `docs/ISSUES_ARCHIVED.md`

---

## 💡 建议的文件管理习惯

### 需求锁定（防止漂移）
```bash
# 1. 新功能需求
/add-feature "功能描述"

# 2. 审核生成的 docs/FEATURE_LIST.md 和 docs/features/F001_XXX.md

# 3. 开始开发
/start-next-feature
```

### 漂移检测（完成后）
```bash
# 1. 完成功能开发
/complete-feature

# 2. 对比 docs/FEATURE_LIST.md 与实际实现

# 3. 发现偏差时
/add-issue "问题描述"
```

### 系统化修复
```bash
# 1. 查看问题列表（自动激活）
"列出所有 issues"

# 2. 修复问题
/resolve-next-issue
```

---

## 📖 文档命名规范

### CodingSkills 标准文件
- **固定命名**：FEATURE_LIST.md、KNOWN_ISSUES.md、CHANGELOG.md
- **不要修改文件名**，否则 CodingSkills 无法自动检测

### 自定义文档
- 功能设计：`F001_功能名称.md`（遵循 CodingSkills 规范）
- 技术设计：自由命名，建议使用英文和下划线
- 分析报告：建议带时间戳，方便追溯

---

## 🎯 下一步

1. **当前架构漂移**：
   - 查看 [`analysis/DRIFT_REPORT_2026-05-06.md`](analysis/DRIFT_REPORT_2026-05-06.md) 了解 AgentOS 任务执行架构层漂移详情（共 8 处硬编码症状）
   - 查看 [`KNOWN_ISSUES.md`](KNOWN_ISSUES.md) 了解需要修复的 8 个 Issue
   - 查看 [`features/F001_AgentOS大模型驱动的任务执行架构.md`](features/F001_AgentOS大模型驱动的任务执行架构.md) 了解跨切面架构原则

2. **开始修复（建议顺序）**：
   ```bash
   # 第 1 波：路由层（005 + 006 必须一起改）
   /resolve-next-issue 005

   # 第 2 波：Skill 生成层（001 + 008）
   # 第 3 波：规则学习层（002 + 004）
   # 第 4 波：自适应抽取（003）
   # 第 5 波：意图集合扩展（007）
   ```

3. **持续管理**：
   - 所有新功能必须先 `/add-feature`
   - 所有问题必须先 `/add-issue`
   - 定期审核 [`FEATURE_LIST.md`](FEATURE_LIST.md) 和 [`KNOWN_ISSUES.md`](KNOWN_ISSUES.md)
   - AgentOS 全量产品基线（32 个 Feature）位于 [`../feature/AgentOS_FEATURE_LIST_v0.1.0.md`](../feature/AgentOS_FEATURE_LIST_v0.1.0.md)，是 docs/F001 影响范围分析的参考

---

**重要提示**：CodingSkills 会自动检测 `docs/` 目录下的标准文件，无需额外配置！