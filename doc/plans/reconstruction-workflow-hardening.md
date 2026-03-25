# Reconstruction Workflow Hardening

## Summary

把“目标 Frame + 参考图”的重建链路收紧成结构优先、可编辑优先、单局部收敛的正式 workflow，避免继续出现叠层、盲改、只贴图却宣称完成的问题。

## Scope

- apply 前清目标 Frame 内历史 AD 层
- inspect / render / measure / refine 闭环稳定化
- scoring 从全局平均走向 composite score + gates + hotspots
- vector 主链以语义结构和设计 token 为中心
- raster 路径只保留给诊断和辅助分析

## Dependencies

- `server/reconstruction-*`
- `server/design-core/*`
- `shared/reconstruction.ts`
- `scripts/plugin-bridge-cli-reconstruct.ts`
- plugin inspect / preview / apply runtime handlers

## Entry Conditions

- reconstruction job lifecycle 已经存在 create / apply / clear / render / measure / refine 主骨架
- target Frame 与 reference raster 的基础采集链已经可用
- 正式写回仍通过本地 plugin runtime 执行

## Workstreams

- 把 reference analysis、guide manifest、element model 收敛成稳定输入
- 把 apply / render / measure / refine / loop 收敛成可解释状态机
- 把 vector editable output 与评分门槛收敛成明确交付标准

## Closure Tasks

- 把 source quad、remap preview、analysis draft、OCR / heuristic 辅助链收成可重复、可失败的受控分支
- 继续补 element scoring、局部 crop、score diff、stop reason 与 gate 输出的稳定回归
- 把 loop / iterate / refine 的终止条件与失败路径写清，不允许无理由继续盲改
- 为 vector 路径补齐“默认交付可编辑节点而非 image fill 贴图”的硬门槛

## Exit Conditions

- reconstruction 可以稳定重复执行，不继续叠错层
- 最终交付默认是可编辑节点，不是假装矢量化的贴图
- 每轮 refine 都有可解释的目标区域和评分变化

## Risks

- live Figma session 与本地 API 状态不稳定时，闭环容易中断
- OCR、透视分析、设计 token 推断仍需继续提升

## Rollback

- 保留 inspection、clear、measure 等稳定子能力
- 单独回退高风险 refine 或 apply 逻辑
- 必要时退回人工分析 + 受控 apply 路径

## Verification

- `npm run test:unit`
- `node --test --import tsx scripts/plugin-bridge-cli.test.ts`
- 涉及 runtime write / owner 边界时补 `npm run governance:check`
