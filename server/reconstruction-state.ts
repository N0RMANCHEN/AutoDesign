import type { PluginNodeSummary } from "../shared/plugin-bridge.js";
import type {
  CreateReconstructionJobPayload,
  ReconstructionApplyStatus,
  ReconstructionJob,
  ReconstructionJobSnapshot,
  ReconstructionReviewFlag,
  ReconstructionStageId,
  ReconstructionStageStatus,
  ReconstructionStrategy,
} from "../shared/reconstruction.js";
import { nowIso } from "../shared/utils.js";

export function sortReconstructionJobs(jobs: ReconstructionJob[]) {
  return [...jobs].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function normalizeDiffMetrics(job: ReconstructionJob): ReconstructionJob["diffMetrics"] {
  if (!job.diffMetrics) {
    return null;
  }

  return {
    globalSimilarity: Number.isFinite(job.diffMetrics.globalSimilarity) ? Number(job.diffMetrics.globalSimilarity) : 0,
    colorDelta: Number.isFinite(job.diffMetrics.colorDelta) ? Number(job.diffMetrics.colorDelta) : 0,
    edgeSimilarity: Number.isFinite(job.diffMetrics.edgeSimilarity) ? Number(job.diffMetrics.edgeSimilarity) : 0,
    layoutSimilarity: Number.isFinite(job.diffMetrics.layoutSimilarity) ? Number(job.diffMetrics.layoutSimilarity) : 0,
    structureSimilarity: Number.isFinite(job.diffMetrics.structureSimilarity)
      ? Number(job.diffMetrics.structureSimilarity)
      : Number.isFinite(job.diffMetrics.layoutSimilarity)
        ? Number(job.diffMetrics.layoutSimilarity)
        : 0,
    hotspotAverage: Number.isFinite(job.diffMetrics.hotspotAverage) ? Number(job.diffMetrics.hotspotAverage) : 0,
    hotspotPeak: Number.isFinite(job.diffMetrics.hotspotPeak)
      ? Number(job.diffMetrics.hotspotPeak)
      : Array.isArray(job.diffMetrics.hotspots) && job.diffMetrics.hotspots.length
        ? Math.max(...job.diffMetrics.hotspots.map((item) => (Number.isFinite(item.score) ? Number(item.score) : 0)))
        : 0,
    hotspotCoverage: Number.isFinite(job.diffMetrics.hotspotCoverage) ? Number(job.diffMetrics.hotspotCoverage) : 0,
    compositeScore: Number.isFinite(job.diffMetrics.compositeScore)
      ? Number(job.diffMetrics.compositeScore)
      : Number.isFinite(job.diffMetrics.globalSimilarity)
        ? Number(job.diffMetrics.globalSimilarity)
        : 0,
    grade:
      job.diffMetrics.grade === "A" ||
      job.diffMetrics.grade === "B" ||
      job.diffMetrics.grade === "C" ||
      job.diffMetrics.grade === "D"
        ? job.diffMetrics.grade
        : "F",
    acceptanceGates: Array.isArray(job.diffMetrics.acceptanceGates) ? job.diffMetrics.acceptanceGates : [],
    hotspots: Array.isArray(job.diffMetrics.hotspots) ? job.diffMetrics.hotspots : [],
  };
}

export function normalizeReconstructionJob(job: ReconstructionJob): ReconstructionJob {
  return {
    ...job,
    input: {
      ...job.input,
      strategy:
        job.input?.strategy === "hybrid-reconstruction"
          ? "hybrid-reconstruction"
          : job.input?.strategy === "raster-exact"
            ? "raster-exact"
            : job.input?.strategy === "structural-preview"
              ? "structural-preview"
              : "vector-reconstruction",
    },
    analysisVersion: typeof job.analysisVersion === "string" && job.analysisVersion.trim()
      ? job.analysisVersion
      : "legacy-preview-v1",
    analysisProvider:
      job.analysisProvider === "codex-assisted" ||
      job.analysisProvider === "openai-responses"
        ? job.analysisProvider
        : "heuristic-local",
    applyStatus: job.applyStatus || "not_applied",
    loopStatus: job.loopStatus || "idle",
    stopReason: job.stopReason || null,
    approvalState: job.approvalState || "not-reviewed",
    lastAppliedAt: job.lastAppliedAt || null,
    diffScore: Number.isFinite(job.diffScore) ? job.diffScore : null,
    bestDiffScore: Number.isFinite(job.bestDiffScore) ? Number(job.bestDiffScore) : null,
    lastImprovement: Number.isFinite(job.lastImprovement) ? Number(job.lastImprovement) : null,
    stagnationCount: Number.isFinite(job.stagnationCount) ? Number(job.stagnationCount) : 0,
    warnings: Array.isArray(job.warnings) ? job.warnings : [],
    referenceRaster: job.referenceRaster || null,
    analysis: job.analysis || null,
    fontMatches: Array.isArray(job.fontMatches) ? job.fontMatches : [],
    rebuildPlan: job.rebuildPlan || null,
    reviewFlags: Array.isArray(job.reviewFlags) ? job.reviewFlags : [],
    approvedFontChoices: Array.isArray(job.approvedFontChoices) ? job.approvedFontChoices : [],
    approvedAssetChoices: Array.isArray(job.approvedAssetChoices) ? job.approvedAssetChoices : [],
    renderedPreview: job.renderedPreview || null,
    diffMetrics: normalizeDiffMetrics(job),
    structureReport: job.structureReport || null,
    refineSuggestions: Array.isArray(job.refineSuggestions) ? job.refineSuggestions : [],
    iterationCount: Number.isFinite(job.iterationCount) ? Number(job.iterationCount) : 0,
    appliedNodeIds: Array.isArray(job.appliedNodeIds) ? job.appliedNodeIds : [],
  };
}

export function mergeReconstructionWarnings(existing: string[], incoming: string[]) {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const warning of [...existing, ...incoming]) {
    const normalized = String(warning || "").trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    merged.push(normalized);
  }
  return merged;
}

