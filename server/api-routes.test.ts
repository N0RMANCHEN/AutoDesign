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
