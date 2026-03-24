import { execFile } from "node:child_process";
import { writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import type {
  ReconstructionAcceptanceGate,
  ReconstructionBounds,
  ReconstructionDiffHotspot,
  ReconstructionDiffGrade,
  ReconstructionDiffMetrics,
  ReconstructionJob,
  ReconstructionRefineSuggestion,
  ReconstructionRenderedPreview,
} from "../shared/reconstruction.js";
import { nowIso } from "../shared/utils.js";

const execFileAsync = promisify(execFile);

function parsePreviewDataUrl(dataUrl: string) {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl);
  if (!match) {
    throw new Error("预览图 dataUrl 格式无效。");
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

function normalizeBounds(input: any): ReconstructionBounds {
  return {
    x: Number.isFinite(input?.x) ? Number(input.x) : 0,
    y: Number.isFinite(input?.y) ? Number(input.y) : 0,
    width: Number.isFinite(input?.width) ? Number(input.width) : 0,
    height: Number.isFinite(input?.height) ? Number(input.height) : 0,
  };
}

function normalizeHotspots(input: unknown): ReconstructionDiffHotspot[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((item, index) => ({
      id: typeof item?.id === "string" ? item.id : `hotspot-${index + 1}`,
      score: Number.isFinite(item?.score) ? Number(item.score) : 0,
      bounds: normalizeBounds(item?.bounds),
    }))
    .filter((item) => item.score > 0 && item.bounds.width > 0 && item.bounds.height > 0)
    .slice(0, 6);
}

function normalizeAcceptanceGates(input: unknown): ReconstructionAcceptanceGate[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((item, index) => {
      const comparator = item?.comparator === "lte" ? "lte" : "gte";
      return {
        id: typeof item?.id === "string" ? item.id : `gate-${index + 1}`,
        label: typeof item?.label === "string" && item.label.trim() ? item.label.trim() : `Gate ${index + 1}`,
        metric: typeof item?.metric === "string" && item.metric.trim() ? item.metric.trim() : "unknown",
        comparator,
        threshold: Number.isFinite(item?.threshold) ? Number(item.threshold) : 0,
        actual: Number.isFinite(item?.actual) ? Number(item.actual) : 0,
        passed: Boolean(item?.passed),
        hard: item?.hard !== false,
      } satisfies ReconstructionAcceptanceGate;
    })
    .slice(0, 12);
}

function clampScore(value: unknown) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, Number(value)));
}

function normalizeGrade(value: unknown): ReconstructionDiffGrade {
  return value === "A" || value === "B" || value === "C" || value === "D" ? value : "F";
}

function buildRenderedPreview(
  previewDataUrl: string,
  targetWidth: number,
  targetHeight: number,
): ReconstructionRenderedPreview {
  const { mimeType } = parsePreviewDataUrl(previewDataUrl);
  return {
    previewDataUrl,
    mimeType,
    width: targetWidth,
    height: targetHeight,
    capturedAt: nowIso(),
  };
}

export function createRenderedPreview(
  previewDataUrl: string,
  targetWidth: number,
  targetHeight: number,
) {
  return buildRenderedPreview(previewDataUrl, targetWidth, targetHeight);
}

