import type { IncomingMessage, ServerResponse } from "node:http";

import type { DesignTaskSnapshot } from "../../shared/design-task.js";
import type {
  CreateReconstructionJobPayload,
  ReconstructionContextPack,
  ReconstructionElementScoresPayload,
  ReconstructionElementScoresResponse,
} from "../../shared/reconstruction.js";
import { buildDesignTaskSnapshotFromReconstructionJob } from "../design-core/reconstruction-compat.js";
import { buildReconstructionContextPack } from "../reconstruction-analysis.js";
import { buildReconstructionElementScores } from "../reconstruction-elements.js";
import { buildReconstructionGuideManifest, resolveScoringReferencePreviewDataUrl } from "../reconstruction-guides.js";
import { getPluginBridgeSnapshot } from "../plugin-bridge-store.js";
import { findSessionById } from "../plugin-runtime-bridge.js";
import { createReconstructionJobFromSelection } from "../reconstruction-selection.js";
import { listReconstructionJobs } from "../reconstruction-store.js";
import { readBody, sendJson } from "../http-utils.js";
import type { RequestContext } from "./request-context.js";
import {
  getReconstructionJobOrRespond,
  getReconstructionRoutePathSegments,
  isReconstructionJobChildRoute,
  isReconstructionJobRoute,
  isReconstructionJobsCollectionRoute,
} from "./reconstruction-route-helpers.js";

export async function tryHandleReconstructionDesignQueryRoute(
  request: IncomingMessage,
  response: ServerResponse,
  context: RequestContext,
): Promise<boolean> {
  const pathSegments = getReconstructionRoutePathSegments(context);

  if (isReconstructionJobsCollectionRoute(context, "GET")) {
    const snapshot = await listReconstructionJobs();
    sendJson(response, 200, snapshot);
    return true;
  }

  if (isReconstructionJobsCollectionRoute(context, "POST")) {
    const payload = await readBody<CreateReconstructionJobPayload>(request);
    if (!payload.targetSessionId) {
      sendJson(response, 400, { ok: false, error: "targetSessionId is required" });
      return true;
    }

    const snapshot = await getPluginBridgeSnapshot();
    const session = findSessionById(snapshot.sessions, payload.targetSessionId);
    if (!session) {
      sendJson(response, 404, { ok: false, error: "Plugin session not found" });
      return true;
    }

    try {
      const job = await createReconstructionJobFromSelection(session, payload);
      sendJson(response, 200, job);
    } catch (error) {
      sendJson(response, 400, {
        ok: false,
        error: error instanceof Error ? error.message : "Invalid reconstruction input",
      });
    }
    return true;
  }

  if (isReconstructionJobRoute(pathSegments, context, "GET")) {
    const job = await getReconstructionJobOrRespond(response, pathSegments[3]);
    if (!job) {
      return true;
    }
    sendJson(response, 200, job);
    return true;
  }

  if (isReconstructionJobChildRoute(pathSegments, context, ["context-pack"], "POST")) {
    const job = await getReconstructionJobOrRespond(response, pathSegments[3]);
    if (!job) {
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

  if (isReconstructionJobChildRoute(pathSegments, context, ["guide-manifest"], "GET")) {
    const job = await getReconstructionJobOrRespond(response, pathSegments[3]);
    if (!job) {
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

  if (isReconstructionJobChildRoute(pathSegments, context, ["element-scores"], "POST")) {
    const job = await getReconstructionJobOrRespond(response, pathSegments[3]);
    if (!job) {
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
    const job = await getReconstructionJobOrRespond(response, pathSegments[3]);
    if (!job) {
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

  if (isReconstructionJobChildRoute(pathSegments, context, ["preview-plan"], "POST")) {
    const job = await getReconstructionJobOrRespond(response, pathSegments[3]);
    if (!job) {
      return true;
    }
    if (!job.rebuildPlan) {
      sendJson(response, 409, { ok: false, error: "Reconstruction job has no rebuild plan yet" });
      return true;
    }
    sendJson(response, 200, job);
    return true;
  }

  return false;
}
