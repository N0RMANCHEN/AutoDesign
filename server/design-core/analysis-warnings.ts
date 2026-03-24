import type { ReconstructionAnalysis, ReconstructionJob } from "../../shared/reconstruction.js";

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
}

export function buildReconstructionAnalysisWarnings(
  job: ReconstructionJob,
  analysis: ReconstructionAnalysis,
  seedWarnings: string[] = [],
): string[] {
  const warnings = uniqueStrings([...seedWarnings]);

  if (!analysis.width || !analysis.height) {
    warnings.push("参考图尺寸解析不完整，后续投影可能不稳定。");
  }
  if (!job.targetNode.width || !job.targetNode.height) {
    warnings.push("目标 Frame 尺寸摘要缺失，当前计划将回退到参考图尺寸比例。");
  }
  if (analysis.textCandidates.length === 0 && analysis.textBlocks.length === 0) {
    warnings.push("当前未识别出稳定文本区域，只生成图形区块计划。");
  }
  if (job.input.strategy === "vector-reconstruction") {
    if (!analysis.canonicalFrame?.fixedTargetFrame) {
      warnings.push("vector-reconstruction 应保持 target frame 固定，当前 canonicalFrame 未明确固定。");
    }
    if (!analysis.canonicalFrame?.deprojected) {
      warnings.push("vector-reconstruction 预期输出正视正交布局，当前 analysis 未显式声明 deprojected。");
    }
    if (!analysis.screenPlane?.rectifiedPreviewDataUrl) {
      warnings.push("vector-reconstruction 当前缺少 rectified screen preview；后续评分仍可能偏向原始透视截图。");
    }
    if (analysis.semanticNodes.length === 0) {
      warnings.push("vector-reconstruction 当前缺少 semanticNodes；apply 将回退到扁平 surface/text 结构。");
    }
  }
  if (job.input.strategy === "hybrid-reconstruction") {
    if (!analysis.canonicalFrame?.fixedTargetFrame) {
      warnings.push("hybrid-reconstruction 应保持 target frame 固定，当前 canonicalFrame 未明确固定。");
    }
    if (!analysis.canonicalFrame?.deprojected) {
      warnings.push("hybrid-reconstruction 预期声明已去透视；当前 analysis 未显式声明 deprojected。");
      warnings.push("当前 apply 仍不会执行真实 perspective warp；只会按 fixed-frame mapping 放置 raster base。");
    }
    if (
      analysis.canonicalFrame?.deprojected &&
      (!analysis.canonicalFrame.sourceQuad || analysis.canonicalFrame.sourceQuad.length !== 4)
    ) {
      warnings.push("hybrid-reconstruction 标记了 deprojected=true，但 canonicalFrame.sourceQuad 缺失；当前只能做固定 frame 映射，不能做真实平面拉正。");
    }
    if (analysis.assetCandidates.length === 0) {
      warnings.push("hybrid-reconstruction 当前没有资产/材质切片候选，材质区域很可能只能依赖 raster base。");
    }
    if (analysis.completionZones.length === 0 && job.input.allowOutpainting) {
      warnings.push("allowOutpainting 已开启，但当前 analysis 没有声明 completionZones。");
    }
    if (analysis.completionZones.length > 0) {
      warnings.push("completionZones 目前只进入 review / warning，不会自动生成补图素材。");
    }
  }

  return uniqueStrings(warnings);
}
