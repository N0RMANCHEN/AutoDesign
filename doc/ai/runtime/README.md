# Runtime AI

Runtime AI 用于 `AutoDesign` 的设计联调场景，负责消费结构化 `Context Pack`，输出严格、可校验、可预览的 JSON 结果。

## 当前接入状态

当前仓库里的真实状态是：

- 工作台包含 “Runtime AI 测试台”
- `Context Pack` 可在工作台生成
- action 当前由本地模拟逻辑驱动，代码入口在 `shared/runtime-actions.ts`
- `SYSTEM_PROMPT.md`、`actions/*`、`contracts/*` 已形成契约草案
- 真实模型接入仍未成为默认主链

因此，这里的文档必须明确区分：

- `implemented now`
  本地模拟 action、现有 schema、工作台测试台
- `planned`
  真实模型调用、正式服务编排、更严格的输出校验链

## 标准调用流程

1. 选择一个 action prompt
2. 生成对应的 `Context Pack JSON`
3. 使用 [SYSTEM_PROMPT.md](SYSTEM_PROMPT.md) 作为 runtime system prompt
4. 要求模型返回 JSON only
5. 按对应 schema 校验输出
6. 人工预览后再应用

## Action 与 Schema

| Action Domain | Actions | Schema |
| --- | --- | --- |
| `codegraph` | `summarize` / `branch` / `reorganize_to_frame` | `contracts/graphpatch.codegraph.schema.json` |
| `knowledge` | `summarize` / `branch` / `learning_path` | `contracts/graphpatch.knowledge.schema.json` |

## 输入要求

`Context Pack` 至少应说明：

- 当前任务类型
- 选中对象及其摘要
- `primaryId` 或其他主目标标识
- 位置信息、层级信息或其他足以执行 action 的关键字段
- 约束项，例如 `maxNewNodes`、`allowDelete`、`allowEdges`

缺少关键字段时，Runtime AI 不得猜测。

## 输出要求

- 输出必须是 JSON only
- 字段结构必须符合对应 schema
- 如果上下文不足，必须在 `questions` 中明确请求补充
- 任何结构性建议都应遵守最小变更原则

## 文档维护规则

- 新增 action 时，必须同时新增或复用对应 schema
- action 文档必须写明 `Schema` 和 `当前接入状态`
- 如果真实模型接入改变了当前行为，必须同步更新这里、`SYSTEM_PROMPT.md` 和相关计划文档