export async function measurePreviewDiff(
  referencePreviewDataUrl: string,
  renderedPreviewDataUrl: string,
): Promise<ReconstructionDiffMetrics> {
  const reference = parsePreviewDataUrl(referencePreviewDataUrl);
  const rendered = parsePreviewDataUrl(renderedPreviewDataUrl);
  const referencePath = path.join(
    os.tmpdir(),
    `autodesign-diff-reference-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${extensionForMimeType(reference.mimeType)}`,
  );
  const renderedPath = path.join(
    os.tmpdir(),
    `autodesign-diff-rendered-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${extensionForMimeType(rendered.mimeType)}`,
  );

  await writeFile(referencePath, reference.bytes);
  await writeFile(renderedPath, rendered.bytes);

  try {
    const scriptPath = path.join(process.cwd(), "scripts", "measure_reconstruction_diff.py");
    const { stdout } = await execFileAsync("python3", [scriptPath, referencePath, renderedPath], {
      maxBuffer: 1024 * 1024 * 4,
    });
    const payload = JSON.parse(stdout);
    return {
      globalSimilarity: clampScore(payload?.globalSimilarity),
      colorDelta: clampScore(payload?.colorDelta),
      edgeSimilarity: clampScore(payload?.edgeSimilarity),
      layoutSimilarity: clampScore(payload?.layoutSimilarity),
      structureSimilarity: clampScore(payload?.structureSimilarity),
      hotspotAverage: clampScore(payload?.hotspotAverage),
      hotspotPeak: clampScore(payload?.hotspotPeak),
      hotspotCoverage: clampScore(payload?.hotspotCoverage),
      compositeScore: clampScore(payload?.compositeScore),
      grade: normalizeGrade(payload?.grade),
      acceptanceGates: normalizeAcceptanceGates(payload?.acceptanceGates),
      hotspots: normalizeHotspots(payload?.hotspots),
    };
  } finally {
    await rm(referencePath, { force: true });
    await rm(renderedPath, { force: true });
  }
}

export async function measureElementDiff(
  referencePreviewDataUrl: string,
  renderedPreviewDataUrl: string,
  cropBounds: ReconstructionBounds,
): Promise<ReconstructionDiffMetrics> {
  const reference = parsePreviewDataUrl(referencePreviewDataUrl);
  const rendered = parsePreviewDataUrl(renderedPreviewDataUrl);
  const referencePath = path.join(
    os.tmpdir(),
    `autodesign-element-reference-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${extensionForMimeType(reference.mimeType)}`,
  );
  const renderedPath = path.join(
    os.tmpdir(),
    `autodesign-element-rendered-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${extensionForMimeType(rendered.mimeType)}`,
  );

  await writeFile(referencePath, reference.bytes);
  await writeFile(renderedPath, rendered.bytes);

  try {
    const scriptPath = path.join(process.cwd(), "scripts", "measure_reconstruction_diff.py");
    const { stdout } = await execFileAsync(
      "python3",
      [
        scriptPath,
        referencePath,
        renderedPath,
        "--crop",
        JSON.stringify(normalizeBounds(cropBounds)),
      ],
      {
        maxBuffer: 1024 * 1024 * 4,
      },
    );
    const payload = JSON.parse(stdout);
    return {
      globalSimilarity: clampScore(payload?.globalSimilarity),
      colorDelta: clampScore(payload?.colorDelta),
      edgeSimilarity: clampScore(payload?.edgeSimilarity),
      layoutSimilarity: clampScore(payload?.layoutSimilarity),
      structureSimilarity: clampScore(payload?.structureSimilarity),
      hotspotAverage: clampScore(payload?.hotspotAverage),
      hotspotPeak: clampScore(payload?.hotspotPeak),
      hotspotCoverage: clampScore(payload?.hotspotCoverage),
      compositeScore: clampScore(payload?.compositeScore),
      grade: normalizeGrade(payload?.grade),
      acceptanceGates: normalizeAcceptanceGates(payload?.acceptanceGates),
      hotspots: normalizeHotspots(payload?.hotspots),
    };
  } finally {
    await rm(referencePath, { force: true });
    await rm(renderedPath, { force: true });
  }
}

function regionForHotspot(job: ReconstructionJob, hotspot: ReconstructionDiffHotspot) {
  return (
    job.analysis?.layoutRegions.find((region) => {
      const regionRight = region.bounds.x + region.bounds.width;
      const regionBottom = region.bounds.y + region.bounds.height;
      const hotspotRight = hotspot.bounds.x + hotspot.bounds.width;
      const hotspotBottom = hotspot.bounds.y + hotspot.bounds.height;
      return !(
        hotspot.bounds.x >= regionRight ||
        hotspotRight <= region.bounds.x ||
        hotspot.bounds.y >= regionBottom ||
        hotspotBottom <= region.bounds.y
      );
    }) || null
  );
}

