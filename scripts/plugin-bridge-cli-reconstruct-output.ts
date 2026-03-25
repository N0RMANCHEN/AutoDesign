import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import type { InspectFrameResponsePayload } from "../shared/plugin-bridge.js";
import type {
  ReconstructionContextPack,
  ReconstructionElement,
  ReconstructionElementScore,
  ReconstructionGuideManifest,
  ReconstructionJob,
} from "../shared/reconstruction.js";
import { decodeDataUrl, sanitizeFileSegment } from "./plugin-bridge-cli-reconstruct-analysis-io.js";

const execFileAsync = promisify(execFile);

export function printReconstructionJob(job: ReconstructionJob) {
  console.log(`job: ${job.id}`);
  console.log(`session: ${job.input.targetSessionId}`);
  console.log(`strategy: ${job.input.strategy}`);
  console.log(`status: ${job.status}`);
  console.log(`applyStatus: ${job.applyStatus}`);
  console.log(`loopStatus: ${job.loopStatus}`);
  console.log(`stopReason: ${job.stopReason || "none"}`);
  console.log(`approvalState: ${job.approvalState}`);
  console.log(`analysisVersion: ${job.analysisVersion}`);
  console.log(`analysisProvider: ${job.analysisProvider}`);
  console.log(`goal: ${job.input.goal}`);
  console.log(`current stage: ${job.currentStageId}`);
  console.log(`target: ${job.targetNode.name} [${job.targetNode.type}] id=${job.targetNode.id}`);
  console.log(`reference: ${job.referenceNode.name} [${job.referenceNode.type}] id=${job.referenceNode.id}`);
  if (job.referenceRaster) {
    console.log(
      `referenceRaster: ${job.referenceRaster.width}x${job.referenceRaster.height} | ${job.referenceRaster.mimeType} | ${job.referenceRaster.source}`,
    );
  }
  console.log(`allowOutpainting: ${job.input.allowOutpainting}`);
  console.log(`maxIterations: ${job.input.maxIterations}`);
  console.log(`iterationCount: ${job.iterationCount}`);
  console.log(`bestCompositeScore: ${job.bestDiffScore === null ? "none" : job.bestDiffScore.toFixed(4)}`);
  console.log(`lastImprovement: ${job.lastImprovement === null ? "none" : job.lastImprovement.toFixed(4)}`);
  console.log(`stagnationCount: ${job.stagnationCount}`);
  console.log(`appliedNodeIds: ${job.appliedNodeIds.length}`);
  if (job.warnings.length) {
    console.log("warnings:");
    for (const warning of job.warnings) {
      console.log(`- ${warning}`);
    }
  }
  if (job.analysis) {
    console.log(
      `analysis: ${job.analysis.width}x${job.analysis.height} | colors=${job.analysis.dominantColors.join(", ") || "none"} | regions=${job.analysis.layoutRegions.length} | surfaces=${job.analysis.designSurfaces.length} | primitives=${job.analysis.vectorPrimitives.length} | semanticNodes=${job.analysis.semanticNodes?.length || 0} | elements=${job.analysis.elements?.length || 0} | constraints=${job.analysis.elementConstraints?.length || 0} | completionPlan=${job.analysis.completionPlan?.length || 0} | textCandidates=${job.analysis.textCandidates.length} | textBlocks=${job.analysis.textBlocks.length} | ocrBlocks=${job.analysis.ocrBlocks.length} | assetCandidates=${job.analysis.assetCandidates.length}`,
    );
    if (job.analysis.canonicalFrame) {
      console.log(
        `canonicalFrame: ${job.analysis.canonicalFrame.width}x${job.analysis.canonicalFrame.height} | fixed=${job.analysis.canonicalFrame.fixedTargetFrame ? "yes" : "no"} | deprojected=${job.analysis.canonicalFrame.deprojected ? "yes" : "no"}`,
      );
      if (job.analysis.canonicalFrame.sourceQuad?.length) {
        console.log(
          `sourceQuad: ${job.analysis.canonicalFrame.sourceQuad
            .map((point) => `(${point.x.toFixed(3)}, ${point.y.toFixed(3)})`)
            .join(" -> ")}`,
        );
      }
    }
    if (job.analysis.screenPlane) {
      console.log(
        `screenPlane: extracted=${job.analysis.screenPlane.extracted ? "yes" : "no"} excludesNonUiShell=${job.analysis.screenPlane.excludesNonUiShell ? "yes" : "no"} confidence=${job.analysis.screenPlane.confidence.toFixed(2)} rectified=${job.analysis.screenPlane.rectifiedPreviewDataUrl ? "yes" : "no"}`,
      );
    }
    if (job.analysis.completionZones.length) {
      console.log("completionZones:");
      for (const zone of job.analysis.completionZones) {
        console.log(`- ${zone.id}: reason=${zone.reason} bounds=(${zone.bounds.x}, ${zone.bounds.y}, ${zone.bounds.width}, ${zone.bounds.height})`);
      }
    }
    if (job.analysis.deprojectionNotes.length) {
      console.log("deprojectionNotes:");
      for (const note of job.analysis.deprojectionNotes) {
        console.log(`- ${note.id}: ${note.message}${note.targetId ? ` | target=${note.targetId}` : ""}`);
      }
    }
    if (job.analysis.textBlocks.length) {
      console.log("textBlocks:");
      for (const block of job.analysis.textBlocks) {
        console.log(`- ${block.id}: role=${block.role} inferred=${block.inferred ? "yes" : "no"} content=${block.content || "[missing]"}`);
      }
    }
    if (job.analysis.ocrBlocks.length) {
      console.log("ocrBlocks:");
      for (const block of job.analysis.ocrBlocks) {
        console.log(`- ${block.id}: text=${block.text || "[missing]"} confidence=${block.confidence.toFixed(2)} source=${block.source}`);
      }
    }
    if (job.analysis.textStyleHints.length) {
      console.log("textStyleHints:");
      for (const hint of job.analysis.textStyleHints) {
        console.log(`- ${hint.textCandidateId}: role=${hint.role} fontCategory=${hint.fontCategory} fontSizeEstimate=${hint.fontSizeEstimate ?? "none"} color=${hint.colorHex || "none"}`);
      }
    }
    if (job.analysis.assetCandidates.length) {
      console.log("assetCandidates:");
      for (const asset of job.analysis.assetCandidates) {
        console.log(`- ${asset.id}: kind=${asset.kind} mode=${asset.extractMode} outpaint=${asset.needsOutpainting ? "yes" : "no"} confidence=${asset.confidence.toFixed(2)}`);
      }
    }
  }
  if (job.fontMatches.length) {
    console.log("fontMatches:");
    for (const match of job.fontMatches) {
      console.log(`- ${match.textCandidateId}: ${match.recommended} (${match.candidates.join(", ")})`);
    }
  }
  if (job.rebuildPlan) {
    console.log("rebuildPlan:");
    for (const summary of job.rebuildPlan.summary) {
      console.log(`- ${summary}`);
    }
    console.log(`ops: ${job.rebuildPlan.ops.length}`);
  }
  if (job.reviewFlags.length) {
    console.log("reviewFlags:");
    for (const flag of job.reviewFlags) {
      console.log(`- [${flag.severity}] ${flag.kind}: ${flag.message}`);
    }
  }
  if (job.approvedFontChoices.length) {
    console.log("approvedFontChoices:");
    for (const item of job.approvedFontChoices) {
      console.log(`- ${item.textCandidateId}: ${item.fontFamily}`);
    }
  }
  if (job.approvedAssetChoices.length) {
    console.log("approvedAssetChoices:");
    for (const item of job.approvedAssetChoices) {
      console.log(`- ${item.assetId}: ${item.decision}${item.note ? ` | ${item.note}` : ""}`);
    }
  }
  if (job.renderedPreview) {
    console.log(`renderedPreview: ${job.renderedPreview.width}x${job.renderedPreview.height} | ${job.renderedPreview.mimeType}`);
  }
  if (job.diffMetrics) {
    console.log(
      `diffMetrics: composite=${job.diffMetrics.compositeScore.toFixed(4)} grade=${job.diffMetrics.grade} global=${job.diffMetrics.globalSimilarity.toFixed(4)} layout=${job.diffMetrics.layoutSimilarity.toFixed(4)} structure=${job.diffMetrics.structureSimilarity.toFixed(4)} edge=${job.diffMetrics.edgeSimilarity.toFixed(4)} colorDelta=${job.diffMetrics.colorDelta.toFixed(4)} hotspotAvg=${job.diffMetrics.hotspotAverage.toFixed(4)} hotspotPeak=${job.diffMetrics.hotspotPeak.toFixed(4)} hotspotCoverage=${job.diffMetrics.hotspotCoverage.toFixed(4)}`,
    );
    if (job.diffMetrics.acceptanceGates.length) {
      console.log("acceptanceGates:");
      for (const gate of job.diffMetrics.acceptanceGates) {
        console.log(`- [${gate.passed ? "pass" : "fail"}] ${gate.label}: ${gate.metric} ${gate.comparator} ${gate.threshold.toFixed(3)} (actual=${gate.actual.toFixed(3)}${gate.hard ? " | hard" : ""})`);
      }
    }
    if (job.diffMetrics.hotspots.length) {
      console.log("hotspots:");
      for (const hotspot of job.diffMetrics.hotspots) {
        console.log(`- ${hotspot.id}: score=${hotspot.score.toFixed(4)} bounds=(${hotspot.bounds.x}, ${hotspot.bounds.y}, ${hotspot.bounds.width}, ${hotspot.bounds.height})`);
      }
    }
  }
  if (job.structureReport) {
    console.log(
      `structureReport: passed=${job.structureReport.passed ? "yes" : "no"} | framePreserved=${job.structureReport.targetFramePreserved === null ? "unknown" : job.structureReport.targetFramePreserved ? "yes" : "no"} | imageFillNodes=${job.structureReport.imageFillNodeCount} | vectorNodes=${job.structureReport.vectorNodeCount} | textNodes=${job.structureReport.textNodeCount} | inferredText=${job.structureReport.inferredTextCount}`,
    );
    if (job.structureReport.issues.length) {
      console.log("structureIssues:");
      for (const issue of job.structureReport.issues) {
        console.log(`- ${issue}`);
      }
    }
  }
  if (job.refineSuggestions.length) {
    console.log("refineSuggestions:");
    for (const suggestion of job.refineSuggestions) {
      console.log(`- [${suggestion.kind}] ${suggestion.message}`);
    }
  }
  console.log("stages:");
  for (const stage of job.stages) {
    console.log(`- ${stage.stageId}: ${stage.status}${stage.message ? ` | ${stage.message}` : ""}`);
  }
}

