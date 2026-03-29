# AutoDesign Architecture & Folder Governance

> 作用：定义 `AutoDesign` 的架构边界、目录职责、文档放置规则与治理门禁。  
> 定位：长期治理标准；不替代 `doc/Roadmap.md` 的执行管理，不替代 `doc/Product-Standards.md` 的产品原则，也不替代 `doc/Test-Standards.md` 的测试标准。

## 1. 规则优先级

冲突时按以下优先级执行：

1. `AGENT.md`
2. 本文档
3. `doc/Product-Standards.md`
4. `doc/Test-Standards.md`
5. `doc/Roadmap.md`
6. `doc/plans/*`
7. `reports/*`
8. 其他说明性文档

分工固定如下：

- `Architecture-Folder-Governance` 回答“仓库怎么组织才合规”
- `Product-Standards` 回答“产品默认规则和质量边界是什么”
- `Test-Standards` 回答“如何验证和验收”
- `Roadmap` 回答“当前正在做什么”
- `plans/` 回答“这件事具体怎么做”
- `reports/` 回答“这件事做完后的证据是什么”

## 2. 系统边界

### 2.1 Workspace System

- 目录：`src/`、`server/`
- 作用：Figma-to-React 上下文整理、组件映射、Runtime Context Pack、本地 API、运行时验证
- 禁止：直接持有 Figma 插件运行时对象；把插件写操作逻辑混入工作台页面

### 2.2 Plugin System

- 目录：`plugins/autodesign/`、`plugins/autodesign-smoke/`
- 作用：selection 读取、preview 导出、capability 执行、Figma 写操作、插件 UI
- 禁止：承担工作台业务逻辑；直接访问工作台内部状态

### 2.3 Bridge System

- 目录：`server/index.ts`、`server/plugin-bridge-store.ts`
- 作用：插件会话注册、命令队列、结果回传、审计、reconstruction job 路由
- 禁止：持有 Figma 节点真实对象；把 bridge 变成隐式全局状态中心

### 2.4 Shared System

- 目录：`shared/`
- 作用：共享类型、能力协议、命令模型、reconstruction 数据结构
- 禁止：共享隐式运行时状态；在 shared 层引入环境相关副作用

### 2.5 Reconstruction System

- 目录：`server/reconstruction-*`、`shared/reconstruction.ts`、`scripts/plugin-bridge-cli.ts`
- 作用：围绕“目标 Frame + 参考图”的 analyze、context-pack、submit-analysis、apply、render、measure、refine workflow
- 禁止：把栅格诊断路径误写成正式交付；绕过目标 Frame 清理和验收门禁直接叠层写入

### 2.6 Capability Lane System

- `Code -> Design`
  - 目录：`shared/code-to-design-*`、`scripts/code-to-design-*`
  - 作用：源码可逆性预检、运行态页面采样、Figma command plan 生成
  - 禁止：通过修改目标项目源码来伪造“可编辑且像素级”成立
- `Direct Figma Design`
  - 目录：`plugins/autodesign/`、`scripts/plugin-bridge-cli.ts`
  - 作用：直接读写 Figma、执行 capability batch
  - 禁止：越过 Plugin API 直接在 workspace/server 层写 Figma
- `Design -> Code`
  - 目录：`shared/runtime-*`、`server/routes/runtime-*`、`src/components/workspace/*`
  - 作用：提取设计事实、整理上下文、生成前端改造输入
  - 禁止：直接漂移成无审阅的业务代码生成管道

## 3. 目录职责

### 3.1 根目录

根目录只保留高优先级入口文件：

- `README.md`
- `AGENT.md`
- `contributing_ai.md`
- `CHANGELOG.md`

根目录不承载项目治理细则、阶段性计划、验收报告。

### 3.2 `doc/`

`doc/` 是唯一正式文档目录，按固定分层维护：

- `doc/Architecture-Folder-Governance.md`
  长期治理规则
- `doc/Product-Standards.md`
  产品原则与默认规则
- `doc/Test-Standards.md`
  测试与验收标准
- `doc/Roadmap.md`
  当前执行真相，只保留 active work
- `doc/Architecture.md`
  当前架构现状与风险
- `doc/Capability-Catalog.md`
  插件与 bridge 能力总表
- `doc/Project-Map.md`
  仓库导航与最短阅读路径
- `doc/ai/`
  AI runtime contract
- `doc/plans/`
  活跃计划文档

### 3.3 `doc/plans/`

`doc/plans/` 只允许放：

- 活跃主题的实施方案
- scope、依赖、入口/出口条件
- 风险、回滚、验收方式

不允许放：

- 当前执行状态快照
- 长期规则
- 完成后的历史总结
- 与当前仓库无关的 research note

### 3.4 `reports/`

