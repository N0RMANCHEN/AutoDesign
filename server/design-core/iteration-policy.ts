import type {
  DesignCaseRecord,
  DesignIterationPolicy,
  DesignIterationStopReason,
  DesignRegionPassResult,
  DesignTaskMode,
} from "../../shared/design-task.js";
import type {
  ReconstructionLoopStopReason,
  ReconstructionRefineSuggestion,
} from "../../shared/reconstruction.js";
import {
  RECONSTRUCTION_ACTIONABLE_CONFIDENCE as actionableConfidenceThreshold,
  RECONSTRUCTION_STAGNATION_LIMIT as stagnationLimit,
  RECONSTRUCTION_TARGET_SIMILARITY as targetSimilarityThreshold,
} from "../../shared/reconstruction.js";

export function buildDefaultIterationPolicy(_mode: DesignTaskMode): DesignIterationPolicy {
  return {
    regionScoped: true,
    maxChangedClustersPerPass: 1,
    acceptOnlyOnImprovement: true,
    stopOnModeDrift: true,
    editabilityRequired: true,
  };
}

function hasActionableSuggestion(refineSuggestions: ReconstructionRefineSuggestion[]) {
  return refineSuggestions.some(
    (suggestion) =>
      suggestion.kind !== "manual-review" && suggestion.confidence >= actionableConfidenceThreshold,
  );
}

export function resolveDesignIterationStopReason(options: {
  compositeScore: number;
  hardFailureCount: number;
  iterationCount: number;
  maxIterations: number;
  stagnationCount: number;
  refineSuggestions?: ReconstructionRefineSuggestion[];
  modeDrift?: boolean;
  editabilitySatisfied?: boolean;
}): DesignIterationStopReason | null {
  if (options.modeDrift) {
    return "mode_drift";
  }
  if (options.editabilitySatisfied === false) {
    return "editability_failed";
  }
  if (options.compositeScore >= targetSimilarityThreshold && options.hardFailureCount === 0) {
    return "target_reached";
  }
  if (options.iterationCount >= options.maxIterations) {
    return "max_iterations";
  }
  if (options.stagnationCount >= stagnationLimit) {
    return "stalled";
  }
  if (options.refineSuggestions && !hasActionableSuggestion(options.refineSuggestions)) {
    return "no_actionable_suggestions";
  }
  return null;
}

export function evaluateDesignIterationPass(options: {
  mode: DesignTaskMode;
  regionClusterId: string | null;
  changedElementIds: string[];
  beforeScore: number | null;
  afterScore: number;
  hardFailures?: string[];
  modeDrift?: boolean;
  editabilitySatisfied?: boolean;
  warnings?: string[];
}): DesignRegionPassResult {
  const policy = buildDefaultIterationPolicy(options.mode);
  const scoreDelta =
    options.beforeScore === null ? null : Number((options.afterScore - options.beforeScore).toFixed(4));
  const hardFailures = options.hardFailures ?? [];
  const editabilitySatisfied = options.editabilitySatisfied !== false;
  const rejectedForNoImprovement =
    policy.acceptOnlyOnImprovement && scoreDelta !== null && scoreDelta <= 0;
  const stopReason = options.modeDrift
    ? "mode_drift"
    : !editabilitySatisfied
      ? "editability_failed"
      : rejectedForNoImprovement
        ? "no_improvement"
        : null;

  return {
    mode: options.mode,
    regionClusterId: options.regionClusterId,
    changedElementIds: options.changedElementIds.slice(0, policy.maxChangedClustersPerPass * 100),
    outcome: stopReason ? "rejected" : "accepted",
    stopReason,
    beforeScore: options.beforeScore,
    afterScore: Number(options.afterScore.toFixed(4)),
    scoreDelta,
    editabilitySatisfied,
    hardFailures,
    warnings: [...(options.warnings ?? [])],
  };
}

export function createDesignCaseRecord(options: {
  taskId: string;
  mode: DesignTaskMode;
  regionPass: DesignRegionPassResult;
  heuristicId?: string | null;
  createdAt: string;
  notes?: string[];
}): DesignCaseRecord {
  return {
    id: `case/${options.taskId}/${options.createdAt}`,
    mode: options.mode,
    taskId: options.taskId,
    regionClusterId: options.regionPass.regionClusterId,
    heuristicId: options.heuristicId ?? null,
    outcome: options.regionPass.outcome,
    stopReason: options.regionPass.stopReason,
    beforeScore: options.regionPass.beforeScore,
    afterScore: options.regionPass.afterScore,
    scoreDelta: options.regionPass.scoreDelta,
    createdAt: options.createdAt,
    notes: [...(options.notes ?? []), ...options.regionPass.warnings],
  };
}

export function mapDesignStopReasonToReconstructionStopReason(
  reason: DesignIterationStopReason | null,
): ReconstructionLoopStopReason | null {
  if (
    reason === "target_reached" ||
    reason === "max_iterations" ||
    reason === "stalled" ||
    reason === "no_actionable_suggestions" ||
    reason === "error"
  ) {
    return reason;
  }
  if (reason === "mode_drift" || reason === "no_improvement") {
    return "stalled";
  }
  if (reason === "editability_failed") {
    return "no_actionable_suggestions";
  }
  return null;
}

export function resolveReconstructionIterationStopReason(options: {
  compositeScore: number;
  hardFailureCount: number;
  iterationCount: number;
  maxIterations: number;
  stagnationCount: number;
  refineSuggestions: ReconstructionRefineSuggestion[];
}): ReconstructionLoopStopReason | null {
  return mapDesignStopReasonToReconstructionStopReason(
    resolveDesignIterationStopReason(options),
  );
}

export function formatDesignIterationStopMessage(
  stopReason: DesignIterationStopReason | ReconstructionLoopStopReason | null,
): string {
  switch (stopReason) {
    case "target_reached":
      return "已达到当前 tranche 的复合评分阈值，且硬性验收门槛已通过。";
    case "max_iterations":
      return "已达到当前 tranche 的最大迭代次数。";
    case "stalled":
    case "no_improvement":
      return "连续多轮提升低于阈值，自动 refine 已停止。";
    case "no_actionable_suggestions":
      return "当前没有足够可信的可执行修正建议，自动 refine 已停止。";
    case "mode_drift":
      return "检测到当前 pass 出现 mode drift，自动 refine 已停止。";
    case "editability_failed":
      return "当前 pass 未满足可编辑输出门槛，自动 refine 已停止。";
    case "error":
      return "自动 refine 因错误中止。";
    default:
      return "当前 reconstruction loop 已停止。";
  }
}
