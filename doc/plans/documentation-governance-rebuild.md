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

## Dependencies

- `README.md`
- `doc/Roadmap.md`
- `doc/plans/README.md`
- `reports/README.md`
- `CHANGELOG.md`
- `scripts/verify-docs.mjs`
- `scripts/check_doc_code_consistency.mjs`
- `scripts/check_roadmap_reports_consistency.mjs`

## Entry Conditions

- 文档树已经完成分层重建
- 文档相关校验脚本已经接入 `verify`
- active work、archive、reports、changelog 的职责边界已经固定

## Workstreams

- 固定文档入口和分层职责，避免 README / Roadmap / plans / reports 混写
- 固定文档门禁，让关键结构和链接漂移能被自动发现
- 固定 task 关闭时的 archive / report / changelog 留痕路径

## Closure Tasks

- 给 active `Roadmap` 和 `doc/plans/*` 补齐可执行的子任务与完成判据结构
- 把文档门禁扩展到 plan 结构完整性和 roadmap 收口字段，而不是只查链接和禁用状态词
- 把模板、README 和实际 active plans 统一到同一套治理结构

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

## Verification

- `npm run verify:docs`
- `npm run check:doc-consistency`
- `npm run check:roadmap-reports`
