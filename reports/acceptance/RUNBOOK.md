# Live Acceptance Runbook

这份 runbook 只覆盖最后的 live Figma / live bridge / reconstruction 实机验收。

## 1. 进入 live 验收前

- 先保证本地主链是绿的：`npm run verify`
- 打开目标 Figma 文件，并启动 AutoDesign 插件
- 确保本地 bridge / server 已经在预期端口运行
- 如果要做正式验收记录，先执行：
  - `npm run acceptance:prep -- --owner <name>`
  - 或 `npm run acceptance:prep -- --scenario reconstruction-live --owner <name>`

这条命令会一次完成两件事：

- 生成 `reports/acceptance/acceptance-<timestamp>.md + .json`
- 生成 `reports/acceptance/artifacts/<timestamp>/plugin-bridge-snapshot.json`

注意：

- 新生成的 acceptance report 默认状态是 `PENDING`
- preflight 通过不等于 live 验收通过，完成实机验证后再把状态改成 `PASS` 或 `FAIL`

## 2. 先看预检是否通过

检查 `reports/acceptance/artifacts/<timestamp>/preflight-summary.txt`：

- session id 是否存在
- file/page 是否是当前目标文件
- selection count 是否符合预期
- preview artifact 是否已经落盘

如果这里就不对，不要继续做 mutating 命令，先修 session 或 selection。

## 3. live-figma-bridge 最小验收

按这个顺序做：

1. `npm run plugin:status`
2. `npm run plugin:inspect -- --frame-node-id <FRAME_NODE_ID>`
3. `npm run plugin:send -- --json '<COMMAND_BATCH>' --node-ids <NODE_IDS>`

人工确认点：

- `plugin:status` 显示的 session/file/page 正确
- `plugin:inspect` 返回的 frame/preview 与目标节点一致
- targeted mutating command 只命中指定节点
- Figma 画布里的可见结果与命令 payload 一致
- 整个过程 session 没有掉线

## 4. reconstruction-live 最小验收

按这个顺序做：

1. `npm run plugin:reconstruct -- --session <SESSION_ID> --target <TARGET_NODE_ID> --reference <REFERENCE_NODE_ID> --strategy hybrid-reconstruction`
2. `npm run plugin:reconstruct -- --job <JOB_ID> --context-pack`
3. `npm run plugin:reconstruct -- --job <JOB_ID> --submit-analysis --analysis-file <FILE>`
4. `npm run plugin:reconstruct -- --job <JOB_ID> --approve-plan --note "<NOTE>"`
5. `npm run plugin:reconstruct -- --job <JOB_ID> --apply`
6. `npm run plugin:reconstruct -- --job <JOB_ID> --render`
7. `npm run plugin:reconstruct -- --job <JOB_ID> --measure`

人工确认点：

- target/reference 没有串位
- context pack 与 reference preview 成功落盘
- apply 后目标 frame 可见变化符合计划
- render / measure 产物完整
- diff metrics 与肉眼观察没有明显冲突

## 5. 什么时候叫用户配合

只有这几种情况需要用户参与：

- 需要在 Figma Desktop 里打开或重开插件
- 需要肉眼确认画布实际写回结果
- 需要确认当前 selection / target frame 是否就是预期对象

如果只是本地脚本、报告生成、artifact 导出或 HTTP/CLI 校验，不需要用户介入。

## 6. 验收后要补什么

- 把结果回填到对应 `acceptance-<timestamp>.md`
- 把 `acceptance-<timestamp>.md + .json` 的状态从 `PENDING` 更新成 `PASS` 或 `FAIL`
- 把关键 artifact 路径补齐到 `acceptance-<timestamp>.json`
- 若是 reconstruction 质量问题，再补 `reports/quality/`
- 若暴露回归或事故，再补 `reports/incidents/`
