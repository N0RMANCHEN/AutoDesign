import type { PluginNodeSummary } from "../shared/plugin-bridge.js";
import type {
  ReconstructionAnalysis,
  ReconstructionAnalysisProvider,
  ReconstructionApplyStatus,
  ReconstructionDiffMetrics,
  ReconstructionFontMatch,
  ReconstructionJob,
  ReconstructionLoopStatus,
  ReconstructionLoopStopReason,
  ReconstructionPlan,
  ReconstructionRasterAsset,
  ReconstructionRefineSuggestion,
  ReconstructionRenderedPreview,
  ReconstructionReviewFlag,
  ReconstructionStageId,
  ReconstructionStructureReport,
} from "../shared/reconstruction.js";
import {
  RECONSTRUCTION_MIN_IMPROVEMENT as minimumImprovementThreshold,
} from "../shared/reconstruction.js";
import {
  createDesignCaseRecord,
  evaluateDesignIterationPass,
  formatDesignIterationStopMessage,
  resolveReconstructionIterationStopReason,
} from "./design-core/iteration-policy.js";
import { inferDesignTaskModeFromReconstructionJob } from "./design-core/mode-policy.js";
import {
  hasPreparedReconstructionState,
  mergeReconstructionReviewFlags,
  mergeReconstructionWarnings,
  normalizeReconstructionJob,
  resetReconstructionEvaluationStages,
  updateReconstructionStage,
} from "./reconstruction-state.js";

type CompletedAnalysisPayload = {
  analysisVersion: string;
  analysisProvider: ReconstructionAnalysisProvider;
  analysis: ReconstructionAnalysis;
  fontMatches: ReconstructionFontMatch[];
  rebuildPlan: ReconstructionPlan;
  reviewFlags: ReconstructionReviewFlag[];
  warnings: string[];
};

type PreparePayload = {
  referenceRaster: ReconstructionRasterAsset;
  warnings?: string[];
};

type MarkAppliedPayload = {
  appliedNodeIds: string[];
  warnings?: string[];
};

type ClearAppliedStatePayload = {
  warnings?: string[];
  applyStatus?: ReconstructionApplyStatus;
  currentStageId?: ReconstructionStageId;
  message?: string;
};

type MarkRenderedPayload = {
  renderedPreview: ReconstructionRenderedPreview;
  targetNode: PluginNodeSummary;
  structureReport?: ReconstructionStructureReport | null;
  warnings?: string[];
};

type MarkMeasuredPayload = {
  diffMetrics: ReconstructionDiffMetrics;
  warnings?: string[];
};

type MarkRefinedPayload = {
  refineSuggestions: ReconstructionRefineSuggestion[];
  warnings?: string[];
};

type MarkLoopStatusPayload = {
  loopStatus: ReconstructionLoopStatus;
  stopReason?: ReconstructionLoopStopReason | null;
  warnings?: string[];
};

function getCompositeScore(
  job: Pick<ReconstructionJob, "diffMetrics" | "diffScore">,
) {
  return job.diffMetrics?.compositeScore ?? job.diffScore ?? 0;
}

function hasHardGateFailures(job: Pick<ReconstructionJob, "diffMetrics">) {
  return Boolean(job.diffMetrics?.acceptanceGates.some((gate) => gate.hard && !gate.passed));
}

function resolveLoopStopReason(
  job: Pick<
    ReconstructionJob,
    "diffMetrics" | "diffScore" | "iterationCount" | "input" | "stagnationCount"
  >,
  refineSuggestions: ReconstructionRefineSuggestion[],
): ReconstructionLoopStopReason | null {
  return resolveReconstructionIterationStopReason({
    compositeScore: getCompositeScore(job),
    hardFailureCount: hasHardGateFailures(job) ? 1 : 0,
    iterationCount: job.iterationCount,
    maxIterations: job.input.maxIterations,
    stagnationCount: job.stagnationCount,
    refineSuggestions,
  });
}

