# Code-to-Design Runtime Capture

## Summary

把 `Code -> Design` 从“源码可逆性预检”推进到“浏览器运行态采样 + Figma command plan 生成”的实验主链。

目标不是直接在这份计划里承诺“任意 React 一键还原”，而是先把固定桌面断点、静态态、可编辑优先的本地链路落稳。

## Scope

包含：

- `shared/code-to-design-*` 的 snapshot / plan contract
- `scripts/code-to-design:capture`
- `scripts/code-to-design:plan`
- 为计划写回补齐的 plugin capability 缺口
- 与三能力线对应的 README / Roadmap / governance 对齐

不包含：

- 多断点响应式还原
- 交互态、动画态、异步数据态自动展开
- 生产级 hosted browser farm
- 任意项目的零配置 code-to-canvas 承诺

## Dependencies

- `shared/code-to-figma-preflight.ts`
- `shared/plugin-capabilities.ts`
- `scripts/plugin-bridge-cli.ts`
- `plugins/autodesign/src/runtime/*`
- `config/governance/product_boundary_truth.json`

## Entry Conditions

- Code-to-Figma preflight 已存在，可作为 fail-fast 前置审计
- 本地插件 bridge 写回主链已稳定
- 运行环境存在可调用的本地 Chrome headless

## Workstreams

### 1. Runtime Snapshot Contract

- 定义运行态页面 snapshot 的结构化 contract
- 固定 viewport、scroll size、节点矩形、computed style、图片 dataUrl 采样口径
- 把采样结果落成稳定 artifact，而不是只靠一次 stdout

### 2. Command Planning

- 基于 snapshot 生成可执行 Figma capability batch
- 第一阶段覆盖 root frame、背景、文本、图片、基础 shape
- 使用 `analysis:` ref 和显式 `parentNodeId` 保持批次内可解析

### 3. Write Capability Hardening

- 补齐 `nodes.create-image`
- 让 `nodes.create-text` 支持固定文本盒宽高
- 补 `plugin:send --json-file` 与 parent-targeted creation guard

### 4. Architecture Split

- 在 README、Architecture、Roadmap、Product Standards 中明确三能力线：
  - `Code -> Design`
  - `Direct Figma Design`
  - `Design -> Code`
- 保持这三条线可以组合，但 contract 和 owner 不混层

## Closure Tasks

- 让 `code-to-design:capture` 能稳定对 `AItest/dist` 生成 snapshot artifact
- 让 `code-to-design:plan` 能生成可通过 `plugin:send --json-file` 下发的 batch
- 为图片节点、固定文本宽度和 parent-targeted creation 补齐单测
- 把 support boundary truth、Roadmap 和 README 同步到 experimental 真实边界

## Exit Conditions

- `code-to-design:capture` 与 `code-to-design:plan` 进入可重复执行状态
- 静态桌面页面可以在不修改目标源码的前提下产出可执行 batch
- 文档、governance 和 capability catalog 与代码真相一致

## Risks

- 浏览器字体与 Figma 本机字体不一致时，文本换行会漂移
- 图片 `object-fit`、渐变、复杂背景和 border 仍可能需要更细粒度映射
- 仅靠固定桌面 viewport 不代表响应式页面已被完整覆盖

## Rollback

- 保留 `code-to-figma:preflight` 作为独立 fail-fast 入口
- 如果运行态采样链不稳，只回退 `code-to-design:*` 入口，不影响 Direct Figma Design / Design-to-Code 主链
- 新增 capability 如出现回归，可单独从 registry 与 catalog 中撤回

## Verification

- `node --test --import tsx shared/code-to-design-snapshot.test.ts shared/code-to-design-plan.test.ts scripts/code-to-design-capture.test.ts scripts/code-to-design-plan.test.ts`
- `node --test --import tsx shared/plugin-targeting.test.ts shared/plugin-cli-guards.test.ts plugins/autodesign/src/runtime/creation-command-handlers.test.ts`
- `npm run typecheck`
- `npm run verify:docs`
