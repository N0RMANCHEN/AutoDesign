# Runtime AI（设计联调助手）

## 作用

Runtime AI 用于 Figmatest 的设计联调场景，负责消费一份结构化 `Context Pack`，然后返回可审阅的结构化结果。

它适合处理的任务包括：

- 摘要选中的设计或实现信息
- 生成下一步分支
- 把零散节点整理成更清晰的结构
- 生成学习或实施路径

## 使用方式

1. 选择一个 action prompt，例如 `actions/codegraph/summarize.md`
2. 准备对应的 `Context Pack JSON`
3. 将 `SYSTEM_PROMPT.md` 作为 system prompt
4. 要求模型返回严格 JSON
5. 在应用结果前先做校验与人工预览

## 输入要求

`Context Pack` 至少应说明：

- 当前任务类型
- 选中对象及其摘要
- 关键位置或层级信息
- 约束项，例如 `maxNewNodes`
- 缺省时不允许模型自行猜测的字段

## 输出要求

- 输出必须是 JSON only
- 如果上下文不足，应在 `questions` 中明确请求补充
- 输出中的建议、节点、边、布局应尽量稳定和可重复
- 任何会影响结构的动作都应遵守最小变更原则

## 注意事项

- Runtime AI 是辅助工具，不是事实来源
- 设计结论与实现结论都需要人工确认
- Prompt 与 `contracts/*.json` 后续必须继续对齐，否则文档会失效