export function buildCompletedAnalysisReconstructionJob(
  currentJob: ReconstructionJob,
  payload: CompletedAnalysisPayload,
  timestamp: string,
): ReconstructionJob {
  const current = normalizeReconstructionJob(currentJob);
  const nextJob: ReconstructionJob = {
    ...current,
    analysisVersion: payload.analysisVersion,
    analysisProvider: payload.analysisProvider,
    updatedAt: timestamp,
    currentStageId: "plan-rebuild",
    loopStatus: "idle",
    stopReason: null,
    approvalState: payload.reviewFlags.length ? "pending-review" : "approved",
    warnings: mergeReconstructionWarnings(current.warnings, payload.warnings),
    analysis: payload.analysis,
    fontMatches: payload.fontMatches,
    rebuildPlan: payload.rebuildPlan,
    reviewFlags: mergeReconstructionReviewFlags([], payload.reviewFlags),
    approvedFontChoices: [],
    approvedAssetChoices: [],
    renderedPreview: null,
    diffMetrics: null,
    structureReport: null,
    refineSuggestions: [],
    iterationCount: 0,
    applyStatus: "not_applied",
    appliedNodeIds: [],
    lastAppliedAt: null,
    completedAt: null,
    bestDiffScore: null,
    lastImprovement: null,
    stagnationCount: 0,
    status: "ready",
  };

  updateReconstructionStage(nextJob, "extract-reference", "completed", "参考图预览提取完成。", timestamp);
  updateReconstructionStage(nextJob, "analyze-layout", "completed", "已生成布局与视觉区域分析。", timestamp);
  updateReconstructionStage(nextJob, "match-fonts", "completed", "已生成字体候选。", timestamp);
  updateReconstructionStage(nextJob, "plan-rebuild", "completed", "已生成重建计划。", timestamp);
  updateReconstructionStage(nextJob, "apply-rebuild", "pending", "等待写入 Figma。", timestamp);
  resetReconstructionEvaluationStages(nextJob);

  return nextJob;
}

export function buildPreparedRasterReconstructionJob(
  currentJob: ReconstructionJob,
  payload: PreparePayload,
  timestamp: string,
): ReconstructionJob {
  const current = normalizeReconstructionJob(currentJob);
  const preserveAppliedState = current.applyStatus === "applied";
  const nextJob: ReconstructionJob = {
    ...current,
    analysisVersion: "raster-exact-v1",
    analysisProvider: "heuristic-local",
    updatedAt: timestamp,
    currentStageId: preserveAppliedState ? current.currentStageId : "apply-rebuild",
    approvalState: "approved",
    warnings: mergeReconstructionWarnings(current.warnings, payload.warnings || []),
    referenceRaster: payload.referenceRaster,
    analysis: null,
    fontMatches: [],
    rebuildPlan: null,
    reviewFlags: [],
    approvedFontChoices: [],
    approvedAssetChoices: [],
    renderedPreview: preserveAppliedState ? current.renderedPreview : null,
    diffMetrics: preserveAppliedState ? current.diffMetrics : null,
    structureReport: preserveAppliedState ? current.structureReport : null,
    refineSuggestions: preserveAppliedState ? current.refineSuggestions : [],
    iterationCount: preserveAppliedState ? current.iterationCount : 0,
    applyStatus: preserveAppliedState ? current.applyStatus : "not_applied",
    appliedNodeIds: preserveAppliedState ? current.appliedNodeIds : [],
    lastAppliedAt: preserveAppliedState ? current.lastAppliedAt : null,
    completedAt: null,
    bestDiffScore: preserveAppliedState ? current.bestDiffScore : null,
    lastImprovement: preserveAppliedState ? current.lastImprovement : null,
    stagnationCount: preserveAppliedState ? current.stagnationCount : 0,
    status: "ready",
  };

  updateReconstructionStage(nextJob, "extract-reference", "completed", "已导出参考图原始栅格资源。", timestamp);
  updateReconstructionStage(nextJob, "analyze-layout", "completed", "raster-exact 策略跳过结构化分析。", timestamp);
  updateReconstructionStage(nextJob, "match-fonts", "completed", "raster-exact 策略不需要字体匹配。", timestamp);
  updateReconstructionStage(nextJob, "plan-rebuild", "completed", "raster-exact 策略已准备直接写回目标 Frame。", timestamp);
  if (!preserveAppliedState) {
    updateReconstructionStage(nextJob, "apply-rebuild", "pending", "等待写入 Figma。", timestamp);
    resetReconstructionEvaluationStages(nextJob);
  }

  return nextJob;
}

