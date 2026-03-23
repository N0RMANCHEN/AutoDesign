import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  ApproveReconstructionPlanPayload,
  ReconstructionAnalysisProvider,
  ReconstructionRasterAsset,
  ReconstructionStrategy,
  CreateReconstructionJobPayload,
  ReconstructionApprovalState,
  ReconstructionApplyStatus,
  ReconstructionApprovedAssetChoice,
  ReconstructionApprovedFontChoice,
  ReconstructionAnalysis,
  ReconstructionDiffMetrics,
  ReconstructionFontMatch,
  ReconstructionJob,
  ReconstructionJobSnapshot,
  ReconstructionLoopStatus,
  ReconstructionLoopStopReason,
  ReconstructionPlan,
  ReconstructionReviewFlag,
  ReviewReconstructionAssetPayload,
  ReviewReconstructionFontPayload,
  ReconstructionRefineSuggestion,
  ReconstructionRenderedPreview,
  ReconstructionStructureReport,
  ReconstructionStageId,
  ReconstructionStageStatus,
} from "../shared/reconstruction.js";
import {
  RECONSTRUCTION_ACTIONABLE_CONFIDENCE as actionableConfidenceThreshold,
  RECONSTRUCTION_MIN_IMPROVEMENT as minimumImprovementThreshold,
  RECONSTRUCTION_STAGNATION_LIMIT as stagnationLimit,
  RECONSTRUCTION_TARGET_SIMILARITY as targetSimilarityThreshold,
} from "../shared/reconstruction.js";
import type { PluginNodeSummary } from "../shared/plugin-bridge.js";
import type { FigmaCapabilityCommand } from "../shared/plugin-contract.js";
import { nowIso } from "../shared/utils.js";

const dataDirectory = path.join(process.cwd(), "data");
const reconstructionFile = path.join(dataDirectory, "autodesign-reconstruction-jobs.json");

const emptySnapshot: ReconstructionJobSnapshot = {
  jobs: [],
};

async function ensureReconstructionFile() {
  await mkdir(dataDirectory, { recursive: true });

  try {
    await readFile(reconstructionFile, "utf8");
  } catch {
    await writeFile(reconstructionFile, JSON.stringify(emptySnapshot, null, 2), "utf8");
  }
}

async function readSnapshot(): Promise<ReconstructionJobSnapshot> {
  await ensureReconstructionFile();
  const raw = await readFile(reconstructionFile, "utf8");
  return JSON.parse(raw) as ReconstructionJobSnapshot;
}

async function writeSnapshot(snapshot: ReconstructionJobSnapshot) {
  await ensureReconstructionFile();
  await writeFile(reconstructionFile, JSON.stringify(snapshot, null, 2), "utf8");
  return snapshot;
}

