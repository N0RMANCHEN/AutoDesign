# Figma MCP Alignment

## Summary

只把与 `AutoDesign` 产品愿景一致的 Figma MCP 能力收敛成本地等价面，避免把官方平台能力、remote hosted MCP 和当前产品主线混写。

## Scope

- Phase 1: 收紧 read/context 等价面
  - 对齐 `get_design_context`、`get_variable_defs`、`get_metadata`、`get_screenshot` 的本地 contract
  - 当前真相：`/api/runtime/variable-defs` 与 `/api/runtime/design-context` 在显式提供 `targetSessionId` 时，已经能返回 plugin session 上报的 live local variable snapshot；`/api/runtime/design-context` 还会直接返回 cached plugin selection 的 dependency truth；`/api/runtime/node-metadata` 的缓存 summary 也已开始包含 style / variable bindings，并可解析到 plugin session 上报的 local style / variable definitions；同时还会返回子树级 resolved / unresolved style and variable dependency pack；未提供 session 时继续保留显式 gap marker
  - 先收紧 layout tree、constraints、component / instance / variant、preview metadata 等结构化设计事实
  - 让 context pack、selection / inspect / preview 输出更稳定地服务 Figma-to-React 改造
  - prototype / interaction 暂只允许 read-only metadata 研究，不直接承诺业务逻辑生成
- Phase 2: 收紧 design system 等价面
  - 收敛 component mapping、review queue、Code Connect-like mapping contract
  - 当前真相：`library asset` 已补成 `ProjectData -> workspace asset catalog -> /api/workspace/library-assets/search` 的本地 read/search 边界，workspace UI 只消费 narrowed asset card，不再理解底层 asset relation ids
  - 当前真相：component mapping 的 implementation target / evidence 已补成 `ProjectData -> workspace mapping card -> /api/workspace/mapping-contract` 的显式 contract，workspace UI 不再把 Code Connect-like 真相埋在 `notes`
  - 输出 design-system-aware rules / instructions，而不是直接承诺生产级代码生成
- Phase 3: 收紧 safe write parity 子集
  - 在本地 plugin runtime / bridge 下补齐与 `use_figma` 重叠的高价值安全子集
  - 优先 pages / sections、完整 variables、variant / instance property / override、layout / style 写能力
- 明确非范围：
  - remote hosted MCP endpoint
  - `whoami`
  - FigJam / Mermaid diagram workflow
  - Make 资源链
  - browser/live UI -> Figma 的 code-to-canvas
  - 跨 team drafts 的 blank file provisioning
  - 直接从 prototype / interaction 自动生成 routing / state / form logic

## Dependencies

- `README.md`
- `AGENT.md`
- `doc/Product-Standards.md`
- `doc/Roadmap.md`
- `doc/Capability-Catalog.md`
- `shared/plugin-capabilities.ts`
- `src/` workspace context pack / component mapping
- `server/` bridge routes and storage
- `plugins/autodesign/` runtime capability handlers
- `reports/quality/figma-mcp-alignment-20260325-135303.md`

## Entry Conditions

- 正式写回主链仍固定为 `Plugin API + localhost bridge`
- MCP 相关能力先做产品取舍，再进入 implementation
- Roadmap 与 plan 对“本地等价能力”和“官方 remote MCP 平台能力”保持分离

## Workstreams

- 收紧 read/context parity，先固定本地设计事实读取 contract
- 收紧 design system parity，让 mapping / review / evidence 可追踪
- 收紧 safe write parity，只保留与当前产品主线重叠的高价值子集

## Closure Tasks

- 把 `get_design_context`、`get_variable_defs`、`get_metadata`、`get_screenshot` 的本地等价面补齐到稳定 contract + 测试 + 入口脚本
- 把 Code Connect-like mapping 语义继续从宽泛 notes 收敛成显式 link / evidence / review contract
- 把 safe write parity 子集明确到 capability catalog、runtime handler 与回归测试，不让 write 面继续泛化
- 用文档和治理脚本持续阻止 remote hosted MCP、FigJam、Make、code-to-canvas 回流进当前 active scope

## Exit Conditions

- read/context 等价面有明确 contract、测试和工作流入口
- design system / mapping 等价面可追踪，并能稳定服务 Figma-to-React 主链
- safe write parity 子集在 capability catalog、plugin runtime 和回归测试中闭环
- 非范围项继续停留在 deferred / future，不回流成当前主线

## Risks

- 如果把“官方 MCP 工具名”直接当成产品任务，Roadmap 会漂移成平台能力清单
- 如果 read/context 与 write parity 同时铺开，容易再次造成 shared / server / plugin 职责污染
- Code Connect-like mapping 如果没有 review queue 和证据链，容易沦为不可审计的隐式状态

## Rollback

- 保留现有 `Plugin API + localhost bridge` 正式写回主链
- 只回退新增的对齐层，不回退已有 inspect / preview / context pack / capability 稳定面
- 如某阶段能力边界不清，退回报告结论和 plan scope，再重新建 task

## Verification

- `npm run verify:docs`
- `npm run check:report-schemas`
- 涉及 capability catalog 或 shared contract 时，补 `npm run test:unit`
- 涉及目录职责、truth store owner 或 plugin runtime 写面时，补 `npm run governance:check`
