import type { ServerResponse } from "node:http";

import type { ReconstructionJob } from "../../shared/reconstruction.js";
import { failReconstructionJob } from "../reconstruction-store.js";
import {
  analyzeReconstructionJob,
  applyReconstructionJob,
  clearReconstructionJob,
  iterateReconstructionJob,
  loopReconstructionJob,
  measureReconstructionJob,
  type ReconstructionExecutionServiceDeps,
  refineReconstructionJob,
  renderReconstructionJob,
} from "../reconstruction-execution-service.js";
import { sendJson } from "../http-utils.js";
import type { RequestContext } from "./request-context.js";
import {
  getReconstructionJobOrRespond,
  getReconstructionRoutePathSegments,
  isReconstructionJobChildRoute,
  sendReconstructionJobNotFound,
} from "./reconstruction-route-helpers.js";

async function sendFailedReconstructionJob(
  response: ServerResponse,
  jobId: string,
  stageId: ReconstructionJob["currentStageId"],
  detail: string,
  statusCode = 500,
) {
  const failed = await failReconstructionJob(jobId, stageId, detail);
  if (!failed) {
    sendReconstructionJobNotFound(response);
    return;
  }
  sendJson(response, statusCode, {
    ok: false,
    error: detail,
    job: failed,
  });
}

async function handleReconstructionJobAction(
  response: ServerResponse,
  jobId: string,
  deps: ReconstructionExecutionServiceDeps,
  action: (jobId: string, job: ReconstructionJob, deps: ReconstructionExecutionServiceDeps) => Promise<ReconstructionJob>,
  options: {
    failureStage: ReconstructionJob["currentStageId"] | ((job: ReconstructionJob) => ReconstructionJob["currentStageId"]);
    normalizeErrorDetail?: (detail: string) => string;
  },
) {
  const job = await getReconstructionJobOrRespond(response, jobId);
  if (!job) {
    return;
  }

  try {
    const updated = await action(jobId, job, deps);
    sendJson(response, 200, updated);
  } catch (error) {
    let detail = error instanceof Error ? error.message : "Reconstruction execution failed";
    if (options.normalizeErrorDetail) {
      detail = options.normalizeErrorDetail(detail);
    }
    const failureStage =
      typeof options.failureStage === "function" ? options.failureStage(job) : options.failureStage;
    await sendFailedReconstructionJob(response, jobId, failureStage, detail);
  }
}

async function handleReconstructionJobApply(
  response: ServerResponse,
  jobId: string,
  deps: ReconstructionExecutionServiceDeps,
) {
  const job = await getReconstructionJobOrRespond(response, jobId);
  if (!job) {
    return;
  }

  if (!deps.isRasterExactJob(job) && !job.rebuildPlan) {
    sendJson(response, 409, { ok: false, error: "Reconstruction job has no rebuild plan yet" });
    return;
  }
  if (!deps.isRasterExactJob(job) && job.approvalState !== "approved") {
    sendJson(response, 409, {
      ok: false,
      error: `Reconstruction job must be approved before apply. current approvalState=${job.approvalState}`,
      job,
    });
    return;
  }

  try {
    const updated = await applyReconstructionJob(jobId, job, deps);
    sendJson(response, 200, updated);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Reconstruction apply failed";
    await sendFailedReconstructionJob(response, jobId, "apply-rebuild", detail);
  }
}

export async function tryHandleReconstructionExecutionRoute(
  response: ServerResponse,
  context: RequestContext,
  deps: ReconstructionExecutionServiceDeps,
): Promise<boolean> {
  const pathSegments = getReconstructionRoutePathSegments(context);
  const jobId = pathSegments[3];

  if (isReconstructionJobChildRoute(pathSegments, context, ["analyze"], "POST")) {
    await handleReconstructionJobAction(response, jobId, deps, analyzeReconstructionJob, {
      failureStage: (job) => job.currentStageId,
    });
    return true;
  }

  if (isReconstructionJobChildRoute(pathSegments, context, ["apply"], "POST")) {
    await handleReconstructionJobApply(response, jobId, deps);
    return true;
  }

  if (isReconstructionJobChildRoute(pathSegments, context, ["clear"], "POST")) {
    await handleReconstructionJobAction(response, jobId, deps, clearReconstructionJob, {
      failureStage: "apply-rebuild",
    });
    return true;
  }

  if (isReconstructionJobChildRoute(pathSegments, context, ["render"], "POST")) {
    await handleReconstructionJobAction(response, jobId, deps, renderReconstructionJob, {
      failureStage: "render-preview",
    });
    return true;
  }

  if (isReconstructionJobChildRoute(pathSegments, context, ["measure"], "POST")) {
    await handleReconstructionJobAction(response, jobId, deps, measureReconstructionJob, {
      failureStage: "measure-diff",
    });
    return true;
  }

  if (isReconstructionJobChildRoute(pathSegments, context, ["refine"], "POST")) {
    await handleReconstructionJobAction(response, jobId, deps, refineReconstructionJob, {
      failureStage: "refine",
    });
    return true;
  }

  if (isReconstructionJobChildRoute(pathSegments, context, ["iterate"], "POST")) {
    await handleReconstructionJobAction(response, jobId, deps, iterateReconstructionJob, {
      failureStage: (job) => (job.currentStageId === "measure-diff" ? "measure-diff" : "render-preview"),
    });
    return true;
  }

  if (isReconstructionJobChildRoute(pathSegments, context, ["loop"], "POST")) {
    await handleReconstructionJobAction(response, jobId, deps, loopReconstructionJob, {
      failureStage: "refine",
      normalizeErrorDetail: (detail) =>
        detail.includes("指定的 nodeIds 在当前 selection 中未找到匹配节点")
          ? `${detail} 当前运行中的 AutoDesign 插件会话很可能还是旧构建，请重新运行插件后再试。`
          : detail,
    });
    return true;
  }

  return false;
}
