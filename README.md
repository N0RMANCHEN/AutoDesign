# AutoDesign

`AutoDesign` 是一个面向个人工作流的 Figma + 前端联调仓库，解决两件事：

1. **用 Codex / Claude 直接调整 Figma**
   通过本地 Figma 插件和 bridge，让 AI 读取当前选中节点、查看图片预览，并执行颜色、样式、变量等写操作。
2. **从 Figma 选中内容出发，让 Codex / Claude 修改 React 前端**
   通过工作台、共享上下文和本地运行时，把 Figma 里的设计事实整理成前端改造输入，再由 AI 协助修改 React / 前端实现。

这不是一个成品 SaaS，也不是单纯的插件示例仓库。它是一个把 **Figma 执行器**、**前端工作台**、**本地 bridge**、**AI 上下文协议** 放在一起的单仓工作流。

## 当前能做什么

### A. Codex / Claude -> Figma

当前正式链路是：

- **Figma Plugin API + 本地 `localhost` bridge**
- 不是 MCP 直接改 Figma

当前插件已经支持：

- 读取当前 selection
- 导出选中节点预览，供 AI 看图片内容
- 改 fill / stroke / radius / opacity / size / position / effects
- 创建与删除基础节点：frame / text / delete / undo
- 创建基础矢量节点：rectangle / ellipse / line / svg
- 改文本内容、字体、字号、字重、文字颜色
- 创建或更新本地 paint style
- 创建或更新本地 text style
- 创建或更新颜色变量
- 把颜色变量绑定到节点 fill
- 通过结构化 capability 命令执行批量操作
- 创建 reconstruction job，为“目标 Frame + 参考图”自动还原工作流提供底座

### B. Figma -> Codex / Claude -> React

当前工作台已经支持：

- 维护设计源、screen、component mapping
- 构造 Runtime Context Pack
- 为 AI 生成更稳定的“设计到实现”上下文
- 让你从 Figma 选中内容出发，再让 Codex / Claude 去改 React / 前端代码

当前还**没有**完整落地的是：

- 从 Figma 自动生成生产级 React 代码的全自动流水线
- 多用户协作、数据库、鉴权

## 仓库怎么组成

仓库分成四层：

- **Workspace**
  `src/` + `server/`
  负责 Figma to React 这一侧的上下文整理、映射、运行时验证
- **Plugin**
  `plugins/autodesign/`
  负责 Codex / Claude to Figma 这一侧的实际执行
- **Bridge**
  `server/index.ts` + `server/plugin-bridge-store.ts`
  负责插件会话、命令队列、结果回传
- **Shared**
  `shared/`
  负责 capability registry、命令协议、共享类型

核心原则是：**共享协议，不共享运行时**。

## 5 分钟快速开始

### 1. 环境要求

- Node.js 18+
- npm
- Figma Desktop

### 2. 安装依赖

```bash
npm install
```

### 3. 启动本地工作台和 bridge

```bash
npm run dev
```

默认地址：

- Workspace: `http://localhost:5173`
- Local API / bridge: `http://localhost:3001`

### 4. 构建插件

```bash
npm run build:plugins
```

正式插件导入路径：

- [manifest.json](/Users/BofeiChen/AutoDesign/plugins/autodesign/dist/manifest.json)

Smoke 插件导入路径：

- [manifest.json](/Users/BofeiChen/AutoDesign/plugins/autodesign-smoke/dist/manifest.json)

### 5. 在 Figma Desktop 导入插件

1. 打开 Figma Desktop
2. `Plugins` -> `Development` -> `Import plugin from manifest...`
3. 先选择 smoke 插件的 `dist/manifest.json`
4. 验证 smoke 插件能正常运行
5. 再导入正式插件 [manifest.json](/Users/BofeiChen/AutoDesign/plugins/autodesign/dist/manifest.json)
6. 运行 `AutoDesign`

> 只导入 `dist/manifest.json`，不要直接导入 `src/`

## 如何使用

### 工作流 1：让 AI 直接改 Figma

1. 启动本地服务：`npm run dev`
2. 在 Figma 打开 `AutoDesign`
3. 在 Figma 里选中你要处理的节点
4. 让 Codex / Claude 发插件命令

常用命令：

- 查看在线插件会话

```bash
npm run plugin:status
```

- 用自然语言发命令

```bash
npm run plugin:send -- --prompt "把当前选中对象改成粉色"
```

- 导出当前选中图片预览

