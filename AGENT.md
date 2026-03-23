# AutoDesign - Agent Guide

> 本文件定义 `AutoDesign` 的最高优先级项目原则。
> 若与其他 Markdown 冲突，以 `AGENT.md` 为准。

## 1. 项目身份

`AutoDesign` 是一个围绕设计事实、前端实现验证和 AI 可控写 Figma 的个人联调仓库。

它当前不承担：

- 成品 SaaS 的多用户和后端业务系统
- 插件市场产品化包装
- 无需审阅的全自动生产级代码生成

## 2. 非协商边界

### 2.1 两类真相必须分开

- 设计真相：以 Figma 中已经确认的结构、状态、命名、层级为准
- 实现真相：以仓库中已经落地并可验证的行为为准

文档和 AI 输出不得把两者混写。

### 2.2 正式写回主链固定

当前仓库里，正式 Figma 写回主链是：

`Plugin API + localhost bridge`

约束：

- 插件 runtime 才能直接写 Figma
- workspace 和 server 只能通过 bridge / capability contract 驱动写回
- MCP 可以辅助读取设计上下文，但不是当前正式写回主链

### 2.3 本地 bridge 默认已授权

对本项目中的 Dev AI，用户已授权默认访问：

- `http://localhost:3001/api/*`

只要仍是当前仓库、当前本地 bridge、当前 Figma 会话范围，就不要把这件事反复写成“需要再次授权”。

### 2.4 正式插件 UI 默认冻结

`plugins/autodesign/src/ui.html` 的可见 UI 默认冻结。

- 没有用户明确要求，不允许修改布局、尺寸、样式、文案或可见交互
- 如确需修改，必须同步更新 UI lock 与相关文档

### 2.5 Prompt 与 schema 也算接口

`doc/ai/runtime/*` 不是随笔，而是 Runtime AI 契约层。

- 输入结构、输出 JSON、失败策略必须与实现和 schema 对齐
- 未实现的内容只能写成计划态，不得伪装成现状

## 3. AI 的职责

AI 在本仓库中只承担辅助角色：

- 归纳设计信息
- 生成结构化建议
- 输出可审阅的文本、JSON patch 或实施草案
- 标注风险、缺口和待确认项

AI 不能自行拥有隐藏状态，也不能绕过人工确认直接改写“设计事实”。

## 4. 文档权责

以下文档是正式入口：

- [README](README.md)：项目定位、运行入口、阅读入口
- [Project Map](doc/Project-Map.md)：仓库导航与阅读路径
- [Dev AI Workflow](contributing_ai.md)：Dev AI 默认执行流程
- [Architecture Governance](doc/Architecture-Folder-Governance.md)：目录职责和文档治理
- [Product Standards](doc/Product-Standards.md)：产品原则和默认行为
- [Test Standards](doc/Test-Standards.md)：测试和验收门槛
- [Roadmap](doc/Roadmap.md)：当前 active work
- [Runtime AI Docs](doc/ai/README.md)：Runtime AI 文档总入口

单一事实来源固定为：

- active work：`doc/Roadmap.md`
- implementation plan：`doc/plans/*`
- acceptance / quality / incident evidence：`reports/*`
- capability truth：`doc/Capability-Catalog.md`
- architecture truth：`doc/Architecture.md`

## 5. 交付底线

一次改动可以视为完成，至少满足：

- 当前状态与仓库事实一致
- 文档引用可达，没有残留失效路径
- 计划态与现状态分界清楚
- AI 契约与 schema 不互相冲突
- 对工作流有意义的变化同步进 `Roadmap`、`plans/`、`reports/` 或 `CHANGELOG.md`
