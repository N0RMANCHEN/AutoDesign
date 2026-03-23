# Action Prompt - CodeGraph / Branch Next Steps

Schema: `doc/ai/runtime/contracts/graphpatch.codegraph.schema.json`
当前接入状态：工作台本地模拟 action，可替换为真实模型调用

你将收到一个 `Context Pack JSON`，其中包含当前选中的设计或实现节点摘要，以及可选的 `primaryId`、位置信息和约束字段。

## 任务

围绕当前主节点生成 2 到 4 个“下一步分支”，用于继续推进设计评审、实现拆分或联调排查。

每个分支节点应包含：

- `title`：短标题
- `text`：1 到 3 行，说明这个分支要解决什么问题

如果提供了 `primaryId`，请为每个分支建立从主节点出发的连接。

## 位置规则

- 若存在主节点位置：分支放在主节点右侧纵向排列
- 建议偏移：`x = primary.x + 360`
- 建议偏移：`y = primary.y + i * 160`
- 若没有位置数据：在 `questions` 中请求补充，不要猜

## 约束

- 严格尊重 `constraints.maxNewNodes`
- 如果不允许创建边，不要强行创建
- 输出必须是 JSON only

## 稳定 ID 规则

- node id：`ai_branch_<primaryId|hash>_<i>`
- edge id：`ai_e_branch_<primaryId|hash>_<i>`
