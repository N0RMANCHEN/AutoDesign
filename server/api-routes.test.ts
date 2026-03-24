import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverPath = path.join(repoRoot, "server", "index.ts");
const tsxLoaderPath = path.join(repoRoot, "node_modules", "tsx", "dist", "loader.mjs");

type RunningServer = {
  baseUrl: string;
  stop: () => Promise<void>;
};

function pngDataUrl(contents: string) {
  return `data:image/png;base64,${Buffer.from(contents, "utf8").toString("base64")}`;
}

async function getFreePort() {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to allocate test port"));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function waitForServer(baseUrl: string) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/plugin-bridge`);
      if (response.ok) {
        return;
      }
    } catch {
      // Retry until server starts listening.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for test server");
}

async function startServer(tempDir: string): Promise<RunningServer> {
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["--import", tsxLoaderPath, serverPath], {
    cwd: tempDir,
    env: {
      ...process.env,
      PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });

  try {
    await waitForServer(baseUrl);
  } catch (error) {
    child.kill("SIGTERM");
    throw new Error(
      `Failed to start test server: ${error instanceof Error ? error.message : "unknown error"}${stderr ? `\n${stderr}` : ""}`,
    );
  }

  return {
    baseUrl,
    stop: async () => {
      if (child.exitCode !== null) {
        return;
      }
      child.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        child.once("exit", () => resolve());
        setTimeout(() => {
          if (child.exitCode === null) {
            child.kill("SIGKILL");
          }
        }, 1000);
      });
    },
  };
}

async function withRunningServer<T>(run: (server: RunningServer) => Promise<T>) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "autodesign-api-routes-"));
  const server = await startServer(tempDir);
  try {
    return await run(server);
  } finally {
    await server.stop();
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function requestJson<T>(baseUrl: string, pathname: string, init?: RequestInit) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  const body = (await response.json()) as T;
  return { response, body };
}

async function registerSampleSession(baseUrl: string) {
  const payload = {
    sessionId: "session_test",
    label: "AutoDesign",
    pluginVersion: "0.2.0",
    editorType: "figma",
    fileName: "Demo File",
    pageName: "Page A",
    runtimeFeatures: {
      supportsExplicitNodeTargeting: true,
    },
    capabilities: [],
    selection: [
      {
        id: "target-1",
        name: "Target Frame",
        type: "FRAME",
        fillable: true,
        fills: [],
        fillStyleId: null,
        width: 160,
        height: 100,
      },
      {
        id: "reference-1",
        name: "Reference Image",
        type: "RECTANGLE",
        fillable: true,
        fills: ["image"],
        fillStyleId: null,
        width: 160,
        height: 100,
        previewDataUrl: pngDataUrl("reference-preview"),
      },
    ],
  };

  const { response, body } = await requestJson<any>(
    baseUrl,
    "/api/plugin-bridge/sessions/register",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
  assert.equal(response.status, 200);
  assert.equal(body.id, "session_test");
}

function createStructuredAnalysisPayload() {
  return {
    width: 160,
    height: 100,
    previewDataUrl: pngDataUrl("analysis-preview"),
    mimeType: "image/png",
    dominantColors: ["#111111", "#F5F7FF"],
    canonicalFrame: {
      width: 160,
      height: 100,
      fixedTargetFrame: true,
      deprojected: true,
      mappingMode: "reflow",
    },
    screenPlane: {
      extracted: true,
      excludesNonUiShell: true,
      confidence: 0.92,
      sourceQuad: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ],
      rectifiedPreviewDataUrl: pngDataUrl("reference-rectified"),
    },
    layoutRegions: [],
    designSurfaces: [
      {
        id: "surface-top-card",
        name: "Top Card",
        bounds: { x: 0.08, y: 0.08, width: 0.72, height: 0.46 },
        fillHex: "#6D6FD0",
        cornerRadius: 24,
        opacity: 1,
        shadow: "soft",
        inferred: false,
      },
    ],
    vectorPrimitives: [],
    semanticNodes: [],
    designTokens: null,
    completionPlan: [],
    textCandidates: [],
    textBlocks: [
      {
        id: "text-score",
        bounds: { x: 0.16, y: 0.18, width: 0.22, height: 0.12 },
        role: "metric",
        content: "37.5%",
        inferred: false,
        fontFamily: "SF Pro Display",
        fontStyle: "Bold",
        fontWeight: 700,
        fontSize: 24,
        lineHeight: 26,
        letterSpacing: 0,
        alignment: "left",
        colorHex: "#111111",
      },
    ],
    ocrBlocks: [],
    textStyleHints: [],
    assetCandidates: [],
    completionZones: [],
    deprojectionNotes: [],
    styleHints: {
      theme: "dark",
      cornerRadiusHint: 24,
      shadowHint: "soft",
      primaryColorHex: "#6D6FD0",
      accentColorHex: "#111111",
    },
    uncertainties: [],
  };
}

