import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { parseReconstructionStrategy } from "../shared/plugin-cli-guards.js";
import type { InspectFrameResponsePayload, PluginBridgeSession, PluginBridgeSnapshot } from "../shared/plugin-bridge.js";
import type {
  ApproveReconstructionPlanPayload,
  CreateReconstructionJobPayload,
  ReconstructionContextPack,
  ReconstructionElement,
  ReconstructionElementScore,
  ReconstructionElementScoresPayload,
  ReconstructionElementScoresResponse,
  ReconstructionGuideManifest,
  ReconstructionJob,
  ReconstructionJobSnapshot,
  ReviewReconstructionAssetPayload,
  ReviewReconstructionFontPayload,
  SubmitReconstructionAnalysisPayload,
} from "../shared/reconstruction.js";
import {
  estimateSourceQuadPixels as estimateSourceQuadPixelsWithAnalysis,
  parseSourceQuadPixels as parseSourceQuadPixelsWithAnalysis,
  writeHybridAnalysisDraft as writeHybridAnalysisDraftWithAnalysis,
  writeRemapPreview as writeRemapPreviewWithAnalysis,
  writeVectorAnalysisDraft as writeVectorAnalysisDraftWithAnalysis,
} from "./plugin-bridge-cli-reconstruct-analysis.js";

const execFileAsync = promisify(execFile);

type ReconstructCliDeps = {
  readFlag: (argv: string[], name: string) => string | null;
  readValueFlag: (argv: string[], name: string) => string | null;
  readJsonFile: <T>(filePath: string) => Promise<T>;
  requestJson: <T>(pathname: string, init?: RequestInit) => Promise<T>;
  pickSession: (sessions: PluginBridgeSession[], explicitSessionId: string | null) => PluginBridgeSession;
};

function fail(message: string): never {
  throw new Error(message);
}

function printReconstructionJob(job: ReconstructionJob) {
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

function sanitizeFileSegment(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "selection";
}

function decodeDataUrl(dataUrl: string) {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl);
  if (!match) {
    fail("无效的 data URL。");
  }

  const mimeType = match[1];
  const buffer = Buffer.from(match[2], "base64");
  const extension = mimeType === "image/jpeg" ? "jpg" : mimeType === "image/png" ? "png" : "img";
  return { mimeType, buffer, extension };
}

function parseSourceQuadPixels(sourceQuadRaw: string | null): ReconstructionPoint[] {
  if (!sourceQuadRaw) {
    return [];
  }

  const points = sourceQuadRaw
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [xRaw, yRaw] = entry.split(",").map((value) => value.trim());
      const x = Number.parseFloat(xRaw || "");
      const y = Number.parseFloat(yRaw || "");
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        fail(`无效的 --source-quad-px 点: ${entry}`);
      }
      return { x, y };
    });

  if (points.length !== 4) {
    fail("--source-quad-px 需要 4 个点，格式示例：--source-quad-px \"46,28;572,6;630,760;54,736\"");
  }

  return points;
}

function normalizeSourceQuad(points: ReconstructionPoint[], width: number, height: number) {
  if (!width || !height) {
    fail("参考图尺寸缺失，无法归一化 sourceQuad。");
  }

  return points.map((point) => ({
    x: Number((point.x / width).toFixed(6)),
    y: Number((point.y / height).toFixed(6)),
  }));
}

function resolveReconstructionReferenceDataUrl(job: ReconstructionJob) {
  return job.referenceRaster?.dataUrl || job.referenceNode.previewDataUrl || null;
}

async function writeRemapPreview(job: ReconstructionJob, sourceQuadPixels: ReconstructionPoint[], outputDirectory: string) {
  const referenceDataUrl = resolveReconstructionReferenceDataUrl(job);
  if (!referenceDataUrl) {
    fail("当前 job 缺少 referenceRaster / previewDataUrl，无法生成 remap preview。");
  }

  const reference = decodeDataUrl(referenceDataUrl);
  const baseName = sanitizeFileSegment(job.id);
  const inputPath = path.join(outputDirectory, `${baseName}-remap-source.${reference.extension}`);
  const outputPath = path.join(outputDirectory, `${baseName}-remap-preview.png`);
  await writeFile(inputPath, reference.buffer);

  const targetWidth = Math.max(1, Math.round(job.targetNode.width || job.analysis?.canonicalFrame?.width || 0));
  const targetHeight = Math.max(1, Math.round(job.targetNode.height || job.analysis?.canonicalFrame?.height || 0));
  if (!targetWidth || !targetHeight) {
    fail("目标 Frame 尺寸缺失，无法生成 remap preview。");
  }

  const scriptPath = path.join(process.cwd(), "scripts", "remap_reference_image.py");
  await execFileAsync("python3", [
    scriptPath,
    inputPath,
    outputPath,
    String(targetWidth),
    String(targetHeight),
    JSON.stringify(sourceQuadPixels),
  ]);

  return outputPath;
}

async function estimateSourceQuadPixels(job: ReconstructionJob, outputDirectory: string): Promise<EstimatedScreenQuad> {
  const referenceDataUrl = resolveReconstructionReferenceDataUrl(job);
  if (!referenceDataUrl) {
    fail("当前 job 缺少 referenceRaster / previewDataUrl，无法自动估计 sourceQuad。");
  }

  const reference = decodeDataUrl(referenceDataUrl);
  const baseName = sanitizeFileSegment(job.id);
  const inputPath = path.join(outputDirectory, `${baseName}-estimate-source.${reference.extension}`);
  const debugPrefix = path.join(outputDirectory, `${baseName}-estimate`);
  await writeFile(inputPath, reference.buffer);

  const targetWidth = Math.max(1, Math.round(job.targetNode.width || job.analysis?.canonicalFrame?.width || 0));
  const targetHeight = Math.max(1, Math.round(job.targetNode.height || job.analysis?.canonicalFrame?.height || 0));
  if (!targetWidth || !targetHeight) {
    fail("目标 Frame 尺寸缺失，无法自动估计 sourceQuad。");
  }

  const scriptPath = path.join(process.cwd(), "scripts", "estimate_screen_quad.py");
  const { stdout } = await execFileAsync("python3", [
    scriptPath,
    inputPath,
    String(targetWidth),
    String(targetHeight),
    debugPrefix,
  ]);
  return JSON.parse(stdout) as EstimatedScreenQuad;
}

async function runPreviewHeuristicAnalysis(imagePath: string): Promise<PreviewHeuristicAnalysis> {
  const scriptPath = path.join(process.cwd(), "scripts", "analyze_reference_preview.py");
  const { stdout } = await execFileAsync("python3", [scriptPath, imagePath]);
  return JSON.parse(stdout) as PreviewHeuristicAnalysis;
}

