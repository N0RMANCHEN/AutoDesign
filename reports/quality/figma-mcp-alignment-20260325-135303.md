# Figma MCP Alignment Assessment

- Timestamp: `20260325-135303`
- Scope: 对照 Figma 官方 MCP 文档，判断哪些能力与 `AutoDesign` 的产品愿景一致，哪些应排除在当前阶段之外。
- Owner: Codex

## Inputs

- Figma Help: Guide to the Figma MCP server
- Figma Developer Docs: Tools and prompts
- Figma Developer Docs: Write to canvas
- `README.md`
- `AGENT.md`
- `doc/Product-Standards.md`
- `doc/Roadmap.md`
- `doc/Capability-Catalog.md`
- `shared/plugin-capabilities.ts`

## Measurements

- 已对照官方 MCP 16 个工具族与 1 组高层能力说明。
- 与当前产品愿景直接一致的能力族：8 组。
- 与当前产品愿景弱一致或需降级取舍的能力族：2 组。
- 明确不应进入当前阶段主线的能力族：6 组。

## Findings

- 与产品愿景一致的主线集中在两类：
  - Figma 设计事实到前端实现上下文：`get_design_context`、`get_variable_defs`、`get_metadata`、`get_screenshot`、Code Connect 映射相关能力、`create_design_system_rules`。
  - 安全可控写回 Figma 的本地等价面：`use_figma` 中与现有本地 plugin runtime / bridge 重叠的安全子集，以及 `search_design_system` 所代表的设计系统检索能力。
- 这些能力应以“本地等价能力收敛”进入 Roadmap，而不是把官方 remote MCP、hosted endpoint 或 SaaS 化能力直接写成当前主线。
- `generate_figma_design`、FigJam 相关能力、Make 资源、`whoami`、`create_new_file`、remote hosted MCP endpoint 不应进入当前阶段 active 主线。原因分别是：
  - 更接近 code-to-canvas、协作白板、账号/seat 平台能力或远程服务能力。
  - 与当前产品的两条核心目标不直接重合。
  - 现有架构的正式写回主链仍是 `Plugin API + localhost bridge`。
- 当前仓库对官方 MCP 的最接近等价面，已经存在但仍不完整：
  - `plugin:inspect` / `plugin:preview` / subtree inspection 对应 `get_metadata` / `get_screenshot` 的本地子集。
  - workspace component mapping / context pack 对应 `get_design_context` / Code Connect 的本地子集。
  - plugin capabilities 对应 `use_figma` 的本地子集。
- 当前仓库与官方 MCP 的主要缺口，不在“有没有 MCP 这个词”，而在能力面收敛不足：
  - variables 仍只有 color variable 的窄实现。
  - page / section、variant / instance property / override、library asset read/search 仍未补齐。
  - 设计上下文输出还没稳定到可以清晰对齐 `get_design_context` / `get_variable_defs`。

## Artifacts

- `reports/quality/figma-mcp-alignment-20260325-135303.md`
- `reports/quality/figma-mcp-alignment-20260325-135303.json`
- `doc/plans/figma-mcp-alignment.md`
- `doc/Roadmap.md`

## Follow-up

- 在 `Roadmap` 新增独立 active work，只收纳与产品愿景一致的 MCP 对齐项。
- 后续按三阶段推进：
  - 先收紧 read/context 等价面。
  - 再补 design system / mapping / library 等价面。
  - 最后补 safe write parity 子集。
- 保持 support boundary 不变：官方 remote MCP 与本地 bridge 不混写。
