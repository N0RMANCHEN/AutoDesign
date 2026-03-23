# AutoDesign - Claude Code Notes

> 本文件只保存 Claude Code 的工具适配信息。
> 项目真相以 [AGENT.md](AGENT.md)、[README.md](README.md) 和 [doc/Project-Map.md](doc/Project-Map.md) 为准。

## Read First

开始任何任务前，优先阅读：

1. [AGENT.md](AGENT.md)
2. [README.md](README.md)
3. [doc/Project-Map.md](doc/Project-Map.md)
4. [contributing_ai.md](contributing_ai.md)

## Primary Execution Surface

需要读取或操作 Figma 中的对象时，默认通过本地 bridge：

- Base URL: `http://localhost:3001`
- Session status: `GET /api/plugin-bridge`
- Send commands: `POST /api/plugin-bridge/commands`

当前正式写回主链是 `Plugin API + localhost bridge`，不是 MCP。

## Useful Commands

```bash
npm run dev
npm run build:plugins
npm run plugin:status
npm run plugin:inspect
npm run plugin:preview
npm run plugin:send -- --prompt "把当前选中对象改成粉色"
npm run plugin:reconstruct
npm run verify:docs
npm run verify:plugins
```

## Key Runtime Files

- `server/index.ts`
- `server/plugin-bridge-store.ts`
- `plugins/autodesign/src/main.ts`
- `plugins/autodesign/src/runtime/capability-runner.ts`
- `shared/plugin-capabilities.ts`
- `shared/plugin-contract.ts`
- `scripts/plugin-bridge-cli.ts`
