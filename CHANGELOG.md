# Changelog

本文件记录对用户、开发者和工作流有意义的版本级变化。

格式约定：

- `Added`：新增能力或新文档层
- `Changed`：已有行为或结构调整
- `Fixed`：缺陷修复
- `Removed`：废弃或删除的内容

## 2026-03-23

### Added

- 新增 [Product-Standards.md](/Users/BofeiChen/AutoDesign/doc/Product-Standards.md)，统一产品原则、设计质量要求和 reconstruction 交付优先级
- 新增 [Test-Standards.md](/Users/BofeiChen/AutoDesign/doc/Test-Standards.md)，统一测试层次、回归门槛和验收规则
- 新增 `reports/` 报告层，用于承接验收、质量、事故和归档证据
- 新增 `doc/plans/` 下的活跃计划文档，建立 `Roadmap -> Plan -> Report` 的项目管理链条

### Changed

- 重写 [Architecture-Folder-Governance.md](/Users/BofeiChen/AutoDesign/doc/Architecture-Folder-Governance.md)，把治理规则升级为长期标准
- 重写 [Roadmap.md](/Users/BofeiChen/AutoDesign/doc/Roadmap.md)，改为 active-only execution truth
- 重写 [README.md](/Users/BofeiChen/AutoDesign/README.md) 和 [Project-Map.md](/Users/BofeiChen/AutoDesign/doc/Project-Map.md)，把文档入口和职责层重新收口
- 重写 `doc/plans/README.md`，明确计划文档的命名、生命周期和边界
- `CHANGELOG` 从提交摘要式记录改为版本化、职责明确的变更追踪

### Fixed

- 修正文档中的失效绝对路径和过期入口说明
- 修正 `Roadmap` 与 capability / 架构说明混写的问题

## 2026-03-22

### Fixed

- 插件命令支持 `nodeIds` 精确定位目标节点，避免多选时误改全部 selection

### Changed

- `FigmaCapabilityCommand` 新增可选字段 `nodeIds?: string[]`
- CLI `plugin:status` 输出增加节点 ID 显示
- CLI `plugin:send` 新增 `--node-ids` 参数

## 2026-03-22 (Brand Rename)

### Changed

- 全仓库品牌名从 `Codex-to-Figma` 迁移为 `AutoDesign`
- 正式插件目录迁移至 `plugins/autodesign`
- smoke 插件同步迁移至 `plugins/autodesign-smoke`
