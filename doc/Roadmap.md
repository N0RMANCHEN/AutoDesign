# AutoDesign Roadmap

- 更新日期：2026-03-25
- 维护规则：本文件只保留当前执行真相，不保留历史流水；已完成事项应移出 active list，并在 `doc/plans/archive/`、`CHANGELOG.md` 或 `reports/` 留痕。

## 1. 治理规则

- live task 只允许：`todo` / `in_progress` / `blocked` / `acceptance_pending`
- `done` 只属于 archive closure，不属于 live 状态模型
- 已关闭任务如果再次漂移，必须新开 task，不回写旧 closure

## 2. 当前执行面板

- `current_focus`: `文档治理体系落地 + design-core 主干迁移 + reconstruction workflow 稳定化 + plugin runtime / bridge CLI 降污 + 测试验收补强 + Figma MCP 对齐取舍`
- `plugin_runtime`: `active`
- `workspace_runtime`: `active`
- `bridge_runtime`: `active`
- `documentation_governance`: `in_progress`
- `active_owner_cap`: `1`
- `delivery_priority`: `R2 架构硬化 -> R3 reconstruction 稳定化 -> R4 测试验收闭环 -> R6 Phase 1 设计事实读层对齐 -> R5 Figma-to-React 上下文收敛`
- `support_boundary`: 工作台上下文整理，以及 `plugin:status` / `plugin:inspect` / `plugin:preview` / `plugin:send` 所代表的 `Plugin API + localhost bridge` 主链为当前正式支持面；`plugin:reconstruct`、Runtime AI 测试台、本地 `Context Pack -> action` 模拟链为 experimental；生产级自动 React 生成、MCP 主写回、SaaS 化能力为 future target。

## 3. Active Work

### R1 文档治理体系重建

- 状态：`in_progress`
- 目标：完成治理层、产品标准层、测试标准层、Roadmap、plans、reports、CHANGELOG 的分层重建，并补上模板与文档门禁
- Plan：[documentation-governance-rebuild.md](plans/documentation-governance-rebuild.md)
- 当前收口子任务：
  - 给每条 active work 和每份 active plan 补齐可执行子任务与完成判据，不再只保留主题级描述
  - 把文档门禁扩展到 active plan 结构完整性与 roadmap 收口字段完整性
  - 统一 `Roadmap`、`doc/plans/README.md`、`doc/plans/_template.md` 与实际 active plans 的治理结构
- 完成判据：
  - 正式文档入口稳定
  - `Roadmap` 只保留 active work
  - `CHANGELOG` 变成版本化追踪
  - `reports/` 承接验收和质量证据
  - 其他 Dev AI 可以只按文档入口完成接手

### R2 Workspace / Plugin / Bridge 架构硬化

- 状态：`in_progress`
- 目标：继续收紧三大运行面边界，减少职责漂移和跨层耦合
- Plan：[workspace-plugin-architecture-hardening.md](plans/workspace-plugin-architecture-hardening.md)
- 当前收口子任务：
  - 继续拆解 `server / plugin / scripts / shared` 剩余热点文件，避免跨层逻辑继续堆在单点大文件
  - 收紧 `plugin:send`、bridge CLI、external dispatch、prompt composition 的安全边界和失败提示
  - 把 subtree inspect、component / instance、mask、auto layout 的读写边界补齐到 contracts + tests
  - 保持 `design-core` 继续从 reconstruction compatibility 层提升为通用主干
- 完成判据：
  - 工作台不直接写 Figma
  - bridge 不持有 Figma 运行时对象
  - shared 不依赖运行时层
  - 关键结构能力有对应文档和验证路径

### R3 Reconstruction Workflow 稳定化

- 状态：`in_progress`
- 目标：把参考图回归链路收紧成“先看、再比、单局部修改、复看、再打分”的可编辑主链
- Plan：[reconstruction-workflow-hardening.md](plans/reconstruction-workflow-hardening.md)
- 当前收口子任务：
  - 收紧 source quad、remap preview、analysis draft、OCR / heuristic 辅助链，确保可重复且可显式失败
  - 继续补 guide manifest、element scoring、局部 crop、score diff、stop reason 的闭环回归
  - 把 apply / render / measure / refine / iterate / loop 的状态机与终止条件收成明确 contract
  - 为 vector 路径补齐“默认交付可编辑节点而非贴图 fallback”的硬门槛
- 完成判据：
  - reconstruction 可以稳定重复执行，不继续叠错层
  - 最终交付默认是可编辑节点，不是假装矢量化的贴图
  - 每轮 refine 都有可解释的目标区域和评分变化

### R4 测试与验收体系补强

