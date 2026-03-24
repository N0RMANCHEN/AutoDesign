import type { PluginNodeSummary } from "../shared/plugin-bridge.js";
import type { ReconstructionJob, ReconstructionStructureReport } from "../shared/reconstruction.js";

import { isHybridReconstructionJob, isVectorReconstructionJob } from "./reconstruction-mode.js";

export function buildStructureReport(
  job: ReconstructionJob,
  targetNode: PluginNodeSummary,
): ReconstructionStructureReport | null {
  if (!isVectorReconstructionJob(job) && !isHybridReconstructionJob(job)) {
    return null;
  }

  const ops = job.rebuildPlan?.ops.filter((op) => op.type === "capability") || [];
  const textNodeCount = ops.filter((op) => op.capabilityId === "nodes.create-text").length;
  const vectorNodeCount = ops.filter((op) =>
    op.capabilityId === "nodes.create-rectangle" ||
    op.capabilityId === "nodes.create-ellipse" ||
    op.capabilityId === "nodes.create-line" ||
    op.capabilityId === "nodes.create-svg"
  ).length;
  const imageFillNodeCount = ops.filter((op) => op.capabilityId === "reconstruction.apply-raster-reference").length;
  const inferredTextCount = job.analysis?.textBlocks.filter((block) => block.inferred).length || 0;
  const expectedWidth = Number(job.targetNode.width || 0);
  const expectedHeight = Number(job.targetNode.height || 0);
  const actualWidth = Number(targetNode.width || 0);
  const actualHeight = Number(targetNode.height || 0);
  const targetFramePreserved =
    expectedWidth > 0 && expectedHeight > 0
      ? Math.abs(actualWidth - expectedWidth) < 0.5 && Math.abs(actualHeight - expectedHeight) < 0.5
      : null;

  const issues: string[] = [];
  if (targetFramePreserved === false) {
    issues.push(
      `target frame 尺寸发生变化: expected ${expectedWidth}x${expectedHeight}, actual ${actualWidth}x${actualHeight}`,
    );
  }
  if (isVectorReconstructionJob(job) && imageFillNodeCount > 0) {
    issues.push("vector-reconstruction 结果中检测到 raster/image-fill 写回。");
  }
  if (isVectorReconstructionJob(job) && textNodeCount + vectorNodeCount === 0) {
    issues.push("vector-reconstruction rebuild plan 没有生成任何可编辑节点。");
  }
  if (isHybridReconstructionJob(job) && imageFillNodeCount === 0) {
    issues.push("hybrid-reconstruction rebuild plan 没有写入 raster base。");
  }
  if (isHybridReconstructionJob(job) && textNodeCount + vectorNodeCount === 0) {
    issues.push("hybrid-reconstruction rebuild plan 没有生成任何可编辑 overlay 节点。");
  }

  return {
    targetFramePreserved,
    imageFillNodeCount,
    textNodeCount,
    vectorNodeCount,
    inferredTextCount,
    passed: issues.length === 0,
    issues,
  };
}
