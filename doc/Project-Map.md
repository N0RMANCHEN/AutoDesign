# AutoDesign Project Map

这份文档帮助你快速理解当前仓库的结构，以及两条核心工作流分别从哪里开始。

## 一句话先记住

这个仓库不是“一个前端应用 + 一个插件 demo”，而是一个单仓工作流：

- **Plugin System**：让 Codex / Claude 可以读取和修改 Figma
- **Workspace System**：让 Figma 选中内容转成更稳定的前端改造输入
- **Bridge + Shared**：把两边的命令、上下文、能力定义串起来

## 当前仓库结构

```text
.
├─ AGENT.md
├─ README.md
├─ contributing_ai.md
├─ CHANGELOG.md
├─ doc/
├─ plugins/
│  ├─ autodesign/
│  └─ autodesign-smoke/
├─ scripts/
├─ server/
├─ shared/
└─ src/
```

## 各目录负责什么

- `src/`
  Vite + React 工作台，负责 Figma to React 这一侧的上下文整理
- `server/`
  本地 Node API 和 plugin bridge
- `shared/`
  capability registry、命令协议、共享类型
- `plugins/autodesign/`
  正式 Figma 插件执行器
- `plugins/autodesign-smoke/`
  只用于验证导入链路的 smoke 插件
- `doc/`
  所有正式文档目录

## 最短阅读路径

第一次进入仓库，推荐按这个顺序读：

1. [README.md](/Users/hirohi/AutoDesign/README.md)
2. [AGENT.md](/Users/hirohi/AutoDesign/AGENT.md)
3. [doc/Roadmap.md](/Users/hirohi/AutoDesign/doc/Roadmap.md)
4. [doc/Architecture-Folder-Governance.md](/Users/hirohi/AutoDesign/doc/Architecture-Folder-Governance.md)
5. [doc/Architecture.md](/Users/hirohi/AutoDesign/doc/Architecture.md)
6. [doc/Capability-Catalog.md](/Users/hirohi/AutoDesign/doc/Capability-Catalog.md)
7. [plugins/autodesign/README.md](/Users/hirohi/AutoDesign/plugins/autodesign/README.md)

## 两条主工作流

### 1. Codex / Claude -> Figma

入口：

- 正式插件 [manifest.json](/Users/BofeiChen/AutoDesign/plugins/autodesign/dist/manifest.json)
- 插件执行器 [main.ts](/Users/BofeiChen/AutoDesign/plugins/autodesign/src/main.ts)
- 运行时能力 [capability-runner.ts](/Users/BofeiChen/AutoDesign/plugins/autodesign/src/runtime/capability-runner.ts)
- bridge CLI [plugin-bridge-cli.ts](/Users/BofeiChen/AutoDesign/scripts/plugin-bridge-cli.ts)

这一侧负责：

- 读取 selection
- 导出图片预览
- 执行 capability 命令
- 把结果写回 Figma

### 2. Figma -> Codex / Claude -> React

入口：

- 工作台入口 [App.tsx](/Users/hirohi/AutoDesign/src/App.tsx)
- 本地 API [index.ts](/Users/hirohi/AutoDesign/server/index.ts)
- 上下文构造 [context-pack.ts](/Users/hirohi/AutoDesign/shared/context-pack.ts)

这一侧负责：

- 设计源与 screen 信息整理
- component mapping
- Runtime Context Pack
- 为 AI 修改 React / 前端提供稳定输入

## 当前最关键的文档边界

- 架构与目录治理：[`doc/Architecture-Folder-Governance.md`](/Users/hirohi/AutoDesign/doc/Architecture-Folder-Governance.md)
- 当前执行真相：[`doc/Roadmap.md`](/Users/hirohi/AutoDesign/doc/Roadmap.md)
- 能力与命令体系：[`doc/Capability-Catalog.md`](/Users/hirohi/AutoDesign/doc/Capability-Catalog.md)
- AI 契约：[`doc/ai/README.md`](/Users/hirohi/AutoDesign/doc/ai/README.md)
