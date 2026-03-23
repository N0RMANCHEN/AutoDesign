# AutoDesign Capability Catalog

这份文档是 `AutoDesign` 的 **插件能力清单与命令体系总表**。后续所有 Figma capability 的新增、废弃、兼容与协议调整，都应先更新这里，再落代码。

## 1. 文档作用

这份文档回答四件事：

1. 当前插件已经能做什么
2. 后续准备接入什么能力
3. 命令应该怎么发
4. 插件结果会怎么回

它是能力目录，不是产品营销页。  
因此必须明确区分：

- `implemented`：已经落在仓库代码里
- `planned`：已经确定会纳入 registry，但还没实现
- `deferred`：知道需要，但当前阶段先不做

## 2. 当前命令体系

### 2.1 三层入口

当前仓库里，插件命令有三层入口：

1. **自然语言入口**
   `shared/plugin-command-composer.ts`
   把中文自然语言解析成结构化命令批次
2. **结构化 JSON 入口**
   直接发送 `FigmaPluginCommandBatch`
3. **本地 bridge 入口**
   通过 `/api/plugin-bridge/*` 队列把命令推给在线插件会话

### 2.2 标准命令批次

当前批次结构：

```ts
type FigmaPluginCommandBatch = {
  source: "codex" | "user";
  requestId?: string;
  issuedAt?: string;
  commands: FigmaPluginCommand[];
};
```

说明：

- `source`：命令来源
- `requestId`：调用方请求 ID，建议始终带上
- `issuedAt`：命令创建时间
- `commands`：顺序执行的命令数组

### 2.3 单条能力命令

当前标准能力命令：

```ts
type FigmaCapabilityCommand = {
  type: "capability";
  capabilityId: PluginCapabilityId;
  payload: PluginCapabilityPayloadMap[PluginCapabilityId];
  executionMode?: "strict" | "best-effort";
  dryRun?: boolean;
  nodeIds?: string[];
};
```

规则：

- `executionMode: "strict"`  
  任一命令失败后停止后续执行
- `executionMode: "best-effort"`  
  失败后继续跑后续命令
- `dryRun: true`  
  只校验能力，不实际写 Figma
- `nodeIds`  
  默认作用于当前 selection；指定后只作用于 selection 内匹配的节点

### 2.4 兼容层

当前仓库仍兼容旧的 legacy command：

- `refresh-selection`
- `set-selection-fill`
- `set-selection-stroke`
- `set-selection-radius`
- `set-selection-opacity`
- `create-or-update-paint-style`
- `create-or-update-color-variable`

插件运行时会先把它们转换成 `type: "capability"` 的标准命令，再执行。

结论：

- **新能力只允许按 capability 命令扩展**
- legacy command 只保留兼容，不再继续新增

## 3. 当前 bridge 体系

### 3.1 插件会话

每个在线插件会话都会上报：

- `id`
- `label`
- `pluginVersion`
- `editorType`
- `fileName`
- `pageName`
- `capabilities`
- `selection`

`selection` 当前摘要字段：

```ts
type PluginNodeSummary = {
  id: string;
  name: string;
  type: string;
  fillable: boolean;
  fills: string[];
  fillStyleId: string | null;
  previewDataUrl?: string | null;
};
```

### 3.2 命令状态

bridge 当前命令状态固定为：

- `queued`
- `claimed`
- `succeeded`
- `failed`

### 3.3 结果结构

每条能力命令的结果结构：

```ts
type PluginCommandExecutionResult = {
  capabilityId: PluginCapabilityId;
  ok: boolean;
  changedNodeIds: string[];
  createdStyleIds: string[];
  createdVariableIds: string[];
  warnings: string[];
  errorCode: string | null;
  message: string;
};
```

要求：

- 每条命令都必须返回结构化结果
- 写操作不能只靠 toast，不回结构化结果
- 失败时必须带 `message`
- 可部分成功时优先写入 `warnings`

## 4. 当前已实现能力

