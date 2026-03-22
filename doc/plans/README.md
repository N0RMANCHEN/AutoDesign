# Plan Documents (`doc/plans/`)

> 规则：实现进度以 `doc/Roadmap.md` 为准；本目录计划文件只描述 scope，不做逐任务快照。

## 职责矩阵

- `doc/Roadmap.md`
  live board；只保留当前执行真相、仍未完成任务、仍生效约束
- `doc/plans/`
  计划文件；只保留 scope、依赖、入口/出口条件、风险与回滚

## 写作边界

- 应写进 `Roadmap`
  - 当前在做什么
  - 下一步做什么
  - 哪些任务仍然 live
- 应写进 `doc/plans/`
  - implementation shape
  - task scope
  - 入口 / 出口条件
  - 风险与 rollback

## 当前状态

- 当前还没有拆出独立计划文件
- 等 capability 扩展或 Figma-to-React 自动化进入明确实施阶段后，再按主题新增计划文档

