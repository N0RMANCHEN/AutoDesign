import type { IncomingMessage, ServerResponse } from "node:http";

import type { ReconstructionElementScoresPayload, ReconstructionElementScoresResponse, SubmitReconstructionAnalysisPayload } from "../../shared/reconstruction.js";
import type { DesignTaskSnapshot } from "../../shared/design-task.js";
import type {
  ApproveReconstructionPlanPayload,
  ReconstructionContextPack,
  ReviewReconstructionAssetPayload,
  ReviewReconstructionFontPayload,
} from "../../shared/reconstruction.js";
import { buildDesignTaskSnapshotFromReconstructionJob } from "../design-core/reconstruction-compat.js";
import { buildNormalizedReconstructionAnalysis, buildReconstructionContextPack } from "../reconstruction-analysis.js";
import { buildReconstructionElementScores } from "../reconstruction-elements.js";
import { buildReconstructionGuideManifest, resolveScoringReferencePreviewDataUrl } from "../reconstruction-guides.js";
import {
  approveReconstructionPlan,
  completeReconstructionAnalysis,
  failReconstructionJob,
  getReconstructionJob,
  listReconstructionJobs,
  reviewReconstructionAssetChoice,
  reviewReconstructionFontChoice,
} from "../reconstruction-store.js";
import { readBody, sendJson } from "../http-utils.js";

type RequestContext = {
  pathname: string;
  method: string;
};

