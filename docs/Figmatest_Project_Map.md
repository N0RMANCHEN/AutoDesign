# Codex to Figma 仓库地图

这份文档帮助你快速理解当前仓库的真实结构，以及两条工作流分别从哪里开始。

## 一句话先记住

这个仓库不是“一个前端应用 + 一个插件 demo”，而是一个单仓工作流：

- **Plugin System**：让 Codex / Claude 可以读取和修改 Figma
- **Workspace System**：让 Figma 选中内容可以转成更稳定的前端改造输入
- **Bridge + Shared**：把两边的命令、上下文、能力定义串起来

## 当前仓库结构

```text
.
├─ AGENT.md
├─ README.md
├─ contributing_ai.md
├─ data/
├─ docs/
├─ plugins/
│  ├─ codex-to-figma/
│  └─ codex-to-figma-smoke/
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
- `plugins/codex-to-figma/`
  正式 Figma 插件执行器
- `plugins/codex-to-figma-smoke/`
  只用于验证导入链路的 smoke 插件
- `data/`
  本地 JSON 持久化
- `docs/`
  架构、规则、AI 契约

## 最短阅读路径

第一次进入仓库，推荐按这个顺序读：

1. [README.md](/Users/hirohi/Figmatest/README.md)
2. [AGENT.md](/Users/hirohi/Figmatest/AGENT.md)
3. [docs/architecture.md](/Users/hirohi/Figmatest/docs/architecture.md)
4. [plugins/codex-to-figma/README.md](/Users/hirohi/Figmatest/plugins/codex-to-figma/README.md)
5. [docs/ai/README.md](/Users/hirohi/Figmatest/docs/ai/README.md)

## 两条主工作流

### 1. Codex / Claude -> Figma

入口：

- 正式插件 [manifest.json](/Users/hirohi/Figmatest/plugins/codex-to-figma/dist/manifest.json)
- 插件执行器 [main.ts](/Users/hirohi/Figmatest/plugins/codex-to-figma/src/main.ts)
- 运行时能力 [capability-runner.ts](/Users/hirohi/Figmatest/plugins/codex-to-figma/src/runtime/capability-runner.ts)
- bridge CLI [plugin-bridge-cli.ts](/Users/hirohi/Figmatest/scripts/plugin-bridge-cli.ts)

这一侧负责：

- 读取 selection
- 导出图片预览
- 执行 capability 命令
- 把结果写回 Figma

### 2. Figma -> Codex / Claude -> React

入口：

- 工作台入口 [App.tsx](/Users/hirohi/Figmatest/src/App.tsx)
- 本地 API [index.ts](/Users/hirohi/Figmatest/server/index.ts)
- 上下文构造 [context-pack.ts](/Users/hirohi/Figmatest/shared/context-pack.ts)

这一侧负责：

- 设计源与 screen 信息整理
- component mapping
- Runtime Context Pack
- 为 AI 修改 React / 前端提供稳定输入

## 现在最关键的边界

### Plugin System 边界

插件负责：

- Figma 文件读写
- 节点预览导出
- capability 执行
- session 上报和结果回传

插件不负责：

- React 工作台页面
- 设计实现评审 UI
- 前端代码生成策略

### Workspace System 边界

工作台负责：

- 设计信息整理
- 实现映射
- AI 上下文组织
- 本地 runtime action

工作台不直接写 Figma 文件。

### Shared / Bridge 边界

共享层和 bridge 只负责：

- 结构化协议
- 能力声明
- 会话与命令队列
- 结果审计

不要把插件 UI 状态或工作台内存状态混进去。

## 当前最值得看的代码入口

- [server/index.ts](/Users/hirohi/Figmatest/server/index.ts)
- [shared/plugin-capabilities.ts](/Users/hirohi/Figmatest/shared/plugin-capabilities.ts)
- [shared/plugin-bridge.ts](/Users/hirohi/Figmatest/shared/plugin-bridge.ts)
- [shared/plugin-contract.ts](/Users/hirohi/Figmatest/shared/plugin-contract.ts)
- [plugins/codex-to-figma/src/runtime/selection-context.ts](/Users/hirohi/Figmatest/plugins/codex-to-figma/src/runtime/selection-context.ts)
- [plugins/codex-to-figma/src/runtime/capability-runner.ts](/Users/hirohi/Figmatest/plugins/codex-to-figma/src/runtime/capability-runner.ts)

## 当前缺的是什么

- 更多 capability 域：text、auto layout、components、libraries
- 更完整的 Figma to React 自动流水线
- 更强的日志、审计和多用户能力
