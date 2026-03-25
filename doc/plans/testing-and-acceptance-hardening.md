# Testing and Acceptance Hardening

## Summary

把 `Test-Standards` 从长期规则落成实际执行链，补齐 capability、inspection、reconstruction、bridge 和发布前验收的真实验证路径。

## Scope

- 为高风险 capability 和 targeting 补自动化验证
- 为 subtree inspection、clear/apply、render/measure/refine 补关键回归
- 在 `reports/acceptance/` 和 `reports/quality/` 沉淀验收与评分结果
- 建立发布前、回归后、重大架构修改后的最低验收清单

## Dependencies

- `doc/Test-Standards.md`
- `reports/acceptance/*`
- `reports/quality/*`
- `scripts/create-acceptance-*.mjs`
- `scripts/prepare-live-acceptance.mjs`
- `server/*.test.ts`
- `shared/*.test.ts`
- `scripts/*.test.ts`

## Entry Conditions

- `Test-Standards` 已经定义分层测试与必测场景
- 单测、CLI 测试与报告 schema 检查已经接入仓库脚本
- live acceptance 的脚手架、预检和模板已可用
- reconstruction quality report 已有模板与固定脚手架入口

## Workstreams

- 把 shared / server / plugin runtime / CLI 的必测场景补成可重复自动化验证
- 把 live acceptance / quality 报告沉淀成固定入口和固定模板
- 把 measured reconstruction job -> quality report -> artifact 这条证据链固定成可复查入口
- 把发布前、回归后、重大改动后的最低验证清单制度化

## Closure Tasks

- 把 capability targeting、prompt composition、bridge CLI、reconstruction state machine 的剩余失败路径补齐自动化回归
- 把 `reports/acceptance` 与 `reports/quality` 的生成、命名、引用和复查流程固定下来
- 让 `quality:prep` 能把 measured reconstruction job 的评分、gate、hotspot 和 preview artifact 固定回报告层
- 为插件写回、bridge online/offline、reconstruction live run 建立可复用的预检与验收 runbook
- 让新增 capability、workflow 语义变化、评分逻辑变化默认能映射到至少一层自动化验证

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

## Verification

- `npm run test:unit`
- `npm run check:report-schemas`
- `npm run verify`
