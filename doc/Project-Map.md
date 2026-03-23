# AutoDesign Project Map

这份文档用于回答三件事：

1. 仓库里有哪些系统
2. 不同任务应该先读哪里
3. 哪份文档对哪类事实负责

## 一句话先记住

这不是单一前端应用，也不是单一插件 demo，而是一个单仓工作流：

- `Plugin System`
  让 AI 可以读取和修改 Figma
- `Workspace System`
  让设计事实转成更稳定的前端改造输入
- `Bridge + Shared`
  负责命令、上下文和能力协议

## 仓库结构

```text
.
├─ README.md
├─ AGENT.md
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

## 目录职责

- `src/`
  Vite + React 工作台
- `server/`
  本地 API、bridge、reconstruction orchestration
- `shared/`
  capability registry、命令协议、共享类型
- `plugins/autodesign/`
  正式 Figma 插件执行器
- `plugins/autodesign-smoke/`
  构建产物 smoke 校验
- `doc/`
  治理、标准、架构、路线图、AI 文档、计划
- `reports/`
  验收、质量、事故、归档证据

## 按任务选择阅读路径

### 新接手仓库

1. [README](../README.md)
2. [AGENT](../AGENT.md)
3. [Dev AI Workflow](../contributing_ai.md)
4. [Architecture Governance](Architecture-Folder-Governance.md)
5. [Roadmap](Roadmap.md)

### 做文档治理或仓库规则调整

1. [Architecture Governance](Architecture-Folder-Governance.md)
2. [Product Standards](Product-Standards.md)
3. [Test Standards](Test-Standards.md)
4. [Plan Docs](plans/README.md)
5. [Reports](../reports/README.md)

### 做插件、bridge、capability 或 reconstruction

1. [Architecture](Architecture.md)
2. [Capability Catalog](Capability-Catalog.md)
3. [Roadmap](Roadmap.md)
4. 相关 `doc/plans/*`
5. [plugins/autodesign/README.md](../plugins/autodesign/README.md)

### 做 Runtime AI / Context Pack / action prompt

1. [doc/ai/README.md](ai/README.md)
2. [doc/ai/runtime/README.md](ai/runtime/README.md)
3. [doc/ai/runtime/SYSTEM_PROMPT.md](ai/runtime/SYSTEM_PROMPT.md)
4. 对应 `actions/*` 和 `contracts/*`
5. [workspace-context-pack-hardening.md](plans/workspace-context-pack-hardening.md)

## 两条正式工作流

### 1. AI -> Figma

入口：

- `plugins/autodesign/dist/manifest.json`
- `plugins/autodesign/src/main.ts`
- `plugins/autodesign/src/runtime/capability-runner.ts`
- `scripts/plugin-bridge-cli.ts`

负责：

- 读取 selection
- 导出 preview
- 执行 capability 命令
- reconstruction analyze / apply / render / measure

### 2. Figma -> AI -> React

入口：

- `src/App.tsx`
- `src/components/workspace/workspace-shell.tsx`
- `server/index.ts`
- `shared/context-pack.ts`

负责：

- 设计源整理
- component mapping
- review queue
- Runtime Context Pack
- 给 AI 提供更稳定的前端改造输入

## 文档职责图

- [README](../README.md)
  项目定位、运行入口、阅读入口
- [AGENT](../AGENT.md)
  最高优先级项目原则
- [contributing_ai](../contributing_ai.md)
  Dev AI 默认执行流程
- [Architecture Governance](Architecture-Folder-Governance.md)
  目录职责和文档治理规则
- [Product Standards](Product-Standards.md)
  产品默认行为和交付原则
- [Test Standards](Test-Standards.md)
  测试层次和验收门槛
- [Roadmap](Roadmap.md)
  当前 active work
- [plans/](plans/README.md)
  how
- [reports/](../reports/README.md)
  evidence
- [Runtime AI Docs](ai/README.md)
  Runtime AI 契约入口