下面这些能力已经在仓库里落地，并会由插件会话上报到 bridge。

| capabilityId | domain | status | payload | 作用 |
| --- | --- | --- | --- | --- |
| `selection.refresh` | `selection` | implemented | `{}` | 读取当前 selection，并更新插件会话上下文 |
| `nodes.inspect-subtree` | `nodes` | implemented | `{ nodeId, maxDepth? }` | 读取目标节点或 Frame 的 subtree，并返回结构化节点清单 |
| `fills.set-fill` | `fills-strokes-effects` | implemented | `{ hex }` | 把当前 selection 的 fill 改成实体色 |
| `fills.clear-fill` | `fills-strokes-effects` | implemented | `{}` | 清空当前 selection 的 fill |
| `strokes.set-stroke` | `fills-strokes-effects` | implemented | `{ hex }` | 把当前 selection 的 stroke 改成实体色 |
| `strokes.clear-stroke` | `fills-strokes-effects` | implemented | `{}` | 清空当前 selection 的 stroke |
| `strokes.set-weight` | `fills-strokes-effects` | implemented | `{ value }` | 修改当前 selection 的描边粗细 |
| `effects.set-shadow` | `fills-strokes-effects` | implemented | `{ offsetX, offsetY, blur, spread?, colorHex?, opacity? }` | 创建或更新当前 selection 的投影 |
| `effects.set-layer-blur` | `fills-strokes-effects` | implemented | `{ radius }` | 创建或更新当前 selection 的图层模糊 |
| `effects.clear-effects` | `fills-strokes-effects` | implemented | `{}` | 清空当前 selection 的效果 |
| `geometry.set-radius` | `geometry` | implemented | `{ value }` | 修改当前 selection 的圆角 |
| `geometry.set-size` | `geometry` | implemented | `{ width, height }` | 修改当前 selection 的尺寸 |
| `geometry.set-position` | `geometry` | implemented | `{ x, y }` | 修改当前 selection 的绝对位置 |
| `nodes.set-opacity` | `fills-strokes-effects` | implemented | `{ value }` | 修改当前 selection 的透明度 |
| `nodes.rename` | `nodes` | implemented | `{ name }` | 统一修改当前 selection 的节点名称 |
| `nodes.duplicate` | `nodes` | implemented | `{ offsetX?, offsetY? }` | 复制当前 selection，并可附带偏移 |
| `nodes.group` | `nodes` | implemented | `{ name? }` | 将当前 selection 分组成一个 Group |
| `nodes.frame-selection` | `nodes` | implemented | `{ name?, padding? }` | 用新建 Frame 包裹当前 selection |
| `layout.configure-frame` | `layout-autolayout` | implemented | `{ layoutMode?, primaryAxisSizingMode?, counterAxisSizingMode?, primaryAxisAlignItems?, counterAxisAlignItems?, itemSpacing?, paddingLeft?, paddingRight?, paddingTop?, paddingBottom?, clipsContent? }` | 配置选中 Frame 的 Auto Layout、padding、spacing 和 clipping |
| `layout.configure-child` | `layout-autolayout` | implemented | `{ layoutAlign?, layoutGrow?, layoutPositioning? }` | 配置 Auto Layout 子节点的布局规则 |
| `nodes.create-frame` | `nodes` | implemented | `{ name?, width, height, x?, y?, fillHex?, cornerRadius?, parentNodeId? }` | 创建一个空 Frame |
| `nodes.create-text` | `nodes` | implemented | `{ name?, content, fontFamily?, fontStyle?, fontSize?, fontWeight?, colorHex?, x?, y?, parentNodeId? }` | 创建一个文本节点 |
| `nodes.create-rectangle` | `nodes` | implemented | `{ name?, width, height, x?, y?, placement?, gap?, fillHex?, strokeHex?, strokeWeight?, cornerRadius?, opacity?, parentNodeId? }` | 创建一个矩形节点 |
| `nodes.create-ellipse` | `nodes` | implemented | `{ name?, width, height, x?, y?, fillHex?, strokeHex?, strokeWeight?, opacity?, parentNodeId? }` | 创建一个椭圆节点 |
| `nodes.create-line` | `nodes` | implemented | `{ name?, width, height?, x?, y?, strokeHex?, strokeWeight?, opacity?, rotation?, parentNodeId? }` | 创建一个线段节点 |
| `nodes.create-svg` | `nodes` | implemented | `{ name?, svgMarkup, x?, y?, width?, height?, opacity?, parentNodeId? }` | 从 SVG 字符串创建可编辑矢量节点 |
| `assets.export-node-image` | `assets-images-export` | implemented | `{ format?, constraint?, preferOriginalBytes? }` | 导出节点图像，并可优先使用原始 image-fill 字节 |
| `reconstruction.apply-raster-reference` | `reconstruction` | implemented | `{ referenceNodeId?, referenceDataUrl?, resultName?, replaceTargetContents?, resizeTargetToReference?, fitMode?, x?, y?, width?, height?, opacity? }` | 以 raster-exact 方式把参考图写入目标 Frame |
| `nodes.delete` | `nodes` | implemented | `{}` | 删除 `nodeIds` 指定的节点或当前 selection |
| `nodes.set-clips-content` | `nodes` | implemented | `{ value }` | 切换选中 Frame 类节点的 clips content |
| `nodes.set-mask` | `nodes` | implemented | `{ value }` | 切换选中节点的 mask 行为 |
| `text.set-content` | `text` | implemented | `{ value }` | 修改当前 selection 中文本节点的内容 |
| `text.set-font-size` | `text` | implemented | `{ value }` | 修改当前 selection 中文本节点的字号 |
| `text.set-font-family` | `text` | implemented | `{ family, style? }` | 修改当前 selection 中文本节点的字体族 |
| `text.set-font-weight` | `text` | implemented | `{ value }` | 修改当前 selection 中文本节点的字重 |
| `text.set-text-color` | `text` | implemented | `{ hex }` | 修改当前 selection 中文本节点的颜色 |
| `text.set-line-height` | `text` | implemented | `{ value }` | 修改当前 selection 中文本节点的行高 |
| `text.set-letter-spacing` | `text` | implemented | `{ value }` | 修改当前 selection 中文本节点的字距 |
| `text.set-alignment` | `text` | implemented | `{ value }` | 修改当前 selection 中文本节点的水平对齐 |
| `components.create-component` | `components-instances` | implemented | `{ name? }` | 把当前 selection 转成 reusable component |
| `components.create-instance` | `components-instances` | implemented | `{ mainComponentNodeId, x?, y?, parentNodeId?, name? }` | 从已有 component 创建 instance |
| `components.detach-instance` | `components-instances` | implemented | `{}` | 把当前 selection 中的 instance detach 成可编辑图层 |
| `styles.upsert-text-style` | `styles` | implemented | `{ name, fontFamily, fontStyle?, fontSize, textColorHex? }` | 创建或更新本地文字样式 |
| `styles.apply-style` | `styles` | implemented | `{ styleType, styleName }` | 把本地 paint / text style 应用到 selection |
| `styles.detach-style` | `styles` | implemented | `{ styleType }` | 解绑 fill / stroke / text style |
| `styles.upsert-paint-style` | `styles` | implemented | `{ name, hex, applyToSelection? }` | 创建或更新本地 paint style，并可应用到 selection |
| `variables.upsert-color-variable` | `variables` | implemented | `{ collectionName, variableName, hex, bindToSelection? }` | 创建或更新本地颜色变量，并可绑定到 selection fill |
| `undo.undo-last` | `undo` | implemented | `{}` | 回滚上一条带快照的修改命令 |

