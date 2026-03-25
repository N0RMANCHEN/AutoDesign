# Changelog

本文件记录对用户、开发者和工作流有意义的版本级变化。

格式约定：

- `Added`：新增能力或新文档层
- `Changed`：已有行为或结构调整
- `Fixed`：缺陷修复
- `Removed`：废弃或删除的内容

## 2026-03-25

### Added

- 新增 [shared/runtime-variable-defs.ts](shared/runtime-variable-defs.ts) 与 [shared/runtime-variable-defs.test.ts](shared/runtime-variable-defs.test.ts)，把 `variable defs` 的 live/local snapshot 归一化逻辑从 `design-context` 组合层拆成独立 contract
- 新增 [plugins/autodesign/src/runtime/variable-snapshot.ts](plugins/autodesign/src/runtime/variable-snapshot.ts) 与 [plugins/autodesign/src/runtime/variable-snapshot.test.ts](plugins/autodesign/src/runtime/variable-snapshot.test.ts)，由插件在 session register/heartbeat 时上报本地 variable collections、modes 和 variable values

### Changed

- [shared/plugin-bridge.ts](shared/plugin-bridge.ts) 与 [server/plugin-bridge-store.ts](server/plugin-bridge-store.ts) 扩展了 plugin session 协议，bridge 现在会保留或显式清空 variable snapshot，而不会再把“旧插件未上报”和“当前文件没有变量”混为一谈
- [server/routes/runtime-read-routes.ts](server/routes/runtime-read-routes.ts) 的 `POST /api/runtime/variable-defs` 与 `POST /api/runtime/design-context` 新增可选 `targetSessionId`，显式定向到 plugin session 时可返回 live local variable truth；未提供 session 时继续返回显式 gap marker
- [server/api-routes.test.ts](server/api-routes.test.ts)、[server/plugin-bridge-store.test.ts](server/plugin-bridge-store.test.ts) 和 [shared/runtime-design-context.test.ts](shared/runtime-design-context.test.ts) 补齐了 live variable snapshot、fallback gap marker 和 heartbeat 保留/清空语义的回归
- [shared/plugin-bridge.ts](shared/plugin-bridge.ts)、[plugins/autodesign/src/runtime/selection-context.ts](plugins/autodesign/src/runtime/selection-context.ts) 和 [shared/runtime-node-metadata.ts](shared/runtime-node-metadata.ts) 现在会在节点摘要里暴露 `styleBindings`、`boundVariableIds` 和 `variableBindings`，把 style / variable binding truth 接入 `node-metadata` 读层
- [plugins/autodesign/src/runtime/style-snapshot.ts](plugins/autodesign/src/runtime/style-snapshot.ts)、[plugins/autodesign/src/main.ts](plugins/autodesign/src/main.ts) 和 [shared/runtime-node-metadata.ts](shared/runtime-node-metadata.ts) 现在还会把 local style definitions 随 plugin session 上报，并在 `node-metadata` 里把 style ids / variable ids 解析成可解释的 resolved truth
- [shared/runtime-node-metadata.ts](shared/runtime-node-metadata.ts) 与 [server/api-routes.test.ts](server/api-routes.test.ts) 现在还会返回子树级 `resolved/unresolved` style / variable dependency pack，让 workspace 和 Figma-to-React 不必再重复扫描 subtree 才能拿到依赖真相
- [shared/runtime-design-context.ts](shared/runtime-design-context.ts) 与 [server/api-routes.test.ts](server/api-routes.test.ts) 现在会在 `design-context` 里直接附带 cached plugin selection 的 dependency truth，减少 workspace 对 `node-metadata` 细节拼装的依赖
- [workspace-shell.tsx](src/components/workspace/workspace-shell.tsx) 的 Runtime AI 测试台现在会先生成并展示 `design-context`，再复用其中的 `contextPack` 跑本地 action，workspace UI 对 bridge/session 细节的直连进一步收口
- [workspace-shell.tsx](src/components/workspace/workspace-shell.tsx) 现在还会在 selection / action / session 改变后把旧的 `design-context` 标成 stale，并阻止继续用过期 `contextPack` 运行 action
- [runtime-panels.tsx](src/components/workspace/runtime-panels.tsx) 从 [workspace-shell.tsx](src/components/workspace/workspace-shell.tsx) 中拆出了 Runtime 相关 panel，避免 workspace 主壳重新长成新的架构热点
- [runtime-bridge-overview.ts](shared/runtime-bridge-overview.ts)、[runtime-read-routes.ts](server/routes/runtime-read-routes.ts) 和 [workspace-shell.tsx](src/components/workspace/workspace-shell.tsx) 新增了专用 `bridge-overview` read model，workspace 不再直接消费原始 `/api/plugin-bridge` snapshot
- 新增 [runtime-bridge-dispatch.ts](shared/runtime-bridge-dispatch.ts)、[runtime-write-routes.ts](server/routes/runtime-write-routes.ts) 和 [bridge-panels.tsx](src/components/workspace/bridge-panels.tsx)，workspace 现在通过 `POST /api/runtime/bridge-dispatch` 获取窄化后的 dispatch receipt，桥接协议 panel / 状态 panel 也从 [workspace-shell.tsx](src/components/workspace/workspace-shell.tsx) 中继续拆出，进一步收紧对原始 bridge command record 的耦合
- 新增 [workspace-read-model.ts](shared/workspace-read-model.ts)、[workspace-read-model.test.ts](shared/workspace-read-model.test.ts) 和 [workspace-routes.ts](server/routes/workspace-routes.ts) 的 workspace read/write contract；workspace 的 design source、mapping、review queue 和默认 selection 现在通过 `/api/workspace/read-model` 读取，`mapping-status`、`figma-sync`、`reset` 也改走窄化 write surface，而不是直接消费 `/api/project`
- [workspace-shell.tsx](src/components/workspace/workspace-shell.tsx) 现在会把 `design-context` 的 stale key 绑定到 `workspace.updatedAt`，避免 sync / reset / mapping status 更新后继续误用旧 context snapshot
- [workspace-read-model.ts](shared/workspace-read-model.ts)、[workspace-routes.ts](server/routes/workspace-routes.ts) 和 [workspace-shell.tsx](src/components/workspace/workspace-shell.tsx) 现在还补上了 review queue 的窄写面：`POST /api/workspace/review-queue-item` 只接收 `status / owner` 更新并返回 narrowed receipt，workspace UI 不再需要理解原始 `ReviewItem` 才能推进评审流
- [workspace-read-model.ts](shared/workspace-read-model.ts)、[workspace-read-model.test.ts](shared/workspace-read-model.test.ts)、[data-panels.tsx](src/components/workspace/data-panels.tsx) 和 [server/api-routes.test.ts](server/api-routes.test.ts) 现在把 design screen truth 收成显式 `screens` catalog，workspace 不再需要从泛化 `selection.options` 或原始 `designScreens` 结构里回推页面摘要、关联映射和评审入口
- [workspace-routes.ts](server/routes/workspace-routes.ts) 与 [server/api-routes.test.ts](server/api-routes.test.ts) 现在正式移除了 legacy `/api/project`、`/api/project/reset` 和 `/api/figma/sync` 对外面，工作台相关数据只通过 `/api/workspace/*` 的窄化 surface 暴露
- [types.ts](shared/types.ts)、[seed.ts](shared/seed.ts)、[workspace-library-assets.ts](shared/workspace-library-assets.ts)、[workspace-read-model.ts](shared/workspace-read-model.ts)、[workspace-routes.ts](server/routes/workspace-routes.ts) 和 [data-panels.tsx](src/components/workspace/data-panels.tsx) 现在补上了 library asset truth：底层 project store 新增 `libraryAssets`，workspace read model 暴露 narrowed asset catalog，`POST /api/workspace/library-assets/search` 提供同一套窄化搜索 contract，UI 不再直接理解原始 asset relation ids
- [types.ts](shared/types.ts)、[seed.ts](shared/seed.ts)、[workspace-read-model.ts](shared/workspace-read-model.ts)、[workspace-routes.ts](server/routes/workspace-routes.ts)、[data-panels.tsx](src/components/workspace/data-panels.tsx) 和 [workspace-shell.tsx](src/components/workspace/workspace-shell.tsx) 现在把 component mapping 的 implementation target / evidence 收成显式 contract：workspace read model 直接暴露 narrowed target / evidence truth，`POST /api/workspace/mapping-contract` 负责窄写回，UI 不再把 Code Connect-like mapping 真相埋在 `notes`

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
- 新增 [scripts/check_report_schemas.test.ts](scripts/check_report_schemas.test.ts)、[scripts/check_capability_catalog_consistency.test.ts](scripts/check_capability_catalog_consistency.test.ts)、[scripts/check_product_boundary_truth.test.ts](scripts/check_product_boundary_truth.test.ts)、[scripts/check_doc_code_consistency.test.ts](scripts/check_doc_code_consistency.test.ts)、[scripts/check_roadmap_reports_consistency.test.ts](scripts/check_roadmap_reports_consistency.test.ts)、[scripts/check_architecture_governance.test.ts](scripts/check_architecture_governance.test.ts)、[scripts/check_runtime_write_surfaces.test.ts](scripts/check_runtime_write_surfaces.test.ts)、[scripts/verify-docs.test.ts](scripts/verify-docs.test.ts)、[scripts/verify-plugin-ui-lock.test.ts](scripts/verify-plugin-ui-lock.test.ts)、[scripts/verify-plugin-smoke.test.ts](scripts/verify-plugin-smoke.test.ts)、[scripts/build-figma-plugins.test.ts](scripts/build-figma-plugins.test.ts)、[scripts/verify-plugin-targeting.test.ts](scripts/verify-plugin-targeting.test.ts)、[scripts/verify.test.ts](scripts/verify.test.ts) 和 [scripts/plugin-bridge-cli.test.ts](scripts/plugin-bridge-cli.test.ts)，把治理脚本自身也纳入 `test:unit`
- 扩展 [scripts/plugin-bridge-cli.test.ts](scripts/plugin-bridge-cli.test.ts) 对 `plugin:status`、`plugin:send`、`plugin:preview`、`plugin:inspect`、`plugin:reconstruct` 的 fixture 化覆盖，补齐 mutating queue、只读命令免 `--node-ids`、preview artifact 导出、preview 空选择拒绝、frame inspect 预览落盘、inspect capability 拒绝、reconstruction job 列表输出、hybrid / raster-exact 创建分支 workflow hint、`--context-pack` artifact 落盘合同、`--submit-analysis` 输入校验与回写、`--review-font` / `--review-asset` / `--approve-plan` / `--request-changes` 审核推进分支，以及 `--apply` / `--clear` / `--render` / `--measure` / `--refine` / `--iterate` / `--loop` 的执行闭环输出
- 新增 [server/api-routes.test.ts](server/api-routes.test.ts)，用临时端口拉起本地 API，覆盖 plugin session 注册、reconstruction job create/list/get、`context-pack` 构建、`submit-analysis` 参数校验和 404 route，开始把验证从 CLI fixture 扩展到真实 HTTP route 层
- 新增 [scripts/create-acceptance-report.mjs](scripts/create-acceptance-report.mjs) 和 [scripts/create-acceptance-report.test.ts](scripts/create-acceptance-report.test.ts)，提供 `npm run acceptance:new` 脚手架，能直接生成 live bridge / reconstruction / plugin smoke 的验收 `.md + .json` 报告骨架
- 新增 [scripts/create-acceptance-preflight.mjs](scripts/create-acceptance-preflight.mjs) 和 [scripts/create-acceptance-preflight.test.ts](scripts/create-acceptance-preflight.test.ts)，提供 `npm run acceptance:preflight`，能在 live 验收前先落盘 bridge snapshot、selection summary 和 preview artifact
- 新增 [scripts/prepare-live-acceptance.mjs](scripts/prepare-live-acceptance.mjs)、[scripts/prepare-live-acceptance.test.ts](scripts/prepare-live-acceptance.test.ts) 和 [reports/acceptance/RUNBOOK.md](reports/acceptance/RUNBOOK.md)，提供 `npm run acceptance:prep`，把 live 验收记录骨架与 preflight artifact 用同一 timestamp 一次准备好，并固定最后的实机验收步骤

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
