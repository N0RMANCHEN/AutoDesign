import { execFile } from "node:child_process";
import { writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import type {
  ReconstructionContextPack,
  ReconstructionAnalysisProvider,
  ReconstructionAnalysis,
  ReconstructionFontMatch,
  ReconstructionJob,
  ReconstructionPlan,
  ReconstructionReviewFlag,
} from "../shared/reconstruction.js";
import { buildReconstructionAnalysisWarnings } from "./design-core/analysis-warnings.js";
import { buildReconstructionContextPolicy } from "./design-core/context-pack-policy.js";
import {
  normalizeReconstructionAnalysisPayload,
  normalizeReconstructionFontMatches,
  normalizeReconstructionReviewFlags,
  resolveReconstructionAnalysisProvider,
  uniqueReviewFlags,
} from "./design-core/reconstruction-analysis-normalization.js";
import {
  buildDefaultReconstructionFontMatches,
  synthesizeReconstructionCompletionPlan,
  synthesizeReconstructionDesignSurfaces,
  synthesizeReconstructionDesignTokens,
  synthesizeReconstructionOcrBlocks,
  synthesizeReconstructionOcrBlocksFromBlocks,
  synthesizeReconstructionTextCandidatesFromBlocks,
  synthesizeReconstructionTextStyleHints,
  synthesizeReconstructionTextStyleHintsFromBlocks,
} from "./design-core/reconstruction-analysis-synthesis.js";
import {
  buildReconstructionPlan,
  buildReconstructionReviewFlags,
  synthesizeSemanticNodes,
} from "./design-core/rebuild-planning.js";
import {
  normalizeReconstructionElementConstraints,
  synthesizeReconstructionElementConstraints,
  synthesizeReconstructionElements,
} from "./reconstruction-elements.js";

const RECONSTRUCTION_ANALYSIS_VERSION = "2026-03-22-preview-v2";
export const RECONSTRUCTION_ANALYSIS_VERSION_CODEX = "2026-03-22-codex-assisted-v1";

const execFileAsync = promisify(execFile);

function parsePreviewDataUrl(dataUrl: string) {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl);
  if (!match) {
    throw new Error("参考图 previewDataUrl 格式无效。");
  }

  return {
    mimeType: match[1],
    bytes: Buffer.from(match[2], "base64"),
  };
}

function extensionForMimeType(mimeType: string) {
  switch (mimeType) {
    case "image/png":
      return ".png";
    case "image/jpeg":
      return ".jpg";
    case "image/gif":
      return ".gif";
    default:
      return ".img";
  }
}

async function analyzePreviewImage(previewDataUrl: string) {
  const { mimeType, bytes } = parsePreviewDataUrl(previewDataUrl);
  const tempPath = path.join(
    os.tmpdir(),
    `autodesign-reconstruction-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${extensionForMimeType(mimeType)}`,
  );

  await writeFile(tempPath, bytes);
  try {
    const scriptPath = path.join(process.cwd(), "scripts", "analyze_reference_preview.py");
    const { stdout } = await execFileAsync("python3", [scriptPath, tempPath], {
      maxBuffer: 1024 * 1024 * 4,
    });
    return {
      mimeType,
      payload: JSON.parse(stdout),
    };
  } finally {
    await rm(tempPath, { force: true });
  }
}

export async function runPreviewOnlyReconstructionAnalysis(job: ReconstructionJob): Promise<{
  analysisVersion: string;
  analysisProvider: ReconstructionAnalysisProvider;
  analysis: ReconstructionAnalysis;
  fontMatches: ReconstructionFontMatch[];
  rebuildPlan: ReconstructionPlan;
  reviewFlags: ReconstructionReviewFlag[];
  warnings: string[];
}> {
  if (!job.referenceNode.previewDataUrl) {
    throw new Error("参考节点缺少 previewDataUrl，无法执行分析。");
  }

  const fallback = await analyzePreviewImage(job.referenceNode.previewDataUrl);
  const normalized = buildNormalizedReconstructionAnalysis(job, {
    analysisProvider: "heuristic-local",
    analysisVersion: RECONSTRUCTION_ANALYSIS_VERSION,
    analysis: fallback.payload,
    warnings: ["当前 analyze 仅执行本地 heuristic。高保真主链已切换为 Codex-assisted context pack + submit-analysis。"],
  });

  return {
    analysisVersion: normalized.analysisVersion,
    analysisProvider: normalized.analysisProvider,
    analysis: normalized.analysis,
    fontMatches: normalized.fontMatches,
    rebuildPlan: normalized.rebuildPlan,
    reviewFlags: normalized.reviewFlags,
    warnings: normalized.warnings,
  };
}

