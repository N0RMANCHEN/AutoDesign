# AutoDesign Project Map

这份文档帮助你快速理解仓库结构、阅读路径和两条核心工作流从哪里开始。

## 一句话先记住

这个仓库不是单一前端应用，也不是单一插件 demo，而是一个单仓工作流：

- `Plugin System`
  让 AI 可以读取和修改 Figma
- `Workspace System`
  让 Figma 设计事实转成更稳定的前端改造输入
- `Bridge + Shared`
  把命令、上下文和能力协议串起来

## 当前仓库结构

```text
.
├─ AGENT.md
├─ README.md
├─ contributing_ai.md
├─ CHANGELOG.md
├─ doc/
├─ reports/
├─ plugins/
├─ scripts/
├─ server/
├─ shared/
└─ src/
```

## 各目录负责什么

- `src/`
  Vite + React 工作台
- `server/`
  本地 Node API、bridge、reconstruction orchestration
- `shared/`
  capability registry、命令协议、共享类型
- `plugins/autodesign/`
  正式 Figma 插件执行器
- `plugins/autodesign-smoke/`
  插件导入 smoke 验证
- `doc/`
  治理、标准、架构、路线图、计划
- `reports/`
  验收、质量、事故和归档证据

## 最短阅读路径

1. [README.md](/Users/BofeiChen/AutoDesign/README.md)
2. [AGENT.md](/Users/BofeiChen/AutoDesign/AGENT.md)
3. [doc/Architecture-Folder-Governance.md](/Users/BofeiChen/AutoDesign/doc/Architecture-Folder-Governance.md)
4. [doc/Product-Standards.md](/Users/BofeiChen/AutoDesign/doc/Product-Standards.md)
5. [doc/Test-Standards.md](/Users/BofeiChen/AutoDesign/doc/Test-Standards.md)
6. [doc/Roadmap.md](/Users/BofeiChen/AutoDesign/doc/Roadmap.md)
7. [doc/Architecture.md](/Users/BofeiChen/AutoDesign/doc/Architecture.md)
8. [doc/Capability-Catalog.md](/Users/BofeiChen/AutoDesign/doc/Capability-Catalog.md)
9. [doc/plans/README.md](/Users/BofeiChen/AutoDesign/doc/plans/README.md)
10. [reports/README.md](/Users/BofeiChen/AutoDesign/reports/README.md)

## 两条主工作流

### 1. AI -> Figma

入口：

- 正式插件 [manifest.json](/Users/BofeiChen/AutoDesign/plugins/autodesign/dist/manifest.json)
- 插件执行器 [main.ts](/Users/BofeiChen/AutoDesign/plugins/autodesign/src/main.ts)
- 运行时能力 [capability-runner.ts](/Users/BofeiChen/AutoDesign/plugins/autodesign/src/runtime/capability-runner.ts)
- bridge CLI [plugin-bridge-cli.ts](/Users/BofeiChen/AutoDesign/scripts/plugin-bridge-cli.ts)

这一侧负责：

- 读取 selection
- 导出 preview
- inspect subtree / frame
- 执行 capability 命令
- reconstruction analyze / apply / render / measure

### 2. Figma -> AI -> React

入口：

- 工作台入口 [App.tsx](/Users/BofeiChen/AutoDesign/src/App.tsx)
- 本地 API [index.ts](/Users/BofeiChen/AutoDesign/server/index.ts)
- 上下文构造 [context-pack.ts](/Users/BofeiChen/AutoDesign/shared/context-pack.ts)

这一侧负责：

- 设计源整理
- component mapping
- Runtime Context Pack
- 为 AI 修改前端代码提供更稳定输入

## 文档边界

- 治理与目录规则：[Architecture-Folder-Governance.md](/Users/BofeiChen/AutoDesign/doc/Architecture-Folder-Governance.md)
- 产品原则：[Product-Standards.md](/Users/BofeiChen/AutoDesign/doc/Product-Standards.md)
- 测试与验收：[Test-Standards.md](/Users/BofeiChen/AutoDesign/doc/Test-Standards.md)
- 当前执行真相：[Roadmap.md](/Users/BofeiChen/AutoDesign/doc/Roadmap.md)
- 能力目录：[Capability-Catalog.md](/Users/BofeiChen/AutoDesign/doc/Capability-Catalog.md)
- AI 契约：`doc/ai/`
- 活跃计划：`doc/plans/`
- 验收与质量证据：`reports/`
