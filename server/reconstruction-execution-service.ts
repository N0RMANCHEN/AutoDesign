import type {
  PluginBridgeCommandRecord,
  PluginImageArtifact,
  PluginNodeInspection,
  PluginNodeSummary,
} from "../shared/plugin-bridge.js";
import type {
  ReconstructionJob,
  ReconstructionLoopStopReason,
  ReconstructionRasterAsset,
  ReconstructionStructureReport,
} from "../shared/reconstruction.js";
import type { FigmaCapabilityCommand } from "../shared/plugin-contract.js";
import {
  clearReconstructionAppliedState,
  completeReconstructionAnalysis,
  getReconstructionJob,
  markReconstructionApplied,
  markReconstructionLoopStatus,
  markReconstructionMeasured,
  markReconstructionRefined,
  markReconstructionRendered,
  prepareHybridReconstruction,
  prepareRasterReconstruction,
  prepareVectorReconstruction,
} from "./reconstruction-store.js";
import { runPreviewOnlyReconstructionAnalysis } from "./reconstruction-analysis.js";
import {
  buildRefineSuggestions,
  createRenderedPreview,
  measurePreviewDiff,
} from "./reconstruction-evaluation.js";

export type ReconstructionExecutionServiceDeps = {
  isRasterExactJob: (job: ReconstructionJob) => boolean;
  isVectorReconstructionJob: (job: ReconstructionJob) => boolean;
  isHybridReconstructionJob: (job: ReconstructionJob) => boolean;
  ensureRasterReference: (job: ReconstructionJob) => Promise<ReconstructionRasterAsset>;
  ensureVectorReference: (job: ReconstructionJob) => Promise<ReconstructionRasterAsset>;
  ensureHybridReference: (job: ReconstructionJob) => Promise<ReconstructionRasterAsset>;
  queueAndWaitForPluginBatch: (
    targetSessionId: string,
    commands: FigmaCapabilityCommand[],
  ) => Promise<PluginBridgeCommandRecord>;
  normalizeRebuildCommands: (
    job: Awaited<ReturnType<typeof getReconstructionJob>>,
  ) => Promise<FigmaCapabilityCommand[]>;
  assertSuccessfulCommandRecord: (
    command: PluginBridgeCommandRecord,
    contextLabel: string,
    options?: { allowMissingWarnings?: boolean },
  ) => string[];
  collectChangedNodeIds: (command: PluginBridgeCommandRecord) => string[];
  uniqueStrings: (values: string[]) => string[];
  inspectFrameSubtree: (
    targetSessionId: string,
    frameNodeId: string,
    options?: { maxDepth?: number },
  ) => Promise<PluginNodeInspection[]>;
  isReconstructionGeneratedInspectionNode: (node: PluginNodeInspection) => boolean;
  exportSingleNodeImage: (
    targetSessionId: string,
    nodeId: string,
    options?: {
      preferOriginalBytes?: boolean;
      constraint?: { type: "WIDTH" | "HEIGHT" | "SCALE"; value: number };
    },
  ) => Promise<PluginImageArtifact>;
  resolveReferencePreviewForMeasurement: (job: ReconstructionJob) => Promise<string | null>;
  buildStructureReport: (
    job: ReconstructionJob,
    targetNode: PluginNodeSummary,
  ) => ReconstructionStructureReport | null;
  requireLoopCompatibleSession: (sessionId: string) => Promise<unknown>;
  resolveLoopStopReason: (job: ReconstructionJob) => ReconstructionLoopStopReason | null;
  buildAutoRefineCommands: (
    job: ReconstructionJob,
  ) => { commands: FigmaCapabilityCommand[]; warnings: string[] };
};

