import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ReconstructionJobSnapshot } from "../../shared/reconstruction.js";
import { resolveDataDirectory } from "../runtime-paths.js";

const emptySnapshot: ReconstructionJobSnapshot = {
  jobs: [],
};

function resolveReconstructionPaths() {
  const dataDirectory = resolveDataDirectory();
  return {
    dataDirectory,
    reconstructionFile: path.join(dataDirectory, "autodesign-reconstruction-jobs.json"),
  };
}

async function ensureReconstructionFile() {
  const { dataDirectory, reconstructionFile } = resolveReconstructionPaths();
  await mkdir(dataDirectory, { recursive: true });

  try {
    await readFile(reconstructionFile, "utf8");
  } catch {
    await writeFile(reconstructionFile, JSON.stringify(emptySnapshot, null, 2), "utf8");
  }
}

export async function readReconstructionJobSnapshot(): Promise<ReconstructionJobSnapshot> {
  await ensureReconstructionFile();
  const { reconstructionFile } = resolveReconstructionPaths();
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const raw = await readFile(reconstructionFile, "utf8");
      return JSON.parse(raw) as ReconstructionJobSnapshot;
    } catch (error) {
      lastError = error;
      if (!(error instanceof SyntaxError) || attempt === 2) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Failed to read reconstruction snapshot.");
}

export async function writeReconstructionJobSnapshot(snapshot: ReconstructionJobSnapshot) {
  await ensureReconstructionFile();
  const { reconstructionFile } = resolveReconstructionPaths();
  const tempFile = `${reconstructionFile}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempFile, JSON.stringify(snapshot, null, 2), "utf8");
  await rename(tempFile, reconstructionFile);
  return snapshot;
}
