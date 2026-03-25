# Workspace Context Pack Hardening

## Summary

把工作台从“设计信息整理”继续推进到稳定的前端改造入口，重点收紧 context pack、`design-context`、`metadata`、`variable defs`、mapping、review queue 和与 plugin / reconstruction 的边界。

## Scope

- context pack 输出结构收敛
- `design-context` / `metadata` / `variable defs` / `screenshot` / `node-metadata` / `bridge-overview` 的本地等价读层收敛；其中 `design-context` 需要直接携带 plugin selection dependency truth，workspace 测试台优先消费它，并拒绝执行过期的 context snapshot
- bridge command dispatch 也要收口到独立的 runtime write receipt，避免 workspace 直接消费原始 bridge command record
- workspace 自身的 design sources / design screen catalog / library asset catalog / mapping / review queue / selection defaults 也要通过稳定 read model 暴露，避免 UI 继续理解 `ProjectData` 原始存储结构
- mapping status、mapping contract、review queue item、workspace reset、figma sync 要补成窄化 write surface，而不是让 UI 整包 `PUT /api/project`
- layout / constraints / component / variant / preview metadata 先作为稳定设计事实输入
- `node-metadata` 需要能直接暴露子树级 style / variable dependency pack，避免 workspace 再自行回溯 plugin inspect 结果
- component mapping 和 screen mapping 的可追踪化
- review queue 的输入输出边界明确
- 与 plugin / reconstruction 结果的职责分界固定
- 语义增强只作为 context enrichment，不承诺生产级自动代码生成

## Dependencies

- `src/` workspace UI and read-model consumers
- `server/api-routes.ts`
- `shared/runtime-*.ts`
- `shared/workspace-read-model.ts`
- plugin selection / variable / metadata snapshots

## Entry Conditions

- workspace 已经有 `/api/workspace/read-model` 与 `/api/runtime/*` 基础读面
- selection / design screen / mapping / review queue 基础存储结构已存在
- `Plugin API + localhost bridge` 仍是 design truth 的唯一 live source

## Workstreams

- 把 runtime design facts 读层收敛成稳定 contract
- 把 workspace 自身 catalog / mapping / review surface 收敛成 narrowed read-write model
- 把 design truth 到前端改造上下文的 handoff 边界固定下来

## Closure Tasks

- 清掉 workspace 对原始 `/api/project`、bridge snapshot、command record 细节的剩余依赖
- 把 `design-context`、`metadata`、`variable defs`、`node-metadata` 的 stale guard 和 dependency truth 消费路径收稳
- 补齐 mapping contract、implementation target、evidence、review queue ownership 的显式输入输出
- 明确 context enrichment 与生产级自动 codegen 的边界，避免 workspace 回流成黑盒生成管道

## Exit Conditions

- context pack 与本地 design-context 读层可以稳定作为前端改造输入
- mapping 和 review 结果有清晰存储与审阅路径
- workspace 不再和 plugin / bridge 职责漂移
- workspace UI 不再直接消费 `/api/project`，而是优先消费稳定的 workspace / runtime read-write surface
- review queue 的 `status / owner` 更新通过窄化 receipt 写回，不再要求 UI 理解原始 `ReviewItem` 存储形状
- design screen truth 通过显式 workspace screen catalog 暴露，而不是让 UI 从泛化 `selection.options` 或原始 `designScreens` 存储形状里自行回推
- library asset truth 通过显式 workspace asset catalog 和 `/api/workspace/library-assets/search` 暴露，而不是让 UI 直接扫描底层 project asset store
- component mapping 的 implementation target / evidence 通过显式 mapping contract 暴露和写回，不再继续埋在宽泛 `notes` 文本里
- legacy `/api/project`、`/api/project/reset`、`/api/figma/sync` 不再作为工作台相关对外 surface 保留
- workspace 优先消费稳定的 runtime read/write surface，而不是 bridge snapshot / command record 细节
- 设计事实读取与后续语义推断 / 代码生成边界清晰

## Risks

- 设计真相与实现真相的边界仍容易混写
- 当前本地 JSON 存储适合验证，但长期治理仍需额外抽象
- 如果把 prototype / interaction 直接翻译为业务逻辑代码，workspace 容易漂移成不可审计的 codegen 流水线

## Rollback

- 保留现有 context pack 能力
- 回退高风险结构变更
- 不回退文档治理边界

## Verification

- `npm run test:unit`
- 涉及 workspace / runtime contract 时补 `npm run typecheck`
- 涉及 owner boundary、truth store、runtime write surface 时补 `npm run governance:check`