## 4.1 Reconstruction Job 底座

为“参考图还原”目标，当前仓库已补上 reconstruction job 框架，并区分了三条路径：

- `vector-reconstruction`
  - 默认主链
  - 固定 target frame、去透视、提交正视正交 analysis，并以纯可编辑 vector/text 写回
- `raster-exact`
  - 调试/对照链路
  - 直接把参考图像素级贴入目标 `FRAME`
- `structural-preview`
  - 结构化预览链
  - 继续用于 preview-only 分析、Codex-assisted analysis 和 skeleton apply / clear

当前已实现：

- `POST /api/reconstruction/jobs`
  - 创建一个 reconstruction job
  - v1 输入固定为一个目标 `FRAME` 和一个参考图片节点
- `GET /api/reconstruction/jobs`
  - 列出最近的 reconstruction job
- `GET /api/reconstruction/jobs/:jobId`
  - 查询单个 job 的阶段状态
- `POST /api/reconstruction/jobs/:jobId/analyze`
  - `vector-reconstruction`：导出并锁定参考图高分辨率资源，等待提交固定 frame 的矢量 analysis
  - `raster-exact`：导出并锁定参考图原始栅格资源
  - `structural-preview`：运行本地 heuristic preview-only 参考图分析，并生成 rebuild plan
