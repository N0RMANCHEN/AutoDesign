# AutoDesign Roadmap (Execution-Oriented)

- 更新日期：2026-03-22

## 1. 治理规则

- `Roadmap` 只保留当前执行真相，不做历史堆积
- 计划文档放在 `doc/plans/`，只描述 scope、依赖、入口出口和风险
- 能力扩展必须先更新 [Capability-Catalog.md](/Users/hirohi/AutoDesign/doc/Capability-Catalog.md)，再改代码
- 与文档结构、目录治理、职责边界有关的规则，以 [Architecture-Folder-Governance.md](/Users/hirohi/AutoDesign/doc/Architecture-Folder-Governance.md) 为准

## 2. 当前执行面板

### 2.1 当前状态

- `current_focus`: `固定 frame 的矢量参考图还原 + 插件稳定性验收`
- `plugin_runtime`: `stable`
- `workspace_runtime`: `stable`
- `bridge_runtime`: `stable`
- `active_owner_cap`: `1`

### 2.2 当前 live queue

- `R1` 文档结构收敛
  - 状态：`in_progress`
  - 目标：将文档统一收口到 `doc/`，由根 `README.md` 承担总入口，并删除重复与低价值 Markdown
- `R2` 插件 capability 扩展第一批
  - 状态：`in_progress`
  - 目标：先把正式插件启动、离线降级、bridge 状态反馈和自动/手动验收闭环做稳，再继续扩 capability 面
- `R3` Figma to React 自动化下一阶段
  - 状态：`todo`
  - 目标：把 Context Pack 和工作台从“上下文整理”推进到更稳定的代码改造入口
- `R4` reconstruction job 底座
  - 状态：`in_progress`
  - 目标：为“目标 Frame + 参考图片”自动还原能力补上 fixed-frame vector reconstruction、输入校验、analysis、vector apply / clear 和 CLI 入口

## 3. 当前 Figma 能力基线

以下能力已经由 capability registry、插件执行器和 bridge 一起落地，可视为当前正式支持面：

- `selection.refresh`
  - 刷新当前 selection 摘要
- `fills.set-fill`
  - 修改 selection fill 实体色
- `fills.clear-fill`
  - 清空 selection fill
- `strokes.set-stroke`
  - 修改 selection stroke 实体色
- `strokes.clear-stroke`
  - 清空 selection stroke
- `strokes.set-weight`
  - 修改 selection 描边粗细
- `effects.set-shadow`
  - 创建或更新 selection 阴影
- `effects.set-layer-blur`
  - 创建或更新 selection 图层模糊
- `effects.clear-effects`
  - 清空 selection 效果
- `geometry.set-radius`
  - 修改 selection 圆角
- `geometry.set-size`
  - 修改 selection 尺寸
- `geometry.set-position`
  - 修改 selection 绝对位置
- `nodes.set-opacity`
  - 修改 selection 透明度
- `nodes.rename`
  - 统一修改 selection 节点名称
- `nodes.duplicate`
  - 复制 selection，并可附带偏移
- `nodes.group`
  - 将 selection 分组成一个 Group
- `nodes.frame-selection`
  - 用新建 Frame 包裹 selection
- `nodes.create-frame`
  - 创建一个空 Frame
- `nodes.create-text`
  - 创建一个文本节点
- `nodes.delete`
  - 删除指定节点或当前 selection
- `text.set-content`
  - 修改 selection 中文本节点的内容
- `text.set-font-size`
  - 修改 selection 中文本节点的字号
- `text.set-font-family`
  - 修改 selection 中文本节点的字体族
- `text.set-font-weight`
  - 修改 selection 中文本节点的字重
- `text.set-text-color`
  - 修改 selection 中文本节点的颜色
- `styles.upsert-text-style`
  - 创建或更新本地文字样式
- `styles.apply-style`
  - 把本地 paint / text style 应用到 selection
- `styles.detach-style`
  - 解绑 fill / stroke / text style
- `styles.upsert-paint-style`
  - 创建或更新本地 paint style，并可应用到 selection
- `variables.upsert-color-variable`
  - 创建或更新本地颜色变量，并可绑定到 selection fill
- `undo.undo-last`
  - 回滚上一条带快照的修改命令

当前 bridge / 命令侧已经具备的配套能力：

- capability registry 与结构化命令 batch
- legacy command 到 capability command 的兼容转换
- `strict` / `best-effort` 执行模式
- `dryRun` 校验
- 基于当前 selection 的 node 过滤
- 结构化执行结果回传
- bridge 状态回传
- 最近一次命令结果摘要回传
- 最近一次执行错误回传
- `bridge offline` 优雅降级
- 插件 UI 外观保持原 selection 列表，不因稳定性改造改变布局
- 正式插件 UI lock 校验
- reconstruction job 持久化、vector analysis 提交、vector apply / clear API

当前自然语言入口已覆盖：

