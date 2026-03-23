# AutoDesign Test Standards

> 作用：定义 `AutoDesign` 的测试层次、命名规范、回归要求和验收标准。  
> 定位：长期质量规则；不替代 `Roadmap`，也不替代单个计划文档里的专项验收条件。

## 1. 测试原则

### 1.1 行为优先

测试优先验证：

- 用户可感知行为
- 协议输入输出
- capability 执行结果
- 工作流状态变化

而不是内部实现细节。

### 1.2 确定性优先

测试应尽量：

- 输入固定
- 输出可重复
- 错误可解释
- 不依赖人工脑补

### 1.3 分层验证

质量验证必须分层完成，不能只靠人工试几次：

- shared/unit
- server/api
- plugin runtime
- CLI / bridge integration
- acceptance / manual

## 2. 测试层次

### 2.1 Shared / Unit

适用于：

- type / contract
- command composer
- targeting rule
- normalization logic
- scoring logic

要求：

- 单文件、快速、确定
- 覆盖边界输入和失败路径
- 默认入口：`npm run test:unit`

### 2.2 Server / API

适用于：

- route validation
- reconstruction job lifecycle
- plan approval gate
- render / measure / refine state change

要求：

- 覆盖成功、失败、缺参、非法状态转换
- 返回结构化错误，不允许只给模糊 message

### 2.3 Plugin Runtime

适用于：

- capability runner
- selection / inspect
- subtree traversal
- auto layout / mask / component 结构读取
- reconstruction apply / clear 写回

要求：

- 明确节点类型边界
- 明确 selection 与 nodeIds 的差异
- 明确外部命令和本地命令的安全约束

### 2.4 CLI / Integration

适用于：

- `plugin:send`
- `plugin:status`
- `plugin:inspect`
- `plugin:preview`
- `plugin:reconstruct`

要求：

- 参数校验和错误提示可读
- 输出能支撑下一步操作
- 多 target、高风险命令、缺少 `nodeIds` 的路径必须有前置失败

### 2.5 Acceptance / Manual

适用于：

- 正式插件导入链路
- bridge online / offline
- 实际 Figma 文件写回
- reconstruction 的 live 验收
- 文档工作流和 Roadmap / report / changelog 维护是否可执行

手工验收结果必须进入 `reports/acceptance/` 或 `reports/quality/`。

推荐最小合同：

- `reports/acceptance/*.md + *.json`
- `reports/quality/*.md + *.json`
- 报告 JSON 默认执行：`npm run check:report-schemas`
- live 验收脚手架默认入口：`npm run acceptance:new`
- live 验收预检入口：`npm run acceptance:preflight`
- live 验收一键准备入口：`npm run acceptance:prep`

## 3. 命名与结构规则

测试应满足：

- 名称直接表达行为，不写模糊缩写
- 使用清晰的 arrange / act / assert 结构
- 一个测试只验证一类行为或一个失败门槛
- 失败信息必须能定位 capability、route、job stage 或节点范围

## 4. 必测场景

以下变化默认必须补验证：

### 4.1 Capability / Targeting

- 修改类命令无 `nodeIds` 时失败
- 只读命令在允许范围内仍可运行
- 混合多个 target 的命令批次被拒绝
- 指定 `nodeIds` 时只影响目标节点

### 4.2 Selection / Inspect

- 当前 selection 摘要正确
- subtree inspection 返回父子层级、布局、组件、裁切、mask 信息
- 预览导出路径稳定

### 4.3 Reconstruction

- job create / analyze / context-pack / submit-analysis / approve / apply / clear / render / measure
- apply 前清旧 AD 层
- target Frame 保持尺寸和边界
- 最终 vector 交付不包含 image fill 残留

### 4.4 Workflow / Scoring

- render / measure / refine 闭环不损坏 job 状态
- composite score、gates、hotspot 输出稳定
- 评分变化与热点收敛方向一致

### 4.5 Docs / Governance

- 新文档遵守文档树边界
- `Roadmap`、`plans/`、`reports/`、`CHANGELOG` 职责不混写
- 关键入口文档无失效路径
- 非插件运行时不得越界触碰 Figma API
- 关键 truth store 只能由 owner 模块写入
- targeting 归一化、CLI guard、capability registry、governance scripts、prompt composition、context pack、runtime action、project storage、plugin bridge store、reconstruction analysis contract 和 reconstruction lifecycle / refine 纯逻辑必须有可重复单测

## 5. 回归门槛

以下变更默认不能只改代码：

- 新 capability
- 新 route
- reconstruction workflow 语义变化
- 评分逻辑变化
- 插件 UI 变化

最低要求：

- 类型或 contract 更新
- 文档同步
- 至少一层自动化验证
- 必要时补手工验收步骤

治理相关改动默认附带：

- `npm run governance:check`
- shared / reconstruction 纯逻辑改动默认附带：`npm run test:unit`

## 6. 完成判定

一次功能或治理改动可以视为完成，至少满足：

- 文档与代码事实一致
- 失败路径可解释
- 没有明显回归风险悬空
- 需要人工验收的部分已写入 `reports/`
- 对用户或工作流有意义的变化已进 `CHANGELOG.md`
