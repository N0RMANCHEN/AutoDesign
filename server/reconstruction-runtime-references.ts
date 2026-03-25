import type { ReconstructionJob, ReconstructionRasterAsset } from "../shared/reconstruction.js";
import { exportSingleNodeImage } from "./plugin-runtime-bridge.js";
import {
  isHybridReconstructionJob,
  isRasterExactJob,
  isVectorReconstructionJob,
} from "./reconstruction-mode.js";
import {
  prepareHybridReconstruction,
  prepareRasterReconstruction,
  prepareVectorReconstruction,
} from "./reconstruction-store.js";

type ReferencePreparation = (
  jobId: string,
  payload: { referenceRaster: ReconstructionRasterAsset },
) => Promise<ReconstructionJob | null>;

async function ensureReference(
  job: ReconstructionJob,
  prepareReference: ReferencePreparation,
): Promise<ReconstructionRasterAsset> {
  if (job.referenceRaster) {
    return job.referenceRaster;
  }

  const referenceRaster = await exportSingleNodeImage(job.input.targetSessionId, job.referenceNode.id, {
    preferOriginalBytes: true,
  });
  const updated = await prepareReference(job.id, { referenceRaster });
  return updated?.referenceRaster || referenceRaster;
}

export async function ensureRasterReference(job: ReconstructionJob) {
  return ensureReference(job, prepareRasterReconstruction);
}

export async function ensureVectorReference(job: ReconstructionJob) {
  return ensureReference(job, prepareVectorReconstruction);
}

export async function ensureHybridReference(job: ReconstructionJob) {
  return ensureReference(job, prepareHybridReconstruction);
}

export async function resolveReferencePreviewForMeasurement(job: ReconstructionJob) {
  const rectifiedPreviewDataUrl = job.analysis?.screenPlane?.rectifiedPreviewDataUrl || null;
  if (rectifiedPreviewDataUrl) {
    return rectifiedPreviewDataUrl;
  }

  let referencePreviewDataUrl = job.referenceRaster?.dataUrl || null;
  if (!referencePreviewDataUrl && isRasterExactJob(job)) {
    referencePreviewDataUrl = (await ensureRasterReference(job)).dataUrl;
  }
  if (!referencePreviewDataUrl && isVectorReconstructionJob(job)) {
    referencePreviewDataUrl = (await ensureVectorReference(job)).dataUrl;
  }
  if (!referencePreviewDataUrl && isHybridReconstructionJob(job)) {
    referencePreviewDataUrl = (await ensureHybridReference(job)).dataUrl;
  }
  if (!referencePreviewDataUrl) {
    referencePreviewDataUrl = job.analysis?.previewDataUrl || null;
  }

  return referencePreviewDataUrl;
}
