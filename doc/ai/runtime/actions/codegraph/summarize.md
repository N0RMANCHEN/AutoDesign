# Action Prompt - CodeGraph / Summarize Selection

Schema: `doc/ai/runtime/contracts/graphpatch.codegraph.schema.json`
当前接入状态：工作台本地模拟 action，可替换为真实模型调用

你将收到一个 `Context Pack JSON`，其中包含 `graphKind="codegraph"`，以及选中设计节点、实现节点或联调片段的摘要。

## 任务

为当前选中内容生成一个新的摘要节点，用于快速回顾当前信息。

建议输出：

- `kind: "note"`
- `title: "Summary"`
- `text`：150 到 300 字中文摘要，优先保留关键设计约束、实现状态和未决问题

如果提供 `primaryId`，可以新增一条连接，将主节点指向摘要节点。

## 位置规则

- 若存在主节点位置：摘要节点放在主节点右侧 `(+360, 0)`
- 若没有位置数据：在 `questions` 中请求补充，不要猜

## 约束

- 默认只新增 1 个节点
- 严格尊重 `constraints.maxNewNodes`
- 输出必须是 JSON only

## 稳定 ID 规则

- node id：`ai_summarize_<primaryId|hash>_1`
- edge id：`ai_e_summarize_<primaryId|hash>_1`
