# Plan Documents

> 实现进度以 [doc/Roadmap.md](../Roadmap.md) 为准；本目录只描述 how，不做状态快照，不做历史堆积。

## 目录职责

`doc/plans/` 只承载活跃主题的实施方案，回答：

- 范围是什么
- 为什么现在做
- 依赖是什么
- 主要工作流怎么拆
- 离收口还差哪些子任务
- 入口 / 出口条件是什么
- 风险和回滚是什么

不回答：

- 当前状态如何
- 已完成多少
- 最终验收结果如何

这些分别应进入：

- `doc/Roadmap.md`
- `reports/*`

## 创建新计划

新增计划前，先在 [Roadmap](../Roadmap.md) 建立 active work，再复制：

- [doc/plans/_template.md](_template.md)

计划文档默认应包含：

- `Summary`
- `Scope`
- `Dependencies`
- `Entry Conditions`
- `Workstreams`
- `Closure Tasks`
- `Exit Conditions`
- `Risks`
- `Rollback`
- `Verification`

约束：

- `Workstreams` 至少 2 条，回答“这项 active work 分几条线推进”
- `Closure Tasks` 至少 3 条，回答“离 task 关闭还差哪些明确子任务”
- 不使用 `done / in_progress` 之类执行状态去标记子任务；子任务只描述收口所需工作

## 禁止内容

计划文档里不要出现：

- `更新日期`
- `current_focus`
- `plugin_runtime`
- `workspace_runtime`
- `bridge_runtime`
- `状态：in_progress / todo / done` 这类执行快照

这些都属于 `Roadmap`。

## 生命周期

- 主题进入 active work 后，先在 `Roadmap` 建项
- 再在本目录补计划文档
- 主题完成后，从 `Roadmap` 移出 active list，并默认转入 `doc/plans/archive/`
- 已关闭任务如果再次漂移，必须新开 task，不回写旧 closure

## Archive

- 历史 closure 与 archive pointer 统一见 [doc/plans/archive/README.md](archive/README.md)

## 当前计划

- [documentation-governance-rebuild.md](documentation-governance-rebuild.md)
- [workspace-plugin-architecture-hardening.md](workspace-plugin-architecture-hardening.md)
- [reconstruction-workflow-hardening.md](reconstruction-workflow-hardening.md)
- [testing-and-acceptance-hardening.md](testing-and-acceptance-hardening.md)
- [workspace-context-pack-hardening.md](workspace-context-pack-hardening.md)
- [figma-mcp-alignment.md](figma-mcp-alignment.md)
- [code-to-figma-preflight.md](code-to-figma-preflight.md)
- [code-to-design-runtime-capture.md](code-to-design-runtime-capture.md)

## Future / Background

- 当前无独立 future/background plan；如后续新增，必须与 active plans 分区列出
