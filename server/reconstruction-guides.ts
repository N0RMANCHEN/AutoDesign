import type {
  ReconstructionGuideManifest,
  ReconstructionJob,
} from "../shared/reconstruction.js";
import { collectReconstructionElements } from "./reconstruction-elements.js";

function resolveReferencePreviewDataUrl(job: ReconstructionJob) {
  return (
    job.referenceRaster?.dataUrl ||
    job.referenceNode.previewDataUrl ||
    job.analysis?.previewDataUrl ||
    null
  );
}

export function resolveScoringReferencePreviewDataUrl(job: ReconstructionJob) {
  return job.analysis?.screenPlane?.rectifiedPreviewDataUrl || resolveReferencePreviewDataUrl(job);
}

export function buildReconstructionGuideManifest(job: ReconstructionJob): ReconstructionGuideManifest {
  if (!job.analysis) {
    throw new Error("Reconstruction job has no structured analysis yet.");
  }

  const { elements, constraints } = collectReconstructionElements(job.analysis);
  return {
    jobId: job.id,
    targetFrame: {
      id: job.targetNode.id,
      width: job.targetNode.width || job.analysis.canonicalFrame?.width || job.analysis.width || null,
      height: job.targetNode.height || job.analysis.canonicalFrame?.height || job.analysis.height || null,
    },
    images: {
      referencePreviewDataUrl: resolveReferencePreviewDataUrl(job),
      rectifiedPreviewDataUrl: job.analysis.screenPlane?.rectifiedPreviewDataUrl || null,
      renderedPreviewDataUrl: job.renderedPreview?.previewDataUrl || null,
    },
    elements,
    constraints,
  };
}
