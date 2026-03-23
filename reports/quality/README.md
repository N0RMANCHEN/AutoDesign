# Quality Reports

本目录用于放质量评估、测量结果和阶段性评分。

创建新报告时，优先复制：

- [reports/quality/TEMPLATE.md](TEMPLATE.md)
- [reports/quality/TEMPLATE.json](TEMPLATE.json)

命名约定：

- `quality-YYYYMMDD-HHMMSS.md` + `quality-YYYYMMDD-HHMMSS.json`

JSON 结构遵守：

- [schemas/quality-report.schema.json](../../schemas/quality-report.schema.json)

适用内容：

- render / measure 结果
- hotspot 对比
- composite score 评估
- 阶段性质量审查

输出应尽量结构化、可回溯、可和具体 job 或 case 关联。