export function buildPreparedVectorReconstructionJob(
  currentJob: ReconstructionJob,
  payload: PreparePayload,
  timestamp: string,
): ReconstructionJob {
  const current = normalizeReconstructionJob(currentJob);
  const preservePreparedState = hasPreparedReconstructionState(current);
  const preserveAppliedState = current.applyStatus === "applied";
  const nextJob: ReconstructionJob = {
    ...current,
    analysisVersion: preservePreparedState ? current.analysisVersion : "vector-reconstruction-v1",
    analysisProvider: preservePreparedState ? current.analysisProvider : "codex-assisted",
    updatedAt: timestamp,
    currentStageId: preservePreparedState ? current.currentStageId : "analyze-layout",
    approvalState: preservePreparedState ? current.approvalState : "not-reviewed",
    warnings: mergeReconstructionWarnings(current.warnings, payload.warnings || []),
    referenceRaster: payload.referenceRaster,
    analysis: preservePreparedState ? current.analysis : null,
    fontMatches: preservePreparedState ? current.fontMatches : [],
    rebuildPlan: preservePreparedState ? current.rebuildPlan : null,
    reviewFlags: preservePreparedState ? current.reviewFlags : [],
    approvedFontChoices: preservePreparedState ? current.approvedFontChoices : [],
    approvedAssetChoices: preservePreparedState ? current.approvedAssetChoices : [],
    renderedPreview: preserveAppliedState ? current.renderedPreview : null,
    diffMetrics: preserveAppliedState ? current.diffMetrics : null,
    structureReport: preserveAppliedState ? current.structureReport : null,
    refineSuggestions: preserveAppliedState ? current.refineSuggestions : [],
    iterationCount: preserveAppliedState ? current.iterationCount : 0,
    applyStatus: preserveAppliedState ? current.applyStatus : "not_applied",
    appliedNodeIds: preserveAppliedState ? current.appliedNodeIds : [],
    lastAppliedAt: preserveAppliedState ? current.lastAppliedAt : null,
    completedAt: null,
    bestDiffScore: preserveAppliedState ? current.bestDiffScore : null,
    lastImprovement: preserveAppliedState ? current.lastImprovement : null,
    stagnationCount: preserveAppliedState ? current.stagnationCount : 0,
    status: "ready",
  };

  updateReconstructionStage(nextJob, "extract-reference", "completed", "已导出参考图高分辨率资源。", timestamp);
  if (!preservePreparedState) {
    updateReconstructionStage(nextJob, "analyze-layout", "pending", "等待提交正视正交矢量分析。", timestamp);
    updateReconstructionStage(nextJob, "match-fonts", "pending", "等待确认文字与风格推断。", timestamp);
    updateReconstructionStage(nextJob, "plan-rebuild", "pending", "等待生成固定 frame 的矢量重建计划。", timestamp);
    updateReconstructionStage(nextJob, "apply-rebuild", "pending", "等待写入 Figma。", timestamp);
    resetReconstructionEvaluationStages(nextJob);
  }

  return nextJob;
}