- `POST /api/reconstruction/jobs/:jobId/context-pack`
  - 导出 `Codex-assisted` 上下文包
  - 返回 job、目标节点、参考节点、reference preview、target preview、当前 warnings / review flags / analysis
- `POST /api/reconstruction/jobs/:jobId/submit-analysis`
  - 接收 Codex 产出的结构化 analysis
  - server 负责归一化 analysis、生成 font matches / review flags / rebuild plan
- `POST /api/reconstruction/jobs/:jobId/preview-plan`
  - 返回当前可审阅的 preview-plan
- `POST /api/reconstruction/jobs/:jobId/review/font`
  - 为某个 text candidate 显式确认字体，并同步更新 rebuild plan
- `POST /api/reconstruction/jobs/:jobId/review/asset`
  - 为某个 asset candidate 记录人工确认结果
- `POST /api/reconstruction/jobs/:jobId/review/approve-plan`
  - 显式批准或退回当前 preview-plan
- `POST /api/reconstruction/jobs/:jobId/apply`
  - `vector-reconstruction`：保持 target Frame 尺寸固定，并将 vector/text rebuild plan 写入目标 Frame
  - `raster-exact`：替换目标 Frame 内容，并将参考图以 raster 结果写入目标 Frame
  - `structural-preview`：将当前 job 的 preview-only rebuild plan 以 skeleton 形式写入目标 Frame
  - `vector-reconstruction` 当前允许执行 `nodes.create-rectangle` / `nodes.create-ellipse` / `nodes.create-line` / `nodes.create-svg` / `nodes.create-text`
- `POST /api/reconstruction/jobs/:jobId/clear`
  - 只删除当前 job 自己创建的节点
- `POST /api/reconstruction/jobs/:jobId/loop`
  - 在受控停止条件下对 `structural-preview` job 自己创建的 skeleton 节点运行自动 refine loop
- `npm run plugin:reconstruct`
  - 从当前在线插件会话创建、查看、分析、apply、clear 或 loop reconstruction job

当前 job 只做：

- 选取目标 session
- 校验目标 `FRAME` / 参考图片节点
- 初始化固定阶段
- 导出高分辨率参考图资源
- 接收固定 frame、正视正交、纯矢量的 analysis
- 运行本地 preview-only 参考图分析
- 导出 Codex-assisted context pack，供 Codex 直接看图分析
- 接收 Codex 产出的结构化 analysis，并重新生成 preview-only rebuild plan
- 产出 OCR block、text style hint、asset candidate 等可审阅分析结果
- 生成字体候选
- 记录 review flag、approval state、已确认字体 / 资产选择
- 生成 vector rebuild plan
- 生成 preview-only rebuild plan
- 在 apply 前要求显式 approve preview-plan
- 将 vector rebuild plan 写入固定尺寸 target Frame
- 将 rebuild plan skeleton 写入目标 Frame
- 清理当前 job 自己创建的 skeleton 节点
- 抓取目标 Frame 最新预览
- 计算本地 diff 指标与热点区域
- 生成 refine 建议
- 在显式停止条件下把 refine 建议回写到当前 job 自己创建的节点
- 持久化 job

