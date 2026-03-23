# Workspace Context Pack Hardening

## Summary

把工作台从“设计信息整理”继续推进到稳定的前端改造入口，重点收紧 context pack、mapping、review queue 和与 plugin / reconstruction 的边界。

## Scope

- context pack 输出结构收敛
- component mapping 和 screen mapping 的可追踪化
- review queue 的输入输出边界明确
- 与 plugin / reconstruction 结果的职责分界固定

## Exit Conditions

- context pack 可以稳定作为前端改造输入
- mapping 和 review 结果有清晰存储与审阅路径
- workspace 不再和 plugin / bridge 职责漂移

## Risks

- 设计真相与实现真相的边界仍容易混写
- 当前本地 JSON 存储适合验证，但长期治理仍需额外抽象

## Rollback

- 保留现有 context pack 能力
- 回退高风险结构变更
- 不回退文档治理边界
