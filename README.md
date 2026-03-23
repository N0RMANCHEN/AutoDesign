# AutoDesign

`AutoDesign` 是一个面向个人工作流的 Figma + React 联调仓库，目标固定为两件事：

1. 让 AI 通过本地插件和 bridge 安全读取、分析、修改 Figma。
2. 让 Figma 中已经确认的设计事实，稳定转成前端改造输入。

它不是成品 SaaS，不是插件商店产品，也不是“一键生成生产代码”的黑盒系统。

## 当前系统

- `src/` + `server/`
  工作台与本地 API，负责设计摘要、组件映射、Runtime Context Pack、bridge 与 reconstruction orchestration。
- `plugins/autodesign/`
  正式 Figma 插件，负责 selection、preview、capability 执行和 Figma 写回。
- `plugins/autodesign-smoke/`
  用于验证构建产物是否能被 Figma Desktop 正确加载。
- `shared/`
  共享类型、命令协议、能力目录、reconstruction 数据结构。

核心原则：共享协议，不共享运行时。

## 快速开始

环境要求：

- Node.js 18+
- npm
- Figma Desktop

安装依赖：

```bash
npm install
```

启动工作台和本地 bridge：

```bash
npm run dev
```

默认地址：

- Workspace: `http://localhost:5173`
- Local API / bridge: `http://localhost:3001`

构建插件：

```bash
npm run build:plugins
```

导入插件：

- 正式插件：`plugins/autodesign/dist/manifest.json`
- Smoke 插件：`plugins/autodesign-smoke/dist/manifest.json`

## 两条主工作流

### AI -> Figma

常用命令：

```bash
npm run plugin:status
npm run plugin:inspect
npm run plugin:preview
npm run plugin:send -- --prompt "把指定对象改成深灰色" --node-ids 1:2
npm run plugin:reconstruct
```

这条链路的正式写回主链是 `Plugin API + localhost bridge`。

### Figma -> AI -> React

当前主链仍以上下文整理和受控改造为主：

- 维护 screen / component mapping
- 构造 Runtime Context Pack
- 为 AI 修改前端代码提供更稳定输入

当前还没有生产级的“全自动 React 生成”主链。

## 当前支持边界

**Formal support now**: 工作台上下文整理，以及 `plugin:status` / `plugin:inspect` / `plugin:preview` / `plugin:send` 所代表的 `Plugin API + localhost bridge` 主链。

**Experimental**: `plugin:reconstruct`、Runtime AI 测试台、本地 `Context Pack -> action` 模拟链。

**Future target**: 生产级自动 React 生成、MCP 主写回、SaaS 化能力。

## 文档入口

从这里开始阅读：

1. [Project-Map](doc/Project-Map.md)
2. [AGENT](AGENT.md)
3. [Dev AI Workflow](contributing_ai.md)
4. [Architecture Governance](doc/Architecture-Folder-Governance.md)
5. [Product Standards](doc/Product-Standards.md)
6. [Test Standards](doc/Test-Standards.md)
7. [Roadmap](doc/Roadmap.md)
8. [Runtime AI Docs](doc/ai/README.md)

职责边界：

- `README.md`
  只做项目定位、运行入口和阅读入口。
- `doc/Roadmap.md`
  只保留当前 active work。
- `doc/plans/`
  只保留 how，不写状态快照。
- `reports/`
  只保留证据、验收、质量和事故记录。
- `CHANGELOG.md`
  只记录版本级变化。

## 维护与校验

文档和 AI 工作流相关改动提交前，至少运行：

```bash
npm run verify
```

如果改动涉及架构边界、插件写回路径、bridge truth store 或目录职责，先跑：

```bash
npm run governance:check
```

如果改动涉及 shared 纯逻辑、targeting 规则、reconstruction 评分/建议逻辑，先跑：

```bash
npm run test:unit
```

如果只改 Markdown，可单独运行：

```bash
npm run verify:docs
```

`governance:check` 当前重点拦两类退化：

- 非插件运行时越界触碰 Figma API
- 非 owner 模块直接写 `data/autodesign-plugin-bridge.json`、`data/autodesign-project.json`、`data/autodesign-reconstruction-jobs.json`
- shared targeting / reconstruction 纯逻辑回归

当前执行状态以 [Roadmap](doc/Roadmap.md) 为准。