test("api_routes register plugin session and expose it through the bridge snapshot", async () => {
  await withRunningServer(async ({ baseUrl }) => {
    await registerSampleSession(baseUrl);

    const { response, body } = await requestJson<any>(baseUrl, "/api/plugin-bridge");
    assert.equal(response.status, 200);
    assert.equal(body.sessions.length, 1);
    assert.equal(body.sessions[0]?.id, "session_test");
    assert.equal(body.sessions[0]?.status, "online");
    assert.equal(body.sessions[0]?.selection[1]?.id, "reference-1");
  });
});

test("api_routes create, list and inspect a reconstruction job via HTTP", async () => {
  await withRunningServer(async ({ baseUrl }) => {
    await registerSampleSession(baseUrl);

    const created = await requestJson<any>(baseUrl, "/api/reconstruction/jobs", {
      method: "POST",
      body: JSON.stringify({
        targetSessionId: "session_test",
        strategy: "hybrid-reconstruction",
        targetNodeId: "target-1",
        referenceNodeId: "reference-1",
        allowOutpainting: true,
      }),
    });

    assert.equal(created.response.status, 200);
    assert.equal(created.body.input.targetSessionId, "session_test");
    assert.equal(created.body.input.strategy, "hybrid-reconstruction");
    assert.equal(created.body.targetNode.id, "target-1");
    assert.equal(created.body.referenceNode.id, "reference-1");
    assert.match(created.body.warnings[0] || "", /allowOutpainting 已记录/);

    const listed = await requestJson<any>(baseUrl, "/api/reconstruction/jobs");
    assert.equal(listed.response.status, 200);
    assert.equal(listed.body.jobs.length, 1);
    assert.equal(listed.body.jobs[0]?.id, created.body.id);

    const fetched = await requestJson<any>(baseUrl, `/api/reconstruction/jobs/${created.body.id}`);
    assert.equal(fetched.response.status, 200);
    assert.equal(fetched.body.id, created.body.id);
    assert.equal(fetched.body.status, "ready");
  });
});

test("api_routes build a reconstruction context pack from a created job", async () => {
  await withRunningServer(async ({ baseUrl }) => {
    await registerSampleSession(baseUrl);
    const created = await requestJson<any>(baseUrl, "/api/reconstruction/jobs", {
      method: "POST",
      body: JSON.stringify({
        targetSessionId: "session_test",
        strategy: "hybrid-reconstruction",
        targetNodeId: "target-1",
        referenceNodeId: "reference-1",
      }),
    });

    const contextPack = await requestJson<any>(
      baseUrl,
      `/api/reconstruction/jobs/${created.body.id}/context-pack`,
      {
        method: "POST",
      },
    );

    assert.equal(contextPack.response.status, 200);
    assert.equal(contextPack.body.jobId, created.body.id);
    assert.equal(contextPack.body.strategy, "hybrid-reconstruction");
    assert.equal(contextPack.body.referenceNode.id, "reference-1");
    assert.equal(contextPack.body.referencePreviewDataUrl, pngDataUrl("reference-preview"));
    assert.ok(Array.isArray(contextPack.body.guidance) && contextPack.body.guidance.length > 0);
  });
});

test("api_routes reject malformed reconstruction analysis submission and unknown routes", async () => {
  await withRunningServer(async ({ baseUrl }) => {
    await registerSampleSession(baseUrl);
    const created = await requestJson<any>(baseUrl, "/api/reconstruction/jobs", {
      method: "POST",
      body: JSON.stringify({
        targetSessionId: "session_test",
        strategy: "hybrid-reconstruction",
        targetNodeId: "target-1",
        referenceNodeId: "reference-1",
      }),
    });

    const invalidSubmit = await requestJson<any>(
      baseUrl,
      `/api/reconstruction/jobs/${created.body.id}/submit-analysis`,
      {
        method: "POST",
        body: JSON.stringify({}),
      },
    );
    assert.equal(invalidSubmit.response.status, 400);
    assert.match(invalidSubmit.body.error || "", /analysis is required/);

    const missingRoute = await requestJson<any>(baseUrl, "/api/reconstruction/unknown", {
      method: "POST",
      body: JSON.stringify({}),
    });
    assert.equal(missingRoute.response.status, 404);
    assert.equal(missingRoute.body.ok, false);
    assert.match(missingRoute.body.error || "", /Route not found/);
  });
});

