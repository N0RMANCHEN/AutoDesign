# Workspace Plugin Architecture Hardening

## Summary

继续收紧 `Workspace`、`Plugin`、`Bridge`、`Shared` 四层职责，减少跨层耦合和隐式状态，把 inspection、structure writing、targeting、reconstruction orchestration 收敛到明确边界内。

## Scope

- 收紧写入方向和 capability 执行边界
- 补全 subtree inspection 和结构理解能力
- 明确 auto layout、mask、component / instance 的读取与写入边界
- 补强 server / plugin / shared 的测试门槛

## Exit Conditions

- 工作台不直接写 Figma
- bridge 不持有 Figma 运行时对象
- shared 不依赖运行时层
- 关键结构能力有对应文档和验证路径

## Risks

- reconstruction 和 capability 扩展仍在快速演化，边界容易再次漂移
- live session 与本地工具链耦合较深，错误可能横跨多层

## Rollback

- 回退单项能力变更
- 恢复旧 capability 行为
- 保留已稳定的文档治理，不回滚治理层