export async function writeContextPackArtifacts(
  contextPack: ReconstructionContextPack,
  outputDirectory: string,
) {
  await mkdir(outputDirectory, { recursive: true });
  const baseName = sanitizeFileSegment(contextPack.jobId);
  const contextPath = path.join(outputDirectory, `${baseName}-context-pack.json`);
  await writeFile(contextPath, JSON.stringify(contextPack, null, 2), "utf8");

  const referencePreview = decodeDataUrl(contextPack.referencePreviewDataUrl);
  const referencePreviewPath = path.join(outputDirectory, `${baseName}-reference.${referencePreview.extension}`);
  await writeFile(referencePreviewPath, referencePreview.buffer);

  let referenceRectifiedPreviewPath: string | null = null;
  if (contextPack.referenceRectifiedPreviewDataUrl) {
    const rectifiedPreview = decodeDataUrl(contextPack.referenceRectifiedPreviewDataUrl);
    referenceRectifiedPreviewPath = path.join(outputDirectory, `${baseName}-reference-rectified.${rectifiedPreview.extension}`);
    await writeFile(referenceRectifiedPreviewPath, rectifiedPreview.buffer);
  }

  let targetPreviewPath: string | null = null;
  if (contextPack.targetPreviewDataUrl) {
    const targetPreview = decodeDataUrl(contextPack.targetPreviewDataUrl);
    targetPreviewPath = path.join(outputDirectory, `${baseName}-target.${targetPreview.extension}`);
    await writeFile(targetPreviewPath, targetPreview.buffer);
  }

  return {
    contextPath,
    referencePreviewPath,
    referenceRectifiedPreviewPath,
    targetPreviewPath,
  };
}

