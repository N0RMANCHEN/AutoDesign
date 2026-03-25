import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { PluginBridgeSession, PluginNodeSummary } from "../shared/plugin-bridge.js";
import type { FigmaCapabilityCommand } from "../shared/plugin-contract.js";
import type {
  CreateReconstructionJobPayload,
  ReconstructionAnalysis,
  ReconstructionDiffMetrics,
} from "../shared/reconstruction.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimeModulePath = path.join(repoRoot, "server", "reconstruction-server-runtime.ts");
const storeModulePath = path.join(repoRoot, "server", "reconstruction-store.ts");

function createNode(id: string, overrides: Partial<PluginNodeSummary> = {}): PluginNodeSummary {
  return {
    id,
    name: id,
    type: "FRAME",
    fillable: true,
    fills: [],
    fillStyleId: null,
    width: 160,
    height: 90,
    ...overrides,
  };
}

function createSession(selection: PluginNodeSummary[]): PluginBridgeSession {
  return {
    id: "session-1",
    label: "Test Session",
    pluginVersion: "test",
    editorType: "figma",
    fileName: "Test File",
    pageName: "Page 1",
    status: "online",
    selection,
    lastSeenAt: new Date().toISOString(),
    lastHandshakeAt: new Date().toISOString(),
    runtimeFeatures: {
      supportsExplicitNodeTargeting: true,
    },
    capabilities: [],
  };
}

function createAnalysis(): ReconstructionAnalysis {
  return {
    previewDataUrl: "data:image/png;base64,ref",
    mimeType: "image/png",
    width: 160,
    height: 90,
    dominantColors: ["#0F172A", "#FF5500"],
    canonicalFrame: null,
    screenPlane: null,
    layoutRegions: [
      {
        id: "region-surface-1",
        kind: "surface",
        confidence: 0.92,
        bounds: { x: 0.1, y: 0.12, width: 0.5, height: 0.34 },
        fillHex: "#FF5500",
      },
    ],
    designSurfaces: [],
    vectorPrimitives: [],
    semanticNodes: [],
    designTokens: null,
    completionPlan: [],
    textCandidates: [
      {
        id: "text-1",
        confidence: 0.88,
        bounds: { x: 0.18, y: 0.6, width: 0.32, height: 0.1 },
        estimatedRole: "body",
      },
    ],
    textBlocks: [],
    ocrBlocks: [],
    textStyleHints: [],
    assetCandidates: [],
    completionZones: [],
    deprojectionNotes: [],
    styleHints: {
      theme: "dark",
      cornerRadiusHint: 12,
      shadowHint: "none",
      primaryColorHex: "#0F172A",
      accentColorHex: "#FF5500",
    },
    uncertainties: [],
  };
}

function createDiffMetrics(overrides: Partial<ReconstructionDiffMetrics> = {}): ReconstructionDiffMetrics {
  return {
    globalSimilarity: 0.95,
    colorDelta: 0.04,
    edgeSimilarity: 0.93,
    layoutSimilarity: 0.91,
    structureSimilarity: 0.92,
    hotspotAverage: 0.08,
    hotspotPeak: 0.12,
    hotspotCoverage: 0.07,
    compositeScore: 0.95,
    grade: "A",
    acceptanceGates: [
      {
        id: "gate-composite",
        label: "Composite score",
        metric: "compositeScore",
        comparator: "gte",
        threshold: 0.9,
        actual: 0.95,
        passed: true,
        hard: true,
      },
    ],
    hotspots: [],
    ...overrides,
  };
}

async function withTempRuntimeContext<T>(
  run: (
    runtime: typeof import("./reconstruction-server-runtime.js"),
    store: typeof import("./reconstruction-store.js"),
  ) => Promise<T>,
) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "autodesign-reconstruction-runtime-"));
  const previousCwd = process.cwd();
  process.chdir(tempDir);
  try {
    const testSuffix = `?test=${Date.now()}-${Math.random()}`;
    const runtime =
      (await import(`${pathToFileURL(runtimeModulePath).href}${testSuffix}`)) as typeof import("./reconstruction-server-runtime.js");
    const store =
      (await import(`${pathToFileURL(storeModulePath).href}${testSuffix}`)) as typeof import("./reconstruction-store.js");
    return await run(runtime, store);
  } finally {
    process.chdir(previousCwd);
    await rm(tempDir, { recursive: true, force: true });
  }
}

test("createReconstructionJobFromSelection resolves explicit nodes and records outpainting warning", async () => {
  await withTempRuntimeContext(async (runtime, store) => {
    const session = createSession([
      createNode("target-1"),
      createNode("reference-1", {
        type: "RECTANGLE",
        fills: ["image"],
        previewDataUrl: "data:image/png;base64,ref",
      }),
    ]);
    const payload: CreateReconstructionJobPayload = {
      targetSessionId: session.id,
      targetNodeId: "target-1",
      referenceNodeId: "reference-1",
      allowOutpainting: true,
    };

    const job = await runtime.createReconstructionJobFromSelection(session, payload);
    const persisted = await store.getReconstructionJob(job.id);

    assert.equal(job.targetNode.id, "target-1");
    assert.equal(job.referenceNode.id, "reference-1");
    assert.ok(job.warnings.includes("allowOutpainting 已记录，但当前 tranche 仅建立任务，不会实际生成补图。"));
    assert.equal(persisted?.id, job.id);
  });
});

