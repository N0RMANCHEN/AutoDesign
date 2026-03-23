# Dev AI Workflow

> 本文件约束 Dev AI 如何在 `AutoDesign` 仓库中协作。  
> 项目原则以 [AGENT.md](AGENT.md) 为准。

## 1. 适用范围

- Dev AI：Codex、Claude、Cursor、Copilot 这类仓库协作 AI
- Runtime AI：产品内的 `Context Pack -> action -> JSON output` 运行时助手，相关规范见 [doc/ai/README.md](doc/ai/README.md)

本文件只约束前者。

## 2. 默认执行流程

任何任务默认按下面顺序推进：

1. 明确这次要收敛的问题和完成标准。
2. 先核对仓库事实，再决定改文档、改代码，还是两者都改。
3. 只做与当前目标直接相关的最小改动。
4. 把变化同步到正确的权责文档，不制造第二份事实来源。
5. 做验证，并区分 `VERIFIED` 与 `NOT VERIFIED`。
6. 对用户或工作流有意义的变化更新 `CHANGELOG.md`。

## 3. 开始工作前最少阅读集

所有任务默认先看：

1. [AGENT.md](AGENT.md)
2. [README.md](README.md)
3. [doc/Project-Map.md](doc/Project-Map.md)
4. [doc/Architecture-Folder-Governance.md](doc/Architecture-Folder-Governance.md)
5. [doc/Product-Standards.md](doc/Product-Standards.md)
6. [doc/Test-Standards.md](doc/Test-Standards.md)
7. [doc/Roadmap.md](doc/Roadmap.md)

再补读与任务直接相关的计划、报告、架构或 AI 文档。

## 4. 改动时该更新哪份文档

- 项目定位、入口导航变化：更新 `README.md` 或 `doc/Project-Map.md`
- 最高优先级原则变化：更新 `AGENT.md`
- Dev AI 默认流程变化：更新 `contributing_ai.md`
- 目录职责、治理边界变化：更新 `doc/Architecture-Folder-Governance.md`
- 产品默认行为变化：更新 `doc/Product-Standards.md`
- 测试门槛变化：更新 `doc/Test-Standards.md`
- 当前 active work 变化：更新 `doc/Roadmap.md`
- 实施方案变化：更新 `doc/plans/*`
- 验收、质量、事故证据：更新 `reports/*`
- capability 或协议变化：更新 `doc/Capability-Catalog.md`
- Runtime AI action、schema、系统 prompt：更新 `doc/ai/runtime/*`

## 5. 文档任务最低验证

文档改动至少完成以下检查：

- 内部链接可达
- 不保留机器绑定绝对路径
- “当前状态”与仓库事实一致
- `Roadmap / plans / reports / CHANGELOG` 职责不混写
- Runtime AI action 文档与 schema 仍对得上

推荐命令：

```bash
npm run verify:docs
```

## 6. 代码或工作流任务最低验证

按改动范围选择最小验证：

- 纯文档：`npm run verify:docs`
- Prompt / JSON contract：`npm run verify:docs` + 关联文件人工抽查
- acceptance / quality report JSON：`npm run check:report-schemas`
- capability registry / catalog：`npm run check:capability-catalog`
- React / server：`npm run typecheck`
- shared targeting / reconstruction 纯逻辑：`npm run test:unit`
- 架构边界 / bridge truth store / 插件写回面：`npm run governance:check`
- 插件 / bridge：`npm run verify:plugins`

如果做不到，必须明确写 `NOT VERIFIED` 和原因。

## 7. 输出要求

- 不把猜测说成事实
- 明确说明改了什么、怎么验证的、哪些仍未验证
- 不重复复述大段仓库背景
- 发现文档漂移时，优先把事实收口到唯一来源，再修引用

## 8. 完成定义

一次 Dev AI 交付可视为完成，至少满足：

- 与 `AGENT.md` 不冲突
- 用户要求涉及的文档或实现已覆盖
- 关键入口和引用已修复
- 变更落到了正确的 `Roadmap / plans / reports / CHANGELOG`
- 验证结果已明确写出
