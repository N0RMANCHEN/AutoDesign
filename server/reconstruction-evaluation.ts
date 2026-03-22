import { execFile } from "node:child_process";
import { writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import type {
  ReconstructionBounds,
  ReconstructionDiffHotspot,
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

function clampScore(value: unknown) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, Number(value)));
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

export function buildRefineSuggestions(
  job: ReconstructionJob,
  diffMetrics: ReconstructionDiffMetrics,
): ReconstructionRefineSuggestion[] {
  const suggestions: ReconstructionRefineSuggestion[] = [];
  const topHotspot = diffMetrics.hotspots[0] || null;

  if (diffMetrics.colorDelta > 0.12) {
    suggestions.push({
      id: "refine-fill-1",
      kind: "nudge-fill",
      confidence: Math.min(0.95, 0.45 + diffMetrics.colorDelta),
      message: "主色偏差仍然明显，下一轮优先收敛背景区块与强调色块的 fill。",
      bounds: topHotspot ? topHotspot.bounds : null,
    });
  }

  if (diffMetrics.layoutSimilarity < 0.88 && topHotspot) {
    const region = regionForHotspot(job, topHotspot);
    suggestions.push({
      id: "refine-layout-1",
      kind: "nudge-layout",
      confidence: Math.min(0.95, 0.55 + (1 - diffMetrics.layoutSimilarity)),
      message: region
        ? `热点区域仍有明显错位，优先调整 ${region.id} 的尺寸和位置。`
        : "热点区域仍有明显错位，优先调整主要区块的尺寸和位置。",
      bounds: topHotspot.bounds,
    });
  }

  if (diffMetrics.edgeSimilarity < 0.86) {
    suggestions.push({
      id: "refine-text-1",
      kind: "nudge-text",
      confidence: Math.min(0.95, 0.5 + (1 - diffMetrics.edgeSimilarity)),
      message: "文本或边界轮廓还不够接近，下一轮优先收敛字号、占位文案和层级关系。",
      bounds: topHotspot ? topHotspot.bounds : null,
    });
  }

  if (!suggestions.length || diffMetrics.globalSimilarity >= 0.9) {
    suggestions.push({
      id: "refine-review-1",
      kind: "manual-review",
      confidence: diffMetrics.globalSimilarity >= 0.9 ? 0.92 : 0.55,
      message:
        diffMetrics.globalSimilarity >= 0.9
          ? "当前结果已达到 tranche 阈值，可进入人工复核或下一阶段精修。"
          : "当前差异已收敛到中低水平，可先人工确认是否进入下一轮自动修正。",
      bounds: topHotspot ? topHotspot.bounds : null,
    });
  }

  return suggestions.slice(0, 4);
}