test("createReconstructionJobFromSelection infers unique frame and image nodes from selection", async () => {
  await withTempRuntimeContext(async (runtime) => {
    const session = createSession([
      createNode("target-1"),
      createNode("reference-1", {
        type: "RECTANGLE",
        fills: ["image"],
        previewDataUrl: "data:image/png;base64,ref",
      }),
    ]);

    const job = await runtime.createReconstructionJobFromSelection(session, {
      targetSessionId: session.id,
    });

    assert.equal(job.targetNode.id, "target-1");
    assert.equal(job.referenceNode.id, "reference-1");
  });
});

test("resolveReconstructionNodes rejects ambiguous frame selection", async () => {
  await withTempRuntimeContext(async (runtime) => {
    const session = createSession([
      createNode("frame-1"),
      createNode("frame-2"),
      createNode("reference-1", {
        type: "RECTANGLE",
        fills: ["image"],
        previewDataUrl: "data:image/png;base64,ref",
      }),
    ]);

    assert.throws(
      () =>
        runtime.resolveReconstructionNodes(session, {
          targetSessionId: session.id,
        }),
      /没有找到唯一可用的目标 Frame/,
    );
  });
});

test("resolveLoopStopReason prioritizes target_reached over iteration and stagnation counters", async () => {
  await withTempRuntimeContext(async (runtime, store) => {
    const job = await store.createReconstructionJob(
      {
        targetSessionId: "session-1",
        strategy: "vector-reconstruction",
      },
      createNode("target-1"),
      createNode("reference-1", {
        type: "RECTANGLE",
        fills: ["image"],
        previewDataUrl: "data:image/png;base64,ref",
      }),
    );

    const stopReason = runtime.resolveLoopStopReason({
      ...job,
      status: "completed",
      diffScore: 0.95,
      diffMetrics: createDiffMetrics(),
      iterationCount: job.input.maxIterations,
      stagnationCount: 3,
    });

    assert.equal(stopReason, "target_reached");
  });
});

test("buildAutoRefineCommands maps actionable suggestions onto applied surface and text nodes", async () => {
  await withTempRuntimeContext(async (runtime, store) => {
    const baseJob = await store.createReconstructionJob(
      {
        targetSessionId: "session-1",
        strategy: "structural-preview",
      },
      createNode("target-1"),
      createNode("reference-1", {
        type: "RECTANGLE",
        fills: ["image"],
        previewDataUrl: "data:image/png;base64,ref",
      }),
    );

    const ops: FigmaCapabilityCommand[] = [
      {
        type: "capability",
        capabilityId: "nodes.create-frame",
        executionMode: "strict",
        payload: {
          width: 80,
          height: 30,
          x: 12,
          y: 14,
          parentNodeId: baseJob.targetNode.id,
        },
      },
      {
        type: "capability",
        capabilityId: "nodes.create-text",
        executionMode: "strict",
        payload: {
          content: "CTA",
          x: 22,
          y: 56,
          parentNodeId: baseJob.targetNode.id,
        },
      },
    ];

    const commands = runtime.buildAutoRefineCommands({
      ...baseJob,
      applyStatus: "applied",
      analysis: createAnalysis(),
      fontMatches: [
        {
          textCandidateId: "text-1",
          recommended: "SF Pro Display",
          candidates: ["SF Pro Display", "Arial"],
          confidence: 0.9,
        },
      ],
      rebuildPlan: {
        previewOnly: false,
        summary: [],
        ops,
      },
      appliedNodeIds: ["surface-node-1", "text-node-1"],
      refineSuggestions: [
        {
          id: "fill-1",
          kind: "nudge-fill",
          confidence: 0.82,
          message: "surface fill drifted",
          bounds: { x: 0.1, y: 0.12, width: 0.5, height: 0.34 },
        },
        {
          id: "layout-1",
          kind: "nudge-layout",
          confidence: 0.79,
          message: "surface bounds need tightening",
          bounds: { x: 0.14, y: 0.15, width: 0.44, height: 0.3 },
        },
        {
          id: "text-1",
          kind: "nudge-text",
          confidence: 0.86,
          message: "text alignment drifted",
          bounds: { x: 0.2, y: 0.58, width: 0.3, height: 0.1 },
        },
      ],
    });

    assert.deepEqual(commands.warnings, []);
    assert.deepEqual(
      commands.commands.map((command) => command.capabilityId),
      [
        "fills.set-fill",
        "geometry.set-position",
        "geometry.set-size",
        "geometry.set-position",
        "text.set-font-size",
        "text.set-font-family",
        "text.set-text-color",
      ],
    );
    assert.deepEqual(commands.commands[0].nodeIds, ["surface-node-1"]);
    assert.deepEqual(commands.commands[0].payload, { hex: "#FF5500" });
    assert.deepEqual(commands.commands[5].payload, { family: "SF Pro Display" });
    assert.deepEqual(commands.commands[6].payload, { hex: "#F5F7FF" });
  });
});
