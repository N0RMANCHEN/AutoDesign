# Codex to Figma

`Codex to Figma` 是一个面向个人工作流的 Figma + 前端联调仓库，解决两件事：

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
- 改 fill / stroke / radius / opacity
- 创建或更新本地 paint style
- 创建或更新颜色变量
- 把颜色变量绑定到节点 fill
- 通过结构化 capability 命令执行批量操作

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
  `plugins/codex-to-figma/`
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

- [manifest.json](/Users/hirohi/Figmatest/plugins/codex-to-figma/dist/manifest.json)

Smoke 插件导入路径：

- [manifest.json](/Users/hirohi/Figmatest/plugins/codex-to-figma-smoke/dist/manifest.json)

### 5. 在 Figma Desktop 导入插件

1. 打开 Figma Desktop
2. `Plugins` -> `Development` -> `Import plugin from manifest...`
3. 先选择 smoke 插件的 `dist/manifest.json`
4. 验证 smoke 插件能正常运行
5. 再导入正式插件 [manifest.json](/Users/hirohi/Figmatest/plugins/codex-to-figma/dist/manifest.json)
6. 运行 `Codex to Figma`

> 只导入 `dist/manifest.json`，不要直接导入 `src/`

## 如何使用

### 工作流 1：让 AI 直接改 Figma

1. 启动本地服务：`npm run dev`
2. 在 Figma 打开 `Codex to Figma`
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
- fill / stroke / radius / opacity
- paint style / color variable / variable binding
- 工作台与插件的本地桥接

### 已有架构底座，但未完成扩展

- 文本能力
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

就会进入付费计划边界。

## 目录导航

```text
.
├─ src/                 # Vite + React workspace
├─ server/              # local Node API + bridge
├─ shared/              # shared types, capability registry, contracts
├─ plugins/             # Figma plugins
├─ data/                # local JSON data
└─ docs/                # architecture and AI docs
```

重点文档：

- [AGENT.md](/Users/hirohi/Figmatest/AGENT.md)
- [docs/architecture.md](/Users/hirohi/Figmatest/docs/architecture.md)
- [docs/Figmatest_Project_Map.md](/Users/hirohi/Figmatest/docs/Figmatest_Project_Map.md)
- [plugins/codex-to-figma/README.md](/Users/hirohi/Figmatest/plugins/codex-to-figma/README.md)

## 常用命令

```bash
npm run dev
npm run build
npm run build:plugins
npm run typecheck
npm run plugin:status
npm run plugin:send -- --prompt "把当前选中对象改成蓝色"
npm run plugin:preview
```

## 当前仓库状态说明

这个仓库已经能跑通“AI 调 Figma”的最小闭环，也已经能为“Figma 驱动 React 改造”提供本地上下文底座。  
它现在最适合的使用方式是：**个人工作流、单机本地、AI 协同设计与前端联调**。
