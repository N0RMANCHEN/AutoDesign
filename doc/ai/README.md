# AutoDesign AI Docs

本目录是 `AutoDesign` 的 AI 文档总入口，分成两层：

- Dev AI：仓库协作、文档治理、代码与工作流交付
- Runtime AI：`Context Pack -> action prompt -> schema -> JSON output` 的运行时契约

## Dev AI

Dev AI 相关规则不放在本目录，统一入口为：

1. [AGENT.md](../../AGENT.md)
2. [contributing_ai.md](../../contributing_ai.md)
3. [doc/Project-Map.md](../Project-Map.md)

## Runtime AI

Runtime AI 相关文档入口：

1. [runtime/README.md](runtime/README.md)
2. [runtime/SYSTEM_PROMPT.md](runtime/SYSTEM_PROMPT.md)
3. `runtime/actions/**`
4. `runtime/contracts/**`

## 当前状态

当前 Runtime AI 文档描述的是一套正式契约方向，但仓库里的实际接入状态仍是：

- 工作台内已有 “Runtime AI 测试台”
- action 目前由本地模拟逻辑驱动
- schema 已存在，可作为 JSON 输出校验基线
- 真实模型接入仍属于后续演进项，不应在文档中伪装成既成事实