export function buildPreparedHybridReconstructionJob(
  currentJob: ReconstructionJob,
  payload: PreparePayload,
  timestamp: string,
): ReconstructionJob {
  const current = normalizeReconstructionJob(currentJob);
  const preservePreparedState = hasPreparedReconstructionState(current);
  const preserveAppliedState = current.applyStatus === "applied";
  const nextJob: ReconstructionJob = {
    ...current,
    analysisVersion: preservePreparedState ? current.analysisVersion : "hybrid-reconstruction-v1",
    analysisProvider: preservePreparedState ? current.analysisProvider : "codex-assisted",
    updatedAt: timestamp,
    currentStageId: preservePreparedState ? current.currentStageId : "analyze-layout",
    approvalState: preservePreparedState ? current.approvalState : "not-reviewed",
    warnings: mergeReconstructionWarnings(current.warnings, payload.warnings || []),
    referenceRaster: payload.referenceRaster,
    analysis: preservePreparedState ? current.analysis : null,
    fontMatches: preservePreparedState ? current.fontMatches : [],
    rebuildPlan: preservePreparedState ? current.rebuildPlan : null,
    reviewFlags: preservePreparedState ? current.reviewFlags : [],
    approvedFontChoices: preservePreparedState ? current.approvedFontChoices : [],
    approvedAssetChoices: preservePreparedState ? current.approvedAssetChoices : [],
    renderedPreview: preserveAppliedState ? current.renderedPreview : null,
    diffMetrics: preserveAppliedState ? current.diffMetrics : null,
    structureReport: preserveAppliedState ? current.structureReport : null,
    refineSuggestions: preserveAppliedState ? current.refineSuggestions : [],
    iterationCount: preserveAppliedState ? current.iterationCount : 0,
    applyStatus: preserveAppliedState ? current.applyStatus : "not_applied",
    appliedNodeIds: preserveAppliedState ? current.appliedNodeIds : [],
    lastAppliedAt: preserveAppliedState ? current.lastAppliedAt : null,
    completedAt: null,
    bestDiffScore: preserveAppliedState ? current.bestDiffScore : null,
    lastImprovement: preserveAppliedState ? current.lastImprovement : null,
    stagnationCount: preserveAppliedState ? current.stagnationCount : 0,
    status: "ready",
  };

  updateReconstructionStage(nextJob, "extract-reference", "completed", "已导出参考图高分辨率资源，并准备混合式重建。", timestamp);
  if (!preservePreparedState) {
    updateReconstructionStage(nextJob, "analyze-layout", "pending", "等待提交 fixed-frame 的 hybrid analysis。", timestamp);
    updateReconstructionStage(nextJob, "match-fonts", "pending", "等待确认可编辑文字与覆盖层。", timestamp);
    updateReconstructionStage(nextJob, "plan-rebuild", "pending", "等待生成 raster base + editable overlay 的重建计划。", timestamp);
    updateReconstructionStage(nextJob, "apply-rebuild", "pending", "等待写入 Figma。", timestamp);
    resetReconstructionEvaluationStages(nextJob);
  }

  return nextJob;
}

export function buildFailedReconstructionJob(
  currentJob: ReconstructionJob,
  stageId: ReconstructionStageId,
  message: string,
  timestamp: string,
): ReconstructionJob {
  const current = normalizeReconstructionJob(currentJob);
  const nextJob: ReconstructionJob = {
    ...current,
    status: "failed",
    loopStatus: "stopped",
    stopReason: "error",
    currentStageId: stageId,
    updatedAt: timestamp,
    completedAt: timestamp,
    warnings: mergeReconstructionWarnings(current.warnings, [message]),
  };

  updateReconstructionStage(nextJob, stageId, "failed", message, timestamp);
  return nextJob;
}

