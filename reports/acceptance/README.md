# Acceptance Reports

本目录用于放人工验收记录。

创建新报告时，优先复制：

- [reports/acceptance/TEMPLATE.md](TEMPLATE.md)
- [reports/acceptance/TEMPLATE.json](TEMPLATE.json)

命名约定：

- `acceptance-YYYYMMDD-HHMMSS.md` + `acceptance-YYYYMMDD-HHMMSS.json`

JSON 结构遵守：

- [schemas/acceptance-report.schema.json](../../schemas/acceptance-report.schema.json)

适用内容：

- 正式插件导入与运行验收
- reconstruction live case 验收
- UI lock 和关键工作流发布前检查

不适用内容：

- 长期治理规则
- 活跃任务状态
- 计划设计