当前 job 还不会做：

- outpainting
- 在无 Codex 参与时，真实 OCR 文本识别仍不可用
- 对目标 Frame 原有内容做 destructive 修改

## 5. 自然语言当前可编译能力

当前自然语言解析器只覆盖一小部分高频动作。已支持的自然语言意图：

- 刷新 selection
- 改填充颜色
- 清空填充
- 改描边颜色
- 清空描边
- 改描边粗细
- 改阴影
- 改图层模糊
- 清空效果
- 改圆角
- 改尺寸
- 改位置
- 改透明度
- 重命名节点
- 复制节点
- 分组
- 用 Frame 包裹 selection
- 改文本内容
- 改字号
- 改字体
- 改字重
- 改文字颜色
- 创建/更新文字样式
- 应用样式
- 解绑样式
- 创建/更新 paint style
- 创建/更新颜色变量，并可绑定

当前未支持但会进入后续计划的自然语言意图：

- 旋转
- richer text style / range text
- Auto Layout
- 组件属性和实例替换
- Page / Section 操作

## 6. 目标能力域总表

下面这部分是 **完整目标目录**。不是说当前全都做完了，而是后续所有 capability 都必须从这里收口命名，不再随意长分支。

### 6.1 Selection

| capabilityId | status | 说明 |
| --- | --- | --- |
| `selection.refresh` | implemented | 刷新当前 selection 摘要 |
| `nodes.inspect-subtree` | implemented | 读取目标节点或 Frame 的 subtree |
| `selection.read-metadata` | planned | 返回更完整的节点属性摘要 |
| `selection.export-preview` | planned | 导出当前 selection 预览 |
| `selection.read-tree` | planned | 读取 selection 内部层级结构 |

### 6.2 Fills / Strokes / Effects

| capabilityId | status | 说明 |
| --- | --- | --- |
| `fills.set-fill` | implemented | 改实体 fill |
| `fills.clear-fill` | implemented | 清空 fill |
| `fills.set-multiple` | planned | 批量设置多层 fill |
| `strokes.set-stroke` | implemented | 改实体 stroke |
| `strokes.clear-stroke` | implemented | 清空 stroke |
| `strokes.set-weight` | implemented | 设置描边粗细 |
| `effects.set-shadow` | implemented | 设置阴影 |
| `effects.set-layer-blur` | implemented | 设置图层模糊 |
| `effects.clear-effects` | implemented | 清空效果 |

### 6.3 Geometry

| capabilityId | status | 说明 |
| --- | --- | --- |
| `geometry.set-radius` | implemented | 设置圆角 |
| `geometry.set-size` | implemented | 设置宽高 |
| `geometry.set-position` | implemented | 设置位置 |
| `geometry.set-rotation` | planned | 设置旋转 |
| `geometry.set-corner-smoothing` | planned | 设置角平滑 |

### 6.4 Node Properties

| capabilityId | status | 说明 |
| --- | --- | --- |
| `nodes.set-opacity` | implemented | 设置透明度 |
| `nodes.rename` | implemented | 改节点名称 |
| `nodes.lock` | planned | 锁定 / 解锁 |
| `nodes.show-hide` | planned | 显示 / 隐藏 |
| `nodes.duplicate` | implemented | 复制节点 |
| `nodes.delete` | implemented | 删除节点 |
| `nodes.group` | implemented | 分组 |
| `nodes.frame-selection` | implemented | 用 Frame 包裹 selection |
| `nodes.create-frame` | implemented | 创建空 Frame |
| `nodes.create-text` | implemented | 创建文本节点 |
| `nodes.create-rectangle` | implemented | 创建矩形节点 |
| `nodes.create-ellipse` | implemented | 创建椭圆节点 |
| `nodes.create-line` | implemented | 创建线段节点 |
| `nodes.create-svg` | implemented | 创建 SVG 矢量节点 |
| `nodes.set-clips-content` | implemented | 设置 clips content |
| `nodes.set-mask` | implemented | 设置 mask 行为 |

