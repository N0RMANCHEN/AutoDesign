import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { PluginBridgeSession, PluginNodeSummary } from "../shared/plugin-bridge.js";
import type { CreateReconstructionJobPayload } from "../shared/reconstruction.js";

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
