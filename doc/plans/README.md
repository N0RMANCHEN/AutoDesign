# Plan Documents (`doc/plans/`)

> 规则：实现进度以 `doc/Roadmap.md` 为准；本目录只描述 how，不做状态快照，不做历史堆积。

## 1. 目录职责

`doc/plans/` 只承载活跃主题的计划文档，回答：

- 范围是什么
- 为什么现在做
- 依赖是什么
- 入口 / 出口条件是什么
- 风险和回滚是什么

不回答：

- 当前状态如何
- 已完成多少
- 最终验收结果如何

这些分别应进入：

- `doc/Roadmap.md`
- `reports/*`

## 2. 命名规则

文件名直接表达主题，避免模糊标题。

推荐：

- `documentation-governance-rebuild.md`
- `workspace-plugin-architecture-hardening.md`
- `reconstruction-workflow-hardening.md`

不推荐：

- `todo.md`
- `plan2.md`
- `notes-final.md`

## 3. 生命周期

- 主题进入 active work 后，先在 `Roadmap` 建项
- 再在本目录补计划文档
- 主题完成后，从 `Roadmap` 移出 active list
- 计划文档如已失去长期入口价值，应删除或转 `reports/archive/`

## 4. 当前计划

- [documentation-governance-rebuild.md](/Users/BofeiChen/AutoDesign/doc/plans/documentation-governance-rebuild.md)
- [workspace-plugin-architecture-hardening.md](/Users/BofeiChen/AutoDesign/doc/plans/workspace-plugin-architecture-hardening.md)
- [reconstruction-workflow-hardening.md](/Users/BofeiChen/AutoDesign/doc/plans/reconstruction-workflow-hardening.md)
- [testing-and-acceptance-hardening.md](/Users/BofeiChen/AutoDesign/doc/plans/testing-and-acceptance-hardening.md)
- [workspace-context-pack-hardening.md](/Users/BofeiChen/AutoDesign/doc/plans/workspace-context-pack-hardening.md)