```bash
npm run plugin:preview
```

- 为“目标 Frame + 参考图”创建 reconstruction job

```bash
npm run plugin:reconstruct
```

说明：

- 现在默认优先创建 `vector-reconstruction` job，目标是“固定 target frame、去透视、纯可编辑矢量重建”
- 创建后推荐主链是 `--analyze -> --context-pack -> --submit-analysis -> --apply -> --render -> --measure`

- 对已有 job 运行 preview-only 参考图分析

```bash
npm run plugin:reconstruct -- --job <jobId> --analyze
```

说明：

- `vector-reconstruction` job 的 `--analyze` 只会导出并锁定参考图高分辨率资源，等待后续提交正视正交的矢量 analysis
- `raster-exact` job 只保留为调试/对照链路，不再是默认主链
- `structural-preview` job 的 `--analyze` 仍然只跑本地 heuristic fallback，用来兜底，不再是高保真主链
- 结构化高保真主链仍然是 `Codex-assisted`

- 导出 Codex-assisted context pack，并把参考图/目标图预览落盘到本地

```bash
npm run plugin:reconstruct -- --job <jobId> --context-pack
```

- 将 Codex 输出的结构化 analysis 提交回 job

```bash
npm run plugin:reconstruct -- --job <jobId> --submit-analysis --analysis-file <path/to/analysis.json>
```

- 查看可审阅的 preview-plan，并检查 OCR / review flags / 字体候选

```bash
npm run plugin:reconstruct -- --job <jobId> --preview-plan
```

- 确认某个文本区域的字体选择

```bash
npm run plugin:reconstruct -- --job <jobId> --review-font --text-candidate <textCandidateId> --font "SF Pro Display"
```

- 显式批准当前 preview-plan，之后才允许 apply

说明：

- `vector-reconstruction` / `structural-preview` 只有在 `approvalState=pending-review` 时才需要 `--approve-plan`
- `vector-reconstruction` apply 会保持 target frame 尺寸固定，只写入可编辑 vector/text 节点
- `raster-exact` 仍会直接贴图并调整尺寸，但仅作为调试路径保留

```bash
npm run plugin:reconstruct -- --job <jobId> --approve-plan
```

- 把 reconstruction 结果写入目标 Frame

```bash
npm run plugin:reconstruct -- --job <jobId> --apply
```

- 清理当前 job 创建的结果节点

```bash
npm run plugin:reconstruct -- --job <jobId> --clear
```

- 对结构化 job 运行有界自动 refine loop，直到命中停止条件

```bash
npm run plugin:reconstruct -- --job <jobId> --loop
```

### 工作流 2：从 Figma 选中内容出发改 React

1. 在 Figma 里确认当前设计选中或设计上下文
2. 在本地工作台整理 screen / component mapping / review 结构
3. 让 Codex / Claude 基于工作台上下文和当前设计选中，修改 React / 前端实现

当前仓库的这一侧重点是：

- 给 AI 提供更稳定的设计上下文
- 帮助你把 Figma 的设计事实映射到 React 实现
- 让“选中什么，就改哪里”成为可追踪工作流

## 当前能力边界

### 已实现

- 本地 bridge 会话注册与心跳
- 插件 selection 读取与预览导出
- capability registry
- 结构化命令 envelope
- fill / stroke / radius / opacity / size / position / effects
- text、style、variable 基础能力
  - 含字号、字体、字重、文字颜色、行高、字距、对齐
- frame / text 创建、delete、undo
- reconstruction job 创建、preview-only 分析、skeleton apply / clear、render / measure / refine / loop
- reconstruction job 创建、vector analysis 提交、固定 frame 矢量 apply / clear、render / measure
- reconstruction job `context-pack -> Codex -> submit-analysis -> preview-plan -> approve -> apply` 主链
- reconstruction job OCR block / review flag / approval state 基础层
- 工作台与插件的本地桥接

### 已有架构底座，但未完成扩展

- 参考图解析
- 字体匹配精度与真实 OCR
- 有界的像素 diff 自动修正写回
- 图片补全 / outpainting
- auto layout / geometry 更多控制
- 组件属性与实例 override
- library / publish / sync 类能力
- 更完整的 Figma to React 自动流水线

## Plugin API、MCP、费用、免费版

### 当前仓库到底用什么接 Figma？

当前主执行链是：

- **Figma Plugin API**
- **本地 bridge API**

不是 MCP 直接执行写操作。