export function buildAppliedReconstructionJob(
  currentJob: ReconstructionJob,
  payload: MarkAppliedPayload,
  timestamp: string,
): ReconstructionJob {
  const current = normalizeReconstructionJob(currentJob);
  const nextJob: ReconstructionJob = {
    ...current,
    status: "ready",
    applyStatus: "applied",
    loopStatus: "idle",
    stopReason: null,
    currentStageId: "apply-rebuild",
    updatedAt: timestamp,
    lastAppliedAt: timestamp,
    completedAt: null,
    diffScore: null,
    bestDiffScore: null,
    lastImprovement: null,
    stagnationCount: 0,
    warnings: mergeReconstructionWarnings(current.warnings, payload.warnings || []),
    renderedPreview: null,
    diffMetrics: null,
    structureReport: null,
    refineSuggestions: [],
    iterationCount: 0,
    appliedNodeIds: [...new Set(payload.appliedNodeIds)],
  };

  updateReconstructionStage(nextJob, "apply-rebuild", "completed", "已将 rebuild plan 写入目标 Frame。", timestamp);
  resetReconstructionEvaluationStages(nextJob);
  return nextJob;
}

export function buildClearedAppliedReconstructionJob(
  currentJob: ReconstructionJob,
  payload: ClearAppliedStatePayload | undefined,
  timestamp: string,
): ReconstructionJob {
  const current = normalizeReconstructionJob(currentJob);
  const nextJob: ReconstructionJob = {
    ...current,
    status: "ready",
    applyStatus: payload?.applyStatus || "not_applied",
    loopStatus: "idle",
    stopReason: null,
    currentStageId: payload?.currentStageId || "plan-rebuild",
    updatedAt: timestamp,
    completedAt: null,
    lastAppliedAt: null,
    diffScore: null,
    bestDiffScore: null,
    lastImprovement: null,
    stagnationCount: 0,
    warnings: mergeReconstructionWarnings(current.warnings, payload?.warnings || []),
    renderedPreview: null,
    diffMetrics: null,
    structureReport: null,
    refineSuggestions: [],
    iterationCount: 0,
    appliedNodeIds: [],
  };

  updateReconstructionStage(
    nextJob,
    "apply-rebuild",
    "pending",
    payload?.message || "等待写入 Figma。",
    timestamp,
  );
  resetReconstructionEvaluationStages(nextJob);
  return nextJob;
}

export function buildRenderedReconstructionJob(
  currentJob: ReconstructionJob,
  payload: MarkRenderedPayload,
  timestamp: string,
): ReconstructionJob {
  const current = normalizeReconstructionJob(currentJob);
  const nextJob: ReconstructionJob = {
    ...current,
    status: "ready",
    currentStageId: "render-preview",
    updatedAt: timestamp,
    completedAt: null,
    warnings: mergeReconstructionWarnings(current.warnings, payload.warnings || []),
    targetNode: payload.targetNode,
    renderedPreview: payload.renderedPreview,
    structureReport: payload.structureReport === undefined ? current.structureReport : payload.structureReport,
  };

  updateReconstructionStage(nextJob, "render-preview", "completed", "已获取目标 Frame 最新预览。", timestamp);
  return nextJob;
}

