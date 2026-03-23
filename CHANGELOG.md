# Changelog

本文件记录对用户、开发者和工作流有意义的版本级变化。

格式约定：

- `Added`：新增能力或新文档层
- `Changed`：已有行为或结构调整
- `Fixed`：缺陷修复
- `Removed`：废弃或删除的内容

## 2026-03-23

### Added

- 新增 [Product-Standards.md](doc/Product-Standards.md)，统一产品原则、设计质量要求和 reconstruction 交付优先级
- 新增 [Test-Standards.md](doc/Test-Standards.md)，统一测试层次、回归门槛和验收规则
- 新增 `reports/` 报告层，用于承接验收、质量、事故和归档证据
- 新增 `doc/plans/` 下的活跃计划文档，建立 `Roadmap -> Plan -> Report` 的项目管理链条
- 新增 `doc/plans/_template.md` 与 `reports/*/TEMPLATE.md`，统一计划和报告的最小结构
- 新增 `npm run verify:docs` 文档门禁，用于检查失效路径、绝对路径、文档边界和 Runtime AI action/schema 对齐
- 新增 `config/governance/product_boundary_truth.json` 与 `config/governance/doc_code_consistency_rules.json`，把支持边界和文档一致性规则配置化
- 新增 `npm run verify`、边界检查、Roadmap/Report 一致性检查，以及 acceptance/quality JSON schema 合同
- 新增 `config/governance/architecture_rules.json`、`config/governance/runtime_write_registry.json` 和 `npm run governance:check`，把架构边界、Figma 写回面和 truth store owner 变成可执行门禁
- 新增 `npm run test:unit`、[shared/plugin-targeting.test.ts](shared/plugin-targeting.test.ts) 和 [server/reconstruction-evaluation.test.ts](server/reconstruction-evaluation.test.ts)，把 targeting 归一化与 reconstruction refine 逻辑纳入自动化回归
- 新增 [shared/plugin-command-composer.test.ts](shared/plugin-command-composer.test.ts)、[shared/context-pack.test.ts](shared/context-pack.test.ts) 和 [shared/runtime-actions.test.ts](shared/runtime-actions.test.ts)，把 prompt composition、context pack 组装和 Runtime AI 纯函数输出纳入回归
- 新增 `npm run check:report-schemas` 与首份 [reports/acceptance/acceptance-20260323-205637.md](reports/acceptance/acceptance-20260323-205637.md)，把 acceptance/quality JSON 合同和真实验收留痕接入主链
- 新增 [server/reconstruction-store.test.ts](server/reconstruction-store.test.ts)，覆盖 reconstruction job 的创建、分析审批、apply/render/measure/refine 生命周期
- 新增 [server/plugin-bridge-store.test.ts](server/plugin-bridge-store.test.ts)，覆盖 plugin session 注册、heartbeat、command queue/claim/complete 和 legacy bridge snapshot 迁移
- 新增 [server/storage.test.ts](server/storage.test.ts)，覆盖 project seed 初始化、legacy project 迁移、write 和 reset 持久化行为
- 新增 [server/reconstruction-analysis.test.ts](server/reconstruction-analysis.test.ts)，覆盖 reconstruction context pack 和 normalized analysis 的关键 contract / warning 行为
- 新增 `npm run check:capability-catalog` 并补齐 [Capability-Catalog.md](doc/Capability-Catalog.md) 中遗漏的 implemented capability，防止 registry 与文档再次漂移
- 新增 [shared/plugin-cli-guards.ts](shared/plugin-cli-guards.ts) 与 [shared/plugin-cli-guards.test.ts](shared/plugin-cli-guards.test.ts)，把 `plugin:send` / `plugin:reconstruct` 的关键 CLI guard 逻辑纳入单测
- 新增 [shared/plugin-capabilities.test.ts](shared/plugin-capabilities.test.ts) 与 [reports/acceptance/acceptance-20260323-213423.md](reports/acceptance/acceptance-20260323-213423.md)，把 capability registry 完整性和当前扩展后的 verify 结果落成正式验收证据
- 新增 [scripts/check_report_schemas.test.ts](scripts/check_report_schemas.test.ts)、[scripts/check_capability_catalog_consistency.test.ts](scripts/check_capability_catalog_consistency.test.ts)、[scripts/check_product_boundary_truth.test.ts](scripts/check_product_boundary_truth.test.ts)、[scripts/check_doc_code_consistency.test.ts](scripts/check_doc_code_consistency.test.ts)、[scripts/check_roadmap_reports_consistency.test.ts](scripts/check_roadmap_reports_consistency.test.ts)、[scripts/check_architecture_governance.test.ts](scripts/check_architecture_governance.test.ts)、[scripts/check_runtime_write_surfaces.test.ts](scripts/check_runtime_write_surfaces.test.ts)、[scripts/verify-docs.test.ts](scripts/verify-docs.test.ts)、[scripts/verify-plugin-ui-lock.test.ts](scripts/verify-plugin-ui-lock.test.ts)、[scripts/verify-plugin-smoke.test.ts](scripts/verify-plugin-smoke.test.ts)、[scripts/build-figma-plugins.test.ts](scripts/build-figma-plugins.test.ts)、[scripts/verify-plugin-targeting.test.ts](scripts/verify-plugin-targeting.test.ts) 和 [scripts/verify.test.ts](scripts/verify.test.ts)，把治理脚本自身也纳入 `test:unit`

### Changed

- 重写 [Architecture-Folder-Governance.md](doc/Architecture-Folder-Governance.md)，把治理规则升级为长期标准
- 重写 [Roadmap.md](doc/Roadmap.md)，改为 active-only execution truth
- 重写 [README.md](README.md) 和 [Project-Map.md](doc/Project-Map.md)，把文档入口、阅读路径和职责层重新收口
- 重写 `AGENT.md`、`contributing_ai.md`、`CLAUDE.md` 和 `doc/ai/*` 入口，明确 Dev AI 与 Runtime AI 的边界
- 重写 `doc/plans/README.md`，明确计划文档的命名、生命周期和边界
- 补齐 `doc/plans/archive/README.md`、report `.md + .json` 合同和支持边界真相源，向 Soul-seed 式治理门禁对齐
- README、Dev AI workflow、治理标准和测试标准新增 `governance:check` 入口，明确非插件运行时不得直接触碰 Figma API
- `CHANGELOG` 从提交摘要式记录改为版本化、职责明确的变更追踪

### Fixed

- 修正文档中的失效绝对路径和过期入口说明
- 修正 `Roadmap` 与 capability / 架构说明混写的问题
- 修复 `check_architecture_governance` 对 side-effect import 越界依赖的漏检，避免 `import "../server/..."` 形式绕过依赖方向门禁
- 修复治理脚本将 `*.test.ts` 夹具误判为生产写入面的问题，避免测试文件触发 runtime write surface 误报

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