function findFailedGates(diffMetrics: ReconstructionDiffMetrics, metrics: string[]) {
  const metricSet = new Set(metrics);
  return diffMetrics.acceptanceGates.filter((gate) => !gate.passed && metricSet.has(gate.metric));
}

function hasHardGateFailures(diffMetrics: ReconstructionDiffMetrics) {
  return diffMetrics.acceptanceGates.some((gate) => gate.hard && !gate.passed);
}

export function buildRefineSuggestions(
  job: ReconstructionJob,
  diffMetrics: ReconstructionDiffMetrics,
): ReconstructionRefineSuggestion[] {
  const suggestions: ReconstructionRefineSuggestion[] = [];
  const topHotspot = diffMetrics.hotspots[0] || null;
  const colorGateFailed = findFailedGates(diffMetrics, ["colorDelta"]).length > 0;
  const layoutGateFailures = findFailedGates(diffMetrics, [
    "layoutSimilarity",
    "structureSimilarity",
    "hotspotPeak",
    "hotspotCoverage",
  ]);
  const edgeGateFailures = findFailedGates(diffMetrics, ["edgeSimilarity", "globalSimilarity"]);

  if (colorGateFailed) {
    suggestions.push({
      id: "refine-fill-1",
      kind: "nudge-fill",
      confidence: Math.min(0.95, 0.56 + diffMetrics.colorDelta),
      message:
        "颜色门槛仍未通过。先并排查看参考图与当前 render，只调整一个父级容器内的 fill/opacity，再重新 render+measure。",
      bounds: topHotspot ? topHotspot.bounds : null,
    });
  }

  if (layoutGateFailures.length && topHotspot) {
    const region = regionForHotspot(job, topHotspot);
    suggestions.push({
      id: "refine-layout-1",
      kind: "nudge-layout",
      confidence: Math.min(0.95, 0.58 + (1 - Math.min(diffMetrics.layoutSimilarity, diffMetrics.structureSimilarity))),
      message: region
        ? `布局/结构门槛未通过。先复看参考图，只修改 ${region.id} 所在父级的尺寸、位置、圆角和间距，再重新导出目标预览。`
        : "布局/结构门槛未通过。先复看参考图，只修改一个主要区块父级的尺寸、位置、圆角和间距，再重新导出目标预览。",
      bounds: topHotspot.bounds,
    });
  }

  if (edgeGateFailures.length) {
    suggestions.push({
      id: "refine-text-1",
      kind: "nudge-text",
      confidence: Math.min(0.95, 0.54 + (1 - diffMetrics.edgeSimilarity)),
      message:
        "边界/文本门槛仍未通过。先锁定结构不动，只收紧字号、字重、文案、线条和层级，不要同时再改多个容器。",
      bounds: topHotspot ? topHotspot.bounds : null,
    });
  }

  if (!suggestions.length || (!hasHardGateFailures(diffMetrics) && diffMetrics.compositeScore >= 0.9)) {
    suggestions.push({
      id: "refine-review-1",
      kind: "manual-review",
      confidence: !hasHardGateFailures(diffMetrics) && diffMetrics.compositeScore >= 0.9 ? 0.92 : 0.55,
      message:
        !hasHardGateFailures(diffMetrics) && diffMetrics.compositeScore >= 0.9
          ? "当前结果已通过硬门槛，先做人眼复核；若局部仍不对，只做单区域小步修正。"
          : "当前建议已不足以安全自动推进。请先并排复看参考图和当前 render，再决定下一轮仅修改哪个局部。",
      bounds: topHotspot ? topHotspot.bounds : null,
    });
  }

  return suggestions.slice(0, 4);
}
