import type {
  ApproveReconstructionPlanPayload,
  ReconstructionAnalysisProvider,
  ReconstructionRasterAsset,
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
  ReconstructionLoopStopReason,
  ReconstructionPlan,
  ReconstructionReviewFlag,
  ReviewReconstructionAssetPayload,
  ReviewReconstructionFontPayload,
  ReconstructionRefineSuggestion,
  ReconstructionRenderedPreview,
  ReconstructionStructureReport,
  ReconstructionStageId,
  ReconstructionLoopStatus,
} from "../shared/reconstruction.js";
import type { PluginNodeSummary } from "../shared/plugin-bridge.js";
import type { FigmaCapabilityCommand } from "../shared/plugin-contract.js";
import { nowIso } from "../shared/utils.js";
import {
  readReconstructionJobSnapshot as readSnapshot,
  writeReconstructionJobSnapshot as writeSnapshot,
} from "./adapters/reconstruction-job-repository.js";
import {
  buildNormalizedReconstructionJobSnapshot,
  clampReconstructionMaxIterations,
  createEmptyReconstructionStages,
  mergeReconstructionWarnings,
  normalizeReconstructionJob,
  resolveReconstructionStrategy,
  sortReconstructionJobs,
} from "./reconstruction-state.js";
import {
  buildAppliedReconstructionJob,
  buildClearedAppliedReconstructionJob,
  buildCompletedAnalysisReconstructionJob,
  buildFailedReconstructionJob,
  buildLoopStatusReconstructionJob,
  buildMeasuredReconstructionJob,
  buildPreparedHybridReconstructionJob,
  buildPreparedRasterReconstructionJob,
  buildPreparedVectorReconstructionJob,
  buildRefinedReconstructionJob,
  buildRenderedReconstructionJob,
} from "./reconstruction-lifecycle.js";

function generateId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function listReconstructionJobs(): Promise<ReconstructionJobSnapshot> {
  const snapshot = await readSnapshot();
  return buildNormalizedReconstructionJobSnapshot(snapshot);
}

export async function getReconstructionJob(jobId: string): Promise<ReconstructionJob | null> {
  const snapshot = await readSnapshot();
  const job = snapshot.jobs.find((item) => item.id === jobId) || null;
  return job ? normalizeReconstructionJob(job) : null;
}

export async function createReconstructionJob(
  payload: CreateReconstructionJobPayload,
  targetNode: PluginNodeSummary,
  referenceNode: PluginNodeSummary,
  warnings: string[] = [],
): Promise<ReconstructionJob> {
  const snapshot = await readSnapshot();
  const timestamp = nowIso();
  const stages = createEmptyReconstructionStages();
  const strategy = resolveReconstructionStrategy(payload, referenceNode);
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
      maxIterations: clampReconstructionMaxIterations(payload.maxIterations),
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
    jobs: sortReconstructionJobs(snapshot.jobs),
  });

  return job;
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
  const nextJob = buildCompletedAnalysisReconstructionJob(snapshot.jobs[jobIndex], payload, timestamp);

  snapshot.jobs[jobIndex] = nextJob;
  await writeSnapshot({
    jobs: sortReconstructionJobs(snapshot.jobs),
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

  const timestamp = nowIso();
  const nextJob = buildPreparedRasterReconstructionJob(snapshot.jobs[jobIndex], payload, timestamp);

  snapshot.jobs[jobIndex] = nextJob;
  await writeSnapshot({
    jobs: sortReconstructionJobs(snapshot.jobs),
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

  const timestamp = nowIso();
  const nextJob = buildPreparedVectorReconstructionJob(snapshot.jobs[jobIndex], payload, timestamp);

  snapshot.jobs[jobIndex] = nextJob;
  await writeSnapshot({
    jobs: sortReconstructionJobs(snapshot.jobs),
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

  const timestamp = nowIso();
  const nextJob = buildPreparedHybridReconstructionJob(snapshot.jobs[jobIndex], payload, timestamp);

  snapshot.jobs[jobIndex] = nextJob;
  await writeSnapshot({
    jobs: sortReconstructionJobs(snapshot.jobs),
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
  const nextJob = buildFailedReconstructionJob(snapshot.jobs[jobIndex], stageId, message, timestamp);
  snapshot.jobs[jobIndex] = nextJob;
  await writeSnapshot({
    jobs: sortReconstructionJobs(snapshot.jobs),
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
  const nextJob = buildAppliedReconstructionJob(snapshot.jobs[jobIndex], payload, timestamp);

  snapshot.jobs[jobIndex] = nextJob;
  await writeSnapshot({
    jobs: sortReconstructionJobs(snapshot.jobs),
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
  const nextJob = buildClearedAppliedReconstructionJob(snapshot.jobs[jobIndex], payload, timestamp);

  snapshot.jobs[jobIndex] = nextJob;
  await writeSnapshot({
    jobs: sortReconstructionJobs(snapshot.jobs),
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
  const nextJob = buildRenderedReconstructionJob(snapshot.jobs[jobIndex], payload, timestamp);

  snapshot.jobs[jobIndex] = nextJob;
  await writeSnapshot({
    jobs: sortReconstructionJobs(snapshot.jobs),
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
  const nextJob = buildMeasuredReconstructionJob(snapshot.jobs[jobIndex], payload, timestamp);

  snapshot.jobs[jobIndex] = nextJob;
  await writeSnapshot({
    jobs: sortReconstructionJobs(snapshot.jobs),
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
  const nextJob = buildRefinedReconstructionJob(snapshot.jobs[jobIndex], payload, timestamp);

  snapshot.jobs[jobIndex] = nextJob;
  await writeSnapshot({
    jobs: sortReconstructionJobs(snapshot.jobs),
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
  const nextJob = buildLoopStatusReconstructionJob(snapshot.jobs[jobIndex], payload, timestamp);

  snapshot.jobs[jobIndex] = nextJob;
  await writeSnapshot({
    jobs: sortReconstructionJobs(snapshot.jobs),
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

  const current = normalizeReconstructionJob(snapshot.jobs[jobIndex]);
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
  await writeSnapshot({ jobs: sortReconstructionJobs(snapshot.jobs) });
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

  const current = normalizeReconstructionJob(snapshot.jobs[jobIndex]);
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
    warnings: payload.note ? mergeReconstructionWarnings(current.warnings, [payload.note]) : current.warnings,
  };

  snapshot.jobs[jobIndex] = nextJob;
  await writeSnapshot({ jobs: sortReconstructionJobs(snapshot.jobs) });
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

  const current = normalizeReconstructionJob(snapshot.jobs[jobIndex]);
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
    warnings: payload.note ? mergeReconstructionWarnings(current.warnings, [payload.note]) : current.warnings,
  };

  snapshot.jobs[jobIndex] = nextJob;
  await writeSnapshot({ jobs: sortReconstructionJobs(snapshot.jobs) });
  return nextJob;
}