export function mergeReconstructionReviewFlags(
  existing: ReconstructionReviewFlag[],
  incoming: ReconstructionReviewFlag[],
) {
  const byId = new Map<string, ReconstructionReviewFlag>();
  for (const item of [...existing, ...incoming]) {
    if (!item || typeof item.id !== "string" || !item.id.trim()) {
      continue;
    }
    byId.set(item.id, item);
  }
  return [...byId.values()];
}

export function hasPreparedReconstructionState(
  job: Pick<
    ReconstructionJob,
    | "analysis"
    | "rebuildPlan"
    | "fontMatches"
    | "reviewFlags"
    | "approvedFontChoices"
    | "approvedAssetChoices"
    | "approvalState"
  >,
) {
  return Boolean(
    job.analysis ||
      job.rebuildPlan ||
      job.fontMatches.length ||
      job.reviewFlags.length ||
      job.approvedFontChoices.length ||
      job.approvedAssetChoices.length ||
      job.approvalState !== "not-reviewed",
  );
}

export function clampReconstructionMaxIterations(value: number | undefined) {
  return Number.isFinite(value) && Number(value) > 0
    ? Math.max(1, Math.min(20, Math.floor(Number(value))))
    : 6;
}

export function resolveReconstructionStrategy(
  input: CreateReconstructionJobPayload,
  _referenceNode: PluginNodeSummary,
): ReconstructionStrategy {
  if (input.strategy === "vector-reconstruction") {
    return "vector-reconstruction";
  }
  if (input.strategy === "hybrid-reconstruction") {
    return "hybrid-reconstruction";
  }
  if (input.strategy === "structural-preview") {
    return "structural-preview";
  }
  if (input.strategy === "raster-exact") {
    return "raster-exact";
  }
  return "vector-reconstruction";
}

export function createEmptyReconstructionStages() {
  return [
    {
      stageId: "validate-input",
      status: "pending",
      message: "等待输入校验。",
      updatedAt: null,
    },
    {
      stageId: "extract-reference",
      status: "pending",
      message: "等待提取参考图结构。",
      updatedAt: null,
    },
    {
      stageId: "analyze-layout",
      status: "pending",
      message: "等待分析布局与主视觉区域。",
      updatedAt: null,
    },
    {
      stageId: "match-fonts",
      status: "pending",
      message: "等待匹配近似字体候选。",
      updatedAt: null,
    },
    {
      stageId: "plan-rebuild",
      status: "pending",
      message: "等待生成结构化重建计划。",
      updatedAt: null,
    },
    {
      stageId: "apply-rebuild",
      status: "pending",
      message: "等待写入 Figma。",
      updatedAt: null,
    },
    {
      stageId: "render-preview",
      status: "pending",
      message: "等待渲染目标预览。",
      updatedAt: null,
    },
    {
      stageId: "measure-diff",
      status: "pending",
      message: "等待计算像素差异。",
      updatedAt: null,
    },
    {
      stageId: "refine",
      status: "pending",
      message: "等待生成下一轮修正。",
      updatedAt: null,
    },
    {
      stageId: "done",
      status: "pending",
      message: "等待任务完成。",
      updatedAt: null,
    },
  ] as ReconstructionJob["stages"];
}

export function updateReconstructionStage(
  job: ReconstructionJob,
  stageId: ReconstructionStageId,
  status: ReconstructionStageStatus,
  message: string,
  timestamp: string,
) {
  job.stages = job.stages.map((stage) =>
    stage.stageId === stageId
      ? {
          ...stage,
          status,
          message,
          updatedAt: timestamp,
        }
      : stage,
  );
}

export function resetReconstructionEvaluationStages(job: ReconstructionJob) {
  const timestamp = nowIso();
  updateReconstructionStage(job, "render-preview", "pending", "等待渲染目标预览。", timestamp);
  updateReconstructionStage(job, "measure-diff", "pending", "等待计算像素差异。", timestamp);
  updateReconstructionStage(job, "refine", "pending", "等待生成下一轮修正。", timestamp);
  updateReconstructionStage(job, "done", "pending", "等待任务完成。", timestamp);
}

export function buildNormalizedReconstructionJobSnapshot(snapshot: ReconstructionJobSnapshot) {
  return {
    jobs: sortReconstructionJobs(snapshot.jobs.map(normalizeReconstructionJob)).slice(0, 100),
  };
}

export function ensureAppliedNodeIds(
  applyStatus: ReconstructionApplyStatus,
  nodeIds: string[],
) {
  return applyStatus === "applied" ? nodeIds : [];
}