async function runVisionOcr(imagePath: string): Promise<VisionOcrLine[]> {
  const scriptPath = path.join(process.cwd(), "scripts", "ocr_preview_vision.swift");
  const { stdout } = await execFileAsync("/usr/bin/xcrun", ["swift", scriptPath, imagePath], {
    cwd: process.cwd(),
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout) as VisionOcrLine[];
}

function boundsOverlap(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
) {
  const x0 = Math.max(left.x, right.x);
  const y0 = Math.max(left.y, right.y);
  const x1 = Math.min(left.x + left.width, right.x + right.width);
  const y1 = Math.min(left.y + left.height, right.y + right.height);
  if (x1 <= x0 || y1 <= y0) {
    return 0;
  }
  return (x1 - x0) * (y1 - y0);
}

function inferTextRole(
  bounds: { height: number },
  targetHeight: number,
  fallback?: "headline" | "body" | "metric" | "label" | "unknown",
) {
  const pixelHeight = bounds.height * targetHeight;
  if (pixelHeight >= 48) {
    return "metric" as const;
  }
  if (pixelHeight >= 28) {
    return "headline" as const;
  }
  if (pixelHeight >= 18) {
    return "body" as const;
  }
  if (fallback && fallback !== "unknown") {
    return fallback;
  }
  return "label" as const;
}

function inferTextRoleFromContent(
  content: string,
  bounds: { height: number },
  targetHeight: number,
  fallback?: "headline" | "body" | "metric" | "label" | "unknown",
) {
  const normalized = content.trim();
  const lettersOnly = normalized.replace(/[^A-Za-z]/g, "");
  const uppercaseRatio = lettersOnly.length > 0 ? lettersOnly.replace(/[A-Z]/g, "").length / lettersOnly.length : 1;
  if (/%/.test(normalized) || /^\d+(?:\.\d+)?%$/.test(normalized)) {
    return "metric" as const;
  }
  if (normalized.split(/\s+/).length >= 3 && bounds.height * targetHeight >= 26) {
    return "headline" as const;
  }
  if (lettersOnly.length > 0 && uppercaseRatio <= 0.25 && normalized.length <= 18) {
    return "label" as const;
  }
  return inferTextRole(bounds, targetHeight, fallback);
}

function makeAnalysisBlockId(prefix: string, index: number, matchedCandidateId?: string | null) {
  if (matchedCandidateId) {
    return `${matchedCandidateId}-ocr-${index + 1}`;
  }
  return `${prefix}-${index + 1}`;
}

function fontFamilyForRole(role: "headline" | "body" | "metric" | "label" | "unknown") {
  return role === "metric" || role === "headline" ? "SF Pro Display" : "SF Pro Text";
}

function fontWeightForRole(role: "headline" | "body" | "metric" | "label" | "unknown") {
  if (role === "metric") {
    return 700;
  }
  if (role === "headline") {
    return 500;
  }
  return 500;
}

function hexToRgb(hex: string | null | undefined) {
  if (!hex) {
    return null;
  }
  const normalized = hex.replace("#", "").trim();
  if (normalized.length !== 6) {
    return null;
  }
  const value = Number.parseInt(normalized, 16);
  if (!Number.isFinite(value)) {
    return null;
  }
  return {
    r: (value >> 16) & 0xff,
    g: (value >> 8) & 0xff,
    b: value & 0xff,
  };
}

function relativeLuminance(hex: string | null | undefined) {
  const rgb = hexToRgb(hex);
  if (!rgb) {
    return null;
  }
  const channel = (value: number) => {
    const normalized = value / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

function contrastRatio(foregroundHex: string, backgroundHex: string) {
  const foreground = relativeLuminance(foregroundHex);
  const background = relativeLuminance(backgroundHex);
  if (foreground === null || background === null) {
    return 0;
  }
  const lighter = Math.max(foreground, background);
  const darker = Math.min(foreground, background);
  return (lighter + 0.05) / (darker + 0.05);
}

function hexToHsv(hex: string | null | undefined) {
  const rgb = hexToRgb(hex);
  if (!rgb) {
    return null;
  }
  const normalizedRed = rgb.r / 255;
  const normalizedGreen = rgb.g / 255;
  const normalizedBlue = rgb.b / 255;
  const maxChannel = Math.max(normalizedRed, normalizedGreen, normalizedBlue);
  const minChannel = Math.min(normalizedRed, normalizedGreen, normalizedBlue);
  const delta = maxChannel - minChannel;
  const saturation = maxChannel === 0 ? 0 : delta / maxChannel;
  return {
    saturation,
    value: maxChannel,
  };
}

function estimateFontSizeFromBounds(
  content: string,
  role: "headline" | "body" | "metric" | "label" | "unknown",
  bounds: { width: number; height: number },
  targetWidth: number,
  targetHeight: number,
  hintedFontSize: number | null,
) {
  const heightPx = Math.max(8, bounds.height * targetHeight);
  const widthPx = Math.max(8, bounds.width * targetWidth);
  const glyphCount = Math.max(1, content.replace(/\s+/g, "").length);
  const widthFactor = role === "metric" ? 0.72 : role === "headline" ? 0.56 : role === "body" ? 0.62 : 0.64;
  const heightFactor = role === "metric" ? 0.58 : role === "headline" ? 0.44 : role === "body" ? 0.38 : 0.34;
  const widthBased = widthPx / (glyphCount * widthFactor);
  const heightBased = heightPx * heightFactor;
  const rawEstimate = Math.min(widthBased, heightBased);
  const hardMin = role === "metric" ? 22 : role === "headline" ? 18 : 12;
  const hardMax = role === "metric" ? 64 : role === "headline" ? 34 : role === "body" ? 22 : 18;
  const estimate = Math.max(hardMin, Math.min(hardMax, Math.round(rawEstimate)));
  if (hintedFontSize !== null && Number.isFinite(hintedFontSize)) {
    const blended = Math.round((estimate * 0.8) + (hintedFontSize * 0.2));
    return Math.max(hardMin, Math.min(hardMax, blended));
  }
  return estimate;
}

function inferTextColor(
  bounds: { x: number; y: number; width: number; height: number },
  layoutRegions: NonNullable<PreviewHeuristicAnalysis["layoutRegions"]>,
  theme: "light" | "dark",
) {
  const matchedRegion = [...layoutRegions]
    .filter((region): region is NonNullable<typeof region> & { bounds: { x: number; y: number; width: number; height: number } } =>
      Boolean(region?.bounds),
    )
    .sort((left, right) => boundsOverlap(right.bounds, bounds) - boundsOverlap(left.bounds, bounds))[0];
  if (bounds.y <= 0.1) {
    return theme === "dark" ? "#F5F7FF" : "#111111";
  }
  if (matchedRegion?.fillHex) {
    const hsv = hexToHsv(matchedRegion.fillHex);
    if (
      hsv &&
      hsv.saturation >= 0.18 &&
      hsv.value >= 0.42 &&
      bounds.x + bounds.width <= matchedRegion.bounds.x + matchedRegion.bounds.width + 0.02
    ) {
      return "#111111";
    }
    const blackContrast = contrastRatio("#111111", matchedRegion.fillHex);
    const whiteContrast = contrastRatio("#F5F7FF", matchedRegion.fillHex);
    return blackContrast >= whiteContrast ? "#111111" : "#F5F7FF";
  }
  return theme === "dark" ? "#F5F7FF" : "#111111";
}

function clampNormalized(value: number) {
  return Math.max(0, Math.min(1, value));
}

function expandNormalizedBounds(
  bounds: { x: number; y: number; width: number; height: number },
  inset: { top: number; right: number; bottom: number; left: number },
) {
  const x0 = clampNormalized(bounds.x - inset.left);
  const y0 = clampNormalized(bounds.y - inset.top);
  const x1 = clampNormalized(bounds.x + bounds.width + inset.right);
  const y1 = clampNormalized(bounds.y + bounds.height + inset.bottom);
  return {
    x: x0,
    y: y0,
    width: Math.max(0.04, x1 - x0),
    height: Math.max(0.04, y1 - y0),
  };
}

function unionNormalizedBounds(items: Array<{ bounds: { x: number; y: number; width: number; height: number } }>) {
  if (!items.length) {
    return null;
  }
  const x0 = Math.min(...items.map((item) => item.bounds.x));
  const y0 = Math.min(...items.map((item) => item.bounds.y));
  const x1 = Math.max(...items.map((item) => item.bounds.x + item.bounds.width));
  const y1 = Math.max(...items.map((item) => item.bounds.y + item.bounds.height));
  return {
    x: clampNormalized(x0),
    y: clampNormalized(y0),
    width: Math.max(0.04, clampNormalized(x1) - clampNormalized(x0)),
    height: Math.max(0.04, clampNormalized(y1) - clampNormalized(y0)),
  };
}

function synthesizeVectorShapesFromText(
  textBlocks: Array<{ content: string; bounds: { x: number; y: number; width: number; height: number } }>,
  heuristic: PreviewHeuristicAnalysis,
) {
  const accentHex = heuristic.styleHints?.accentColorHex || heuristic.dominantColors?.[1] || "#7172D7";
  const darkHex = heuristic.styleHints?.primaryColorHex || heuristic.dominantColors?.[0] || "#0C0C0D";
  const designSurfaces: Array<{
    id: string;
    name: string;
    bounds: { x: number; y: number; width: number; height: number };
    fillHex: string;
    cornerRadius: number;
    opacity: number;
    shadow: "none" | "soft";
    inferred: boolean;
  }> = [];
  const vectorPrimitives: Array<{
    id: string;
    kind: "line";
    name: string;
    bounds: { x: number; y: number; width: number; height: number };
    points: Array<{ x: number; y: number }>;
    fillHex: null;
    strokeHex: string;
    strokeWeight: number;
    opacity: number;
    cornerRadius: null;
    svgMarkup: null;
    inferred: boolean;
  }> = [];

  const headerText = textBlocks.find((block) => /^Wednesday/i.test(block.content));
  const topCardTexts = textBlocks.filter((block) => {
    if (headerText && block.content === headerText.content) {
      return false;
    }
    return block.bounds.y < 0.42 && !/^Save$/i.test(block.content) && !/^Walk/i.test(block.content);
  });
  const topUnion = unionNormalizedBounds(topCardTexts);
  if (topUnion) {
    designSurfaces.push({
      id: "surface-top-card",
      name: "Top Card",
      bounds: expandNormalizedBounds(topUnion, { top: 0.06, right: 0.03, bottom: 0.05, left: 0.03 }),
      fillHex: accentHex,
      cornerRadius: 28,
      opacity: 1,
      shadow: "soft",
      inferred: true,
    });

    const todayScore = textBlocks.find((block) => /^TODAY SCORE$/i.test(block.content));
    if (todayScore) {
      const lineY = clampNormalized(todayScore.bounds.y - 0.025);
      vectorPrimitives.push({
        id: "primitive-top-divider",
        kind: "line",
        name: "Top Divider",
        bounds: {
          x: clampNormalized(topUnion.x + 0.06),
          y: lineY,
          width: Math.max(0.12, Math.min(0.46, topUnion.width * 0.45)),
          height: 0.003,
        },
        points: [],
        fillHex: null,
        strokeHex: "#111111",
        strokeWeight: 3,
        opacity: 1,
        cornerRadius: null,
        svgMarkup: null,
        inferred: true,
      });
    }
  }

  const heuristicBottom = (heuristic.layoutRegions || []).find((region) => {
    const bounds = region?.bounds;
    return Boolean(bounds && bounds.y > 0.45 && bounds.width > 0.6);
  });
  if (heuristicBottom?.bounds) {
    designSurfaces.push({
      id: "surface-bottom-card",
      name: "Bottom Card",
      bounds: {
        x: clampNormalized(Math.max(0.08, heuristicBottom.bounds.x)),
        y: clampNormalized(Math.max(0.48, heuristicBottom.bounds.y)),
        width: Math.min(0.78, heuristicBottom.bounds.width),
        height: Math.min(0.34, heuristicBottom.bounds.height),
      },
      fillHex: accentHex,
      cornerRadius: 28,
      opacity: 1,
      shadow: "soft",
      inferred: true,
    });
  }

  const saveText = textBlocks.find((block) => /^Save$/i.test(block.content));
  if (saveText) {
    designSurfaces.push({
      id: "surface-save-pill",
      name: "Save Pill",
      bounds: expandNormalizedBounds(saveText.bounds, { top: 0.04, right: 0.08, bottom: 0.05, left: 0.06 }),
      fillHex: darkHex,
      cornerRadius: 28,
      opacity: 1,
      shadow: "none",
      inferred: true,
    });
  }

  const walkText = textBlocks.find((block) => /^Walk/i.test(block.content));
  if (walkText) {
    designSurfaces.push({
      id: "surface-walk-pill",
      name: "Walk Pill",
      bounds: expandNormalizedBounds(walkText.bounds, { top: 0.04, right: 0.08, bottom: 0.06, left: 0.06 }),
      fillHex: darkHex,
      cornerRadius: 28,
      opacity: 1,
      shadow: "none",
      inferred: true,
    });
  }

  return { designSurfaces, vectorPrimitives };
}

async function encodeImageFileAsDataUrl(filePath: string) {
  const buffer = await readFile(filePath);
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

function uniqueNumbers(values: Array<number | null | undefined>) {
  return [...new Set(values.filter((value): value is number => Number.isFinite(value)).map((value) => Number(value)))];
}

function buildDesignTokensFromDraft(
  heuristic: PreviewHeuristicAnalysis,
  textBlocks: Array<{ role: "headline" | "body" | "metric" | "label" | "unknown"; fontFamily: string; fontSize: number }>,
) {
  const displayBlock = textBlocks.find((block) => block.role === "headline" || block.role === "metric") || null;
  const bodyBlock = textBlocks.find((block) => block.role === "body") || null;
  const labelBlock = textBlocks.find((block) => block.role === "label") || null;
  const accentHex = heuristic.styleHints?.accentColorHex || heuristic.dominantColors?.[1] || "#7172D7";
  const canvasHex = heuristic.styleHints?.primaryColorHex || heuristic.dominantColors?.[0] || "#0C0C0D";
  return {
    colors: {
      canvas: canvasHex,
      accent: accentHex,
      foreground: heuristic.styleHints?.theme === "dark" ? "#F5F7FF" : "#111111",
      mutedForeground: heuristic.styleHints?.theme === "dark" ? "#C9CCE3" : "#5C6178",
      pillBackground: canvasHex,
    },
    radiusScale: uniqueNumbers([12, 18, 28, heuristic.styleHints?.cornerRadiusHint || 28]),
    spacingScale: uniqueNumbers([4, 8, 12, 16, 24, 32]),
    typography: {
      displayFamily: displayBlock?.fontFamily || "SF Pro Display",
      textFamily: bodyBlock?.fontFamily || labelBlock?.fontFamily || "SF Pro Text",
      headlineSize: textBlocks.find((block) => block.role === "headline")?.fontSize || 24,
      bodySize: bodyBlock?.fontSize || 16,
      labelSize: labelBlock?.fontSize || 12,
      metricSize: textBlocks.find((block) => block.role === "metric")?.fontSize || 40,
    },
  };
}

function buildSemanticNodesFromDraft(
  targetWidth: number,
  targetHeight: number,
  designSurfaces: Array<{ id: string; name: string; bounds: { x: number; y: number; width: number; height: number }; fillHex: string; cornerRadius: number }>,
  textBlocks: Array<{ id: string; content: string; bounds: { x: number; y: number; width: number; height: number } }>,
  vectorPrimitives: Array<{ id: string; bounds: { x: number; y: number; width: number; height: number } | null }>,
) {
  void targetWidth;
  const nodes: Array<Record<string, unknown>> = [
    {
      id: "semantic-screen-root",
      name: "Screen Root",
      kind: "screen-root",
      parentId: null,
      bounds: { x: 0, y: 0, width: 1, height: 1 },
      inferred: false,
      surfaceRefId: null,
      textRefId: null,
      primitiveRefId: null,
      layoutMode: "NONE",
      itemSpacing: null,
      paddingTop: 0,
      paddingRight: 0,
      paddingBottom: 0,
      paddingLeft: 0,
      fillHex: null,
      cornerRadius: 0,
      componentName: null,
    },
  ];

  const addContainerNode = (surfaceId: string, name: string, kind: string, componentName: string | null) => {
    const surface = designSurfaces.find((item) => item.id === surfaceId);
    if (!surface) {
      return;
    }
    nodes.push({
      id: `semantic-${surfaceId}`,
      name,
      kind,
      parentId: "semantic-screen-root",
      bounds: surface.bounds,
      inferred: true,
      surfaceRefId: surface.id,
      textRefId: null,
      primitiveRefId: null,
      layoutMode: "NONE",
      itemSpacing: null,
      paddingTop: 0,
      paddingRight: 0,
      paddingBottom: 0,
      paddingLeft: 0,
      fillHex: surface.fillHex,
      cornerRadius: surface.cornerRadius,
      componentName,
    });
  };

  addContainerNode("surface-top-card", "Top Card", "card", "MissionCard");
  addContainerNode("surface-bottom-card", "Bottom Card", "card", "WorkoutCard");
  addContainerNode("surface-save-pill", "Save Pill", "pill", "ActionPill");
  addContainerNode("surface-walk-pill", "Walk Pill", "pill", "ActionPill");

  for (const block of textBlocks) {
    const parentSurface = designSurfaces.find((surface) => boundsOverlap(surface.bounds, block.bounds) > 0.45) || null;
    nodes.push({
      id: `semantic-${block.id}`,
      name: block.content.slice(0, 32) || block.id,
      kind: /^Wednesday/i.test(block.content) ? "header" : "text",
      parentId: parentSurface ? `semantic-${parentSurface.id}` : "semantic-screen-root",
      bounds: block.bounds,
      inferred: false,
      surfaceRefId: null,
      textRefId: block.id,
      primitiveRefId: null,
      layoutMode: "NONE",
      itemSpacing: null,
      paddingTop: null,
      paddingRight: null,
      paddingBottom: null,
      paddingLeft: null,
      fillHex: null,
      cornerRadius: null,
      componentName: null,
    });
  }

  for (const primitive of vectorPrimitives) {
    if (!primitive.bounds) {
      continue;
    }
    const parentSurface = designSurfaces.find((surface) => boundsOverlap(surface.bounds, primitive.bounds as any) > 0.45) || null;
    nodes.push({
      id: `semantic-${primitive.id}`,
      name: primitive.id,
      kind: "primitive",
      parentId: parentSurface ? `semantic-${parentSurface.id}` : "semantic-screen-root",
      bounds: primitive.bounds,
      inferred: true,
      surfaceRefId: null,
      textRefId: null,
      primitiveRefId: primitive.id,
      layoutMode: "NONE",
      itemSpacing: null,
      paddingTop: null,
      paddingRight: null,
      paddingBottom: null,
      paddingLeft: null,
      fillHex: null,
      cornerRadius: null,
      componentName: null,
    });
  }

  if (nodes.length === 1) {
    nodes.push({
      id: "semantic-fallback-section",
      name: "Primary Section",
      kind: "section",
      parentId: "semantic-screen-root",
      bounds: { x: 0.04, y: 0.08, width: 0.92, height: 0.84 },
      inferred: true,
      surfaceRefId: null,
      textRefId: null,
      primitiveRefId: null,
      layoutMode: "NONE",
      itemSpacing: null,
      paddingTop: 0,
      paddingRight: 0,
      paddingBottom: 0,
      paddingLeft: 0,
      fillHex: null,
      cornerRadius: null,
      componentName: null,
    });
  }

  return nodes;
}

function buildCompletionPlanFromDraft(semanticNodes: Array<Record<string, unknown>>, targetHeight: number) {
  const semanticBounds = semanticNodes
    .map((item) => item.bounds as { x: number; y: number; width: number; height: number } | undefined)
    .filter(Boolean);
  if (!semanticBounds.length) {
    return [];
  }

  const maxY = Math.max(...semanticBounds.map((bounds) => bounds.y + bounds.height));
  if (maxY >= 0.88) {
    return [];
  }

  return [
    {
      id: "completion-lower-flow",
      name: "Lower Screen Continuation",
      bounds: {
        x: 0.06,
        y: Math.min(0.88, maxY + 0.02),
        width: 0.88,
        height: Math.max(0.08, 0.96 - Math.min(0.88, maxY + 0.02)),
      },
      strategy: "conservative-extend",
      summary: `按当前卡片和胶囊语言继续延展剩余 screen flow；保持 ${targetHeight}px 高度屏幕内的保守信息架构。`,
      priority: "medium",
      inferred: true,
    },
  ];
}

async function writeVectorAnalysisDraft(
  job: ReconstructionJob,
  sourceQuadPixels: ReconstructionPoint[],
  remapPreviewPath: string,
  outputDirectory: string,
) {
  const referenceWidth = job.referenceRaster?.width || job.referenceNode.width || 0;
  const referenceHeight = job.referenceRaster?.height || job.referenceNode.height || 0;
  const targetWidth = Math.max(1, Math.round(job.targetNode.width || 0));
  const targetHeight = Math.max(1, Math.round(job.targetNode.height || 0));
  const baseName = sanitizeFileSegment(job.id);
  const draftPath = path.join(outputDirectory, `${baseName}-vector-analysis-draft.json`);
  const normalizedQuad = normalizeSourceQuad(sourceQuadPixels, referenceWidth, referenceHeight);
  const heuristic = await runPreviewHeuristicAnalysis(remapPreviewPath);
  const ocrLines = await runVisionOcr(remapPreviewPath);
  const rectifiedPreviewDataUrl = await encodeImageFileAsDataUrl(remapPreviewPath);
  const textCandidates = heuristic.textCandidates || [];
  const textStyleHints = heuristic.textStyleHints || [];
  const layoutRegions = heuristic.layoutRegions || [];
  const theme = heuristic.styleHints?.theme === "light" ? "light" : "dark";
  const defaultTextColor = theme === "dark" ? "#F5F7FF" : "#111111";

  const textBlocks = ocrLines.length
    ? ocrLines
        .filter((line) => Boolean(line.text.trim()))
        .map((line, index) => {
          const matchedCandidate = [...textCandidates]
            .filter((candidate): candidate is NonNullable<typeof candidate> & { id: string; bounds: { x: number; y: number; width: number; height: number } } =>
              Boolean(candidate?.id && candidate.bounds),
            )
            .sort((left, right) => boundsOverlap(right.bounds, line.bounds) - boundsOverlap(left.bounds, line.bounds))[0];
          const styleHint = matchedCandidate
            ? textStyleHints.find((hint) => hint.textCandidateId === matchedCandidate.id)
            : null;
          const role = inferTextRoleFromContent(line.text.trim(), line.bounds, targetHeight, matchedCandidate?.estimatedRole);
          const roleMatchedHint = styleHint?.role === role ? styleHint : null;
          const hintedFontSize =
            roleMatchedHint?.fontSizeEstimate && Number.isFinite(roleMatchedHint.fontSizeEstimate)
              ? Number(roleMatchedHint.fontSizeEstimate)
              : null;
          const fontSize = estimateFontSizeFromBounds(
            line.text.trim(),
            role,
            line.bounds,
            targetWidth,
            targetHeight,
            hintedFontSize,
          );
          const lineHeight =
            roleMatchedHint?.lineHeightEstimate && Number.isFinite(roleMatchedHint.lineHeightEstimate)
              ? Math.max(fontSize, Number(roleMatchedHint.lineHeightEstimate))
              : role === "body"
                ? Math.round(fontSize * 1.2)
                : role === "label"
                  ? Math.round(fontSize * 1.1)
                  : null;
          const colorHex =
            roleMatchedHint?.colorHex && roleMatchedHint.colorHex !== defaultTextColor
              ? roleMatchedHint.colorHex
              : inferTextColor(line.bounds, layoutRegions, theme);
          return {
            id: makeAnalysisBlockId("ocr-line", index, matchedCandidate?.id || null),
            bounds: line.bounds,
            role,
            content: line.text.trim(),
            inferred: line.confidence < 0.6,
            fontFamily: fontFamilyForRole(role),
            fontStyle: null,
            fontWeight:
              roleMatchedHint?.fontWeightGuess && Number.isFinite(roleMatchedHint.fontWeightGuess)
                ? Number(roleMatchedHint.fontWeightGuess)
                : fontWeightForRole(role),
            fontSize,
            lineHeight,
            letterSpacing:
              roleMatchedHint?.letterSpacingEstimate && Number.isFinite(roleMatchedHint.letterSpacingEstimate)
                ? Number(roleMatchedHint.letterSpacingEstimate)
                : 0,
            alignment:
              roleMatchedHint?.alignmentGuess && roleMatchedHint.alignmentGuess !== "unknown"
                ? roleMatchedHint.alignmentGuess
                : "left",
            colorHex,
          };
        })
    : [];
  const synthesizedShapes = synthesizeVectorShapesFromText(textBlocks, heuristic);
  const designTokens = buildDesignTokensFromDraft(heuristic, textBlocks);
  const semanticNodes = buildSemanticNodesFromDraft(
    targetWidth,
    targetHeight,
    synthesizedShapes.designSurfaces,
    textBlocks,
    synthesizedShapes.vectorPrimitives,
  );
  const completionPlan = buildCompletionPlanFromDraft(semanticNodes, targetHeight);

  const payload: SubmitReconstructionAnalysisPayload = {
    analysisProvider: "codex-assisted",
    analysisVersion: "2026-03-23-vector-draft-v1",
    warnings: ["这是 CLI 生成的 vector analysis draft；当前优先恢复可编辑文本和大区块，复杂图标/纹理仍未完全结构化。"],
    analysis: {
      previewDataUrl: rectifiedPreviewDataUrl,
      width: targetWidth,
      height: targetHeight,
      dominantColors: heuristic.dominantColors || ["#0D0D12", "#AA99FF"],
      canonicalFrame: {
        width: targetWidth,
        height: targetHeight,
        fixedTargetFrame: true,
        deprojected: true,
        mappingMode: "reflow",
        sourceQuad: normalizedQuad,
      },
      screenPlane: {
        extracted: true,
        excludesNonUiShell: true,
        confidence: 0.82,
        sourceQuad: normalizedQuad,
        rectifiedPreviewDataUrl,
      },
      layoutRegions: heuristic.layoutRegions || [],
      designSurfaces: synthesizedShapes.designSurfaces,
      vectorPrimitives: synthesizedShapes.vectorPrimitives,
      semanticNodes,
      designTokens,
      completionPlan,
      textCandidates,
      textBlocks,
      ocrBlocks: ocrLines.map((line, index) => ({
        id: `ocr-${index + 1}`,
        text: line.text.trim(),
        confidence: line.confidence,
        bounds: line.bounds,
        lineCount: Math.max(1, line.text.split(/\n+/).length),
        language: null,
        source: "ocr",
      })),
      textStyleHints,
      assetCandidates: heuristic.assetCandidates || [],
      styleHints: {
        theme,
        cornerRadiusHint: heuristic.styleHints?.cornerRadiusHint || 28,
        shadowHint: heuristic.styleHints?.shadowHint || "none",
        primaryColorHex: heuristic.styleHints?.primaryColorHex || "#0D0D12",
        accentColorHex: heuristic.styleHints?.accentColorHex || "#AA99FF",
      },
      uncertainties: [
        ...(heuristic.uncertainties || []),
        "当前 vector draft 仍不会自动恢复复杂插画/纹理；主要恢复文本层和大矩形区块。",
      ],
    },
  };
  await writeFile(draftPath, JSON.stringify(payload, null, 2), "utf8");
  return draftPath;
}

async function writeHybridAnalysisDraft(job: ReconstructionJob, sourceQuadPixels: ReconstructionPoint[], outputDirectory: string) {
  const referenceWidth = job.referenceRaster?.width || job.referenceNode.width || 0;
  const referenceHeight = job.referenceRaster?.height || job.referenceNode.height || 0;
  const targetWidth = Math.max(1, Math.round(job.targetNode.width || 0));
  const targetHeight = Math.max(1, Math.round(job.targetNode.height || 0));
  const baseName = sanitizeFileSegment(job.id);
  const draftPath = path.join(outputDirectory, `${baseName}-hybrid-analysis-draft.json`);
  const normalizedQuad = normalizeSourceQuad(sourceQuadPixels, referenceWidth, referenceHeight);
  const remapPreviewPath = await writeRemapPreview(job, sourceQuadPixels, outputDirectory);
  const rectifiedPreviewDataUrl = await encodeImageFileAsDataUrl(remapPreviewPath);
  const payload: SubmitReconstructionAnalysisPayload = {
    analysisProvider: "codex-assisted",
    analysisVersion: "2026-03-23-hybrid-draft-v1",
    warnings: ["这是 CLI 生成的 hybrid analysis draft；请在 submit 前继续补充 textBlocks、assetCandidates、completionZones。"],
    analysis: {
      previewDataUrl: rectifiedPreviewDataUrl,
      width: referenceWidth,
      height: referenceHeight,
      dominantColors: ["#0D0D12", "#AA99FF"],
      canonicalFrame: {
        width: targetWidth,
        height: targetHeight,
        fixedTargetFrame: true,
        deprojected: true,
        mappingMode: "reflow",
        sourceQuad: normalizedQuad,
      },
      screenPlane: {
        extracted: true,
        excludesNonUiShell: true,
        confidence: 0.72,
        sourceQuad: normalizedQuad,
        rectifiedPreviewDataUrl,
      },
      layoutRegions: [],
      designSurfaces: [],
      vectorPrimitives: [],
      semanticNodes: [],
      designTokens: null,
      completionPlan: [],
      textCandidates: [],
      textBlocks: [],
      ocrBlocks: [],
      textStyleHints: [],
      assetCandidates: [],
      completionZones: [],
      deprojectionNotes: [
        {
          id: "source-quad-draft",
          message: "sourceQuad 由 plugin:reconstruct 的 remap/draft 工作流生成，仍需人工确认。",
          targetId: null,
        },
      ],
      styleHints: {
        theme: "dark",
        cornerRadiusHint: 28,
        shadowHint: "none",
        primaryColorHex: "#0D0D12",
        accentColorHex: "#AA99FF",
      },
      uncertainties: ["当前 draft 只包含 fixed-frame + deprojection 骨架，未自动恢复可编辑 overlay。"],
    },
  };
  await writeFile(draftPath, JSON.stringify(payload, null, 2), "utf8");
  return draftPath;
}

async function writeContextPackArtifacts(contextPack: ReconstructionContextPack, outputDirectory: string) {
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

async function inspectFramePayload(
  requestJson: ReconstructCliDeps["requestJson"],
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

async function cropDataUrlToFile(
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

function resolveElementQuery(elements: ReconstructionElement[], query: string) {
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

function printElementScores(scores: ReconstructionElementScore[]) {
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

async function writeGuideArtifacts(manifest: ReconstructionGuideManifest, outputDirectory: string) {
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

export async function runReconstruct(argv: string[], deps: ReconstructCliDeps) {
  const jobId = deps.readFlag(argv, "--job");
  if (jobId) {
    if (argv.includes("--preview-remap") || argv.includes("--draft-analysis") || argv.includes("--estimate-quad")) {
      const job = await deps.requestJson<ReconstructionJob>(`/api/reconstruction/jobs/${jobId}`);
      const outputDirectory = deps.readFlag(argv, "--out") || path.join(process.cwd(), "data", "reconstruction-remaps");
      await mkdir(outputDirectory, { recursive: true });
      const explicitSourceQuad = parseSourceQuadPixelsWithAnalysis(deps.readFlag(argv, "--source-quad-px"));
      const estimated =
        explicitSourceQuad.length === 4 ? null : await estimateSourceQuadPixelsWithAnalysis(job, outputDirectory);
      const sourceQuadPixels = explicitSourceQuad.length === 4 ? explicitSourceQuad : estimated?.sourceQuadPixels || [];

      if (!sourceQuadPixels.length) {
        fail("无法获得 sourceQuad。请提供 --source-quad-px，或使用 --estimate-quad。");
      }

      console.log(`job: ${job.id}`);
      console.log(`sourceQuadPx: ${sourceQuadPixels.map((point) => `${point.x},${point.y}`).join(" | ")}`);
      if (estimated) {
        console.log(`estimatedRotation: ${estimated.rotationDegrees}deg`);
        console.log(`estimatedRotatedBox: (${estimated.rotatedBox.x}, ${estimated.rotatedBox.y}, ${estimated.rotatedBox.width}, ${estimated.rotatedBox.height}) density=${estimated.rotatedBox.density}`);
        if (estimated.debug?.originalOverlayPath) {
          console.log(`quadOverlay: ${estimated.debug.originalOverlayPath}`);
        }
        if (estimated.debug?.rotatedOverlayPath) {
          console.log(`rotatedBoxOverlay: ${estimated.debug.rotatedOverlayPath}`);
        }
      }

      const needsRemapPreview =
        argv.includes("--preview-remap") ||
        argv.includes("--draft-analysis") ||
        job.input.strategy === "vector-reconstruction";
      const remapPreviewPath = needsRemapPreview
        ? await writeRemapPreviewWithAnalysis(job, sourceQuadPixels, outputDirectory)
        : null;
      if (remapPreviewPath) {
        console.log(`remapPreview: ${remapPreviewPath}`);
      }
      if (argv.includes("--draft-analysis")) {
        const draftPath =
          job.input.strategy === "vector-reconstruction" && remapPreviewPath
            ? await writeVectorAnalysisDraftWithAnalysis(job, sourceQuadPixels, remapPreviewPath, outputDirectory)
            : await writeHybridAnalysisDraftWithAnalysis(job, sourceQuadPixels, outputDirectory);
        console.log(`analysisDraft: ${draftPath}`);
      }
      return;
    }

    if (argv.includes("--export-guides")) {
      const manifest = await deps.requestJson<ReconstructionGuideManifest>(`/api/reconstruction/jobs/${jobId}/guide-manifest`);
      const outputDirectory = deps.readFlag(argv, "--out") || path.join(process.cwd(), "data", "reconstruction-guides");
      const artifacts = await writeGuideArtifacts(manifest, outputDirectory);
      console.log(`job: ${manifest.jobId}`);
      console.log(`guideManifest: ${artifacts.manifestPath}`);
      console.log(`referenceGuide: ${artifacts.referencePreviewPath || "none"}`);
      console.log(`rectifiedGuide: ${artifacts.rectifiedPreviewPath || "none"}`);
      console.log(`renderedGuide: ${artifacts.renderedPreviewPath || "none"}`);
      console.log(`elements: ${artifacts.elementCount}`);
      console.log(`constraints: ${artifacts.constraintCount}`);
      return;
    }

    const scoreElementQuery = deps.readValueFlag(argv, "--score-element");
    if (argv.includes("--score-elements") || argv.includes("--score-element") || scoreElementQuery) {
      const job = await deps.requestJson<ReconstructionJob>(`/api/reconstruction/jobs/${jobId}`);
      const manifest = await deps.requestJson<ReconstructionGuideManifest>(`/api/reconstruction/jobs/${jobId}/guide-manifest`);
      const inspectPayload = await inspectFramePayload(deps.requestJson, job.input.targetSessionId, job.targetNode.id, {
        maxDepth: (() => {
          const raw = deps.readFlag(argv, "--max-depth");
          const value = raw ? Number.parseInt(raw, 10) : Number.NaN;
          return Number.isFinite(value) ? value : 6;
        })(),
        includePreview: true,
      });
      const explicitElementQuery = scoreElementQuery || deps.readValueFlag(argv, "--element");
      const targetElement = explicitElementQuery ? resolveElementQuery(manifest.elements, explicitElementQuery) : null;
      if (explicitElementQuery && !targetElement) {
        fail(`未找到元素：${explicitElementQuery}`);
      }
      const renderedPreviewDataUrl = inspectPayload.preview?.dataUrl || job.renderedPreview?.previewDataUrl || null;
      if (!renderedPreviewDataUrl) {
        fail(`job ${job.id} 缺少当前 target render。先运行 --render，或保持插件在线以便 inspect-frame 导出预览。`);
      }
      const scorePayload: ReconstructionElementScoresPayload = {
        inspectedNodes: inspectPayload.nodes,
        renderedPreviewDataUrl,
        ...(targetElement ? { elementIds: [targetElement.id] } : {}),
      };
      const scoreResponse = await deps.requestJson<ReconstructionElementScoresResponse>(`/api/reconstruction/jobs/${jobId}/element-scores`, {
        method: "POST",
        body: JSON.stringify(scorePayload),
      });
      console.log(`job: ${job.id}`);
      console.log(`referencePreview: ${scoreResponse.referencePreviewKind}`);
      console.log(`liveNodes: ${scoreResponse.liveNodeCount}`);
      printElementScores(scoreResponse.scores);
      return;
    }

    const renderElementQuery = deps.readValueFlag(argv, "--render-element");
    if (argv.includes("--render-element") || renderElementQuery) {
      const explicitQuery = renderElementQuery || deps.readValueFlag(argv, "--element");
      if (!explicitQuery) {
        fail("--render-element 需要一个元素 id/name，或配合 --element 使用。");
      }
      const job = await deps.requestJson<ReconstructionJob>(`/api/reconstruction/jobs/${jobId}`);
      const manifest = await deps.requestJson<ReconstructionGuideManifest>(`/api/reconstruction/jobs/${jobId}/guide-manifest`);
      const element = resolveElementQuery(manifest.elements, explicitQuery);
      if (!element) {
        fail(`未找到元素：${explicitQuery}`);
      }
      const referencePreviewDataUrl = manifest.images.rectifiedPreviewDataUrl || manifest.images.referencePreviewDataUrl;
      if (!referencePreviewDataUrl) {
        fail(`job ${job.id} 缺少 reference preview，无法导出元素 crop。`);
      }
      const inspectPayload = await inspectFramePayload(deps.requestJson, job.input.targetSessionId, job.targetNode.id, {
        maxDepth: 1,
        includePreview: true,
      });
      const renderedPreviewDataUrl = inspectPayload.preview?.dataUrl || job.renderedPreview?.previewDataUrl || null;
      if (!renderedPreviewDataUrl) {
        fail(`job ${job.id} 缺少当前 target render。先运行 --render，或保持插件在线以便 inspect-frame 导出预览。`);
      }
      const outputDirectory = deps.readFlag(argv, "--out") || path.join(process.cwd(), "data", "reconstruction-element-renders");
      await mkdir(outputDirectory, { recursive: true });
      const baseName = `${sanitizeFileSegment(job.id)}-${sanitizeFileSegment(element.name)}`;
      const referencePath = path.join(outputDirectory, `${baseName}-reference.png`);
      const renderedPath = path.join(outputDirectory, `${baseName}-rendered.png`);
      await cropDataUrlToFile(referencePreviewDataUrl, element.referenceBounds, referencePath);
      await cropDataUrlToFile(renderedPreviewDataUrl, element.referenceBounds, renderedPath);
      console.log(`job: ${job.id}`);
      console.log(`element: ${element.name} [${element.id}]`);
      console.log(`referenceCrop: ${referencePath}`);
      console.log(`renderedCrop: ${renderedPath}`);
      return;
    }

    if (argv.includes("--analyze")) {
      const job = await deps.requestJson<ReconstructionJob>(`/api/reconstruction/jobs/${jobId}/analyze`, { method: "POST" });
      printReconstructionJob(job);
      return;
    }

    if (argv.includes("--context-pack")) {
      const contextPack = await deps.requestJson<ReconstructionContextPack>(`/api/reconstruction/jobs/${jobId}/context-pack`, { method: "POST" });
      const outputDirectory = deps.readFlag(argv, "--out") || path.join(process.cwd(), "data", "reconstruction-context-packs");
      const artifacts = await writeContextPackArtifacts(contextPack, outputDirectory);
      console.log(`job: ${contextPack.jobId}`);
      console.log(`mode: ${contextPack.mode}`);
      console.log(`contextPack: ${artifacts.contextPath}`);
      console.log(`referencePreview: ${artifacts.referencePreviewPath}`);
      console.log(`referenceRectifiedPreview: ${artifacts.referenceRectifiedPreviewPath || "none"}`);
      console.log(`targetPreview: ${artifacts.targetPreviewPath || "none"}`);
      console.log("guidance:");
      for (const line of contextPack.guidance) {
        console.log(`- ${line}`);
      }
      console.log("workflow:");
      for (const line of contextPack.workflow) {
        console.log(`- ${line}`);
      }
      console.log("scoringRubric:");
      for (const line of contextPack.scoringRubric) {
        console.log(`- ${line}`);
      }
      return;
    }

    if (argv.includes("--submit-analysis")) {
      const analysisFile = deps.readFlag(argv, "--analysis-file");
      const analysisJson = deps.readFlag(argv, "--analysis-json");
      if (!analysisFile && !analysisJson) {
        fail("--submit-analysis 需要 --analysis-file 或 --analysis-json。");
      }
      if (analysisFile && analysisJson) {
        fail("--submit-analysis 只能使用一种输入方式：--analysis-file 或 --analysis-json。");
      }
      const payload = analysisFile
        ? await deps.readJsonFile<SubmitReconstructionAnalysisPayload>(analysisFile)
        : (JSON.parse(analysisJson as string) as SubmitReconstructionAnalysisPayload);
      const job = await deps.requestJson<ReconstructionJob>(`/api/reconstruction/jobs/${jobId}/submit-analysis`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      printReconstructionJob(job);
      return;
    }

    if (argv.includes("--preview-plan")) {
      const job = await deps.requestJson<ReconstructionJob>(`/api/reconstruction/jobs/${jobId}/preview-plan`, { method: "POST" });
      printReconstructionJob(job);
      return;
    }

    if (argv.includes("--review-font")) {
      const textCandidateId = deps.readFlag(argv, "--text-candidate");
      const fontFamily = deps.readFlag(argv, "--font");
      if (!textCandidateId || !fontFamily) {
        fail("--review-font 需要 --text-candidate 和 --font。");
      }
      const payload: ReviewReconstructionFontPayload = { textCandidateId, fontFamily };
      const job = await deps.requestJson<ReconstructionJob>(`/api/reconstruction/jobs/${jobId}/review/font`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      printReconstructionJob(job);
      return;
    }

    if (argv.includes("--review-asset")) {
      const assetId = deps.readFlag(argv, "--asset");
      const decision = deps.readFlag(argv, "--decision");
      if (!assetId || (decision !== "approved" && decision !== "rejected")) {
        fail("--review-asset 需要 --asset 和 --decision approved|rejected。");
      }
      const payload: ReviewReconstructionAssetPayload = { assetId, decision, note: deps.readFlag(argv, "--note") || undefined };
      const job = await deps.requestJson<ReconstructionJob>(`/api/reconstruction/jobs/${jobId}/review/asset`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      printReconstructionJob(job);
      return;
    }

    if (argv.includes("--approve-plan") || argv.includes("--request-changes")) {
      const payload: ApproveReconstructionPlanPayload = {
        approved: argv.includes("--approve-plan"),
        note: deps.readFlag(argv, "--note") || undefined,
      };
      const job = await deps.requestJson<ReconstructionJob>(`/api/reconstruction/jobs/${jobId}/review/approve-plan`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      printReconstructionJob(job);
      return;
    }

    for (const action of ["apply", "clear", "render", "measure", "refine", "iterate", "loop"] as const) {
      if (argv.includes(`--${action}`)) {
        const job = await deps.requestJson<ReconstructionJob>(`/api/reconstruction/jobs/${jobId}/${action}`, {
          method: "POST",
        });
        printReconstructionJob(job);
        return;
      }
    }

    const job = await deps.requestJson<ReconstructionJob>(`/api/reconstruction/jobs/${jobId}`);
    printReconstructionJob(job);
    return;
  }

  if (argv.includes("--list")) {
    const snapshot = await deps.requestJson<ReconstructionJobSnapshot>("/api/reconstruction/jobs");
    if (!snapshot.jobs.length) {
      console.log("当前没有 reconstruction job。");
      return;
    }

    for (const job of snapshot.jobs) {
      console.log(`${job.id} | ${job.status} | ${job.targetNode.name} <= ${job.referenceNode.name} | ${job.currentStageId}`);
    }
    return;
  }

  const snapshot = await deps.requestJson<PluginBridgeSnapshot>("/api/plugin-bridge");
  const session = deps.pickSession(snapshot.sessions, deps.readFlag(argv, "--session"));
  const maxIterationsRaw = deps.readFlag(argv, "--max-iterations");
  const payload: CreateReconstructionJobPayload = {
    targetSessionId: session.id,
    targetNodeId: deps.readFlag(argv, "--target") || undefined,
    referenceNodeId: deps.readFlag(argv, "--reference") || undefined,
    goal: "pixel-match",
    strategy: (() => {
      try {
        return parseReconstructionStrategy(argv, deps.readFlag);
      } catch (error) {
        fail(error instanceof Error ? error.message : "reconstruction strategy 解析失败。");
      }
    })(),
    maxIterations: maxIterationsRaw !== null ? Number.parseInt(maxIterationsRaw, 10) : undefined,
    allowOutpainting: argv.includes("--allow-outpainting"),
  };

  const job = await deps.requestJson<ReconstructionJob>("/api/reconstruction/jobs", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  printReconstructionJob(job);
  if (job.input.strategy === "raster-exact") {
    console.log("next: --apply -> --render -> --measure");
  } else if (job.input.strategy === "vector-reconstruction") {
    console.log("next: --analyze -> --context-pack -> --submit-analysis -> --apply -> --render -> --measure");
  } else if (job.input.strategy === "hybrid-reconstruction") {
    console.log("next: --analyze -> --context-pack -> --submit-analysis -> --preview-plan -> --approve-plan -> --apply -> --render -> --measure");
  } else {
    console.log("next: --analyze or --context-pack");
  }
}
