# Documentation Governance Rebuild

## Summary

重建 `AutoDesign` 的文档操作系统，目标是建立稳定的治理层、标准层、执行层和报告层，解决事实重复、职责混写、入口失效和项目管理缺位的问题。

## Scope

- 重写 `README.md`
- 重写 `doc/Architecture-Folder-Governance.md`
- 新增 `doc/Product-Standards.md`
- 新增 `doc/Test-Standards.md`
- 重写 `doc/Roadmap.md`
- 重写 `doc/Project-Map.md`
- 重构 `CHANGELOG.md`
- 建立 `reports/` 结构和规则
- 收口文档绝对路径和职责边界

## Exit Conditions

- 文档层级明确，且每份文档只承担一种职责
- `Roadmap` 只保留 active work
- `CHANGELOG` 采用版本化格式
- `reports/` 可以承接验收和质量证据
- 关键入口文档无失效路径

## Risks

- 新结构如果没有持续维护，后续会再次退化成重复事实
- 旧文档残留如果不清理，会继续造成冲突和误读

## Rollback

- 回退到本次改动前的文档版本
- 恢复旧 `Roadmap` / `README` / `CHANGELOG`
- 删除新建的 `Product-Standards`、`Test-Standards`、`reports/`
