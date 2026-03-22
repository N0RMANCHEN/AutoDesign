# AutoDesign - Claude Code 指引

> 本文件为 Claude Code 在本仓库中工作时的持久化上下文，避免每次会话重复解释。

## 项目概览

AutoDesign 是一个 Figma + React 联调仓库，包含三个子系统：

- **Client**：Vite + React 工作台，端口 `5173`
- **Server**：Node API / Bridge，端口 `3001`
- **Figma Plugin**：运行在 Figma 桌面版内，通过 HTTP 与 Server 通信

## Figma 插件 Bridge 链路

这是本项目最核心的 AI 协作链路。当需要读取或操作 Figma 中的元素时，**通过本地 bridge 完成，不依赖 Figma MCP**。

### 读取选中元素的步骤

1. 确认 server 在运行（`localhost:3001`）
2. 用户在 Figma 中运行 AutoDesign 插件并选中元素
3. 插件自动将 selection 上报到 bridge：
   ```
   GET http://localhost:3001/api/plugin-bridge
   ```
4. 返回的 `sessions[]` 按 `lastSeenAt` 降序排列，取最新的 online session
5. 每个 session 的 `selection[]` 包含选中节点信息：
   - `id` — Figma node ID
   - `name` — 节点名称
   - `type` — 节点类型（RECTANGLE, ELLIPSE, FRAME 等）
   - `fills` — 填充色数组
   - `previewDataUrl` — Base64 PNG 预览图（可解码后用 Read 工具查看）

### 向 Figma 发送命令

通过 bridge 命令队列：

```
POST http://localhost:3001/api/plugin-bridge/commands
Body: {
  targetSessionId: "<session_id>",
  source: "codex",
  payload: {
    source: "codex",
    commands: [{
      type: "capability",
      capabilityId: "<capability_id>",
      payload: { ... }
    }]
  }
}
```

### 本项目默认授权规则

- 用户已明确授权本项目中的 Dev AI 默认访问 `http://localhost:3001/api/*`
- 只要仍是当前仓库、本地 bridge、当前 Figma 会话范围，就不要重复询问 localhost bridge 权限
- 如果宿主工具仍然要求审批，属于运行时限制，不应解释为项目内未授权
- 如果目标地址、协议、端口或访问范围变化，再单独确认

支持的 capability：

| ID | 作用 | payload |
|---|---|---|
| `selection.refresh` | 刷新选区 | `{}` |
| `fills.set-fill` | 设置填充色 | `{ hex }` |
| `strokes.set-stroke` | 设置描边色 | `{ hex }` |
| `geometry.set-radius` | 设置圆角 | `{ value }` |
| `nodes.set-opacity` | 设置透明度 | `{ value }` (0-100) |
| `styles.upsert-paint-style` | 创建/更新样式 | `{ name, hex, applyToSelection? }` |
| `variables.upsert-color-variable` | 创建/更新变量 | `{ collectionName, variableName, hex, bindToSelection? }` |

### 预览图解码

selection 中的 `previewDataUrl` 是 `data:image/png;base64,...` 格式，解码保存为 PNG 后可用 Read 工具直接查看。

## 关键文件

- `server/index.ts` — API 路由（端口 3001）
- `server/plugin-bridge-store.ts` — session/command 持久化存储
- `plugins/autodesign/src/main.ts` — 插件入口
- `plugins/autodesign/src/runtime/selection-context.ts` — 选区读取
- `plugins/autodesign/src/runtime/capability-runner.ts` — 命令执行
- `shared/plugin-capabilities.ts` — capability 注册表
- `shared/plugin-contract.ts` — 命令契约
- `shared/plugin-command-composer.ts` — 自然语言 → 命令
- `data/autodesign-plugin-bridge.json` — bridge 数据文件

## 启动方式

```bash
npm run dev          # 同时启动 client + server
npm run plugin:status  # 查看插件连接状态
npm run plugin:send    # 发送命令到插件
npm run plugin:preview # 导出选区预览图
```

## 注意事项

- 以 `AGENT.md` 为最高优先级文档
- Plugin API + 本地 bridge 是当前主执行面，不是 MCP
- 插件心跳间隔 5s，超过 45s 无心跳则标记为 stale
- 插件每 1.5s 轮询一次命令队列
