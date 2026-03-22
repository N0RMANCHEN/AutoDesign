# AutoDesign Architecture

## 1. 项目定位

`AutoDesign` 是一个围绕 **Figma 设计信息**、**React 实现验证** 和 **AI 对 Figma 的可控写操作** 的联调工作仓库。

它不是：

- 成品 SaaS
- 通用型 Figma 插件市场产品
- 一键生成完整前端的黑盒系统

它当前的核心价值是：

- 用本地插件让 Codex / Claude 直接操作 Figma
- 用工作台把 Figma 设计事实整理成 React 改造输入
- 用共享协议把这两条链路稳定连接起来

## 2. 当前架构结论

当前仓库采用 **双系统、共享模型**：

- **Workspace System**
  - 技术形态：Vite + React + 本地 Node API
  - 职责：Figma-to-React 上下文整理、组件映射、Runtime Context Pack、本地 action 测试
- **Plugin System**
  - 技术形态：独立 Figma Plugin
  - 职责：selection、preview、fill、style、variable 等写操作
- **Bridge Runtime**
  - 技术形态：本地 HTTP API + JSON 队列
  - 职责：插件会话、命令队列、结果回传
- **Shared Model**
  - 技术形态：共享 TypeScript 类型与 JSON 协议
  - 职责：统一能力定义、命令结构与桥接数据

核心原则：

- 共享协议
- 不共享运行时

## 3. 当前主执行链

当前仓库真正写回 Figma 的主链是：

- **Figma Plugin API**
- **本地 bridge**

不是 MCP 直接执行写操作。

因此当前事实必须保持一致：

- 插件负责改 Figma
- 工作台负责整理上下文
- bridge 负责传输

## 4. 核心分层

### 4.1 Design Source

来源于 Figma 和人工评审结论的设计事实：

- 组件命名
- 变体与状态
- 布局关系
- 设计备注

### 4.2 Mapping Rules

把设计信息翻译为实现约束：

- 组件映射
- props / state / event 约束
- token 与布局规则

### 4.3 Workspace Runtime

负责：

- 设计源展示
- component mapping
- review queue
- Runtime Context Pack

当前实现：

- `src/`
- `server/`
- `data/autodesign-project.json`

### 4.4 Plugin Runtime

负责：

- 读取 selection
- 导出 preview
- 执行 capability 命令
- 注册 bridge session

当前实现：

- `plugins/autodesign/src/main.ts`
- `plugins/autodesign/src/runtime/`
- `plugins/autodesign/src/ui.html`

### 4.5 Command Contracts

插件能力和命令体系的正式总表统一收口在：

- [Capability-Catalog.md](/Users/hirohi/AutoDesign/doc/Capability-Catalog.md)

### 4.6 AI Runtime Contracts

AI 的 Prompt、action 文档和 JSON 契约统一收口在：

- `doc/ai/`

## 5. 当前目录布局

```text
.
├─ src/            # Vite + React workspace
├─ server/         # local Node API
├─ shared/         # shared types and contracts
├─ plugins/        # packaged Figma executors
├─ data/           # local JSON project storage
└─ doc/            # documentation, roadmap, governance, AI contracts
```

## 6. 当前风险点

- 本地 JSON 持久化适合当前阶段，但未来切数据库需要额外抽象
- 插件当前覆盖的是高频视觉写操作，尚未覆盖文本、Auto Layout、组件与实例
- Figma-to-React 目前仍以上下文整理和映射验证为主，不等于完整代码生成系统

