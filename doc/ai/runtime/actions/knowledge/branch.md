# Action Prompt - Knowledge / Propose Branches

Schema: `doc/ai/runtime/contracts/graphpatch.knowledge.schema.json`
当前接入状态：工作台本地模拟 action，可替换为真实模型调用

目标：围绕当前知识节点提出 2 到 4 个后续分支，用于拆解设计研究、实现验证或联调排查。

要求：

- 每个分支都要有清晰标题和简短说明
- 分支之间不要语义重复
- 严格输出结构化 JSON
- 尊重 `constraints.maxNewNodes`
- 如果缺少主节点或位置数据，在 `questions` 中请求补充