async function clearReconstructionNodes(
  job: ReconstructionJob,
  deps: ReconstructionExecutionServiceDeps,
) {
  let generatedNodeIds: string[] = [];
  const fallbackWarnings: string[] = [];
  try {
    const inspectedNodes = await deps.inspectFrameSubtree(job.input.targetSessionId, job.targetNode.id, {
      maxDepth: 8,
    });
    generatedNodeIds = deps.uniqueStrings(
      inspectedNodes
        .filter((node) => node.id !== job.targetNode.id && deps.isReconstructionGeneratedInspectionNode(node))
        .sort((left, right) => right.depth - left.depth)
        .map((node) => node.id),
    );
  } catch (error) {
    fallbackWarnings.push(
      `未能检查目标 Frame 子树，已回退到仅删除当前 job 记录的已应用节点。原因: ${error instanceof Error ? error.message : "inspect failed"}`,
    );
  }
  const nodeIdsToDelete = deps.uniqueStrings([...generatedNodeIds, ...job.appliedNodeIds]).filter(
    (nodeId) => nodeId !== job.targetNode.id,
  );

  if (!nodeIdsToDelete.length) {
    return {
      warnings: fallbackWarnings,
      deletedNodeIds: [] as string[],
    };
  }

  const command = await deps.queueAndWaitForPluginBatch(job.input.targetSessionId, [
    {
      type: "capability",
      capabilityId: "nodes.delete",
      payload: {},
      nodeIds: nodeIdsToDelete,
      executionMode: "strict",
    },
  ]);

  const warnings = deps.assertSuccessfulCommandRecord(command, "Reconstruction clear", {
    allowMissingWarnings: true,
  });

  return {
    warnings: deps.uniqueStrings([...fallbackWarnings, ...warnings]),
    deletedNodeIds: deps.collectChangedNodeIds(command),
  };
}

async function renderReconstructionPreview(
  job: ReconstructionJob,
  deps: ReconstructionExecutionServiceDeps,
) {
  const artifact = await deps.exportSingleNodeImage(job.input.targetSessionId, job.targetNode.id, {
    preferOriginalBytes: false,
  });
  const targetNode: PluginNodeSummary = {
    ...job.targetNode,
    width: artifact.width,
    height: artifact.height,
    previewDataUrl: artifact.dataUrl,
  };

  return {
    targetNode,
    renderedPreview: createRenderedPreview(artifact.dataUrl, artifact.width, artifact.height),
  };
}

export async function runReconstructionIteration(
  jobId: string,
  deps: ReconstructionExecutionServiceDeps,
) {
  const job = await getReconstructionJob(jobId);
  if (!job) {
    throw new Error("Reconstruction job not found");
  }
  if (deps.isRasterExactJob(job)) {
    throw new Error("raster-exact job 不支持 iterate/refine loop。请直接使用 render + measure 验证结果。");
  }
  if (!job.analysis) {
    throw new Error("Reconstruction job has no analysis yet");
  }
  if (job.applyStatus !== "applied") {
    throw new Error("Reconstruction job must be applied before running diff iteration");
  }

  const rendered = await renderReconstructionPreview(job, deps);
  const renderedJob = await markReconstructionRendered(jobId, rendered);
  if (!renderedJob) {
    throw new Error("Reconstruction job not found");
  }

  const diffMetrics = await measurePreviewDiff(
    (await deps.resolveReferencePreviewForMeasurement(renderedJob)) ||
      renderedJob.analysis?.previewDataUrl ||
      job.analysis.previewDataUrl,
    rendered.renderedPreview.previewDataUrl,
  );

  const measuredJob = await markReconstructionMeasured(jobId, { diffMetrics });
  if (!measuredJob) {
    throw new Error("Reconstruction job not found");
  }

  const refineSuggestions = buildRefineSuggestions(measuredJob, diffMetrics);
  const refinedJob = await markReconstructionRefined(jobId, { refineSuggestions });
  if (!refinedJob) {
    throw new Error("Reconstruction job not found");
  }

  return refinedJob;
}