export async function inspectFramePayload(
  requestJson: <T>(pathname: string, init?: RequestInit) => Promise<T>,
  sessionId: string,
  frameNodeId: string,
  options?: { maxDepth?: number; includePreview?: boolean },
) {
  return requestJson<InspectFrameResponsePayload>("/api/plugin-bridge/inspect-frame", {
    method: "POST",
    body: JSON.stringify({
      targetSessionId: sessionId,
      frameNodeId,
      ...(Number.isFinite(options?.maxDepth) ? { maxDepth: Math.floor(options!.maxDepth!) } : {}),
      includePreview: options?.includePreview !== false,
    }),
  });
}

export async function cropDataUrlToFile(
  dataUrl: string,
  bounds: { x: number; y: number; width: number; height: number },
  outputPath: string,
) {
  const decoded = decodeDataUrl(dataUrl);
  const tempInputPath = path.join(
    os.tmpdir(),
    `autodesign-crop-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${decoded.extension}`,
  );
  try {
    await writeFile(tempInputPath, decoded.buffer);
    const scriptPath = path.join(process.cwd(), "scripts", "crop_reconstruction_preview.py");
    await execFileAsync("python3", [scriptPath, tempInputPath, outputPath, JSON.stringify(bounds)]);
  } finally {
    await rm(tempInputPath, { force: true });
  }
}

