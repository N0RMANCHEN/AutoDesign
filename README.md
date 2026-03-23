# AutoDesign

`AutoDesign` 是一个面向个人工作流的 Figma + 前端联调仓库，核心目标只有两条：

1. 让 AI 通过本地 Figma 插件和 bridge 安全地读取、分析、修改 Figma。
2. 让 Figma 中已经确认的设计事实，稳定转成 React / 前端改造输入。

它不是成品 SaaS，不是插件商店产品，也不是“一键从设计稿生成生产代码”的黑盒系统。

## 当前系统

仓库当前由四个系统组成：

- `src/` + `server/`
  工作台与本地 API，负责 Figma-to-React 上下文整理、映射和运行时验证
- `plugins/autodesign/`
  正式 Figma 插件，负责 selection、preview、capability 执行和写回 Figma
- `server/index.ts` + `server/plugin-bridge-store.ts`
  本地 bridge，负责插件会话、命令队列、结果回传和 reconstruction job
- `shared/`
  共享类型、能力协议、命令结构和 reconstruction 数据模型

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

- 正式插件：[manifest.json](/Users/BofeiChen/AutoDesign/plugins/autodesign/dist/manifest.json)
- Smoke 插件：[manifest.json](/Users/BofeiChen/AutoDesign/plugins/autodesign-smoke/dist/manifest.json)

## 两条核心工作流

### 1. AI -> Figma

常用命令：

```bash
npm run plugin:status
npm run plugin:inspect
npm run plugin:preview
npm run plugin:send -- --prompt "把指定对象改成深灰色" --node-ids 1:2
npm run plugin:reconstruct
```

这条链路的目标是：

- 读取当前 selection 和预览
- 通过结构化 capability 命令精确写 Figma
- 运行 reconstruction workflow，把参考图回归到目标 Frame

### 2. Figma -> AI -> React

这条链路当前仍以上下文整理为主：

- 维护 screen / component mapping
- 构造 Runtime Context Pack
- 给 AI 生成更稳定的实现上下文

当前还没有生产级的“全自动 React 生成”主链。

## 文档入口

从现在开始，仓库文档按治理层分工维护：

1. [AGENT.md](/Users/BofeiChen/AutoDesign/AGENT.md)
2. [Architecture-Folder-Governance.md](/Users/BofeiChen/AutoDesign/doc/Architecture-Folder-Governance.md)
3. [Product-Standards.md](/Users/BofeiChen/AutoDesign/doc/Product-Standards.md)
4. [Test-Standards.md](/Users/BofeiChen/AutoDesign/doc/Test-Standards.md)
5. [Roadmap.md](/Users/BofeiChen/AutoDesign/doc/Roadmap.md)
6. [Architecture.md](/Users/BofeiChen/AutoDesign/doc/Architecture.md)
7. [Capability-Catalog.md](/Users/BofeiChen/AutoDesign/doc/Capability-Catalog.md)
8. [Project-Map.md](/Users/BofeiChen/AutoDesign/doc/Project-Map.md)
9. [doc/plans/README.md](/Users/BofeiChen/AutoDesign/doc/plans/README.md)
10. [reports/README.md](/Users/BofeiChen/AutoDesign/reports/README.md)

职责边界：

- `README.md`
  项目总览和入口
- `doc/Roadmap.md`
  当前执行真相，只保留 active work
- `doc/plans/`
  具体计划，不做状态快照
- `reports/`
  验收、质量、事故、归档证据
- `CHANGELOG.md`
  面向版本和工作流的变更追踪

## 当前重点

当前项目的高优先级工作，不再散落在多个说明文档里，而统一收口为：

- 架构边界与职责修正
- reconstruction workflow 稳定化
- 文档治理体系重建
- 测试与验收链补全

具体执行状态以 [Roadmap.md](/Users/BofeiChen/AutoDesign/doc/Roadmap.md) 为准。

## 维护原则

- 能力目录只在 [Capability-Catalog.md](/Users/BofeiChen/AutoDesign/doc/Capability-Catalog.md)
- 活跃任务只在 [Roadmap.md](/Users/BofeiChen/AutoDesign/doc/Roadmap.md)
- 规则只在治理、产品、测试标准文档
- 新增文档前先判断是否已有承载位
- 旧文档被新文档覆盖时，删除优先于并存
