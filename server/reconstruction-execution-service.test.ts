import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { PluginNodeSummary } from "../shared/plugin-bridge.js";
import type {
  ReconstructionJob,
  ReconstructionRasterAsset,
  ReconstructionStructureReport,
} from "../shared/reconstruction.js";
import type { ReconstructionExecutionServiceDeps } from "./reconstruction-execution-service.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const storeModulePath = path.join(repoRoot, "server", "reconstruction-store.ts");
const serviceModulePath = path.join(repoRoot, "server", "reconstruction-execution-service.ts");

function createNode(id: string): PluginNodeSummary {
  return {
    id,
    name: id,
    type: "FRAME",
    fillable: true,
    fills: [],
    fillStyleId: null,
    width: 120,
    height: 80,
  };
}

function createReferenceRaster(): ReconstructionRasterAsset {
  return {
    nodeId: "reference-1",
    mimeType: "image/png",
    width: 120,
    height: 80,
    dataUrl:
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0uoAAAAASUVORK5CYII=",
    source: "node-export",
  };
}

async function withTempExecutionContext<T>(
  run: (
    store: typeof import("./reconstruction-store.js"),
    service: typeof import("./reconstruction-execution-service.js"),
  ) => Promise<T>,
) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "autodesign-reconstruction-execution-"));
  const previousCwd = process.cwd();
  process.chdir(tempDir);
  try {
    const testSuffix = `?test=${Date.now()}-${Math.random()}`;
    const store = (await import(`${pathToFileURL(storeModulePath).href}${testSuffix}`)) as typeof import("./reconstruction-store.js");
    const service = (await import(`${pathToFileURL(serviceModulePath).href}${testSuffix}`)) as typeof import("./reconstruction-execution-service.js");
    return await run(store, service);
  } finally {
    process.chdir(previousCwd);
    await rm(tempDir, { recursive: true, force: true });
  }
}

function createDeps(
  overrides: Partial<ReconstructionExecutionServiceDeps>,
): ReconstructionExecutionServiceDeps {
  const fail = async () => {
    throw new Error("unexpected dependency call");
  };

  return {
    isRasterExactJob: () => false,
    isVectorReconstructionJob: () => false,
    isHybridReconstructionJob: () => false,
    ensureRasterReference: fail,
    ensureVectorReference: fail,
    ensureHybridReference: fail,
    queueAndWaitForPluginBatch: fail,
    normalizeRebuildCommands: fail,
    assertSuccessfulCommandRecord: () => [],
    collectChangedNodeIds: () => [],
    uniqueStrings: (values) => [...new Set(values)],
    inspectFrameSubtree: fail,
    isReconstructionGeneratedInspectionNode: () => false,
    exportSingleNodeImage: fail,
    resolveReferencePreviewForMeasurement: fail,
    buildStructureReport: () => null,
    requireLoopCompatibleSession: fail,
    resolveLoopStopReason: () => null,
    buildAutoRefineCommands: () => ({ commands: [], warnings: [] }),
    ...overrides,
  };
}

test("analyzeReconstructionJob routes raster-exact jobs through deterministic reference preparation", async () => {
  await withTempExecutionContext(async (store, service) => {
    const job = await store.createReconstructionJob(
      {
        targetSessionId: "session-1",
        strategy: "raster-exact",
      },
      createNode("target-1"),
      createNode("reference-1"),
    );
    const loaded = await store.getReconstructionJob(job.id);
    if (!loaded) {
      throw new Error("expected job to exist");
    }

    let ensureCalls = 0;
    const updated = await service.analyzeReconstructionJob(
      job.id,
      loaded,
      createDeps({
        isRasterExactJob: () => true,
        ensureRasterReference: async () => {
          ensureCalls += 1;
          return createReferenceRaster();
        },
      }),
    );

    assert.equal(ensureCalls, 1);
    assert.equal(updated.analysisVersion, "raster-exact-v1");
    assert.equal(updated.approvalState, "approved");
    assert.equal(updated.currentStageId, "apply-rebuild");
  });
});

test("renderReconstructionJob persists exported preview dimensions and structure report", async () => {
  await withTempExecutionContext(async (store, service) => {
    const job = await store.createReconstructionJob(
      {
        targetSessionId: "session-1",
        strategy: "vector-reconstruction",
      },
      createNode("target-1"),
      createNode("reference-1"),
    );
    const loaded = await store.getReconstructionJob(job.id);
    if (!loaded) {
      throw new Error("expected job to exist");
    }

    const structureReport: ReconstructionStructureReport = {
      targetFramePreserved: true,
      imageFillNodeCount: 0,
      textNodeCount: 3,
      vectorNodeCount: 4,
      inferredTextCount: 0,
      passed: true,
      issues: [],
    };

    const updated = await service.renderReconstructionJob(
      job.id,
      loaded,
      createDeps({
        exportSingleNodeImage: async () => ({
          kind: "node-image",
          nodeId: loaded.targetNode.id,
          mimeType: "image/png",
          width: 240,
          height: 160,
          dataUrl: createReferenceRaster().dataUrl,
          source: "node-export",
        }),
        buildStructureReport: () => structureReport,
      }),
    );

    assert.equal(updated.renderedPreview?.width, 240);
    assert.equal(updated.renderedPreview?.height, 160);
    assert.equal(updated.targetNode.width, 240);
    assert.equal(updated.targetNode.height, 160);
    assert.deepEqual(updated.structureReport, structureReport);
  });
});