也就是说，当前仓库里真正改 Figma 文件的是本地插件里的 `figma.*` API，而不是外部 MCP server。

### MCP 和当前仓库的关系

- **当前仓库主链路**：Plugin API + bridge
- **MCP**：未来可以补做读取/辅助链路，但不是当前主执行面

### 要付费吗？

这要分成两件事：

1. **当前仓库这条插件路线**
   - 重点看你能不能在 Figma Design 文件里运行插件
   - 当前官方帮助文档说明 Starter 用户可在文件中使用插件  
   https://help.figma.com/hc/en-us/articles/360042532714-Use-plugins-in-files
2. **Figma MCP**
   - 这是另一条链路
   - 官方 seat / 配额规则单独计算  
   https://help.figma.com/hc/en-us/articles/32132100833559-Guide-to-the-Figma-MCP-server

### 免费版能用到什么程度？

按当前官方文档，当前仓库依赖的这几类能力里：

- 文件内运行插件：可用
- 文件内创建/管理变量：可用  
  https://help.figma.com/hc/en-us/articles/15145852043927-Create-and-manage-variables
- 文件内创建/管理样式：可用  
  https://help.figma.com/hc/en-us/articles/360039238753-Styles-in-Figma-Design

但如果未来要做：

- Dev Mode 深度能力
- Desktop MCP
- 发布库 / 更完整团队协作

那就要单独看 seat 和计划限制。

## 用户侧怎么配置

### 必装

- Node.js 18+
- npm
- Figma Desktop

### 本地服务

```bash
npm run dev
```

### 正式插件导入文件

- [manifest.json](/Users/BofeiChen/AutoDesign/plugins/autodesign/dist/manifest.json)

### Smoke 插件导入文件

- [manifest.json](/Users/BofeiChen/AutoDesign/plugins/autodesign-smoke/dist/manifest.json)

### 当前插件名

- 正式插件：`AutoDesign`
- smoke 插件：`AutoDesign Smoke`

### 本地 bridge 地址

- `http://localhost:3001`

### 环境变量

- `AUTODESIGN_API_URL`
- 代码内保留旧环境变量兼容处理，但文档与新配置统一使用 `AUTODESIGN_API_URL`

## 当前已支持的核心功能

### 设计执行

- 选区读取
- 选区图片预览导出
- fill / stroke / radius / opacity
- paint style 创建或更新
- color variable 创建或更新
- variable binding

### 设计到实现

- design source 管理
- screen / component mapping
- review queue
- Runtime Context Pack
- 本地 Runtime action 测试

## FAQ

### 这是 MCP 吗？

不是。当前仓库真正写 Figma 的主链路是 **Figma Plugin API + 本地 bridge**。

### Claude 能不能用？

可以。仓库的意思是兼容 **Codex / Claude** 作为 AI 操作入口，但当前代码里并没有内置 Claude SDK。你可以把它理解成：仓库提供本地执行链，AI 侧可以是 Codex，也可以是 Claude。

### 为什么需要本地 bridge？

因为插件运行在 Figma 里，工作台和 AI 运行在本地开发环境里。bridge 负责：

- 注册插件会话
- 传递结构化命令
- 回传结果
- 提供最基本的可审计性

### 为什么不直接全走 MCP？

因为当前仓库已经有私有开发插件执行链，而且它更适合：

- 直接操作当前文件
- 做私有本地调试
- 精细控制插件会话和命令结果

MCP 可以是未来补充，不是当前主执行面。

## 仓库地图

- [AGENT.md](/Users/hirohi/AutoDesign/AGENT.md)
- [doc/Roadmap.md](/Users/hirohi/AutoDesign/doc/Roadmap.md)
- [doc/Architecture-Folder-Governance.md](/Users/hirohi/AutoDesign/doc/Architecture-Folder-Governance.md)
- [doc/Architecture.md](/Users/hirohi/AutoDesign/doc/Architecture.md)
- [doc/Capability-Catalog.md](/Users/hirohi/AutoDesign/doc/Capability-Catalog.md)
- [doc/Project-Map.md](/Users/hirohi/AutoDesign/doc/Project-Map.md)
- [doc/ai/README.md](/Users/hirohi/AutoDesign/doc/ai/README.md)
- [doc/plans/README.md](/Users/hirohi/AutoDesign/doc/plans/README.md)
- [plugins/autodesign/README.md](/Users/hirohi/AutoDesign/plugins/autodesign/README.md)