- 刷新 selection
- 填充颜色
- 清空填充
- 描边颜色
- 清空描边
- 描边粗细
- 阴影
- 图层模糊
- 清空效果
- 圆角
- 尺寸
- 位置
- 透明度
- 重命名节点
- 复制节点
- 分组
- 用 Frame 包裹 selection
- 文本内容
- 字号
- 字体
- 字重
- 文字颜色
- 创建/更新文字样式
- 应用样式
- 解绑样式
- paint style 创建/更新
- 颜色变量创建/更新与绑定

## 4. Figma capability 扩展路线

### P0：先补齐高频视觉编辑闭环

目标：让 AI 可以覆盖最常见的视觉微调，而不必频繁退回人工操作。

当前已完成：

- `fills.clear-fill`
- `strokes.clear-stroke`
- `strokes.set-weight`
- `effects.set-shadow`
- `effects.set-layer-blur`
- `effects.clear-effects`
- `geometry.set-size`
- `geometry.set-position`

验收口径：

- capability descriptor、payload contract、执行器实现三者同步
- 自然语言入口至少补齐高频命令
- bridge 返回结构化结果，不靠 toast 作为唯一反馈

### P1：补齐文本与样式体系

目标：把“改色块”推进到“改文字与样式”这一层。

当前已完成基础文本能力：

- `text.set-content`
- `text.set-font-size`
- `text.set-font-family`
- `text.set-font-weight`
- `text.set-text-color`
- `text.set-line-height`
- `text.set-letter-spacing`
- `text.set-alignment`

当前已完成第一层样式能力：

- `styles.upsert-text-style`
- `styles.apply-style`
- `styles.detach-style`

待继续推进：

- `styles.upsert-effect-style`
- `styles.upsert-grid-style`

验收口径：

- 文本节点、普通节点、实例节点的可写边界要明确
- style 创建与 style 应用要拆成独立 capability
- 文档里要明确哪些是 text only，哪些可跨节点类型复用

### P2：补齐布局与节点操作

目标：让 AI 能完成一轮更完整的局部排版，而不仅是改视觉参数。

当前已完成第一层节点结构能力：

- `nodes.rename`
- `nodes.duplicate`
- `nodes.group`
- `nodes.frame-selection`

待继续推进：

- `nodes.delete`
- Auto Layout 系列 capability
  - direction
  - padding
  - item spacing
  - alignment
  - sizing mode

验收口径：

- 删除、包裹、分组类操作默认走更保守的确认策略
- Auto Layout 的 payload 需要避免做成随意字段集合，优先显式枚举

### P3：补齐读取、变量绑定与组件实例能力

目标：把插件从“写几个视觉属性”推进到“可读、可分析、可作用于设计系统对象”。

- `selection.read-metadata`
- `selection.export-preview`
- `selection.read-tree`
- 变量绑定与解绑扩展
  - fill / stroke / text / effect
- 组件与实例能力
  - component property 读取
  - instance override 写入
  - component swap

验收口径：

- 读取能力先于复杂写入能力落地
- 组件实例相关能力必须先明确 override 边界和失败返回

### P4：暂缓项

这些方向明确需要，但不进入当前 tranche：

- Page / Section 操作
- library / publish / sync
- annotations / dev handoff 深水区能力
- MCP 直接写 Figma 的主执行面替换

## 5. 近期优先级

- `R4 / Tranche 1B`
  - 状态：`done`
  - 范围：把 preview-only rebuild plan 真正写入目标 Frame，并保证只清理本 job 创建的节点
  - 已交付：
    - `POST /api/reconstruction/jobs/:jobId/apply`
    - `POST /api/reconstruction/jobs/:jobId/clear`
    - reconstruction job `appliedNodeIds` / `applyStatus` / `lastAppliedAt`
    - CLI:
      - `npm run plugin:reconstruct -- --job <jobId> --apply`
      - `npm run plugin:reconstruct -- --job <jobId> --clear`
  - 当前边界：
    - `structural-preview` 只 apply `nodes.create-frame` / `nodes.create-text`
    - `raster-exact` 改为直接写入 raster 结果节点
    - 只删除当前 job 自己创建的节点
    - 还没有像素 diff、真实 OCR、outpainting

- `R4 / Tranche 2`
  - 状态：`done`
  - 范围：在不改变插件 UI 的前提下，补齐 reconstruction job 的第一版评估闭环
  - 已交付：
    - `POST /api/reconstruction/jobs/:jobId/render`
    - `POST /api/reconstruction/jobs/:jobId/measure`
    - `POST /api/reconstruction/jobs/:jobId/refine`
    - `POST /api/reconstruction/jobs/:jobId/iterate`
    - reconstruction job `renderedPreview` / `diffMetrics` / `refineSuggestions` / `iterationCount`
    - CLI:
      - `npm run plugin:reconstruct -- --job <jobId> --render`
      - `npm run plugin:reconstruct -- --job <jobId> --measure`
      - `npm run plugin:reconstruct -- --job <jobId> --refine`
      - `npm run plugin:reconstruct -- --job <jobId> --iterate`
  - 当前边界：
    - `raster-exact` / `structural-preview` 都会进入 render + measure
    - 当前像素 diff 已改为以原尺寸为基准比较
    - `refine` 只生成建议，不自动回写下一轮修正
    - 还没有真实 OCR、outpainting、自动精修写回