### 6.5 Styles

| capabilityId | status | 说明 |
| --- | --- | --- |
| `styles.upsert-paint-style` | implemented | 创建或更新 paint style |
| `styles.upsert-text-style` | implemented | 创建或更新 text style |
| `styles.upsert-effect-style` | planned | 创建或更新 effect style |
| `styles.upsert-grid-style` | planned | 创建或更新 layout grid style |
| `styles.apply-style` | implemented | 把某个 style 应用到节点 |
| `styles.detach-style` | implemented | 解绑 style |

### 6.6 Variables

| capabilityId | status | 说明 |
| --- | --- | --- |
| `variables.upsert-color-variable` | implemented | 创建或更新颜色变量 |
| `variables.upsert-number-variable` | planned | 创建或更新数字变量 |
| `variables.upsert-string-variable` | planned | 创建或更新字符串变量 |
| `variables.upsert-boolean-variable` | planned | 创建或更新布尔变量 |
| `variables.upsert-mode` | planned | 创建或更新 mode |
| `variables.bind-fill` | planned | 把变量绑定到 fill |
| `variables.bind-stroke` | planned | 把变量绑定到 stroke |
| `variables.bind-effect` | planned | 把变量绑定到 effect |
| `variables.unbind` | planned | 解绑变量 |

### 6.7 Text

| capabilityId | status | 说明 |
| --- | --- | --- |
| `text.set-content` | implemented | 改文字内容 |
| `text.set-font-family` | implemented | 改字体族 |
| `text.set-font-size` | implemented | 改字号 |
| `text.set-font-weight` | implemented | 改字重 |
| `text.set-text-color` | implemented | 改文字颜色 |
| `text.set-line-height` | implemented | 改行高 |
| `text.set-letter-spacing` | implemented | 改字距 |
| `text.set-alignment` | implemented | 改对齐 |
| `text.set-case` | planned | 改大小写 |
| `text.apply-style` | planned | 应用 text style |

### 6.8 Layout / Auto Layout

| capabilityId | status | 说明 |
| --- | --- | --- |
| `layout.set-auto-layout` | planned | 开启或关闭 Auto Layout |
| `layout.set-direction` | planned | 改布局方向 |
| `layout.set-padding` | planned | 改内边距 |
| `layout.set-spacing` | planned | 改 item spacing |
| `layout.set-alignment` | planned | 改对齐规则 |
| `layout.set-sizing` | planned | 改 hug / fill / fixed |
| `layout.configure-frame` | implemented | 配置 Frame 的 Auto Layout、padding、spacing 和 clipping |
| `layout.configure-child` | implemented | 配置 Auto Layout 子节点规则 |
| `layout.set-constraints` | planned | 改 constraints |

### 6.9 Components / Instances

| capabilityId | status | 说明 |
| --- | --- | --- |
| `components.create-component` | implemented | 把节点转成 component |
| `components.create-instance` | implemented | 从 component 创建 instance |
| `components.detach-instance` | implemented | detach 当前 selection 中的 instance |
| `components.create-variant-set` | planned | 创建 variant set |
| `instances.detach` | planned | detach instance |
| `instances.swap-component` | planned | 替换实例组件 |
| `instances.set-component-property` | planned | 改 component property |
| `instances.set-override` | planned | 改实例 override |

### 6.10 Assets / Images / Export

| capabilityId | status | 说明 |
| --- | --- | --- |
| `assets.export-node-image` | implemented | 导出单个节点图像 |
| `assets.read-image-bytes` | planned | 读取图片资源字节 |
| `assets.place-image-fill` | planned | 将图片填充到节点 |
| `export.selection-png` | planned | 导出 PNG |
| `export.selection-svg` | planned | 导出 SVG |
| `export.selection-pdf` | planned | 导出 PDF |