export async function tryHandleReconstructionDesignRoute(
  request: IncomingMessage,
  response: ServerResponse,
  context: RequestContext,
): Promise<boolean> {
  const pathSegments = context.pathname.split("/").filter(Boolean);

  if (context.pathname === "/api/reconstruction/jobs" && context.method === "GET") {
    const snapshot = await listReconstructionJobs();
    sendJson(response, 200, snapshot);
    return true;
  }

  if (
    pathSegments.length === 4 &&
    pathSegments[0] === "api" &&
    pathSegments[1] === "reconstruction" &&
    pathSegments[2] === "jobs" &&
    context.method === "GET"
  ) {
    const job = await getReconstructionJob(pathSegments[3]);
    if (!job) {
      sendJson(response, 404, { ok: false, error: "Reconstruction job not found" });
      return true;
    }
    sendJson(response, 200, job);
    return true;
  }

  if (
    pathSegments.length === 5 &&
    pathSegments[0] === "api" &&
    pathSegments[1] === "reconstruction" &&
    pathSegments[2] === "jobs" &&
    pathSegments[4] === "context-pack" &&
    context.method === "POST"
  ) {
    const job = await getReconstructionJob(pathSegments[3]);
    if (!job) {
      sendJson(response, 404, { ok: false, error: "Reconstruction job not found" });
      return true;
    }

    try {
      const contextPack = buildReconstructionContextPack(job);
      sendJson(response, 200, contextPack satisfies ReconstructionContextPack);
    } catch (error) {
      sendJson(response, 400, {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to build reconstruction context pack",
      });
    }
    return true;
  }

  if (
    pathSegments.length === 5 &&
    pathSegments[0] === "api" &&
    pathSegments[1] === "reconstruction" &&
    pathSegments[2] === "jobs" &&
    pathSegments[4] === "submit-analysis" &&
    context.method === "POST"
  ) {
    const jobId = pathSegments[3];
    const job = await getReconstructionJob(jobId);
    if (!job) {
      sendJson(response, 404, { ok: false, error: "Reconstruction job not found" });
      return true;
    }

    const payload = await readBody<SubmitReconstructionAnalysisPayload>(request);
    if (payload.analysis === undefined) {
      sendJson(response, 400, { ok: false, error: "analysis is required" });
      return true;
    }

    try {
      const normalized = buildNormalizedReconstructionAnalysis(job, {
        analysisVersion: payload.analysisVersion,
        analysisProvider: payload.analysisProvider || "codex-assisted",
        analysis: payload.analysis,
        fontMatches: payload.fontMatches,
        reviewFlags: payload.reviewFlags,
        warnings: payload.warnings,
      });
      const updated = await completeReconstructionAnalysis(jobId, normalized);
      if (!updated) {
        sendJson(response, 404, { ok: false, error: "Reconstruction job not found" });
        return true;
      }
      sendJson(response, 200, updated);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Failed to submit reconstruction analysis";
      const failed = await failReconstructionJob(jobId, job.currentStageId, detail);
      if (!failed) {
        sendJson(response, 404, { ok: false, error: "Reconstruction job not found" });
        return true;
      }
      sendJson(response, 400, {
        ok: false,
        error: detail,
        job: failed,
      });
    }
    return true;
  }

  if (
    pathSegments.length === 5 &&
    pathSegments[0] === "api" &&
    pathSegments[1] === "reconstruction" &&
    pathSegments[2] === "jobs" &&
    pathSegments[4] === "guide-manifest" &&
    context.method === "GET"
  ) {
    const job = await getReconstructionJob(pathSegments[3]);
    if (!job) {
      sendJson(response, 404, { ok: false, error: "Reconstruction job not found" });
      return true;
    }

    try {
      const manifest = buildReconstructionGuideManifest(job);
      sendJson(response, 200, manifest);
    } catch (error) {
      sendJson(response, 409, {
        ok: false,
        error: error instanceof Error ? error.message : "Reconstruction guide manifest is unavailable",
      });
    }
    return true;
  }

  if (
    pathSegments.length === 5 &&
    pathSegments[0] === "api" &&
    pathSegments[1] === "reconstruction" &&
    pathSegments[2] === "jobs" &&
    pathSegments[4] === "element-scores" &&
    context.method === "POST"
  ) {
    const job = await getReconstructionJob(pathSegments[3]);
    if (!job) {
      sendJson(response, 404, { ok: false, error: "Reconstruction job not found" });
      return true;
    }
    if (!job.analysis) {
      sendJson(response, 409, { ok: false, error: "Reconstruction job has no structured analysis yet" });
      return true;
    }

    const payload = await readBody<ReconstructionElementScoresPayload>(request);
    if (!Array.isArray(payload.inspectedNodes)) {
      sendJson(response, 400, { ok: false, error: "inspectedNodes is required" });
      return true;
    }

    const referencePreviewDataUrl = resolveScoringReferencePreviewDataUrl(job);
    if (!referencePreviewDataUrl) {
      sendJson(response, 409, { ok: false, error: "Reconstruction job has no scorable reference preview" });
      return true;
    }

    try {
      const scores = await buildReconstructionElementScores({
        analysis: job.analysis,
        inspectedNodes: payload.inspectedNodes,
        referencePreviewDataUrl,
        renderedPreviewDataUrl: payload.renderedPreviewDataUrl ?? job.renderedPreview?.previewDataUrl ?? null,
        elementIds: Array.isArray(payload.elementIds)
          ? payload.elementIds.filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
          : undefined,
      });
      sendJson(response, 200, {
        jobId: job.id,
        referencePreviewKind: job.analysis.screenPlane?.rectifiedPreviewDataUrl ? "rectified" : "reference",
        liveNodeCount: payload.inspectedNodes.length,
        scores,
      } satisfies ReconstructionElementScoresResponse);
    } catch (error) {
      sendJson(response, 500, {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to compute reconstruction element scores",
      });
    }
    return true;
  }

  if (
    pathSegments.length === 4 &&
    pathSegments[0] === "api" &&
    pathSegments[1] === "design-tasks" &&
    pathSegments[2] === "reconstruction-jobs" &&
    context.method === "GET"
  ) {
    const job = await getReconstructionJob(pathSegments[3]);
    if (!job) {
      sendJson(response, 404, { ok: false, error: "Reconstruction job not found" });
      return true;
    }

    try {
      const snapshot = buildDesignTaskSnapshotFromReconstructionJob(job);
      sendJson(response, 200, snapshot satisfies DesignTaskSnapshot);
    } catch (error) {
      sendJson(response, 409, {
        ok: false,
        error: error instanceof Error ? error.message : "Design task snapshot is unavailable",
      });
    }
    return true;
  }

  if (
    pathSegments.length === 5 &&
    pathSegments[0] === "api" &&
    pathSegments[1] === "reconstruction" &&
    pathSegments[2] === "jobs" &&
    pathSegments[4] === "preview-plan" &&
    context.method === "POST"
  ) {
    const job = await getReconstructionJob(pathSegments[3]);
    if (!job) {
      sendJson(response, 404, { ok: false, error: "Reconstruction job not found" });
      return true;
    }
    if (!job.rebuildPlan) {
      sendJson(response, 409, { ok: false, error: "Reconstruction job has no rebuild plan yet" });
      return true;
    }
    sendJson(response, 200, job);
    return true;
  }

  if (
    pathSegments.length === 6 &&
    pathSegments[0] === "api" &&
    pathSegments[1] === "reconstruction" &&
    pathSegments[2] === "jobs" &&
    pathSegments[4] === "review" &&
    pathSegments[5] === "font" &&
    context.method === "POST"
  ) {
    const payload = await readBody<ReviewReconstructionFontPayload>(request);
    if (!payload.textCandidateId || !payload.fontFamily) {
      sendJson(response, 400, { ok: false, error: "textCandidateId and fontFamily are required" });
      return true;
    }

    try {
      const updated = await reviewReconstructionFontChoice(pathSegments[3], payload);
      if (!updated) {
        sendJson(response, 404, { ok: false, error: "Reconstruction job not found" });
        return true;
      }
      sendJson(response, 200, updated);
    } catch (error) {
      sendJson(response, 400, {
        ok: false,
        error: error instanceof Error ? error.message : "Reconstruction font review failed",
      });
    }
    return true;
  }

  if (
    pathSegments.length === 6 &&
    pathSegments[0] === "api" &&
    pathSegments[1] === "reconstruction" &&
    pathSegments[2] === "jobs" &&
    pathSegments[4] === "review" &&
    pathSegments[5] === "asset" &&
    context.method === "POST"
  ) {
    const payload = await readBody<ReviewReconstructionAssetPayload>(request);
    if (!payload.assetId || !payload.decision) {
      sendJson(response, 400, { ok: false, error: "assetId and decision are required" });
      return true;
    }

    try {
      const updated = await reviewReconstructionAssetChoice(pathSegments[3], payload);
      if (!updated) {
        sendJson(response, 404, { ok: false, error: "Reconstruction job not found" });
        return true;
      }
      sendJson(response, 200, updated);
    } catch (error) {
      sendJson(response, 400, {
        ok: false,
        error: error instanceof Error ? error.message : "Reconstruction asset review failed",
      });
    }
    return true;
  }

  if (
    pathSegments.length === 6 &&
    pathSegments[0] === "api" &&
    pathSegments[1] === "reconstruction" &&
    pathSegments[2] === "jobs" &&
    pathSegments[4] === "review" &&
    pathSegments[5] === "approve-plan" &&
    context.method === "POST"
  ) {
    const payload = await readBody<ApproveReconstructionPlanPayload>(request);
    if (typeof payload.approved !== "boolean") {
      sendJson(response, 400, { ok: false, error: "approved is required" });
      return true;
    }

    const updated = await approveReconstructionPlan(pathSegments[3], payload);
    if (!updated) {
      sendJson(response, 404, { ok: false, error: "Reconstruction job not found" });
      return true;
    }
    sendJson(response, 200, updated);
    return true;
  }

  return false;
}