export async function runReconstructionLoop(
  jobId: string,
  deps: ReconstructionExecutionServiceDeps,
) {
  let job = await getReconstructionJob(jobId);
  if (!job) {
    throw new Error("Reconstruction job not found");
  }
  if (deps.isRasterExactJob(job)) {
    throw new Error("raster-exact job 不支持自动 refine loop。");
  }
  if (!job.analysis) {
    throw new Error("Reconstruction job has no analysis yet");
  }
  if (job.applyStatus !== "applied") {
    throw new Error("Reconstruction job must be applied before running auto refine loop");
  }
  await deps.requireLoopCompatibleSession(job.input.targetSessionId);

  const running = await markReconstructionLoopStatus(jobId, {
    loopStatus: "running",
    stopReason: null,
  });
  if (!running) {
    throw new Error("Reconstruction job not found");
  }
  job = running;

  const safetyLimit = Math.max(1, job.input.maxIterations + 1);
  for (let cycle = 0; cycle < safetyLimit; cycle += 1) {
    if (!job.diffMetrics || !job.refineSuggestions.length) {
      job = await runReconstructionIteration(jobId, deps);
    }

    const stopReason = deps.resolveLoopStopReason(job);
    if (stopReason || job.status === "completed") {
      const stopped = await markReconstructionLoopStatus(jobId, {
        loopStatus: "stopped",
        stopReason: stopReason || job.stopReason || "no_actionable_suggestions",
      });
      return stopped || job;
    }

    const refinement = deps.buildAutoRefineCommands(job);
    if (!refinement.commands.length) {
      const stopped = await markReconstructionLoopStatus(jobId, {
        loopStatus: "stopped",
        stopReason: "no_actionable_suggestions",
        warnings: refinement.warnings.length
          ? refinement.warnings
          : ["当前没有可执行的自动 refine 命令。"],
      });
      return stopped || job;
    }

    const command = await deps.queueAndWaitForPluginBatch(job.input.targetSessionId, refinement.commands);
    const commandWarnings = deps.assertSuccessfulCommandRecord(command, "Reconstruction loop refine");
    job = (await runReconstructionIteration(jobId, deps)) || job;

    if (commandWarnings.length || refinement.warnings.length) {
      const refreshed = await markReconstructionLoopStatus(jobId, {
        loopStatus: job.status === "completed" ? "stopped" : "running",
        stopReason: job.status === "completed" ? job.stopReason : null,
        warnings: [...commandWarnings, ...refinement.warnings],
      });
      if (refreshed) {
        job = refreshed;
      }
    }
  }

  const stopped = await markReconstructionLoopStatus(jobId, {
    loopStatus: "stopped",
    stopReason: "max_iterations",
    warnings: ["自动 refine 触发了 server safety limit，已强制停止。"],
  });
  return stopped || job;
}

export async function analyzeReconstructionJob(
  jobId: string,
  job: ReconstructionJob,
  deps: ReconstructionExecutionServiceDeps,
) {
  if (deps.isRasterExactJob(job)) {
    const referenceRaster = await deps.ensureRasterReference(job);
    const updated = await prepareRasterReconstruction(jobId, { referenceRaster });
    if (!updated) {
      throw new Error("Reconstruction job not found");
    }
    return updated;
  }
  if (deps.isVectorReconstructionJob(job)) {
    const referenceRaster = await deps.ensureVectorReference(job);
    const updated = await prepareVectorReconstruction(jobId, { referenceRaster });
    if (!updated) {
      throw new Error("Reconstruction job not found");
    }
    return updated;
  }
  if (deps.isHybridReconstructionJob(job)) {
    const referenceRaster = await deps.ensureHybridReference(job);
    const updated = await prepareHybridReconstruction(jobId, { referenceRaster });
    if (!updated) {
      throw new Error("Reconstruction job not found");
    }
    return updated;
  }

  const result = await runPreviewOnlyReconstructionAnalysis(job);
  const updated = await completeReconstructionAnalysis(jobId, result);
  if (!updated) {
    throw new Error("Reconstruction job not found");
  }
  return updated;
}

