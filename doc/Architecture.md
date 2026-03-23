# AutoDesign Architecture

## 1. 项目定位

`AutoDesign` 是一个围绕设计事实、前端实现验证和 AI 可控写 Figma 的联调仓库。

它当前不承担：

- 成品 SaaS 的多用户和后端业务系统
- 通用型插件市场产品
- 一键生成生产级前端的黑盒流水线

## 2. 当前架构结论

仓库当前采用“双执行面、共享协议”的架构：

- Workspace System
  - 形态：Vite + React + 本地 Node API
  - 职责：设计信息整理、component mapping、review queue、Runtime Context Pack、局部前端改造支持
- Plugin System
  - 形态：独立 Figma Plugin
  - 职责：selection、preview、capability 命令执行、Figma 写回
- Bridge Runtime
  - 形态：本地 HTTP API + 插件会话队列
  - 职责：插件会话、命令编排、结果回传、reconstruction job orchestration
- Shared Model
  - 形态：共享 TypeScript 类型和 JSON contract
  - 职责：统一能力定义、命令结构、bridge 数据模型、reconstruction 类型

核心原则：

- 共享协议
- 不共享运行时
- 工作台不直接写 Figma
- 插件不承载工作台业务逻辑

## 3. 当前主执行链

### 3.1 AI -> Figma

正式写回链路是：

1. CLI / bridge 发结构化命令
2. 本地 bridge 把命令投递给在线插件会话
3. 插件 runtime 执行 capability
4. 结构化结果回传 bridge

这条链路的事实是：

- Figma 写操作以 Plugin API 为准
- MCP 可以辅助读取，但不是当前仓库的正式写回主链

### 3.2 Figma -> AI -> React

当前主链仍是“上下文整理 + 受控改造”：

1. 从 Figma 提取设计事实
2. 在工作台中映射 screen / component / runtime context
3. 给 AI 生成更稳定的实现上下文
4. 对 React / 前端代码做局部调整

## 4. 当前结构风险

仓库当前仍有这些架构风险，需要持续收敛：

- `Roadmap`、能力目录、架构说明曾经相互混写，容易让事实漂移
- reconstruction workflow 还在快速演化，server、plugin、CLI 三端约束需要持续收紧
- 工作台、bridge、plugin 的职责边界虽然已经定义，但实现上仍需要补更多门禁和测试
- 以本地 JSON 持久化为主的当前阶段适合验证，但不等于长期形态

## 5. 当前演进约束

后续架构整改必须遵守：

- capability 变化先改 [Capability-Catalog.md](/Users/BofeiChen/AutoDesign/doc/Capability-Catalog.md)
- 目录和职责变化先改 [Architecture-Folder-Governance.md](/Users/BofeiChen/AutoDesign/doc/Architecture-Folder-Governance.md)
- 产品行为变化先改 [Product-Standards.md](/Users/BofeiChen/AutoDesign/doc/Product-Standards.md)
- 测试门槛变化先改 [Test-Standards.md](/Users/BofeiChen/AutoDesign/doc/Test-Standards.md)
- 活跃事项只在 [Roadmap.md](/Users/BofeiChen/AutoDesign/doc/Roadmap.md)

## 6. 当前目录布局

```text
.
├─ src/            # Vite + React workspace
├─ server/         # local Node API + bridge + reconstruction orchestration
├─ shared/         # shared contracts and types
├─ plugins/        # Figma executors
├─ scripts/        # CLI and local tooling
├─ data/           # local JSON storage and previews
├─ doc/            # governance, architecture, standards, roadmap, plans
└─ reports/        # acceptance, quality, incidents, archive
```