test("api_routes expose reconstruction guide manifests, element scoring and design-task compatibility snapshots", async () => {
  await withRunningServer(async ({ baseUrl }) => {
    await registerSampleSession(baseUrl);
    const created = await requestJson<any>(baseUrl, "/api/reconstruction/jobs", {
      method: "POST",
      body: JSON.stringify({
        targetSessionId: "session_test",
        strategy: "vector-reconstruction",
        targetNodeId: "target-1",
        referenceNodeId: "reference-1",
      }),
    });

    const submitted = await requestJson<any>(
      baseUrl,
      `/api/reconstruction/jobs/${created.body.id}/submit-analysis`,
      {
        method: "POST",
        body: JSON.stringify({
          analysisVersion: "codex-v1",
          analysisProvider: "codex-assisted",
          analysis: createStructuredAnalysisPayload(),
        }),
      },
    );
    assert.equal(submitted.response.status, 200);

    const guideManifest = await requestJson<any>(
      baseUrl,
      `/api/reconstruction/jobs/${created.body.id}/guide-manifest`,
    );
    assert.equal(guideManifest.response.status, 200);
    assert.equal(guideManifest.body.jobId, created.body.id);
    assert.equal(guideManifest.body.images.referencePreviewDataUrl, pngDataUrl("reference-preview"));
    assert.equal(guideManifest.body.images.rectifiedPreviewDataUrl, pngDataUrl("reference-rectified"));
    assert.ok(Array.isArray(guideManifest.body.elements) && guideManifest.body.elements.length >= 2);

    const elementScores = await requestJson<any>(
      baseUrl,
      `/api/reconstruction/jobs/${created.body.id}/element-scores`,
      {
        method: "POST",
        body: JSON.stringify({
          inspectedNodes: [
            {
              id: "target-1",
              name: "Target Frame",
              type: "FRAME",
              fillable: true,
              fills: [],
              fillStyleId: null,
              x: 0,
              y: 0,
              absoluteX: 0,
              absoluteY: 0,
              width: 160,
              height: 100,
              depth: 0,
              childCount: 2,
              indexWithinParent: 0,
            },
            {
              id: "node-top-card",
              name: "Top Card",
              type: "FRAME",
              fillable: true,
              fills: ["#6D6FD0"],
              fillStyleId: null,
              x: 12.8,
              y: 8,
              absoluteX: 12.8,
              absoluteY: 8,
              width: 115.2,
              height: 46,
              parentNodeId: "target-1",
              parentNodeType: "FRAME",
              depth: 1,
              childCount: 1,
              indexWithinParent: 0,
              cornerRadius: 24,
              opacity: 1,
              analysisRefId: "surface-top-card",
              generatedBy: "reconstruction",
            },
            {
              id: "node-score",
              name: "37.5%",
              type: "TEXT",
              fillable: true,
              fills: ["#111111"],
              fillStyleId: null,
              x: 25.6,
              y: 18,
              absoluteX: 25.6,
              absoluteY: 18,
              width: 35.2,
              height: 12,
              parentNodeId: "node-top-card",
              parentNodeType: "FRAME",
              depth: 2,
              childCount: 0,
              indexWithinParent: 0,
              textContent: "37.5%",
              fontFamily: "SF Pro Display",
              fontStyle: "Bold",
              fontSize: 24,
              fontWeight: 700,
              textAlignment: "LEFT",
              analysisRefId: "text-score",
              generatedBy: "reconstruction",
            },
          ],
        }),
      },
    );
    assert.equal(elementScores.response.status, 200);
    assert.equal(elementScores.body.referencePreviewKind, "rectified");
    assert.equal(elementScores.body.liveNodeCount, 3);
    assert.ok(Array.isArray(elementScores.body.scores) && elementScores.body.scores.length >= 2);

    const designTask = await requestJson<any>(
      baseUrl,
      `/api/design-tasks/reconstruction-jobs/${created.body.id}`,
    );
    assert.equal(designTask.response.status, 200);
    assert.equal(designTask.body.mode, "restoration");
    assert.equal(designTask.body.intent.outputTarget, "figma-native");
    assert.ok(Array.isArray(designTask.body.scene.elements) && designTask.body.scene.elements.length >= 2);
    assert.equal(designTask.body.scorecard, null);
  });
});