export async function applyReconstructionJob(
  jobId: string,
  job: ReconstructionJob,
  deps: ReconstructionExecutionServiceDeps,
) {
  if (!deps.isRasterExactJob(job) && !job.rebuildPlan) {
    throw new Error("Reconstruction job has no rebuild plan yet");
  }
  if (!deps.isRasterExactJob(job) && job.approvalState !== "approved") {
    throw new Error(`Reconstruction job must be approved before apply. current approvalState=${job.approvalState}`);
  }

  let accumulatedWarnings: string[] = [];
  let latestJob = job;

  if (deps.isRasterExactJob(job) && !job.referenceRaster) {
    const referenceRaster = await deps.ensureRasterReference(job);
    const prepared = await prepareRasterReconstruction(job.id, { referenceRaster });
    if (prepared) {
      latestJob = prepared;
    }
  }
  if (deps.isVectorReconstructionJob(job) && !job.referenceRaster) {
    const referenceRaster = await deps.ensureVectorReference(job);
    const prepared = await prepareVectorReconstruction(job.id, { referenceRaster });
    if (prepared) {
      latestJob = prepared;
    }
  }
  if (deps.isHybridReconstructionJob(job) && !job.referenceRaster) {
    const referenceRaster = await deps.ensureHybridReference(job);
    const prepared = await prepareHybridReconstruction(job.id, { referenceRaster });
    if (prepared) {
      latestJob = prepared;
    }
  }

  const cleared = await clearReconstructionNodes(latestJob, deps);
  accumulatedWarnings = deps.uniqueStrings([...accumulatedWarnings, ...cleared.warnings]);
  const reset = await clearReconstructionAppliedState(job.id, {
    warnings: cleared.warnings,
    message: "等待重新写入 Figma。",
  });
  if (!reset) {
    throw new Error("Reconstruction job not found");
  }

  latestJob = (await getReconstructionJob(jobId)) || latestJob;
  if (!latestJob) {
    throw new Error("Reconstruction job not found");
  }

  if (deps.isHybridReconstructionJob(latestJob) && latestJob.analysis?.completionZones.length) {
    const approvedCompletionSlices = latestJob.analysis.assetCandidates.filter((asset) =>
      latestJob.approvedAssetChoices.some(
        (choice) =>
          choice.assetId === asset.id &&
          choice.decision === "approved" &&
          (asset.kind === "texture" || asset.kind === "background-slice"),
      ),
    );
    if (!approvedCompletionSlices.length) {
      accumulatedWarnings = deps.uniqueStrings([
        ...accumulatedWarnings,
        "当前 hybrid analysis 含 completionZones，但没有已批准的 texture/background-slice 候选；补边区域不会被 deterministic patch 填充。",
      ]);
    }
  }

  const command = deps.isRasterExactJob(latestJob)
    ? await deps.queueAndWaitForPluginBatch(latestJob.input.targetSessionId, [
        {
          type: "capability",
          capabilityId: "reconstruction.apply-raster-reference",
          nodeIds: [latestJob.targetNode.id],
          payload: {
            referenceNodeId: latestJob.referenceNode.id,
            resultName: `AD Rebuild/${latestJob.id}/Raster`,
            replaceTargetContents: true,
            resizeTargetToReference: true,
          },
          executionMode: "strict",
        },
      ])
    : await deps.queueAndWaitForPluginBatch(
        latestJob.input.targetSessionId,
        await deps.normalizeRebuildCommands(latestJob),
      );

  accumulatedWarnings = deps.uniqueStrings([
    ...accumulatedWarnings,
    ...deps.assertSuccessfulCommandRecord(command, "Reconstruction apply"),
  ]);

  const appliedNodeIds = deps.collectChangedNodeIds(command);
  if (!appliedNodeIds.length) {
    throw new Error("Reconstruction apply completed without changedNodeIds.");
  }

  const updated = await markReconstructionApplied(jobId, {
    appliedNodeIds,
    warnings: accumulatedWarnings,
  });
  if (!updated) {
    throw new Error("Reconstruction job not found");
  }
  return updated;
}