`reports/` 是正式报告层，只承接证据和结果：

- `reports/acceptance/`
  手工验收、发布前检查
- `reports/quality/`
  质量评估、对比测量、阶段评分
- `reports/incidents/`
  回归事故、重要问题复盘
- `reports/archive/`
  历史报告归档

`reports/` 不替代 `Roadmap` 和 `plans/`。

### 3.5 `doc/ai/`

`doc/ai/` 只放：

- Runtime prompt
- action 文档
- JSON contract

这里的内容视为接口，不是随笔。

## 4. 依赖和写入方向

固定依赖方向：

- `plugin` 可以依赖 `shared`
- `server` 可以依赖 `shared`
- `src` 可以依赖 `shared`
- `shared` 不能依赖 `plugin`、`server`、`src`

固定写入方向：

- 只有插件运行时可以直接写 Figma
- 工作台和 server 只能通过 bridge / capability contract 驱动插件执行
- reconstruction apply 必须通过插件 capability 或明确受控的写回路径完成

治理配置与门禁：

- `config/governance/architecture_rules.json`
  目录、依赖方向、关键入口和文件体量门禁
- `config/governance/runtime_write_registry.json`
  Figma API 可触达面和关键 truth store owner
- `npm run governance:check`
  执行上述两类治理检查

当前关键持久化真相文件默认只允许 owner 模块写入：

- `data/autodesign-plugin-bridge.json` -> `server/plugin-bridge-store.ts`
- `data/autodesign-project.json` -> `server/storage.ts`
- `data/autodesign-reconstruction-jobs.json` -> `server/reconstruction-store.ts`

## 5. 文档治理规则

### 5.1 单一事实来源

- 能力目录：`doc/Capability-Catalog.md`
- 当前执行真相：`doc/Roadmap.md`
- 架构治理规则：本文档
- 产品原则：`doc/Product-Standards.md`
- 测试标准：`doc/Test-Standards.md`
- Runtime AI 契约：`doc/ai/runtime/*`
- 支持边界真相：`config/governance/product_boundary_truth.json`

同一类事实不能在多个 Markdown 里并行维护。

以下高优先级规则默认只保留一个正文来源：

- 本地 bridge 默认授权：`AGENT.md`
- 正式插件 UI 默认冻结：`AGENT.md`
- `Plugin API + localhost bridge` 是正式写回主链：`AGENT.md`
- `Roadmap / plans / reports / CHANGELOG` 分工：本文档

### 5.2 删除优先于并存

旧文档被新文档覆盖后，优先删除，不保留并行版本。

### 5.3 Roadmap / Plan / Report 分工

- `Roadmap`：当前做什么
- `plans/`：准备怎么做
- `reports/`：实际做出了什么、测到了什么

三者禁止混写。

### 5.4 文档命名

文档名直接表达作用，不使用模糊标题。

推荐：

- `Roadmap.md`
- `Product-Standards.md`
- `Test-Standards.md`
- `Capability-Catalog.md`

不推荐：

- `notes.md`
- `misc.md`
- `draft2.md`
- `todo-final.md`

## 6. 变更门禁

以下情况必须先改文档再改实现：

- 系统边界变化
- 新 capability 或 protocol 变更
- reconstruction workflow 语义变化
- 测试门槛变化
- 文档目录和职责变化

最低要求：

- 新 capability：先更新 `Capability-Catalog.md`
- 新治理规则：先更新本文档或对应标准文档
- 新活跃主题：先进 `Roadmap`，再补 `doc/plans/*`
- 完成后的验收结果：进 `reports/*`
- 对用户或工作流有意义的变化：进 `CHANGELOG.md`

## 7. 当前不再保留的文档类型

以下类型默认视为噪音：

- 被 `Roadmap` 覆盖的 checklist
- 被治理文档覆盖的 code quality 单独说明
- 一次性聊天结论式 md
- 没有长期入口价值的 research 摘要
- 已经失效但继续保留的迁移说明

## 8. 新增 Markdown 的判断门槛

新增 Markdown 前，必须先判断：

1. 现有文档是否已经覆盖该内容
2. 它属于治理、产品、测试、Roadmap、plan、report、还是 AI contract
3. 它是否会成为稳定入口，而不是一次性记录

如果回答不清楚，就不应新建文档。

## 9. 模板与检查

- 新计划优先复制 `doc/plans/_template.md`
- 已关闭计划默认迁入 `doc/plans/archive/`，生命周期说明见 `doc/plans/archive/README.md`
- 新报告优先复制 `reports/*/TEMPLATE.md`
- 文档相关改动提交前，默认执行 `npm run verify`
- 架构边界、Figma 写回面或 truth store 改动提交前，默认执行 `npm run governance:check`
