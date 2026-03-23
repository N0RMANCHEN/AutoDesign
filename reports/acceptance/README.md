# Acceptance Reports

本目录用于放人工验收记录。

创建新报告时，优先复制：

- [reports/acceptance/TEMPLATE.md](TEMPLATE.md)
- [reports/acceptance/TEMPLATE.json](TEMPLATE.json)

更推荐的入口：

- `npm run acceptance:new`
- `npm run acceptance:new -- --scenario live-figma-bridge --owner <name>`
- `npm run acceptance:new -- --scenario reconstruction-live --owner <name>`

命名约定：

- `acceptance-YYYYMMDD-HHMMSS.md` + `acceptance-YYYYMMDD-HHMMSS.json`

JSON 结构遵守：

- [schemas/acceptance-report.schema.json](../../schemas/acceptance-report.schema.json)

适用内容：

- 正式插件导入与运行验收
- reconstruction live case 验收
- UI lock 和关键工作流发布前检查

推荐场景：

- `live-figma-bridge`
  需要人工确认 bridge 在线、inspect 可用、定向写回是否命中目标节点
- `reconstruction-live`
  需要人工确认 job create/context-pack/review/apply/render/measure 的 live 流程
- `plugin-smoke`
  需要人工确认插件能启动、能看到 selection、能导出 preview

不适用内容：

- 长期治理规则
- 活跃任务状态
- 计划设计