export function resolveElementQuery(elements: ReconstructionElement[], query: string) {
  const normalized = query.trim().toLowerCase();
  const sanitized = sanitizeFileSegment(normalized);
  return (
    elements.find((element) => element.id.toLowerCase() === normalized) ||
    elements.find((element) => (element.analysisRefId || "").toLowerCase() === normalized) ||
    elements.find((element) => element.name.trim().toLowerCase() === normalized) ||
    elements.find((element) => sanitizeFileSegment(element.name) === sanitized) ||
    null
  );
}

export function printElementScores(scores: ReconstructionElementScore[]) {
  if (!scores.length) {
    console.log("elementScores: empty");
    return;
  }

  console.log("elementScores:");
  for (const score of scores) {
    console.log(
      `- ${score.elementName} [${score.kind}] id=${score.elementId} grade=${score.grade} composite=${score.compositeScore.toFixed(4)} pixel=${score.pixelScore.toFixed(4)} geometry=${score.geometryScore.toFixed(4)} style=${score.styleScore.toFixed(4)} typography=${score.typographyScore.toFixed(4)} alignment=${score.alignmentScore.toFixed(4)} editability=${score.editabilityScore.toFixed(4)} node=${score.inspectedNodeId || "missing"} match=${score.matchStrategy}`,
    );
    if (score.hardFailures.length) {
      console.log(`  hardFailures=${score.hardFailures.join(", ")}`);
    }
    if (score.notes.length) {
      console.log(`  notes=${score.notes.join(" | ")}`);
    }
  }
}

export async function writeGuideArtifacts(
  manifest: ReconstructionGuideManifest,
  outputDirectory: string,
) {
  await mkdir(outputDirectory, { recursive: true });
  const baseName = sanitizeFileSegment(manifest.jobId);
  const manifestPath = path.join(outputDirectory, `${baseName}-guide-manifest.json`);

  let referencePreviewPath: string | null = null;
  if (manifest.images.referencePreviewDataUrl) {
    const artifact = decodeDataUrl(manifest.images.referencePreviewDataUrl);
    referencePreviewPath = path.join(outputDirectory, `${baseName}-guide-reference.${artifact.extension}`);
    await writeFile(referencePreviewPath, artifact.buffer);
  }

  let rectifiedPreviewPath: string | null = null;
  if (manifest.images.rectifiedPreviewDataUrl) {
    const artifact = decodeDataUrl(manifest.images.rectifiedPreviewDataUrl);
    rectifiedPreviewPath = path.join(outputDirectory, `${baseName}-guide-reference-rectified.${artifact.extension}`);
    await writeFile(rectifiedPreviewPath, artifact.buffer);
  }

  let renderedPreviewPath: string | null = null;
  if (manifest.images.renderedPreviewDataUrl) {
    const artifact = decodeDataUrl(manifest.images.renderedPreviewDataUrl);
    renderedPreviewPath = path.join(outputDirectory, `${baseName}-guide-rendered.${artifact.extension}`);
    await writeFile(renderedPreviewPath, artifact.buffer);
  }

  await writeFile(
    manifestPath,
    JSON.stringify(
      {
        jobId: manifest.jobId,
        targetFrame: manifest.targetFrame,
        images: {
          referencePreviewPath,
          rectifiedPreviewPath,
          renderedPreviewPath,
        },
        elements: manifest.elements,
        constraints: manifest.constraints,
      },
      null,
      2,
    ),
    "utf8",
  );

  return {
    manifestPath,
    referencePreviewPath,
    rectifiedPreviewPath,
    renderedPreviewPath,
    elementCount: manifest.elements.length,
    constraintCount: manifest.constraints.length,
  };
}