export function buildReconstructionContextPack(job: ReconstructionJob): ReconstructionContextPack {
  if (!job.referenceNode.previewDataUrl) {
    throw new Error("参考节点缺少 previewDataUrl，无法生成 Codex context pack。");
  }
  const policy = buildReconstructionContextPolicy(job);

  return {
    jobId: job.id,
    mode: "codex-assisted",
    analysisProvider: "codex-assisted",
    analysisVersionTarget: RECONSTRUCTION_ANALYSIS_VERSION_CODEX,
    generatedAt: new Date().toISOString(),
    strategy: job.input.strategy,
    targetNode: job.targetNode,
    referenceNode: job.referenceNode,
    referencePreviewDataUrl: job.referenceRaster?.dataUrl || job.referenceNode.previewDataUrl,
    referenceRectifiedPreviewDataUrl: job.analysis?.screenPlane?.rectifiedPreviewDataUrl || null,
    targetPreviewDataUrl: job.targetNode.previewDataUrl || null,
    currentAnalysis: job.analysis,
    currentFontMatches: job.fontMatches,
    currentReviewFlags: job.reviewFlags,
    currentWarnings: job.warnings,
    workflow: policy.workflow,
    scoringRubric: policy.scoringRubric,
    guidance: policy.guidance,
  };
}

