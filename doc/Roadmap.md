# AutoDesign Roadmap

- 更新日期：2026-03-24
- 维护规则：本文件只保留当前执行真相，不保留历史流水；已完成事项应移出 active list，并在 `doc/plans/archive/`、`CHANGELOG.md` 或 `reports/` 留痕。

## 1. 治理规则

- live task 只允许：`todo` / `in_progress` / `blocked` / `acceptance_pending`
- `done` 只属于 archive closure，不属于 live 状态模型
- 已关闭任务如果再次漂移，必须新开 task，不回写旧 closure

## 2. 当前执行面板

- `current_focus`: `文档治理体系落地 + design-core 主干迁移 + reconstruction workflow 稳定化 + plugin runtime / bridge CLI 降污 + 测试验收补强`
- `plugin_runtime`: `active`
- `workspace_runtime`: `active`
- `bridge_runtime`: `active`
- `documentation_governance`: `in_progress`
- `active_owner_cap`: `1`
- `support_boundary`: 工作台上下文整理，以及 `plugin:status` / `plugin:inspect` / `plugin:preview` / `plugin:send` 所代表的 `Plugin API + localhost bridge` 主链为当前正式支持面；`plugin:reconstruct`、Runtime AI 测试台、本地 `Context Pack -> action` 模拟链为 experimental；生产级自动 React 生成、MCP 主写回、SaaS 化能力为 future target。

## 3. Active Work

### R1 文档治理体系重建

- 状态：`in_progress`
- 目标：完成治理层、产品标准层、测试标准层、Roadmap、plans、reports、CHANGELOG 的分层重建，并补上模板与文档门禁
- Plan：[documentation-governance-rebuild.md](plans/documentation-governance-rebuild.md)
- 出口：
  - 正式文档入口稳定
  - `Roadmap` 只保留 active work
  - `CHANGELOG` 变成版本化追踪
  - `reports/` 承接验收和质量证据
  - 其他 Dev AI 可以只按文档入口完成接手

### R2 Workspace / Plugin / Bridge 架构硬化

- 状态：`in_progress`
- 目标：继续收紧三大运行面边界，减少职责漂移和跨层耦合
- Plan：[workspace-plugin-architecture-hardening.md](plans/workspace-plugin-architecture-hardening.md)
- 当前重点：
  - design-task / design-core 继续从 reconstruction compatibility 提升为通用主干
  - server / plugin / scripts / shared 的大文件继续拆成 contracts / adapters / routes / services
  - plugin runtime 与 bridge CLI 的职责边界继续收紧，并维持共享协议不漂移
  - plugin / server / shared 的测试门槛补齐

### R3 Reconstruction Workflow 稳定化

- 状态：`in_progress`
- 目标：把参考图回归链路收紧成“先看、再比、单局部修改、复看、再打分”的可编辑主链
- Plan：[reconstruction-workflow-hardening.md](plans/reconstruction-workflow-hardening.md)
- 当前重点：
  - reconstruction facade 继续兼容，但 analysis / elements / scoring / iteration policy 已开始共用 design-core
  - inspect / render / measure / refine / loop 闭环继续以单区域迭代、逐元素评分、score diff 和 stop reason 为主线收紧
  - guide manifest、element scoring、局部 crop 评分、结构优先与可编辑优先继续作为稳定边界

### R4 测试与验收体系补强

- 状态：`in_progress`
- 目标：把 `Test-Standards` 真正落成可执行的测试与验收链，不再只停留在规范层
- Plan：[testing-and-acceptance-hardening.md](plans/testing-and-acceptance-hardening.md)
- 当前重点：
  - capability / inspect / reconstruction / design-core / plugin runtime command handlers / bridge CLI reconstruct 的必测场景补齐
  - `test:unit` 收口 shared targeting、CLI guard、capability registry、governance scripts、prompt composition、context pack、runtime action、project storage、plugin bridge store、reconstruction analysis contract、element model / scoring、reconstruction store lifecycle、execution service 与 plugin runtime helpers / handlers 的纯逻辑回归
  - `reports/acceptance` 和 `reports/quality` 的实际使用
  - 发布前和回归后的验收模板沉淀

### R5 Figma-to-React 上下文链收敛

- 状态：`todo`
- 目标：把工作台从“上下文整理”继续推进到更稳定的前端改造入口
- Plan：[workspace-context-pack-hardening.md](plans/workspace-context-pack-hardening.md)
- 当前重点：
  - context pack 的稳定性
  - component mapping 和 review queue 可追踪化
  - 与 plugin / reconstruction 结果的边界收敛

## 3. 当前风险

- 文档治理刚完成重建，后续如不持续维护，仍会重新退化为重复事实和失效入口
- reconstruction 仍处在高变动阶段，评分、iteration policy 和 refine workflow 需要继续收紧
- structure-first 的目标已明确，但 component / instance / auto layout 的写能力还需持续补齐
- plugin runtime 与 bridge CLI 虽已明显降污，但 reconstruct 子命令与共享 command composer 仍是剩余热点
- 测试标准和报告层已经建立，但自动化验证与真实验收沉淀仍不完整

## 4. Archive Handoff

- 当前还没有正式 closure 迁入 `doc/plans/archive/`
- 后续 task 关闭时，默认补一份 archive closure，再从本文件移出

## 5. Deferred

- 多用户协作、数据库、鉴权
- 生产级线上服务化
- 完整自动化 React 生成流水线

## 6. 维护规则

- 活跃主题先入 `Roadmap`，再配套 `doc/plans/*`
- 计划文档描述 how；本文件只描述 what / status
- 已关闭主题转入 `doc/plans/archive/*`
- 验收与测量进 `reports/`
- 对用户或工作流有意义的变化进 `CHANGELOG.md`
