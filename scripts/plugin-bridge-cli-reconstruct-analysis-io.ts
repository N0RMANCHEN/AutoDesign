import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type {
  ReconstructionJob,
  ReconstructionPoint,
} from "../shared/reconstruction.js";

const execFileAsync = promisify(execFile);
const reconstructFixtureDirectory = process.env.AUTODESIGN_RECONSTRUCT_FIXTURE_DIR
  ? path.resolve(process.env.AUTODESIGN_RECONSTRUCT_FIXTURE_DIR)
  : null;

export type EstimatedScreenQuad = {
  rotationDegrees: number;
  rotatedBox: {
    x: number;
    y: number;
    width: number;
    height: number;
    density: number;
  };
  sourceQuadPixels: ReconstructionPoint[];
  debug?: {
    originalOverlayPath?: string;
    rotatedOverlayPath?: string;
  };
};

export type PreviewHeuristicAnalysis = {
  width: number;
  height: number;
  dominantColors?: string[];
  layoutRegions?: Array<{
    id?: string;
    kind?: string;
    confidence?: number;
    bounds?: { x: number; y: number; width: number; height: number };
    fillHex?: string | null;
  }>;
  textCandidates?: Array<{
    id?: string;
    confidence?: number;
    bounds?: { x: number; y: number; width: number; height: number };
    estimatedRole?: "headline" | "body" | "metric" | "label" | "unknown";
  }>;
  textStyleHints?: Array<{
    textCandidateId?: string;
    role?: "headline" | "body" | "metric" | "label" | "unknown";
    fontCategory?: string;
    fontWeightGuess?: number | null;
    fontSizeEstimate?: number | null;
    colorHex?: string | null;
    alignmentGuess?: "left" | "center" | "right" | "justified" | "unknown";
    lineHeightEstimate?: number | null;
    letterSpacingEstimate?: number | null;
    confidence?: number;
  }>;
  assetCandidates?: unknown[];
  styleHints?: {
    theme?: "light" | "dark";
    cornerRadiusHint?: number;
    shadowHint?: "none" | "soft";
    primaryColorHex?: string | null;
    accentColorHex?: string | null;
  };
  uncertainties?: string[];
};

export type VisionOcrLine = {
  text: string;
  confidence: number;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

function fail(message: string): never {
  throw new Error(message);
}

function buildFixtureFileName(prefix: string, key: string, extension: string) {
  return `${prefix}__${sanitizeFileSegment(key)}.${extension}`;
}

async function readFixtureBuffer(fileName: string) {
  if (!reconstructFixtureDirectory) {
    return null;
  }

  try {
    return await readFile(path.join(reconstructFixtureDirectory, fileName));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function readFixtureJson<T>(fileName: string) {
  const buffer = await readFixtureBuffer(fileName);
  if (!buffer) {
    return null;
  }
  return JSON.parse(buffer.toString("utf8")) as T;
}

export function sanitizeFileSegment(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "selection";
}

export function decodeDataUrl(dataUrl: string) {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl);
  if (!match) {
    fail("无效的 data URL。");
  }

  const mimeType = match[1];
  const buffer = Buffer.from(match[2], "base64");
  const extension = mimeType === "image/jpeg" ? "jpg" : mimeType === "image/png" ? "png" : "img";
  return { buffer, extension };
}

export function parseSourceQuadPixels(sourceQuadRaw: string | null): ReconstructionPoint[] {
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

export function normalizeSourceQuad(points: ReconstructionPoint[], width: number, height: number) {
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

export async function writeRemapPreview(
  job: ReconstructionJob,
  sourceQuadPixels: ReconstructionPoint[],
  outputDirectory: string,
) {
  const referenceDataUrl = resolveReconstructionReferenceDataUrl(job);
  if (!referenceDataUrl) {
    fail("当前 job 缺少 referenceRaster / previewDataUrl，无法生成 remap preview。");
  }

  const reference = decodeDataUrl(referenceDataUrl);
  const baseName = sanitizeFileSegment(job.id);
  const inputPath = path.join(outputDirectory, `${baseName}-remap-source.${reference.extension}`);
  const outputPath = path.join(outputDirectory, `${baseName}-remap-preview.png`);
  await writeFile(inputPath, reference.buffer);
  const fixtureBuffer = await readFixtureBuffer(
    buildFixtureFileName("reconstruct-remap-preview", baseName, "png"),
  );
  if (fixtureBuffer) {
    await writeFile(outputPath, fixtureBuffer);
    return outputPath;
  }

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

export async function estimateSourceQuadPixels(job: ReconstructionJob, outputDirectory: string): Promise<EstimatedScreenQuad> {
  const referenceDataUrl = resolveReconstructionReferenceDataUrl(job);
  if (!referenceDataUrl) {
    fail("当前 job 缺少 referenceRaster / previewDataUrl，无法自动估计 sourceQuad。");
  }

  const reference = decodeDataUrl(referenceDataUrl);
  const baseName = sanitizeFileSegment(job.id);
  const inputPath = path.join(outputDirectory, `${baseName}-estimate-source.${reference.extension}`);
  const debugPrefix = path.join(outputDirectory, `${baseName}-estimate`);
  await writeFile(inputPath, reference.buffer);
  const fixture = await readFixtureJson<EstimatedScreenQuad>(
    buildFixtureFileName("estimate-screen-quad", baseName, "json"),
  );
  if (fixture) {
    return fixture;
  }

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

export async function runPreviewHeuristicAnalysis(imagePath: string): Promise<PreviewHeuristicAnalysis> {
  const fixture = await readFixtureJson<PreviewHeuristicAnalysis>(
    buildFixtureFileName("preview-heuristic", path.basename(imagePath, path.extname(imagePath)), "json"),
  );
  if (fixture) {
    return fixture;
  }

  const scriptPath = path.join(process.cwd(), "scripts", "analyze_reference_preview.py");
  const { stdout } = await execFileAsync("python3", [scriptPath, imagePath]);
  return JSON.parse(stdout) as PreviewHeuristicAnalysis;
}

export async function runVisionOcr(imagePath: string): Promise<VisionOcrLine[]> {
  const fixture = await readFixtureJson<VisionOcrLine[]>(
    buildFixtureFileName("vision-ocr", path.basename(imagePath, path.extname(imagePath)), "json"),
  );
  if (fixture) {
    return fixture;
  }

  const scriptPath = path.join(process.cwd(), "scripts", "ocr_preview_vision.swift");
  const { stdout } = await execFileAsync("/usr/bin/xcrun", ["swift", scriptPath, imagePath], {
    cwd: process.cwd(),
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout) as VisionOcrLine[];
}

export async function encodeImageFileAsDataUrl(filePath: string) {
  const buffer = await readFile(filePath);
  return `data:image/png;base64,${buffer.toString("base64")}`;
}
