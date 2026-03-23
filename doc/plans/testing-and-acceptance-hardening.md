# Testing and Acceptance Hardening

## Summary

把 `Test-Standards` 从长期规则落成实际执行链，补齐 capability、inspection、reconstruction、bridge 和发布前验收的真实验证路径。

## Scope

- 为高风险 capability 和 targeting 补自动化验证
- 为 subtree inspection、clear/apply、render/measure/refine 补关键回归
- 在 `reports/acceptance/` 和 `reports/quality/` 沉淀验收与评分结果
- 建立发布前、回归后、重大架构修改后的最低验收清单

## Exit Conditions

- `Test-Standards` 中的必测场景有对应执行载体
- 关键工作流不再只靠临时手工验证
- 新增 capability 或重建主链变化有明确验收要求

## Risks

- live Figma session、本地 bridge 和 CLI 强依赖本机环境，验证链容易中断
- 如果没有持续更新报告层，测试规则会再次停留在文档层

## Rollback

- 保留长期测试规则
- 回退高风险自动化用例或局部验收脚本
- 必要时暂退到手工验收，但必须保留报告记录