export async function clearReconstructionJob(
  jobId: string,
  job: ReconstructionJob,
  deps: ReconstructionExecutionServiceDeps,
) {
  const cleared = await clearReconstructionNodes(job, deps);
  const warnings = deps.uniqueStrings(cleared.warnings);
  const updated = await clearReconstructionAppliedState(jobId, {
    warnings,
    message: "等待写入 Figma。",
  });
  if (!updated) {
    throw new Error("Reconstruction job not found");
  }
  return updated;
}

export async function renderReconstructionJob(
  jobId: string,
  job: ReconstructionJob,
  deps: ReconstructionExecutionServiceDeps,
) {
  const rendered = await renderReconstructionPreview(job, deps);
  const updated = await markReconstructionRendered(jobId, {
    ...rendered,
    structureReport: deps.buildStructureReport(job, rendered.targetNode),
  });
  if (!updated) {
    throw new Error("Reconstruction job not found");
  }
  return updated;
}

export async function measureReconstructionJob(
  jobId: string,
  job: ReconstructionJob,
  deps: ReconstructionExecutionServiceDeps,
) {
  if (!job.renderedPreview?.previewDataUrl) {
    throw new Error("Reconstruction job has no rendered preview yet.");
  }

  const referencePreviewDataUrl = await deps.resolveReferencePreviewForMeasurement(job);
  if (!referencePreviewDataUrl) {
    throw new Error("Reconstruction job has no reference preview available for diff measurement.");
  }
  const diffMetrics = await measurePreviewDiff(referencePreviewDataUrl, job.renderedPreview.previewDataUrl);
  const updated = await markReconstructionMeasured(jobId, { diffMetrics });
  if (!updated) {
    throw new Error("Reconstruction job not found");
  }
  return updated;
}

export async function refineReconstructionJob(
  jobId: string,
  job: ReconstructionJob,
  deps: ReconstructionExecutionServiceDeps,
) {
  if (deps.isRasterExactJob(job)) {
    throw new Error("raster-exact job 不支持 refine。请直接使用 render + measure 进行验收。");
  }
  if (deps.isVectorReconstructionJob(job)) {
    throw new Error("vector-reconstruction 目前不支持自动 refine。请重新提交 analysis 后再 apply/render/measure。");
  }
  if (deps.isHybridReconstructionJob(job)) {
    throw new Error("hybrid-reconstruction 当前先支持 apply/render/measure，暂不支持自动 refine。");
  }
  if (!job.diffMetrics) {
    throw new Error("Reconstruction job has no diff metrics yet.");
  }

  const refineSuggestions = buildRefineSuggestions(job, job.diffMetrics);
  const updated = await markReconstructionRefined(jobId, { refineSuggestions });
  if (!updated) {
    throw new Error("Reconstruction job not found");
  }
  return updated;
}

export async function iterateReconstructionJob(
  jobId: string,
  job: ReconstructionJob,
  deps: ReconstructionExecutionServiceDeps,
) {
  if (deps.isRasterExactJob(job)) {
    throw new Error("raster-exact job 不支持 iterate。请直接使用 render + measure。");
  }
  if (deps.isVectorReconstructionJob(job)) {
    throw new Error("vector-reconstruction 目前不支持 iterate。请修改 analysis/rebuild plan 后重新 apply。");
  }
  if (deps.isHybridReconstructionJob(job)) {
    throw new Error("hybrid-reconstruction 当前暂不支持 iterate。请重新提交 analysis 后再 apply/render/measure。");
  }
  return runReconstructionIteration(jobId, deps);
}

export async function loopReconstructionJob(
  jobId: string,
  job: ReconstructionJob,
  deps: ReconstructionExecutionServiceDeps,
) {
  if (deps.isRasterExactJob(job)) {
    throw new Error("raster-exact job 不支持自动 refine loop。");
  }
  if (deps.isVectorReconstructionJob(job)) {
    throw new Error("vector-reconstruction 目前不支持自动 refine loop。");
  }
  if (deps.isHybridReconstructionJob(job)) {
    throw new Error("hybrid-reconstruction 当前暂不支持自动 refine loop。");
  }
  return runReconstructionLoop(jobId, deps);
}
