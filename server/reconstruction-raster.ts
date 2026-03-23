import { execFile } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import type { ReconstructionJob, ReconstructionPoint, ReconstructionRasterAsset } from "../shared/reconstruction.js";

const execFileAsync = promisify(execFile);

function parseDataUrl(dataUrl: string) {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl);
  if (!match) {
    throw new Error("参考图 dataUrl 格式无效。");
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

function normalizeQuadToPixels(
  quad: ReconstructionPoint[],
  width: number,
  height: number,
) {
  return quad.slice(0, 4).map((point) => ({
    x: Math.max(0, Math.min(width, point.x * width)),
    y: Math.max(0, Math.min(height, point.y * height)),
  }));
}

export async function remapHybridReferenceRaster(
  job: ReconstructionJob,
): Promise<ReconstructionRasterAsset | null> {
  const referenceRaster = job.referenceRaster;
  const sourceQuad = job.analysis?.canonicalFrame?.sourceQuad;
  if (!referenceRaster || !sourceQuad || sourceQuad.length !== 4) {
    return null;
  }

  const { bytes, mimeType } = parseDataUrl(referenceRaster.dataUrl);
  const targetWidth = Math.max(
    1,
    Math.round(job.targetNode.width || job.analysis?.canonicalFrame?.width || job.analysis?.width || referenceRaster.width),
  );
  const targetHeight = Math.max(
    1,
    Math.round(job.targetNode.height || job.analysis?.canonicalFrame?.height || job.analysis?.height || referenceRaster.height),
  );
  const pixelQuad = normalizeQuadToPixels(sourceQuad, referenceRaster.width, referenceRaster.height);

  const tempInputPath = path.join(
    os.tmpdir(),
    `autodesign-remap-reference-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${extensionForMimeType(mimeType)}`,
  );
  const tempOutputPath = path.join(
    os.tmpdir(),
    `autodesign-remap-output-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`,
  );

  try {
    await writeFile(tempInputPath, bytes);
    const scriptPath = path.join(process.cwd(), "scripts", "remap_reference_image.py");
    await execFileAsync(
      "python3",
      [scriptPath, tempInputPath, tempOutputPath, String(targetWidth), String(targetHeight), JSON.stringify(pixelQuad)],
      {
        cwd: process.cwd(),
        maxBuffer: 10 * 1024 * 1024,
      },
    );
    const remappedBytes = await readFile(tempOutputPath);
    return {
      nodeId: referenceRaster.nodeId,
      mimeType: "image/png",
      width: targetWidth,
      height: targetHeight,
      dataUrl: `data:image/png;base64,${remappedBytes.toString("base64")}`,
      source: referenceRaster.source,
    };
  } finally {
    await Promise.allSettled([rm(tempInputPath, { force: true }), rm(tempOutputPath, { force: true })]);
  }
}
