# Workspace Plugin Architecture Hardening

## Summary

继续收紧 `Workspace`、`Plugin`、`Bridge`、`Shared` 四层职责，减少跨层耦合和隐式状态，把 inspection、structure writing、targeting、reconstruction orchestration 收敛到明确边界内。

## Scope

- 收紧写入方向和 capability 执行边界
- 补全 subtree inspection 和结构理解能力
- 明确 auto layout、mask、component / instance 的读取与写入边界
- 补强 server / plugin / shared 的测试门槛

## Dependencies

- `shared/` capability / targeting / bridge contracts
- `server/` runtime routes、truth store、reconstruction orchestration
- `plugins/autodesign/` runtime handlers
- `scripts/plugin-bridge-cli.ts`
- `scripts/check_architecture_governance.mjs`
- `scripts/check_runtime_write_surfaces.mjs`

## Entry Conditions

- 正式写回主链仍固定为 `Plugin API + localhost bridge`
- `Workspace` 不直接触碰 Figma runtime 的规则已经建立
- shared contract 已作为 plugin / server / scripts 共享边界使用

## Workstreams

- 收紧 workspace / bridge / plugin / shared 的 owner boundary 与依赖方向
- 把 inspection、targeting、external dispatch 与 capability 执行收敛成稳定 contract
- 补强架构热点的治理脚本、纯逻辑测试与 CLI 行为回归

## Closure Tasks

- 继续拆解 server / plugin / scripts / shared 的剩余热点文件，避免新逻辑继续堆到单点大文件
- 收紧 `plugin:send`、bridge CLI 与 prompt composition 的安全边界，确保外部写命令可解释且可拒绝
- 为 subtree inspect、component / instance、mask、auto layout 边界补齐回归测试和文档断言
- 让 runtime write surface / governance checks 对新 owner 漂移保持自动拦截

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

## Verification

- `npm run governance:check`
- `npm run test:unit`
- 涉及 CLI 行为时补 `node --test --import tsx scripts/plugin-bridge-cli.test.ts`
