# AutoDesign Architecture & Folder Governance

> 作用：定义 `AutoDesign` 的架构边界、目录职责、文档放置规则与治理门禁。  
> 定位：长期治理标准，不替代 `doc/Roadmap.md` 的执行排期。

## 1. 规则优先级

冲突时按以下优先级执行：

1. `AGENT.md`
2. 本文档
3. `doc/Roadmap.md`
4. `doc/plans/*`
5. 其他说明性文档

说明：

- `Roadmap` 回答“当前做什么”
- 本文档回答“仓库怎么组织才合规”

## 2. 系统边界

### 2.1 Workspace System

- 目录：`src/`、`server/`
- 作用：承载 Figma to React 的上下文整理、设计映射、Runtime Context Pack、本地运行时验证
- 禁止：直接写 Figma 文件

### 2.2 Plugin System

- 目录：`plugins/autodesign/`
- 作用：承载 AutoDesign 插件、selection 读取、preview 导出、Figma 写操作执行
- 禁止：承担工作台业务逻辑或评审页面职责

### 2.3 Bridge System

- 目录：`server/index.ts`、`server/plugin-bridge-store.ts`
- 作用：会话注册、命令队列、结果回传、基础审计
- 禁止：直接持有 Figma 节点运行时对象

### 2.4 Shared System

- 目录：`shared/`
- 作用：共享类型、命令协议、capability registry
- 禁止：共享隐式运行时状态

## 3. 目录职责

### 3.1 根目录

根目录只保留高优先级入口文件：

- `README.md`
- `AGENT.md`
- `contributing_ai.md`
- `CHANGELOG.md`

### 3.2 `doc/`

`doc/` 是唯一正式文档目录。

根 `README.md` 负责项目总览和文档总入口，因此 `doc/` 不再额外保留总索引页。

固定分层：

- `doc/Roadmap.md`
  当前执行真相
- `doc/Architecture-Folder-Governance.md`
  目录与治理标准
- `doc/Architecture.md`
  当前架构说明
- `doc/Capability-Catalog.md`
  插件能力与命令总表
- `doc/Project-Map.md`
  仓库导航
- `doc/ai/`
  AI 契约与 Prompt
- `doc/plans/`
  计划文档

### 3.3 `doc/plans/`

`doc/plans/` 只允许放：

- 计划范围
- 依赖链
- 入口 / 出口条件
- 风险与回滚

不允许放：

- 当前执行状态快照
- 已完成任务的长篇记录
- 与当前仓库无关的 research 笔记

### 3.4 `doc/ai/`

`doc/ai/` 只放：

- Runtime Prompt
- action 文档
- JSON 契约

这里的内容视为接口草案，不是随笔。

## 4. 文档治理规则

### 4.1 单一事实来源

- 插件能力总表：`doc/Capability-Catalog.md`
- 当前执行真相：`doc/Roadmap.md`
- 架构边界：`doc/Architecture-Folder-Governance.md`

同一类事实不能在多个 Markdown 里并行维护。

### 4.2 删除优先于并存

如果一个旧文档已经被新文档覆盖，优先删除旧文档，而不是继续并存。

### 4.3 Roadmap 与 Plan 分工

- `Roadmap`：当前在做什么
- `plans/`：这件事具体打算怎么做

禁止把这两者混写。

### 4.4 文档命名

文档名直接表达作用，不使用模糊标题。

推荐：

- `Roadmap.md`
- `Capability-Catalog.md`
- `Architecture-Folder-Governance.md`

不推荐：

- `notes.md`
- `misc.md`
- `draft2.md`

## 5. 当前不再保留的文档类型

以下类型默认视为噪音，除非有明确长期治理价值：

- 已被 `Roadmap` 覆盖的 checklist
- 已被治理文档覆盖的 code quality 单独说明
- 只记录一次性命名迁移的 ADR
- 与现状无关的历史残留说明

## 6. 新增文档的门禁

以后新增 Markdown 前，先判断：

1. 这是不是现有文档已经覆盖的内容
2. 它属于 `Roadmap`、`plans`、`ai`、还是正式治理文档
3. 它是否会成为长期入口，而不是一次性记录

如果回答不清楚，就不应新建文档。
