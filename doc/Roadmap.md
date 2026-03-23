# AutoDesign Roadmap

- 更新日期：2026-03-23
- 维护规则：本文件只保留当前执行真相，不保留历史流水；已完成事项应移出 active list，并在 `CHANGELOG.md` 或 `reports/` 留痕。

## 1. 当前执行面板

- `current_focus`: `文档治理体系落地 + 架构边界收紧 + reconstruction workflow 稳定化 + 测试验收补强`
- `plugin_runtime`: `active`
- `workspace_runtime`: `active`
- `bridge_runtime`: `active`
- `documentation_governance`: `in_progress`
- `active_owner_cap`: `1`

## 2. Active Work

### R1 文档治理体系重建

- 状态：`in_progress`
- 目标：按 Soul-seed 模式完成治理层、产品标准层、测试标准层、Roadmap、plans、reports、CHANGELOG 的分层重建
- Plan：[documentation-governance-rebuild.md](/Users/BofeiChen/AutoDesign/doc/plans/documentation-governance-rebuild.md)
- 出口：
  - 正式文档入口稳定
  - `Roadmap` 只保留 active work
  - `CHANGELOG` 变成版本化追踪
  - `reports/` 承接验收和质量证据
  - 其他 Dev AI 可以只按文档入口完成接手

### R2 Workspace / Plugin / Bridge 架构硬化

- 状态：`in_progress`
- 目标：继续收紧三大运行面边界，减少职责漂移和跨层耦合
- Plan：[workspace-plugin-architecture-hardening.md](/Users/BofeiChen/AutoDesign/doc/plans/workspace-plugin-architecture-hardening.md)
- 当前重点：
  - 写入方向和共享协议治理
  - subtree inspection 与结构写入能力补全
  - plugin / server / shared 的测试门槛补齐

### R3 Reconstruction Workflow 稳定化

- 状态：`in_progress`
- 目标：把参考图回归链路收紧成“先看、再比、单局部修改、复看、再打分”的可编辑主链
- Plan：[reconstruction-workflow-hardening.md](/Users/BofeiChen/AutoDesign/doc/plans/reconstruction-workflow-hardening.md)
- 当前重点：
  - 目标 Frame 清旧层
  - inspect / render / measure / refine 闭环稳定
  - 结构优先、可编辑优先、栅格仅用于诊断

### R4 测试与验收体系补强

- 状态：`todo`
- 目标：把 `Test-Standards` 真正落成可执行的测试与验收链，不再只停留在规范层
- Plan：[testing-and-acceptance-hardening.md](/Users/BofeiChen/AutoDesign/doc/plans/testing-and-acceptance-hardening.md)
- 当前重点：
  - capability / inspect / reconstruction 的必测场景补齐
  - `reports/acceptance` 和 `reports/quality` 的实际使用
  - 发布前和回归后的验收模板沉淀

### R5 Figma-to-React 上下文链收敛

- 状态：`todo`
- 目标：把工作台从“上下文整理”继续推进到更稳定的前端改造入口
- Plan：[workspace-context-pack-hardening.md](/Users/BofeiChen/AutoDesign/doc/plans/workspace-context-pack-hardening.md)
- 当前重点：
  - context pack 的稳定性
  - component mapping 和 review queue 可追踪化
  - 与 plugin / reconstruction 结果的边界收敛

## 3. 当前风险

- 文档治理刚完成重建，后续如不持续维护，仍会重新退化为重复事实和失效入口
- reconstruction 仍处在高变动阶段，评分和 refine workflow 需要继续收紧
- structure-first 的目标已明确，但 component / instance / auto layout 的写能力还需持续补齐
- 测试标准和报告层已经建立，但自动化验证与真实验收沉淀仍不完整

## 4. Deferred

- 多用户协作、数据库、鉴权
- 生产级线上服务化
- 完整自动化 React 生成流水线

## 5. 维护规则

- 活跃主题先入 `Roadmap`，再配套 `doc/plans/*`
- 计划文档描述 how；本文件只描述 what / status
- 验收与测量进 `reports/`
- 对用户或工作流有意义的变化进 `CHANGELOG.md`
