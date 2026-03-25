import type { IncomingMessage, ServerResponse } from "node:http";

import type {
  ApproveReconstructionPlanPayload,
  ReviewReconstructionAssetPayload,
  ReviewReconstructionFontPayload,
  SubmitReconstructionAnalysisPayload,
} from "../../shared/reconstruction.js";
import { buildNormalizedReconstructionAnalysis } from "../reconstruction-analysis.js";
import {
  approveReconstructionPlan,
  completeReconstructionAnalysis,
  failReconstructionJob,
  reviewReconstructionAssetChoice,
  reviewReconstructionFontChoice,
} from "../reconstruction-store.js";
import { readBody, sendJson } from "../http-utils.js";
import type { RequestContext } from "./request-context.js";
import {
  getReconstructionJobOrRespond,
  getReconstructionRoutePathSegments,
  isReconstructionJobChildRoute,
} from "./reconstruction-route-helpers.js";

export async function tryHandleReconstructionDesignReviewRoute(
  request: IncomingMessage,
  response: ServerResponse,
  context: RequestContext,
): Promise<boolean> {
  const pathSegments = getReconstructionRoutePathSegments(context);

  if (isReconstructionJobChildRoute(pathSegments, context, ["submit-analysis"], "POST")) {
    const jobId = pathSegments[3];
    const job = await getReconstructionJobOrRespond(response, jobId);
    if (!job) {
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

  if (isReconstructionJobChildRoute(pathSegments, context, ["review", "font"], "POST")) {
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

  if (isReconstructionJobChildRoute(pathSegments, context, ["review", "asset"], "POST")) {
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

  if (isReconstructionJobChildRoute(pathSegments, context, ["review", "approve-plan"], "POST")) {
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
