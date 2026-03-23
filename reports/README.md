# Reports

`reports/` 是 `AutoDesign` 的正式报告层，只放证据，不放治理规则和 active status。

## 目录职责

- `reports/acceptance/`
  手工验收和发布前检查
- `reports/quality/`
  质量评分、diff 结果、阶段评估
- `reports/incidents/`
  重要回归、事故和复盘
- `reports/archive/`
  失去活跃价值但仍需保留的历史报告

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
