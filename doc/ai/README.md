# AutoDesign AI 文档说明

本目录保存 AutoDesign 当前仓库的 AI 运行时设计文档。

目标不是描述“已经上线的 AI 产品能力”，而是提前定义：

- AI 能拿到什么上下文
- AI 可以执行哪些类型的辅助任务
- AI 必须输出什么结构
- 调用方该如何校验、预览和应用结果

入口如下：

- `doc/ai/runtime/README.md`
- `doc/ai/runtime/SYSTEM_PROMPT.md`
- `doc/ai/runtime/actions/**`
- `doc/ai/runtime/contracts/**`

这套文档主要服务于两类场景：

- 从 Figma 设计事实出发，给 Codex / Claude 更稳定的前端改造上下文
- 对设计与实现差异做结构化整理、总结和下一步建议
