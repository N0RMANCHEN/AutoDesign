# Reports

`reports/` 是 `AutoDesign` 的正式报告层，只放证据，不放治理规则和 active status。

## 目录职责

- `reports/acceptance/`
  人工验收和发布前检查
- `reports/quality/`
  质量评分、diff 结果、阶段评估
- `reports/incidents/`
  回归事故、重要问题复盘
- `reports/archive/`
  历史报告归档

## 创建新报告

新增报告时，优先复制对应模板：

- [reports/acceptance/TEMPLATE.md](acceptance/TEMPLATE.md)
- [reports/acceptance/TEMPLATE.json](acceptance/TEMPLATE.json)
- [reports/quality/TEMPLATE.md](quality/TEMPLATE.md)
- [reports/quality/TEMPLATE.json](quality/TEMPLATE.json)
- [reports/incidents/TEMPLATE.md](incidents/TEMPLATE.md)

如果是新的 live 验收，优先生成脚手架而不是手写空白报告：

- `npm run acceptance:new`
- `npm run acceptance:new -- --scenario reconstruction-live --owner <name>`
- `npm run acceptance:preflight`
- `npm run acceptance:prep -- --owner <name>`
- `npm run quality:prep -- --job <JOB_ID> --owner <name>`
- `npm run quality:new -- --scenario reconstruction-measure --owner <name>`
- [reports/quality/RUNBOOK.md](quality/RUNBOOK.md)

注意：

- 新生成的 acceptance report 默认状态是 `PENDING`
- 只有真实验收跑完后，才应把状态更新为 `PASS` 或 `FAIL`

报告合同：

- `reports/acceptance/*.md + *.json`
  JSON 结构遵守 [schemas/acceptance-report.schema.json](../schemas/acceptance-report.schema.json)
- `reports/quality/*.md + *.json`
  JSON 结构遵守 [schemas/quality-report.schema.json](../schemas/quality-report.schema.json)

报告 JSON 提交前，默认执行：

- `npm run check:report-schemas`

## 写作规则

- `Roadmap` 只写当前在做什么
- `doc/plans/` 只写准备怎么做
- `reports/` 只写做出来了什么、测到了什么、出了什么问题

## 当前用途

后续以下内容都应进入 `reports/`：

- reconstruction 验收
- 评分和热点对比
- 插件导入和在线状态验证
- 重要回归问题复盘
