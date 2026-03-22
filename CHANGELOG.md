# Changelog

## 3.22.01 — fix: 插件命令支持 nodeIds 精确定位目标节点

- `FigmaCapabilityCommand` 新增可选字段 `nodeIds?: string[]`
- `capability-runner.ts` 新增 `getTargetNodes()`，fill/stroke/radius/opacity 操作支持只作用于指定节点
- CLI `plugin:status` 输出增加 node id 显示
- CLI `plugin:send` 新增 `--node-ids` 参数
- 修复：多选时发送改色命令会影响所有选中节点的 bug

## 3.22.00 — refactor: 项目品牌重命名为 AutoDesign

- 全仓库 Codex-to-Figma 品牌名替换为 AutoDesign
- 插件目录从 `plugins/codex-to-figma` 迁移至 `plugins/autodesign`
- smoke 插件同步迁移至 `plugins/autodesign-smoke`