export function buildMeasuredReconstructionJob(
  currentJob: ReconstructionJob,
  payload: MarkMeasuredPayload,
  timestamp: string,
): ReconstructionJob {
  const current = normalizeReconstructionJob(currentJob);
  const previousDiffScore = current.diffScore;
  const currentDiffScore = payload.diffMetrics.compositeScore;
  const lastImprovement = previousDiffScore === null ? null : currentDiffScore - previousDiffScore;
  const stagnationCount =
    lastImprovement !== null && lastImprovement < minimumImprovementThreshold
      ? current.stagnationCount + 1
      : 0;
  const mode = inferDesignTaskModeFromReconstructionJob(current);
  const passResult = evaluateDesignIterationPass({
    mode,
    regionClusterId: payload.diffMetrics.hotspots[0]?.id ?? null,
    changedElementIds: current.appliedNodeIds,
    beforeScore: previousDiffScore,
    afterScore: currentDiffScore,
    hardFailures: payload.diffMetrics.acceptanceGates
      .filter((gate) => gate.hard && !gate.passed)
      .map((gate) => gate.id),
    warnings:
      lastImprovement !== null && lastImprovement < minimumImprovementThreshold
        ? ["当前 pass 提升未达到自动接受阈值。"]
        : [],
  });
  const caseRecord = createDesignCaseRecord({
    taskId: `design-task/${current.id}`,
    mode,
    regionPass: passResult,
    heuristicId: "reconstruction-measurement",
    createdAt: timestamp,
  });
  const nextJob: ReconstructionJob = {
    ...current,
    status: "ready",
    currentStageId: "measure-diff",
    updatedAt: timestamp,
    completedAt: null,
    diffScore: currentDiffScore,
    bestDiffScore: Math.max(current.bestDiffScore || 0, currentDiffScore),
    lastImprovement,
    stagnationCount,
    diffMetrics: payload.diffMetrics,
    iterationCount: current.iterationCount + 1,
    warnings: mergeReconstructionWarnings(current.warnings, [
      ...(payload.warnings || []),
      ...caseRecord.notes,
    ]),
  };

  updateReconstructionStage(
    nextJob,
    "measure-diff",
    "completed",
    `已完成视觉评分，composite=${payload.diffMetrics.compositeScore.toFixed(3)} grade=${payload.diffMetrics.grade} failedGates=${payload.diffMetrics.acceptanceGates.filter((gate) => !gate.passed).length}。`,
    timestamp,
  );
  return nextJob;
}

export function buildRefinedReconstructionJob(
  currentJob: ReconstructionJob,
  payload: MarkRefinedPayload,
  timestamp: string,
): ReconstructionJob {
  const current = normalizeReconstructionJob(currentJob);
  const stopReason = resolveLoopStopReason(current, payload.refineSuggestions);
  const shouldComplete = Boolean(stopReason);
  const nextJob: ReconstructionJob = {
    ...current,
    status: shouldComplete ? "completed" : "ready",
    loopStatus: shouldComplete ? "stopped" : current.loopStatus === "running" ? "running" : "idle",
    stopReason,
    currentStageId: shouldComplete ? "done" : "refine",
    updatedAt: timestamp,
    completedAt: shouldComplete ? timestamp : null,
    warnings: mergeReconstructionWarnings(current.warnings, payload.warnings || []),
    refineSuggestions: payload.refineSuggestions,
  };

  updateReconstructionStage(
    nextJob,
    "refine",
    "completed",
    shouldComplete
      ? formatDesignIterationStopMessage(stopReason)
      : `已生成 ${payload.refineSuggestions.length} 条 refine 建议。`,
    timestamp,
  );

  if (shouldComplete) {
    updateReconstructionStage(nextJob, "done", "completed", "当前 reconstruction iteration 已完成。", timestamp);
  }

  return nextJob;
}

export function buildLoopStatusReconstructionJob(
  currentJob: ReconstructionJob,
  payload: MarkLoopStatusPayload,
  timestamp: string,
): ReconstructionJob {
  const current = normalizeReconstructionJob(currentJob);
  const nextJob: ReconstructionJob = {
    ...current,
    status: payload.loopStatus === "stopped" ? "completed" : current.status,
    loopStatus: payload.loopStatus,
    stopReason: payload.stopReason === undefined ? current.stopReason : payload.stopReason,
    updatedAt: timestamp,
    completedAt: payload.loopStatus === "stopped" ? current.completedAt || timestamp : null,
    warnings: mergeReconstructionWarnings(current.warnings, payload.warnings || []),
  };

  if (payload.loopStatus === "running") {
    updateReconstructionStage(nextJob, "done", "pending", "自动 refine loop 正在运行。", timestamp);
  }

  if (payload.loopStatus === "stopped") {
    updateReconstructionStage(
      nextJob,
      "done",
      "completed",
      formatDesignIterationStopMessage(nextJob.stopReason),
      timestamp,
    );
  }

  return nextJob;
}
