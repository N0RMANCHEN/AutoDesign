# AutoDesign Plugin

这个目录是正式的 Figma 执行器源码包。

它负责：

- 读取当前 selection
- 导出选中节点预览
- 通过 Figma Plugin API 执行结构化 capability 命令
- 通过本地 bridge 和 Codex / Claude 工作流通信

当前已经实现的 capability：

- `selection.refresh`
- `fills.set-fill`
- `fills.clear-fill`
- `strokes.set-stroke`
- `strokes.clear-stroke`
- `strokes.set-weight`
- `effects.set-shadow`
- `effects.set-layer-blur`
- `effects.clear-effects`
- `geometry.set-radius`
- `geometry.set-size`
- `geometry.set-position`
- `nodes.set-opacity`
- `nodes.rename`
- `nodes.duplicate`
- `nodes.group`
- `nodes.frame-selection`
- `nodes.create-frame`
- `nodes.create-text`
- `nodes.delete`
- `text.set-content`
- `text.set-font-size`
- `text.set-font-family`
- `text.set-font-weight`
- `text.set-text-color`
- `styles.upsert-text-style`
- `styles.apply-style`
- `styles.detach-style`
- `styles.upsert-paint-style`
- `variables.upsert-color-variable`
- `undo.undo-last`

当前稳定性基线：

- 插件在 `bridge online` 和 `bridge offline` 两种状态下都必须能正常打开
- UI 外观保持既有 selection 列表，不因为稳定性硬化改变可见布局
- bridge 断连时插件只降级为 `offline`，不能触发插件环境加载失败
- 构建产物必须通过插件 smoke 校验，并保持 `manifest.ui + figma.showUI(__html__)` 结构
- 正式插件 UI 受 [ui.lock.json](ui.lock.json) 保护，未获用户明确授权不得修改

开发规则：

- 源码在 `src/`
- 运行时模块在 `src/runtime/`
- 只把 `dist/manifest.json` 导入到 Figma Desktop
- 不直接导入 `src/`

常用命令：

```bash
npm run build:plugins
npm run verify:plugin-ui-lock
npm run verify:plugins
npm run plugin:status
npm run plugin:reconstruct
npm run plugin:reconstruct -- --job <jobId> --analyze
npm run plugin:reconstruct -- --job <jobId> --context-pack
npm run plugin:reconstruct -- --job <jobId> --submit-analysis --analysis-file <path/to/analysis.json>
npm run plugin:reconstruct -- --job <jobId> --preview-plan
npm run plugin:reconstruct -- --job <jobId> --review-font --text-candidate <id> --font "SF Pro Display"
npm run plugin:reconstruct -- --job <jobId> --approve-plan
npm run plugin:reconstruct -- --job <jobId> --apply
npm run plugin:reconstruct -- --job <jobId> --clear
npm run plugin:reconstruct -- --job <jobId> --render
npm run plugin:reconstruct -- --job <jobId> --measure
npm run plugin:reconstruct -- --job <jobId> --refine
npm run plugin:reconstruct -- --job <jobId> --iterate
npm run plugin:reconstruct -- --job <jobId> --loop
npm run plugin:send -- --prompt "把当前选中对象改成粉色"
npm run plugin:send -- --prompt "行高 24"
npm run plugin:send -- --prompt "字距 1.2"
npm run plugin:send -- --prompt "居中对齐"
npm run plugin:preview
```

注意：

- reconstruction 默认会优先创建 `vector-reconstruction` job；主链是 `--analyze -> --context-pack -> --submit-analysis -> --apply -> --render -> --measure`
- `vector-reconstruction` 会保持 target frame 尺寸不变，只写入可编辑 vector/text 节点
- 只有 `approvalState=pending-review` 的 job 才需要 `--approve-plan`
- `raster-exact` 只保留给调试/对照，不再是默认主链
- `--preview-plan` / `--review-font` / `--loop` 主要用于 `structural-preview` job

导入路径：

- `plugins/autodesign/dist/manifest.json`

插件名称：

- `AutoDesign`

手动验收清单：

1. 重新导入 `plugins/autodesign/dist/manifest.json`
2. 在本地 bridge 未启动时打开插件，确认 UI 正常显示、selection 正常显示、bridge 状态为 `offline`
3. 启动本地 bridge 后重新打开插件，确认 bridge 状态切到 `online`
4. 实机执行至少 3 类命令：
   - 视觉：`把当前选中对象改成粉色`
   - 文本：`文本改成 "Hello World"`
   - 节点结构：`把它们编组` 或 `包成 Frame 名字 Hero padding 16`
5. 运行中关闭本地 bridge，确认插件只降级为 `offline`，不会崩溃
