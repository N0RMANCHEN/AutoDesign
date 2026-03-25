import type { ServerResponse } from "node:http";

import type { ReconstructionJob } from "../../shared/reconstruction.js";
import { sendJson } from "../http-utils.js";
import { getReconstructionJob } from "../reconstruction-store.js";
import type { RequestContext } from "./request-context.js";

export function getReconstructionRoutePathSegments(context: RequestContext) {
  return context.pathname.split("/").filter(Boolean);
}

export function isReconstructionJobsCollectionRoute(
  context: RequestContext,
  method: "GET" | "POST",
) {
  return context.pathname === "/api/reconstruction/jobs" && context.method === method;
}

export function isReconstructionJobRoute(
  pathSegments: string[],
  context: RequestContext,
  method: "GET" | "POST",
) {
  return (
    pathSegments.length === 4 &&
    pathSegments[0] === "api" &&
    pathSegments[1] === "reconstruction" &&
    pathSegments[2] === "jobs" &&
    context.method === method
  );
}

export function isReconstructionJobChildRoute(
  pathSegments: string[],
  context: RequestContext,
  childSegments: string[],
  method: "GET" | "POST",
) {
  return (
    pathSegments.length === 4 + childSegments.length &&
    pathSegments[0] === "api" &&
    pathSegments[1] === "reconstruction" &&
    pathSegments[2] === "jobs" &&
    childSegments.every((segment, index) => pathSegments[4 + index] === segment) &&
    context.method === method
  );
}

export function sendReconstructionJobNotFound(response: ServerResponse) {
  sendJson(response, 404, { ok: false, error: "Reconstruction job not found" });
}

export async function getReconstructionJobOrRespond(
  response: ServerResponse,
  jobId: string,
): Promise<ReconstructionJob | null> {
  const job = await getReconstructionJob(jobId);
  if (!job) {
    sendReconstructionJobNotFound(response);
    return null;
  }
  return job;
}
