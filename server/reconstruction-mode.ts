import type { ReconstructionJob } from "../shared/reconstruction.js";

export function isRasterExactJob(job: ReconstructionJob) {
  return job.input.strategy === "raster-exact";
}

export function isVectorReconstructionJob(job: ReconstructionJob) {
  return job.input.strategy === "vector-reconstruction";
}

export function isHybridReconstructionJob(job: ReconstructionJob) {
  return job.input.strategy === "hybrid-reconstruction";
}
