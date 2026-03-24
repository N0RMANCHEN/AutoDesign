import type { ReconstructionJob, ReconstructionStrategy } from "../../shared/reconstruction.js";

export function buildReconstructionWorkflowChecklist() {
  return [
    "每一轮开始前都必须同时查看 reference preview 与当前 target preview；不要只看节点树或 OCR。",
    "先判断大布局和容器结构：主卡、副卡、胶囊、分割线、顶部信息区的位置、尺寸、圆角、间距是否正确。",
    "一次只修改一个父级或一个局部组件；不要把多个父级的结构改动混在同一批命令里。",
    "每次修改后必须重新 render 并重新 measure，再决定下一步，不允许连续盲改。",
    "只有当布局、结构、颜色门槛基本通过后，才继续收紧文本内容、字号、字重和小图标。",
    "若热点集中在某个区域，下一轮只处理该区域对应的父级，不扩散到整页。",
  ];
}

export function buildReconstructionScoringRubric() {
  return [
    "评分不再只看 globalSimilarity，而是以 compositeScore 为主，并同时检查 layout / structure / edge / color / hotspot gates。",
    "target_reached 只有在 compositeScore 达标且所有硬性 gates 通过时才成立。",
    "hotspotPeak 与 hotspotCoverage 会限制“平均像但局部明显错”的结果通过。",
    "refine 建议必须先说明应看哪个区域、改哪个父级，再进入写入动作。",
  ];
}

export function buildReconstructionStrategyGuidance(strategy: ReconstructionStrategy) {
  if (strategy === "vector-reconstruction") {
    return [
      "Codex 必须输出固定 target frame 下的正视正交矢量设计稿语义，而不是截图拆解或贴图方案。",
      "主体比例要尽量保留；frame 外侧缺失区域按相同风格做保守延展补完。",
      "最终结果必须纯可编辑矢量：文本用 text，图形用 rectangle/ellipse/line/svg。",
      "看不清的文字可以补合理文案，但必须在 textBlocks 中标记 inferred=true。",
      "优先把容器结构、卡片尺寸、圆角、层级和对齐做对，再继续补文字和细节。",
      "提交时只提交结构化 analysis；server 负责生成 vector rebuild plan。",
    ];
  }
  if (strategy === "hybrid-reconstruction") {
    return [
      "Codex 必须输出 fixed target frame 下的 hybrid analysis，而不是只给整图贴图方案。",
      "保留 raster base 作为高保真底座；文本、规则 shape、可识别 icon 优先进入可编辑 overlay。",
      "必须显式填写 canonicalFrame，并尽量声明 deprojected=true；透视和尺寸差异写入 deprojectionNotes。",
      "如参考图存在透视，请在 canonicalFrame.sourceQuad 中给出参考图平面的 4 个点，顺序固定为 top-left, top-right, bottom-right, bottom-left，坐标使用 0..1 归一化。",
      "超出参考图可直接覆盖的区域写入 completionZones；材质和背景切片写入 assetCandidates。",
      "每一轮先比对 remap preview 与当前 target render，再只修改一个局部容器或一个 overlay 组。",
      "不要强迫复杂纹理矢量化；难以编辑的材质区域留给 raster base。",
    ];
  }
  return [
    "Codex 应基于参考图输出结构化 analysis，而不是直接修改 Figma。",
    "必须尽量提供真实文本内容、文本角色、颜色、字号、行高、字距和对齐。",
    "复杂图标或位图区域可以标记为 assetCandidates，不要强行结构化为 shape。",
    "无法确认的内容写入 uncertainties，并保留 review flag。",
    "提交时只提交结构化 analysis；preview-only rebuild plan 由 server 再生成。",
  ];
}

export function buildReconstructionContextPolicy(job: ReconstructionJob) {
  return {
    workflow: buildReconstructionWorkflowChecklist(),
    scoringRubric: buildReconstructionScoringRubric(),
    guidance: buildReconstructionStrategyGuidance(job.input.strategy),
  };
}
