# Code-to-Figma Preflight

## Summary

在不把 `browser/live UI -> Figma` 主链拉进正式支持面的前提下，先补一条严格的源码预检链，用来判断某个前端项目是否落在“桌面端、静态态、可编辑、禁止降级”的可逆子集内。

## Scope

- 定义 `editable-exact / desktop / forbid-degradation` 的前端可逆子集 v1
- 为本地 React/CSS 项目提供 fail-fast preflight CLI
- 对 CSS、TSX/JS 的高风险不可逆特性给出结构化 blocker / warning
- 明确这条链只做 feasibility audit，不直接生成 Figma，不承诺 code-to-canvas 主线

## Dependencies

- `README.md`
- `doc/Roadmap.md`
- `doc/Test-Standards.md`
- `scripts/code-to-figma-preflight.ts`
- `shared/code-to-figma-preflight.ts`

## Entry Conditions

- 当前正式支持面仍固定为 `Plugin API + localhost bridge`
- 即使 `Code -> Design` 已进入 experimental scope，preflight 仍只负责 feasibility audit，不负责 runtime snapshot / plan
- 任何“像素级且可编辑”承诺都必须先经过可逆子集预检

## Workstreams

- 定义前端可逆子集 v1，先收紧会直接破坏可编辑还原的 CSS/TSX blocker
- 提供本地 CLI 和结构化报告，让外部项目能被直接审计
- 用文档和 Roadmap 明确这条链是 preflight，而不是生成器主链

## Closure Tasks

- 补齐 preflight 的 CSS / TSX blocker 与 warning contract，并收成 shared 可复用逻辑
- 补上 CLI 入口、输出格式、退出码和 fixture 化回归
- 在 README、Roadmap、Test Standards 与 CHANGELOG 中记录这条预检链的正式入口与边界

## Exit Conditions

- 可逆子集 v1 有明确 contract
- 本地项目可以通过 `npm run code-to-figma:preflight` 得到可解释的 PASS/BLOCKED 结果
- 不可逆特性会被显式拦截，而不是继续隐式承诺“差不多能还原”

## Risks

- 如果 blocker 集过松，后续实现会被不可能完成的页面拖垮
- 如果 blocker 集过严，会把仍可实现的页面过早排除
- 如果把 preflight 混同于 code-to-canvas 主链，产品边界会重新漂移

## Rollback

- 保留现有 Figma 读写与 reconstruction 主链不变
- 如 preflight 规则误伤，只回退新增的 audit 规则或 CLI，不扩大正式支持面
- 如 scope 再次漂移到 code-to-canvas 主线，先回退文档边界，再重新建 task

## Verification

- `node --test --import tsx shared/code-to-figma-preflight.test.ts scripts/code-to-figma-preflight.test.ts`
- `npm run typecheck`
- `npm run verify:docs`
- `npm run code-to-figma:preflight -- --project ../AItest --entry src/App.tsx --allow-blocked`