- `R4 / Tranche 3`
  - 状态：`done`
  - 范围：在不改变插件 UI 的前提下，把 refine 建议收成有界自动 loop，并把停止条件写成硬规则
  - 已交付：
    - `POST /api/reconstruction/jobs/:jobId/loop`
    - reconstruction job `loopStatus` / `stopReason` / `bestDiffScore` / `lastImprovement` / `stagnationCount`
    - 自动 refine 现在会按显式 `nodeIds` 写回当前 job 创建的 skeleton 节点
    - CLI:
      - `npm run plugin:reconstruct -- --job <jobId> --loop`
  - 停止条件：
    - `globalSimilarity >= 0.90`
    - 达到 `maxIterations`
    - 连续多轮提升低于阈值
    - 当前没有足够可信的可执行 refine 建议
  - 当前边界：
    - 只会精修 `structural-preview` job 自己创建的 skeleton 节点
    - 只使用保守的 fill / layout / text 微调命令
    - 还没有真实 OCR、outpainting、复杂 vector 重建

- `R4 / Tranche 4A`
  - 状态：`done`
  - 范围：先把 reconstruction job 升级成“可审阅分析 + approval gate”，不给 apply 留盲写空间
  - 已交付：
    - reconstruction job `analysisVersion` / `approvalState` / `reviewFlags`
    - reconstruction analysis `ocrBlocks` / `textStyleHints` / `assetCandidates`
    - reconstruction job `approvedFontChoices` / `approvedAssetChoices`
    - `POST /api/reconstruction/jobs/:jobId/preview-plan`
    - `POST /api/reconstruction/jobs/:jobId/review/font`
    - `POST /api/reconstruction/jobs/:jobId/review/asset`
    - `POST /api/reconstruction/jobs/:jobId/review/approve-plan`
    - CLI:
      - `npm run plugin:reconstruct -- --job <jobId> --preview-plan`
      - `npm run plugin:reconstruct -- --job <jobId> --review-font --text-candidate <id> --font "<family>"`
      - `npm run plugin:reconstruct -- --job <jobId> --review-asset --asset <id> --decision approved|rejected`
      - `npm run plugin:reconstruct -- --job <jobId> --approve-plan`
      - `npm run plugin:reconstruct -- --job <jobId> --request-changes`
  - 当前边界：
    - OCR block 仍是 heuristic 占位，不是外部 OCR 服务结果
    - asset candidate 仍只用于 review metadata，不会自动写回图片素材
    - `apply` 现在要求 `approvalState=approved`

- `R4 / Tranche 4B`
  - 状态：`done`
  - 范围：把 reconstruction 主线从 server 内置 provider 转成 `Codex-assisted`，保留 heuristic 兜底
  - 已交付：
    - reconstruction job `analysisProvider`
    - `POST /api/reconstruction/jobs/:jobId/context-pack`
    - `POST /api/reconstruction/jobs/:jobId/submit-analysis`
    - CLI:
      - `npm run plugin:reconstruct -- --job <jobId> --context-pack`
      - `npm run plugin:reconstruct -- --job <jobId> --submit-analysis --analysis-file <path>`
    - context pack 会导出参考图与目标图预览，供 Codex 直接看图分析
    - `submit-analysis` 会把 Codex 结构化 analysis 正式写回 job，再生成 preview-only rebuild plan
  - 当前边界：
    - `analyze` 仍保留本地 heuristic fallback，但不再是高保真主链
    - 还没有把 Codex analysis 自动嵌进 server；当前仍是“Codex-in-the-loop”
    - 还没有 outpainting、图片资产自动写回、复杂 vector 重建

### P0

- 文档体系整理完成
- capability registry 继续成为唯一扩展入口
- 插件与工作台继续保持职责隔离
- 正式插件验收固定为 `typecheck -> build:plugins -> verify:plugins -> Figma 手动验收`
- 正式插件必须在 `bridge offline` 时可正常打开
- 稳定性改造默认不改变既有插件 UI 外观
- 正式插件 UI 变更必须先得到用户明确授权，再更新 lock
- Figma capability 扩展先按 `P0 -> P1 -> P2 -> P3` 顺序推进

### P1

- `text line-height / alignment / spacing`
- `styles.upsert-effect-style`
- `styles.effect/grid follow-up`

### P2

- `nodes.delete`
- Auto Layout 系列 capability
- 文本样式与 text style
- 变量绑定与解绑扩展
- 组件与实例能力

## 6. 非当前执行项

下面这些方向是明确会做，但不属于当前 live execution：

- 多用户协作与数据库
- 发布库 / 团队级设计系统同步
- MCP 作为补充读取链路的适配
- 全自动生产级 React 代码生成流水线

## 7. 当前完成定义

当前阶段的完成标准：

- 文档入口收敛
- `Capability-Catalog` 成为唯一能力总表
- `Roadmap` 能被直接用来判断当前在做什么
- 当前正式支持的 Figma capability 与待扩展梯队可以直接从 `Roadmap` 读出来
- 新人只看 `README + Roadmap + Project-Map` 就能理解仓库当前状态
