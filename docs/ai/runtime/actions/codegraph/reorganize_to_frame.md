# Action Prompt - CodeGraph / Reorganize Into Frame

你将收到一个 `Context Pack JSON`，其中包含选中节点集合、可选的 `bbox`、以及是否允许连边等约束。

## 任务

把当前零散节点整理进一个新的 `frame` 容器中，目标是提升结构可读性，而不是改写内容本身。

最小可行输出应包含：

- 新增一个 `frame` 节点
- 调整选中节点位置，使其落在 frame 范围内
- 默认不新增和删除边，除非约束明确允许且任务明确要求

## 位置规则

- 若提供 `bbox`：frame 放在 `bbox` 左上角外扩 `80` 像素
- 宽高建议为 `bbox + 160` margin
- 若没有 `bbox`：在 `questions` 中请求补充

## 约束

- 不修改节点正文
- 不假设不存在的布局信息
- 输出必须是 JSON only

## 稳定 ID 规则

- frame id：`ai_frame_<primaryId|hash>_1`