### 6.11 Pages / Sections / Navigation

| capabilityId | status | 说明 |
| --- | --- | --- |
| `pages.create-page` | planned | 新建 page |
| `pages.switch-page` | planned | 切换当前 page |
| `sections.create` | planned | 创建 section |
| `sections.move-selection` | planned | 将 selection 移入 section |
| `viewport.focus-selection` | planned | 聚焦到 selection |

### 6.12 Libraries / Publish / Sync

| capabilityId | status | 说明 |
| --- | --- | --- |
| `libraries.list-local-assets` | planned | 列出本地样式 / 变量 / 组件 |
| `libraries.publish-readiness-check` | planned | 检查发布前状态 |
| `libraries.resolve-dependencies` | planned | 解析库依赖 |
| `libraries.sync-references` | deferred | 同步库引用 |

### 6.13 Annotations / Dev Handoff

| capabilityId | status | 说明 |
| --- | --- | --- |
| `annotations.add-note` | planned | 添加说明注释 |
| `annotations.add-dev-note` | planned | 添加开发备注 |
| `annotations.add-measurement` | deferred | 添加尺寸标注 |
| `handoff.collect-inspect-data` | planned | 收集交付摘要 |

## 7. 当前推荐的实现顺序

后续能力接入建议按这个顺序推进：

### 第一批：高频视觉编辑

第一批已完成：

- `fills.clear-fill`
- `strokes.clear-stroke`
- `strokes.set-weight`
- `effects.set-shadow`
- `effects.set-layer-blur`
- `effects.clear-effects`
- `geometry.set-size`
- `geometry.set-position`

### 第二批：文本与布局

第二批当前已完成基础文本能力：

- `text.set-content`
- `text.set-font-size`
- `text.set-font-family`
- `text.set-font-weight`
- `text.set-text-color`

下一步继续推进：

- `layout.set-auto-layout`
- `layout.set-padding`
- `layout.set-spacing`

### 第三批：设计系统能力

第三批当前已完成第一层样式能力：

- `styles.upsert-text-style`
- `styles.apply-style`
- `styles.detach-style`

下一步继续推进：

- `styles.upsert-effect-style`
- `variables.upsert-number-variable`
- `variables.bind-stroke`
- `variables.unbind`

### 第四批：组件与文件级能力

第四批当前已完成第一层节点结构能力：

- `nodes.rename`
- `nodes.duplicate`
- `nodes.group`
- `nodes.frame-selection`

下一步继续推进：

- `nodes.delete`
- `layout.set-auto-layout`
- `layout.set-direction`
- `layout.set-padding`
- `layout.set-spacing`

- `components.create-component`
- `instances.swap-component`
- `pages.create-page`
- `sections.create`

## 8. 命名规则

后续 capability 命名固定遵守：

- `domain.action-object`
- 使用小写 kebab / dot 组合
- 不允许把 editor/UI 细节写进 capabilityId

示例：

- 正确：`text.set-content`
- 正确：`variables.bind-fill`
- 错误：`plugin-set-text`
- 错误：`figma-change-style`

## 9. 变更规则

以后每次新增或调整能力，至少同步更新这里的四项：

1. `status`
2. `payload`
3. `bridge result` 影响
4. 是否进入自然语言解析器

如果做不到这四项同步，就不算 capability 体系完成。

## 10. 当前真实代码入口

和这份文档直接对应的代码入口：

- [shared/plugin-capabilities.ts](../shared/plugin-capabilities.ts)
- [shared/plugin-contract.ts](../shared/plugin-contract.ts)
- [shared/plugin-bridge.ts](../shared/plugin-bridge.ts)
- [shared/plugin-command-composer.ts](../shared/plugin-command-composer.ts)
- [plugins/autodesign/src/runtime/capability-runner.ts](../plugins/autodesign/src/runtime/capability-runner.ts)
