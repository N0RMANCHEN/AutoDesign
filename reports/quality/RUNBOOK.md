# Reconstruction Quality Runbook

这份 runbook 只覆盖 reconstruction 的质量测量和评分留痕，不替代 live acceptance。

## 1. 进入质量记录前

- 先保证当前 job 已经至少跑到 `--measure`
- 如果是代码改动后的回归，先保证 `npm run verify` 为绿
- 确认目标 job 的 `renderedPreview` 和 `diffMetrics` 已经存在

推荐顺序：

1. `npm run plugin:reconstruct -- --job <JOB_ID>`
2. `npm run plugin:reconstruct -- --job <JOB_ID> --measure`
3. `npm run quality:prep -- --job <JOB_ID> --owner <name>`

## 2. `quality:prep` 会做什么

- 读取当前 reconstruction job
- 如果还没有 `diffMetrics`，直接 fail fast，不生成假质量报告
- 生成 `reports/quality/quality-<timestamp>.md + .json`
- 生成 `reports/quality/artifacts/<timestamp>/quality-summary.txt`
- 导出 `<job-id>-snapshot.json`
- 若当前 job 上存在 reference / rendered preview，则额外导出 PNG

## 3. 复查点

- composite score、grade、failed gates 是否符合当前变更预期
- hotspot 是否真的对准肉眼最明显的残余问题
- structure report 是否暴露 image fill 残留、frame 漂移或文本节点退化
- refine suggestion 是否仍指向单区域、可解释的下一步

## 4. 什么时候还需要 acceptance

以下情况不能只留 quality report：

- 需要证明 live Figma 写回结果正确
- 需要发布前或回归后的人眼确认
- 需要确认 bridge / plugin session 在线链路没有掉线

这些场景要额外补：

- `npm run acceptance:prep -- --owner <name>`
- [reports/acceptance/RUNBOOK.md](../acceptance/RUNBOOK.md)

## 5. 质量记录后要补什么

- 若质量已足够支撑发布或用户交付，把这份质量报告链接到对应 acceptance / changelog / plan closure
- 若仍有 failed gates 或明显 hotspot，按报告里的 follow-up 收下一轮 targeted change
- 若暴露真实回归或事故，再补 `reports/incidents/`