- 状态：`in_progress`
- 目标：把 `Test-Standards` 真正落成可执行的测试与验收链，不再只停留在规范层
- Plan：[testing-and-acceptance-hardening.md](plans/testing-and-acceptance-hardening.md)
- 当前收口子任务：
  - 补齐 capability / inspect / reconstruction / design-core / plugin runtime / bridge CLI 的剩余失败路径回归
  - 把 `test:unit` 继续收口到 targeting、CLI guard、prompt composition、reconstruction contract 与 runtime helpers 的纯逻辑
  - 把 `reports/acceptance`、`reports/quality` 与 live acceptance runbook 固定成可复用执行链
  - 为发布前、回归后、重大架构改动建立最低验证清单
- 完成判据：
  - `Test-Standards` 中的必测场景有对应执行载体
  - 关键工作流不再只靠临时手工验证
  - 新增 capability 或重建主链变化有明确验收要求

### R5 Figma-to-React 上下文链收敛

- 状态：`in_progress`
- 目标：把工作台从“上下文整理”继续推进到更稳定的前端改造入口
- Plan：[workspace-context-pack-hardening.md](plans/workspace-context-pack-hardening.md)
- 当前收口子任务：
  - 清掉 workspace 对原始 `/api/project`、bridge snapshot、command record 细节的剩余依赖
  - 收稳 `design-context`、`metadata`、`variable defs`、`node-metadata` 的 stale guard 与 dependency truth 消费路径
  - 收紧 mapping contract、implementation target、evidence、review queue ownership 的显式输入输出
  - 继续把 layout / constraints / component / variant / preview metadata 固化为稳定设计事实输入
- 完成判据：
  - context pack 与本地 design-context 读层可以稳定作为前端改造输入
  - mapping 和 review 结果有清晰存储与审阅路径
  - workspace 不再和 plugin / bridge 职责漂移
  - workspace UI 不再直接消费 `/api/project`，而是优先消费稳定的 workspace / runtime read-write surface

### R6 Figma MCP 对齐取舍

- 状态：`in_progress`
- 目标：只把与产品愿景一致的 Figma MCP 能力收敛成本地等价面，避免产品被 remote MCP / FigJam / Make / SaaS 平台能力带偏
- Plan：[figma-mcp-alignment.md](plans/figma-mcp-alignment.md)
- 当前收口子任务：
  - 把 `get_design_context`、`get_variable_defs`、`get_metadata`、`get_screenshot` 的本地等价面补齐到 contract + tests + 入口
  - 继续收紧 Code Connect-like mapping 语义，把 link / evidence / review contract 显式化
  - 把 write parity 子集明确到 capability catalog、runtime handler 与回归测试，不再宽泛铺开
  - 继续通过文档与治理规则阻止 remote hosted MCP、FigJam、Make、code-to-canvas 回流进 active scope
- 完成判据：
  - read/context 等价面有明确 contract、测试和工作流入口
  - design system / mapping 等价面可追踪，并能稳定服务 Figma-to-React 主链
  - safe write parity 子集在 capability catalog、plugin runtime 和回归测试中闭环
  - 非范围项继续停留在 deferred / future，不回流成当前主线

## 4. 当前风险

- 文档治理刚完成重建，后续如不持续维护，仍会重新退化为重复事实和失效入口
- reconstruction 仍处在高变动阶段，评分、iteration policy 和 refine workflow 需要继续收紧
- structure-first 的目标已明确，但 component / instance / auto layout 的写能力还需持续补齐
- plugin runtime 与 bridge CLI 虽已明显降污，但 reconstruct 子命令与共享 command composer 仍是剩余热点
- 测试标准和报告层已经建立，但自动化验证与真实验收沉淀仍不完整
- 如不区分“本地等价能力”与“官方 MCP 平台能力”，Roadmap 很容易漂移到 hosted endpoint、FigJam、Make 和 SaaS 方向
- 如把设计语义推断直接升级成业务逻辑和自动代码生成承诺，Workspace 会从“稳定改造输入”漂移成高风险 codegen 管道

## 5. Archive Handoff

- 当前还没有正式 closure 迁入 `doc/plans/archive/`
- 后续 task 关闭时，默认补一份 archive closure，再从本文件移出

## 6. Deferred

- 多用户协作、数据库、鉴权
- 生产级线上服务化
- 完整自动化 React 生成流水线
- remote hosted MCP endpoint / identity / team drafts provisioning
- FigJam diagram workflow 与 Make 资源链
- browser / live UI -> Figma 的 code-to-canvas 主链

## 7. 维护规则

- 活跃主题先入 `Roadmap`，再配套 `doc/plans/*`
- 计划文档描述 how；本文件只描述 what / status
- 每条 active work 默认包含 `当前收口子任务` 与 `完成判据`
- 已关闭主题转入 `doc/plans/archive/*`
- 验收与测量进 `reports/`
- 对用户或工作流有意义的变化进 `CHANGELOG.md`