function generateId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function sortJobs(jobs: ReconstructionJob[]) {
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

function normalizeJob(job: ReconstructionJob): ReconstructionJob {
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

function resolveStrategy(
  input: CreateReconstructionJobPayload,
  referenceNode: PluginNodeSummary,
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

function hasActionableSuggestion(refineSuggestions: ReconstructionRefineSuggestion[]) {
  return refineSuggestions.some(
    (suggestion) =>
      suggestion.kind !== "manual-review" && suggestion.confidence >= actionableConfidenceThreshold,
  );
}

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
  const compositeScore = getCompositeScore(job);
  if (compositeScore >= targetSimilarityThreshold && !hasHardGateFailures(job)) {
    return "target_reached";
  }
  if (job.iterationCount >= job.input.maxIterations) {
    return "max_iterations";
  }
  if (job.stagnationCount >= stagnationLimit) {
    return "stalled";
  }
  if (!hasActionableSuggestion(refineSuggestions)) {
    return "no_actionable_suggestions";
  }
  return null;
}

function formatLoopStopMessage(stopReason: ReconstructionLoopStopReason | null) {
  switch (stopReason) {
    case "target_reached":
      return "已达到当前 tranche 的复合评分阈值，且硬性验收门槛已通过。";
    case "max_iterations":
      return "已达到当前 tranche 的最大迭代次数。";
    case "stalled":
      return "连续多轮提升低于阈值，自动 refine 已停止。";
    case "no_actionable_suggestions":
      return "当前没有足够可信的可执行修正建议，自动 refine 已停止。";
    case "error":
      return "自动 refine 因错误中止。";
    default:
      return "当前 reconstruction loop 已停止。";
  }
}

function createEmptyStages() {
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

function mergeWarnings(existing: string[], incoming: string[]) {
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

function mergeReviewFlags(existing: ReconstructionReviewFlag[], incoming: ReconstructionReviewFlag[]) {
  const byId = new Map<string, ReconstructionReviewFlag>();
  for (const item of [...existing, ...incoming]) {
    if (!item || typeof item.id !== "string" || !item.id.trim()) {
      continue;
    }
    byId.set(item.id, item);
  }
  return [...byId.values()];
}

function clampMaxIterations(value: number | undefined) {
  return Number.isFinite(value) && Number(value) > 0
    ? Math.max(1, Math.min(20, Math.floor(Number(value))))
    : 6;
}

export async function listReconstructionJobs(): Promise<ReconstructionJobSnapshot> {
  const snapshot = await readSnapshot();
  return {
    jobs: sortJobs(snapshot.jobs.map(normalizeJob)).slice(0, 100),
  };
}

export async function getReconstructionJob(jobId: string): Promise<ReconstructionJob | null> {
  const snapshot = await readSnapshot();
  const job = snapshot.jobs.find((item) => item.id === jobId) || null;
  return job ? normalizeJob(job) : null;
}

export async function createReconstructionJob(
  payload: CreateReconstructionJobPayload,
  targetNode: PluginNodeSummary,
  referenceNode: PluginNodeSummary,
  warnings: string[] = [],
): Promise<ReconstructionJob> {
  const snapshot = await readSnapshot();
  const timestamp = nowIso();
  const stages = createEmptyStages();
  const strategy = resolveStrategy(payload, referenceNode);
  stages[0] = {
    stageId: "validate-input",
    status: "completed",
    message: "输入校验通过，任务已进入待分析状态。",
    updatedAt: timestamp,
  };

  const job: ReconstructionJob = {
    id: generateId("reconstruction_job"),
    analysisVersion: "uninitialized",
    analysisProvider: "codex-assisted",
    input: {
      targetSessionId: payload.targetSessionId,
      targetNodeId: targetNode.id,
      referenceNodeId: referenceNode.id,
      goal: payload.goal || "pixel-match",
      strategy,
      maxIterations: clampMaxIterations(payload.maxIterations),
      allowOutpainting: Boolean(payload.allowOutpainting),
    },
    status: "ready",
    applyStatus: "not_applied",
    loopStatus: "idle",
    stopReason: null,
    approvalState: strategy === "raster-exact" ? "approved" : "not-reviewed",
    currentStageId: "extract-reference",
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: null,
    lastAppliedAt: null,
    diffScore: null,
    bestDiffScore: null,
    lastImprovement: null,
    stagnationCount: 0,
    warnings,
    targetNode,
    referenceNode,
    referenceRaster: null,
    analysis: null,
    fontMatches: [],
    rebuildPlan: null,
    reviewFlags: [],
    approvedFontChoices: [],
    approvedAssetChoices: [],
    renderedPreview: null,
    diffMetrics: null,
    structureReport: null,
    refineSuggestions: [],
    iterationCount: 0,
    appliedNodeIds: [],
    stages,
  };

  snapshot.jobs.unshift(job);
  await writeSnapshot({
    jobs: sortJobs(snapshot.jobs),
  });

  return job;
}

function updateStage(
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

function resetEvaluationStages(job: ReconstructionJob) {
  const timestamp = nowIso();
  updateStage(job, "render-preview", "pending", "等待渲染目标预览。", timestamp);
  updateStage(job, "measure-diff", "pending", "等待计算像素差异。", timestamp);
  updateStage(job, "refine", "pending", "等待生成下一轮修正。", timestamp);
  updateStage(job, "done", "pending", "等待任务完成。", timestamp);
}

export async function completeReconstructionAnalysis(
  jobId: string,
  payload: {
    analysisVersion: string;
    analysisProvider: ReconstructionAnalysisProvider;
    analysis: ReconstructionAnalysis;
    fontMatches: ReconstructionFontMatch[];
    rebuildPlan: ReconstructionPlan;
    reviewFlags: ReconstructionReviewFlag[];
    warnings: string[];
  },
): Promise<ReconstructionJob | null> {
  const snapshot = await readSnapshot();
  const jobIndex = snapshot.jobs.findIndex((job) => job.id === jobId);
  if (jobIndex < 0) {
    return null;
  }

  const timestamp = nowIso();
  const nextJob: ReconstructionJob = {
    ...snapshot.jobs[jobIndex],
    analysisVersion: payload.analysisVersion,
    analysisProvider: payload.analysisProvider,
    updatedAt: timestamp,
    currentStageId: "plan-rebuild",
    loopStatus: "idle",
    stopReason: null,
    approvalState: payload.reviewFlags.length ? "pending-review" : "approved",
    warnings: mergeWarnings(snapshot.jobs[jobIndex].warnings, payload.warnings),
    analysis: payload.analysis,
    fontMatches: payload.fontMatches,
    rebuildPlan: payload.rebuildPlan,
    reviewFlags: mergeReviewFlags([], payload.reviewFlags),
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

  updateStage(nextJob, "extract-reference", "completed", "参考图预览提取完成。", timestamp);
  updateStage(nextJob, "analyze-layout", "completed", "已生成布局与视觉区域分析。", timestamp);
  updateStage(nextJob, "match-fonts", "completed", "已生成字体候选。", timestamp);
  updateStage(nextJob, "plan-rebuild", "completed", "已生成重建计划。", timestamp);
  updateStage(nextJob, "apply-rebuild", "pending", "等待写入 Figma。", timestamp);
  resetEvaluationStages(nextJob);

  snapshot.jobs[jobIndex] = nextJob;
  await writeSnapshot({
    jobs: sortJobs(snapshot.jobs),
  });

  return nextJob;
}

export async function prepareRasterReconstruction(
  jobId: string,
  payload: {
    referenceRaster: ReconstructionRasterAsset;
    warnings?: string[];
  },
): Promise<ReconstructionJob | null> {
  const snapshot = await readSnapshot();
  const jobIndex = snapshot.jobs.findIndex((job) => job.id === jobId);
  if (jobIndex < 0) {
    return null;
  }

  const current = normalizeJob(snapshot.jobs[jobIndex]);
  const timestamp = nowIso();
  const preserveAppliedState = current.applyStatus === "applied";
  const nextJob: ReconstructionJob = {
    ...current,
    analysisVersion: "raster-exact-v1",
    analysisProvider: "heuristic-local",
    updatedAt: timestamp,
    currentStageId: preserveAppliedState ? current.currentStageId : "apply-rebuild",
    approvalState: "approved",
    warnings: mergeWarnings(current.warnings, payload.warnings || []),
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

  updateStage(nextJob, "extract-reference", "completed", "已导出参考图原始栅格资源。", timestamp);
  updateStage(nextJob, "analyze-layout", "completed", "raster-exact 策略跳过结构化分析。", timestamp);
  updateStage(nextJob, "match-fonts", "completed", "raster-exact 策略不需要字体匹配。", timestamp);
  updateStage(nextJob, "plan-rebuild", "completed", "raster-exact 策略已准备直接写回目标 Frame。", timestamp);
  if (!preserveAppliedState) {
    updateStage(nextJob, "apply-rebuild", "pending", "等待写入 Figma。", timestamp);
    resetEvaluationStages(nextJob);
  }

  snapshot.jobs[jobIndex] = nextJob;
  await writeSnapshot({
    jobs: sortJobs(snapshot.jobs),
  });

  return nextJob;
}

export async function prepareVectorReconstruction(
  jobId: string,
  payload: {
    referenceRaster: ReconstructionRasterAsset;
    warnings?: string[];
  },
): Promise<ReconstructionJob | null> {
  const snapshot = await readSnapshot();
  const jobIndex = snapshot.jobs.findIndex((job) => job.id === jobId);
  if (jobIndex < 0) {
    return null;
  }

  const current = normalizeJob(snapshot.jobs[jobIndex]);
  const timestamp = nowIso();
  const nextJob: ReconstructionJob = {
    ...current,
    analysisVersion: "vector-reconstruction-v1",
    analysisProvider: "codex-assisted",
    updatedAt: timestamp,
    currentStageId: "analyze-layout",
    approvalState: "not-reviewed",
    warnings: mergeWarnings(current.warnings, payload.warnings || []),
    referenceRaster: payload.referenceRaster,
    analysis: null,
    fontMatches: [],
    rebuildPlan: null,
    reviewFlags: [],
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

  updateStage(nextJob, "extract-reference", "completed", "已导出参考图高分辨率资源。", timestamp);
  updateStage(nextJob, "analyze-layout", "pending", "等待提交正视正交矢量分析。", timestamp);
  updateStage(nextJob, "match-fonts", "pending", "等待确认文字与风格推断。", timestamp);
  updateStage(nextJob, "plan-rebuild", "pending", "等待生成固定 frame 的矢量重建计划。", timestamp);
  updateStage(nextJob, "apply-rebuild", "pending", "等待写入 Figma。", timestamp);
  resetEvaluationStages(nextJob);

  snapshot.jobs[jobIndex] = nextJob;
  await writeSnapshot({
    jobs: sortJobs(snapshot.jobs),
  });

  return nextJob;
}

export async function prepareHybridReconstruction(
  jobId: string,
  payload: {
    referenceRaster: ReconstructionRasterAsset;
    warnings?: string[];
  },
): Promise<ReconstructionJob | null> {
  const snapshot = await readSnapshot();
  const jobIndex = snapshot.jobs.findIndex((job) => job.id === jobId);
  if (jobIndex < 0) {
    return null;
  }

  const current = normalizeJob(snapshot.jobs[jobIndex]);
  const timestamp = nowIso();
  const nextJob: ReconstructionJob = {
    ...current,
    analysisVersion: "hybrid-reconstruction-v1",
    analysisProvider: "codex-assisted",
    updatedAt: timestamp,
    currentStageId: "analyze-layout",
    approvalState: "not-reviewed",
    warnings: mergeWarnings(current.warnings, payload.warnings || []),
    referenceRaster: payload.referenceRaster,
    analysis: null,
    fontMatches: [],
    rebuildPlan: null,
    reviewFlags: [],
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

  updateStage(nextJob, "extract-reference", "completed", "已导出参考图高分辨率资源，并准备混合式重建。", timestamp);
  updateStage(nextJob, "analyze-layout", "pending", "等待提交 fixed-frame 的 hybrid analysis。", timestamp);
  updateStage(nextJob, "match-fonts", "pending", "等待确认可编辑文字与覆盖层。", timestamp);
  updateStage(nextJob, "plan-rebuild", "pending", "等待生成 raster base + editable overlay 的重建计划。", timestamp);
  updateStage(nextJob, "apply-rebuild", "pending", "等待写入 Figma。", timestamp);
  resetEvaluationStages(nextJob);

  snapshot.jobs[jobIndex] = nextJob;
  await writeSnapshot({
    jobs: sortJobs(snapshot.jobs),
  });

  return nextJob;
}

export async function failReconstructionJob(
  jobId: string,
  stageId: ReconstructionStageId,
  message: string,
): Promise<ReconstructionJob | null> {
  const snapshot = await readSnapshot();
  const jobIndex = snapshot.jobs.findIndex((job) => job.id === jobId);
  if (jobIndex < 0) {
    return null;
  }

  const timestamp = nowIso();
  const nextJob: ReconstructionJob = {
    ...snapshot.jobs[jobIndex],
    status: "failed",
    loopStatus: "stopped",
    stopReason: "error",
    currentStageId: stageId,
    updatedAt: timestamp,
    completedAt: timestamp,
    warnings: mergeWarnings(snapshot.jobs[jobIndex].warnings, [message]),
  };

  updateStage(nextJob, stageId, "failed", message, timestamp);
  snapshot.jobs[jobIndex] = nextJob;
  await writeSnapshot({
    jobs: sortJobs(snapshot.jobs),
  });

  return nextJob;
}

export async function markReconstructionApplied(
  jobId: string,
  payload: {
    appliedNodeIds: string[];
    warnings?: string[];
  },
): Promise<ReconstructionJob | null> {
  const snapshot = await readSnapshot();
  const jobIndex = snapshot.jobs.findIndex((job) => job.id === jobId);
  if (jobIndex < 0) {
    return null;
  }

  const timestamp = nowIso();
  const nextJob: ReconstructionJob = {
    ...snapshot.jobs[jobIndex],
    status: "ready",
    applyStatus: "applied",
    loopStatus: "idle",
    stopReason: null,
    currentStageId: "apply-rebuild",
    approvalState: snapshot.jobs[jobIndex].approvalState,
    updatedAt: timestamp,
    lastAppliedAt: timestamp,
    completedAt: null,
    diffScore: null,
    bestDiffScore: null,
    lastImprovement: null,
    stagnationCount: 0,
    warnings: mergeWarnings(snapshot.jobs[jobIndex].warnings, payload.warnings || []),
    renderedPreview: null,
    diffMetrics: null,
    structureReport: null,
    refineSuggestions: [],
    iterationCount: 0,
    appliedNodeIds: [...new Set(payload.appliedNodeIds)],
  };

  updateStage(nextJob, "apply-rebuild", "completed", "已将 rebuild plan 写入目标 Frame。", timestamp);
  resetEvaluationStages(nextJob);

  snapshot.jobs[jobIndex] = nextJob;
  await writeSnapshot({
    jobs: sortJobs(snapshot.jobs),
  });

  return nextJob;
}

export async function clearReconstructionAppliedState(
  jobId: string,
  payload?: {
    warnings?: string[];
    applyStatus?: ReconstructionApplyStatus;
    currentStageId?: ReconstructionStageId;
    message?: string;
  },
): Promise<ReconstructionJob | null> {
  const snapshot = await readSnapshot();
  const jobIndex = snapshot.jobs.findIndex((job) => job.id === jobId);
  if (jobIndex < 0) {
    return null;
  }

  const timestamp = nowIso();
  const nextJob: ReconstructionJob = {
    ...snapshot.jobs[jobIndex],
    status: "ready",
    applyStatus: payload?.applyStatus || "not_applied",
    loopStatus: "idle",
    stopReason: null,
    currentStageId: payload?.currentStageId || "plan-rebuild",
    approvalState: snapshot.jobs[jobIndex].approvalState,
    updatedAt: timestamp,
    completedAt: null,
    lastAppliedAt: null,
    diffScore: null,
    bestDiffScore: null,
    lastImprovement: null,
    stagnationCount: 0,
    warnings: mergeWarnings(snapshot.jobs[jobIndex].warnings, payload?.warnings || []),
    renderedPreview: null,
    diffMetrics: null,
    structureReport: null,
    refineSuggestions: [],
    iterationCount: 0,
    appliedNodeIds: [],
  };

  updateStage(
    nextJob,
    "apply-rebuild",
    "pending",
    payload?.message || "等待写入 Figma。",
    timestamp,
  );
  resetEvaluationStages(nextJob);

  snapshot.jobs[jobIndex] = nextJob;
  await writeSnapshot({
    jobs: sortJobs(snapshot.jobs),
  });

  return nextJob;
}

export async function markReconstructionRendered(
  jobId: string,
  payload: {
    renderedPreview: ReconstructionRenderedPreview;
    targetNode: PluginNodeSummary;
    structureReport?: ReconstructionStructureReport | null;
    warnings?: string[];
  },
): Promise<ReconstructionJob | null> {
  const snapshot = await readSnapshot();
  const jobIndex = snapshot.jobs.findIndex((job) => job.id === jobId);
  if (jobIndex < 0) {
    return null;
  }

  const timestamp = nowIso();
  const nextJob: ReconstructionJob = {
    ...snapshot.jobs[jobIndex],
    status: "ready",
    currentStageId: "render-preview",
    approvalState: snapshot.jobs[jobIndex].approvalState,
    updatedAt: timestamp,
    completedAt: null,
    warnings: mergeWarnings(snapshot.jobs[jobIndex].warnings, payload.warnings || []),
    targetNode: payload.targetNode,
    renderedPreview: payload.renderedPreview,
    structureReport:
      payload.structureReport === undefined ? snapshot.jobs[jobIndex].structureReport : payload.structureReport,
  };

  updateStage(nextJob, "render-preview", "completed", "已获取目标 Frame 最新预览。", timestamp);

  snapshot.jobs[jobIndex] = nextJob;
  await writeSnapshot({
    jobs: sortJobs(snapshot.jobs),
  });

  return nextJob;
}

export async function markReconstructionMeasured(
  jobId: string,
  payload: {
    diffMetrics: ReconstructionDiffMetrics;
    warnings?: string[];
  },
): Promise<ReconstructionJob | null> {
  const snapshot = await readSnapshot();
  const jobIndex = snapshot.jobs.findIndex((job) => job.id === jobId);
  if (jobIndex < 0) {
    return null;
  }

  const timestamp = nowIso();
  const previousDiffScore = snapshot.jobs[jobIndex].diffScore;
  const currentDiffScore = payload.diffMetrics.compositeScore;
  const lastImprovement =
    previousDiffScore === null ? null : currentDiffScore - previousDiffScore;
  const stagnationCount =
    lastImprovement !== null && lastImprovement < minimumImprovementThreshold
      ? snapshot.jobs[jobIndex].stagnationCount + 1
      : 0;
  const nextJob: ReconstructionJob = {
    ...snapshot.jobs[jobIndex],
    status: "ready",
    currentStageId: "measure-diff",
    approvalState: snapshot.jobs[jobIndex].approvalState,
    updatedAt: timestamp,
    completedAt: null,
    diffScore: currentDiffScore,
    bestDiffScore: Math.max(snapshot.jobs[jobIndex].bestDiffScore || 0, currentDiffScore),
    lastImprovement,
    stagnationCount,
    diffMetrics: payload.diffMetrics,
    iterationCount: snapshot.jobs[jobIndex].iterationCount + 1,
    warnings: mergeWarnings(snapshot.jobs[jobIndex].warnings, payload.warnings || []),
  };

  updateStage(
    nextJob,
    "measure-diff",
    "completed",
    `已完成视觉评分，composite=${payload.diffMetrics.compositeScore.toFixed(3)} grade=${payload.diffMetrics.grade} failedGates=${payload.diffMetrics.acceptanceGates.filter((gate) => !gate.passed).length}。`,
    timestamp,
  );

  snapshot.jobs[jobIndex] = nextJob;
  await writeSnapshot({
    jobs: sortJobs(snapshot.jobs),
  });

  return nextJob;
}

export async function markReconstructionRefined(
  jobId: string,
  payload: {
    refineSuggestions: ReconstructionRefineSuggestion[];
    warnings?: string[];
  },
): Promise<ReconstructionJob | null> {
  const snapshot = await readSnapshot();
  const jobIndex = snapshot.jobs.findIndex((job) => job.id === jobId);
  if (jobIndex < 0) {
    return null;
  }

  const timestamp = nowIso();
  const current = snapshot.jobs[jobIndex];
  const stopReason = resolveLoopStopReason(current, payload.refineSuggestions);
  const shouldComplete = Boolean(stopReason);
  const nextJob: ReconstructionJob = {
    ...current,
    status: shouldComplete ? "completed" : "ready",
    loopStatus: shouldComplete ? "stopped" : current.loopStatus === "running" ? "running" : "idle",
    stopReason,
    currentStageId: shouldComplete ? "done" : "refine",
    approvalState: current.approvalState,
    updatedAt: timestamp,
    completedAt: shouldComplete ? timestamp : null,
    warnings: mergeWarnings(current.warnings, payload.warnings || []),
    refineSuggestions: payload.refineSuggestions,
  };

  updateStage(
    nextJob,
    "refine",
    "completed",
    shouldComplete
      ? formatLoopStopMessage(stopReason)
      : `已生成 ${payload.refineSuggestions.length} 条 refine 建议。`,
    timestamp,
  );

  if (shouldComplete) {
    updateStage(nextJob, "done", "completed", "当前 reconstruction iteration 已完成。", timestamp);
  }

  snapshot.jobs[jobIndex] = nextJob;
  await writeSnapshot({
    jobs: sortJobs(snapshot.jobs),
  });

  return nextJob;
}

export async function markReconstructionLoopStatus(
  jobId: string,
  payload: {
    loopStatus: ReconstructionLoopStatus;
    stopReason?: ReconstructionLoopStopReason | null;
    warnings?: string[];
  },
): Promise<ReconstructionJob | null> {
  const snapshot = await readSnapshot();
  const jobIndex = snapshot.jobs.findIndex((job) => job.id === jobId);
  if (jobIndex < 0) {
    return null;
  }

  const timestamp = nowIso();
  const nextJob: ReconstructionJob = {
    ...snapshot.jobs[jobIndex],
    status: payload.loopStatus === "stopped" ? "completed" : snapshot.jobs[jobIndex].status,
    loopStatus: payload.loopStatus,
    stopReason:
      payload.stopReason === undefined ? snapshot.jobs[jobIndex].stopReason : payload.stopReason,
    updatedAt: timestamp,
    completedAt:
      payload.loopStatus === "stopped" ? snapshot.jobs[jobIndex].completedAt || timestamp : null,
    warnings: mergeWarnings(snapshot.jobs[jobIndex].warnings, payload.warnings || []),
  };

  if (payload.loopStatus === "running") {
    updateStage(nextJob, "done", "pending", "自动 refine loop 正在运行。", timestamp);
  }

  if (payload.loopStatus === "stopped") {
    updateStage(nextJob, "done", "completed", formatLoopStopMessage(nextJob.stopReason), timestamp);
  }

  snapshot.jobs[jobIndex] = nextJob;
  await writeSnapshot({
    jobs: sortJobs(snapshot.jobs),
  });

  return nextJob;
}

function replaceRebuildPlanFontChoice(
  rebuildPlan: ReconstructionPlan | null,
  textCandidateId: string,
  fontFamily: string,
) {
  if (!rebuildPlan) {
    return rebuildPlan;
  }

  return {
    ...rebuildPlan,
    ops: rebuildPlan.ops.map((op) => {
      if (op.capabilityId !== "nodes.create-text") {
        return op;
      }
      const payload = op.payload as Record<string, unknown>;
      if (payload.analysisRefId !== textCandidateId) {
        return op;
      }
      return {
        ...op,
        payload: {
          ...payload,
          fontFamily,
        },
      } as FigmaCapabilityCommand;
    }),
  };
}

export async function reviewReconstructionFontChoice(
  jobId: string,
  payload: ReviewReconstructionFontPayload,
): Promise<ReconstructionJob | null> {
  const snapshot = await readSnapshot();
  const jobIndex = snapshot.jobs.findIndex((job) => job.id === jobId);
  if (jobIndex < 0) {
    return null;
  }

  const current = normalizeJob(snapshot.jobs[jobIndex]);
  const matchIndex = current.fontMatches.findIndex((item) => item.textCandidateId === payload.textCandidateId);
  if (matchIndex < 0) {
    throw new Error(`Unknown textCandidateId: ${payload.textCandidateId}`);
  }

  const timestamp = nowIso();
  const nextFontMatches = [...current.fontMatches];
  nextFontMatches[matchIndex] = {
    ...nextFontMatches[matchIndex],
    recommended: payload.fontFamily,
    candidates: [payload.fontFamily, ...nextFontMatches[matchIndex].candidates.filter((item) => item !== payload.fontFamily)].slice(0, 5),
  };

  const nextApprovedChoices = [
    ...current.approvedFontChoices.filter((item) => item.textCandidateId !== payload.textCandidateId),
    {
      textCandidateId: payload.textCandidateId,
      fontFamily: payload.fontFamily,
      approvedAt: timestamp,
    } satisfies ReconstructionApprovedFontChoice,
  ];

  const nextReviewFlags = current.reviewFlags.filter(
    (flag) => !(flag.kind === "font-review" && flag.targetId === payload.textCandidateId),
  );

  const nextJob: ReconstructionJob = {
    ...current,
    updatedAt: timestamp,
    fontMatches: nextFontMatches,
    rebuildPlan: replaceRebuildPlanFontChoice(current.rebuildPlan, payload.textCandidateId, payload.fontFamily),
    approvedFontChoices: nextApprovedChoices,
    reviewFlags: nextReviewFlags,
  };

  snapshot.jobs[jobIndex] = nextJob;
  await writeSnapshot({ jobs: sortJobs(snapshot.jobs) });
  return nextJob;
}

export async function reviewReconstructionAssetChoice(
  jobId: string,
  payload: ReviewReconstructionAssetPayload,
): Promise<ReconstructionJob | null> {
  const snapshot = await readSnapshot();
  const jobIndex = snapshot.jobs.findIndex((job) => job.id === jobId);
  if (jobIndex < 0) {
    return null;
  }

  const current = normalizeJob(snapshot.jobs[jobIndex]);
  const hasAsset = Boolean(current.analysis?.assetCandidates.some((item) => item.id === payload.assetId));
  if (!hasAsset) {
    throw new Error(`Unknown assetId: ${payload.assetId}`);
  }

  const timestamp = nowIso();
  const nextApprovedChoices = [
    ...current.approvedAssetChoices.filter((item) => item.assetId !== payload.assetId),
    {
      assetId: payload.assetId,
      decision: payload.decision,
      note: payload.note,
      approvedAt: timestamp,
    } satisfies ReconstructionApprovedAssetChoice,
  ];

  const nextReviewFlags = current.reviewFlags.filter(
    (flag) => !(flag.kind === "asset-review" && flag.targetId === payload.assetId),
  );

  const nextJob: ReconstructionJob = {
    ...current,
    updatedAt: timestamp,
    approvedAssetChoices: nextApprovedChoices,
    reviewFlags: nextReviewFlags,
    warnings: payload.note ? mergeWarnings(current.warnings, [payload.note]) : current.warnings,
  };

  snapshot.jobs[jobIndex] = nextJob;
  await writeSnapshot({ jobs: sortJobs(snapshot.jobs) });
  return nextJob;
}

export async function approveReconstructionPlan(
  jobId: string,
  payload: ApproveReconstructionPlanPayload,
): Promise<ReconstructionJob | null> {
  const snapshot = await readSnapshot();
  const jobIndex = snapshot.jobs.findIndex((job) => job.id === jobId);
  if (jobIndex < 0) {
    return null;
  }

  const current = normalizeJob(snapshot.jobs[jobIndex]);
  const timestamp = nowIso();
  const nextApprovalState: ReconstructionApprovalState = payload.approved ? "approved" : "changes-requested";
  const nextReviewFlags = payload.approved
    ? current.reviewFlags.filter((flag) => flag.kind !== "preview-plan-review")
    : current.reviewFlags;

  const nextJob: ReconstructionJob = {
    ...current,
    updatedAt: timestamp,
    approvalState: nextApprovalState,
    reviewFlags: nextReviewFlags,
    warnings: payload.note ? mergeWarnings(current.warnings, [payload.note]) : current.warnings,
  };

  snapshot.jobs[jobIndex] = nextJob;
  await writeSnapshot({ jobs: sortJobs(snapshot.jobs) });
  return nextJob;
}