export function buildNormalizedReconstructionAnalysis(
  job: ReconstructionJob,
  payload: {
    analysisVersion?: string;
    analysisProvider?: ReconstructionAnalysisProvider;
    analysis: unknown;
    fontMatches?: ReconstructionFontMatch[];
    reviewFlags?: ReconstructionReviewFlag[];
    warnings?: string[];
  },
): {
  analysisVersion: string;
  analysisProvider: ReconstructionAnalysisProvider;
  analysis: ReconstructionAnalysis;
  fontMatches: ReconstructionFontMatch[];
  rebuildPlan: ReconstructionPlan;
  reviewFlags: ReconstructionReviewFlag[];
  warnings: string[];
} {
  if (!job.referenceNode.previewDataUrl) {
    throw new Error("参考节点缺少 previewDataUrl，无法生成结构化分析。");
  }

  const rawAnalysis = (payload.analysis || {}) as Record<string, unknown>;
  const analysisPreviewDataUrl =
    typeof rawAnalysis.previewDataUrl === "string" && rawAnalysis.previewDataUrl.startsWith("data:image/")
      ? rawAnalysis.previewDataUrl
      : job.referenceNode.previewDataUrl;
  const mimeType =
    typeof rawAnalysis.mimeType === "string" && rawAnalysis.mimeType.trim()
      ? rawAnalysis.mimeType.trim()
      : parsePreviewDataUrl(job.referenceNode.previewDataUrl).mimeType;
  const rawWidth = Number.isFinite(rawAnalysis.width) ? Number(rawAnalysis.width) : job.referenceNode.width || 0;
  const rawHeight = Number.isFinite(rawAnalysis.height) ? Number(rawAnalysis.height) : job.referenceNode.height || 0;

  const normalized = normalizeReconstructionAnalysisPayload(job, rawAnalysis, rawWidth, rawHeight);
  const textCandidates =
    normalized.textCandidatesRaw.length > 0
      ? normalized.textCandidatesRaw
      : synthesizeReconstructionTextCandidatesFromBlocks(normalized.normalizedTextBlocks);
  const designSurfaces =
    normalized.designSurfacesRaw.length > 0
      ? normalized.designSurfacesRaw
      : synthesizeReconstructionDesignSurfaces(normalized.layoutRegions, normalized.styleHints);

  const analysisBase: ReconstructionAnalysis = {
    previewDataUrl: analysisPreviewDataUrl,
    mimeType,
    width: rawWidth,
    height: rawHeight,
    dominantColors: normalized.dominantColors,
    canonicalFrame: normalized.canonicalFrame,
    screenPlane: normalized.screenPlane,
    layoutRegions: normalized.layoutRegions,
    designSurfaces,
    vectorPrimitives: normalized.vectorPrimitives,
    semanticNodes: normalized.semanticNodes,
    elements: normalized.normalizedElements,
    elementConstraints: [],
    designTokens: normalized.designTokens,
    completionPlan: normalized.completionPlan,
    textCandidates,
    textBlocks: normalized.normalizedTextBlocks,
    ocrBlocks:
      normalized.normalizedOcrBlocks.length > 0
        ? normalized.normalizedOcrBlocks
        : synthesizeReconstructionOcrBlocks(textCandidates),
    textStyleHints:
      normalized.normalizedTextStyleHints.length > 0
        ? normalized.normalizedTextStyleHints
        : normalized.normalizedTextBlocks.length > 0
          ? synthesizeReconstructionTextStyleHintsFromBlocks(normalized.normalizedTextBlocks)
          : synthesizeReconstructionTextStyleHints(normalized.styleHints.theme, textCandidates),
    assetCandidates: normalized.assetCandidates,
    completionZones: normalized.completionZones,
    deprojectionNotes: normalized.deprojectionNotes,
    styleHints: normalized.styleHints,
    uncertainties: normalized.uncertainties,
  };

  const derivedSemanticNodes =
    analysisBase.semanticNodes.length > 0 ? analysisBase.semanticNodes : synthesizeSemanticNodes(analysisBase);
  const analysis: ReconstructionAnalysis = {
    ...analysisBase,
    semanticNodes: derivedSemanticNodes,
    designTokens:
      analysisBase.designTokens ||
      synthesizeReconstructionDesignTokens(normalized.styleHints, normalized.normalizedTextBlocks),
    completionPlan:
      analysisBase.completionPlan.length > 0
        ? analysisBase.completionPlan
        : synthesizeReconstructionCompletionPlan(derivedSemanticNodes),
  };

  const derivedElements =
    normalized.normalizedElements.length > 0 ? normalized.normalizedElements : synthesizeReconstructionElements(analysis);
  const normalizedElementConstraints = normalizeReconstructionElementConstraints(
    rawAnalysis.elementConstraints,
    derivedElements,
  );
  analysis.elements = derivedElements;
  analysis.elementConstraints =
    normalizedElementConstraints.length > 0
      ? normalizedElementConstraints
      : synthesizeReconstructionElementConstraints(derivedElements);

  const warnings = buildReconstructionAnalysisWarnings(job, analysis, payload.warnings || []);

  const normalizedFontMatches = normalizeReconstructionFontMatches(payload.fontMatches, analysis.textCandidates);
  const fontMatches =
    normalizedFontMatches.length > 0
      ? normalizedFontMatches
      : buildDefaultReconstructionFontMatches(analysis.textCandidates);

  if (analysis.textBlocks.length > 0 && analysis.ocrBlocks.every((block) => !block.text)) {
    analysis.ocrBlocks = synthesizeReconstructionOcrBlocksFromBlocks(analysis.textBlocks);
  }

  const rebuildPlan = buildReconstructionPlan(job, analysis, fontMatches);
  const normalizedReviewFlags = normalizeReconstructionReviewFlags(payload.reviewFlags);
  const reviewFlags = uniqueReviewFlags(
    job.input.strategy === "vector-reconstruction"
      ? [...normalizedReviewFlags]
      : [
          ...buildReconstructionReviewFlags(job, analysis, fontMatches),
          ...normalizedReviewFlags,
        ],
  );

  return {
    analysisVersion:
      typeof payload.analysisVersion === "string" && payload.analysisVersion.trim()
        ? payload.analysisVersion.trim()
        : RECONSTRUCTION_ANALYSIS_VERSION_CODEX,
    analysisProvider: resolveReconstructionAnalysisProvider(payload.analysisProvider),
    analysis,
    fontMatches,
    rebuildPlan,
    reviewFlags,
    warnings,
  };
}
