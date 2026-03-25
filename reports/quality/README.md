# Quality Reports

本目录用于放质量评估、测量结果和阶段性评分。

创建新报告时，优先复制：

- [reports/quality/TEMPLATE.md](TEMPLATE.md)
- [reports/quality/TEMPLATE.json](TEMPLATE.json)

更推荐的入口：

- `npm run quality:new`
- `npm run quality:prep -- --job <JOB_ID> --owner <name>`
- `npm run quality:new -- --scenario reconstruction-measure --owner <name>`
- `npm run quality:new -- --scenario workflow-regression --owner <name>`
- [reports/quality/RUNBOOK.md](RUNBOOK.md)

推荐场景：

- `reconstruction-measure`
  记录 reconstruction render / measure / hotspot / gate 结果
- `workflow-regression`
  记录高风险工作流改动后的回归评估
- `design-context-review`
  记录 design-context / metadata / variable-def 等读层质量审查

命名约定：

- `quality-YYYYMMDD-HHMMSS.md` + `quality-YYYYMMDD-HHMMSS.json`

reconstruction 质量测量建议直接执行：

- `npm run quality:prep -- --job <JOB_ID> --owner <name>`

它会在 `reports/quality/artifacts/<timestamp>/` 下写入：

- `quality-summary.txt`
- `<job-id>-snapshot.json`
- `reference` / `rendered` preview PNG（若当前 job 上可用）

`quality:prep` 不会替代人工验收，它只负责把当前 measured job 的评分、gate、hotspot 和 artifact 固化成可复查证据。

JSON 结构遵守：

- [schemas/quality-report.schema.json](../../schemas/quality-report.schema.json)

适用内容：

- render / measure 结果
- hotspot 对比
- composite score 评估
- 阶段性质量审查

输出应尽量结构化、可回溯、可和具体 job 或 case 关联。
