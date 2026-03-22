# Codex to Figma Plugin

这个目录是正式的 Figma 执行器源码包。

它负责：

- 读取当前 selection
- 导出选中节点预览
- 通过 Figma Plugin API 执行结构化 capability 命令
- 通过本地 bridge 和 Codex / Claude 工作流通信

当前已经实现的 capability：

- `selection.refresh`
- `fills.set-fill`
- `strokes.set-stroke`
- `geometry.set-radius`
- `nodes.set-opacity`
- `styles.upsert-paint-style`
- `variables.upsert-color-variable`

开发规则：

- 源码在 `src/`
- 运行时模块在 `src/runtime/`
- 只把 `dist/manifest.json` 导入到 Figma Desktop
- 不直接导入 `src/`

常用命令：

```bash
npm run build:plugins
npm run plugin:status
npm run plugin:send -- --prompt "把当前选中对象改成粉色"
npm run plugin:preview
```

导入路径：

- `/Users/hirohi/Figmatest/plugins/codex-to-figma/dist/manifest.json`

插件名称：

- `Codex to Figma`
