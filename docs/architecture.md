# Codex to Figma 架构总览

## 1. 项目定位

这个仓库是一套围绕 **Figma 设计信息**、**React 实现验证** 和 **Codex / Claude 对 Figma 的可控写操作** 的联调方案。它不是业务系统，而是一个把设计事实、实现约束、AI 契约、插件执行能力和本地 bridge 放进同一仓库的工作平台。

## 2. 当前架构结论

当前仓库采用 **双系统、共享模型** 的结构：

- **Workspace System**
  - 技术形态：Vite + React + 本地 Node API
  - 职责：承载 Figma-to-React 上下文整理、组件映射、Runtime Context Pack 与本地 action 测试
- **Plugin System**
  - 技术形态：独立 Figma Plugin
  - 职责：承载 Codex-to-Figma 的执行操作，例如 selection、preview、fill、style、variable 与 binding
- **Bridge Runtime**
  - 技术形态：本地 HTTP API + JSON 队列
  - 职责：维护插件会话、命令队列、结果回传与能力声明
- **Shared Model**
  - 技术形态：共享 TypeScript 领域模型与 JSON 命令协议
  - 职责：保证两个系统对“设计源、组件映射、AI 输入输出、插件命令、capability registry”使用同一份结构化定义

这样做的核心目的是：**共享上下文，不共享运行时。**

## 3. 为什么必须拆成两个系统

如果把工作台和 Figma 插件做成一个统一运行时，会立刻出现三个问题：

1. React 工作台的状态和 Figma 文件写操作会互相污染，难以判断错误来自设计执行还是来自实现验证。
2. 插件需要面对 Figma API 的节点边界、样式和变量写权限，而工作台需要面对项目数据、AI 契约和代码映射，这两类职责天然不同。
3. 后续无论接 MCP、接代码生成还是接自动命令桥，都需要一条清楚的协议边界，否则难以追溯“谁生成了命令，谁执行了命令，谁维护了设计事实”。

当前要特别明确的一点是：

- **仓库当前主执行链路是 Figma Plugin API + 本地 bridge**
- **不是 MCP 直接改 Figma**

因此，仓库当前只允许共享：

- 领域类型
- JSON 命令协议
- 本地项目数据模型

不允许共享：

- 隐式内存状态
- 直接跨运行时调用 UI 内部状态
- 把插件当成工作台子页面来实现

## 4. 核心分层

### 4.1 Design Source

设计输入层，来源于 Figma 中已经确认的：

- 组件命名
- 变体与状态
- 布局关系
- 设计备注与交互说明

它回答“设计是什么”。

### 4.2 Mapping Rules

映射规则层，把设计信息翻译为实现约束：

- 组件与页面命名规范
- Props、状态与交互事件的映射
- token 与布局规则
- 可复用模式与例外说明

它回答“设计如何进入代码”。

### 4.3 Workspace Runtime

工作台运行时负责：

- 展示设计源、组件映射和评审项
- 维护本地 JSON 项目数据
- 构造 `Context Pack`
- 运行本地 Runtime action
- 为 Figma-to-React 链路提供稳定输入

当前实现形态：

- `src/` 中的 Vite + React 前端
- `server/` 中的本地 Node API
- `data/figmatest-project.json` 作为持久化层

### 4.4 Plugin Runtime

插件运行时负责：

- 读取当前 selection
- 导出节点预览
- 通过 Figma Plugin API 执行结构化 capability 命令
- 通过本地桥接服务注册会话、领取命令并回传结果

当前实现形态：

- `plugins/codex-to-figma/src/main.ts`
- `plugins/codex-to-figma/src/runtime/`
- `plugins/codex-to-figma/src/ui.html`
- `plugins/codex-to-figma/dist/manifest.json`

### 4.5 AI Runtime Contracts

AI 契约层定义：

- `Context Pack` 输入字段
- Runtime action 的职责边界
- JSON 输出格式
- 失败与提问策略

它回答“AI 在联调里可以做什么，不能做什么”。

### 4.6 Plugin Command Contracts

插件命令契约层定义：

- 哪些 capability 允许写入 Figma
- capability payload 的结构
- 命令 envelope 如何批量执行
- 结果如何结构化回传与审阅

它回答“Codex 产出的命令如何安全、可审计地进入 Figma”。

### 4.7 Local Bridge Runtime

本地桥接层负责：

- 维护在线插件会话
- 记录每个插件上报的文件、页面与 selection
- 接收工作台下发的命令批次
- 把命令分配给目标插件
- 记录领取、成功、失败和结果摘要

当前实现形态：

- `server/plugin-bridge-store.ts`
- `shared/plugin-bridge.ts`
- `shared/plugin-capabilities.ts`
- `server/index.ts` 中的 `/api/plugin-bridge/*` 路由

## 5. 当前目录布局

```text
.
├─ src/            # Vite + React workspace
├─ server/         # local Node API
├─ shared/         # shared types and contracts
├─ plugins/        # packaged Figma executors
├─ data/           # local JSON project storage
└─ docs/           # architecture, ADR, runtime contracts
```

## 6. 关键设计原则

### 6.1 设计真相优先于实现猜测

没有从 Figma 或评审记录中确认的信息，不要默认落地为实现事实。

### 6.2 命令可审计

任何写回 Figma 的操作都必须能表示成结构化命令，而不是隐藏在临时 UI 行为里。

### 6.3 共享协议，不共享状态

工作台和插件可以共享类型与命令格式，但不能依赖对方的内存状态。

### 6.4 自动桥接也必须显式建模

即使已经打通工作台到插件的桥接，命令仍然必须经过结构化队列、目标会话和结果回传，不能退回成隐式直连。

### 6.5 MCP 是补充链路，不是当前主链

如果未来接入 MCP，应视为：

- 设计读取或外部上下文补充链路
- 或者未来的另一个 adapter

不能把它写成当前仓库已经替代 Plugin API 的事实。

## 7. 当前风险点

- 本地 JSON 持久化适合 MVP，但未来切数据库时需要额外抽象
- 插件当前覆盖的是颜色相关写操作，尚未覆盖更复杂的组件属性或文本样式
- Figma-to-React 目前仍以上下文整理和映射验证为主，不等于完整代码生成系统
