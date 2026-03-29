import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = path.join(repoRoot, "scripts", "create-acceptance-preflight.mjs");

function pngDataUrl(contents: string) {
  return `data:image/png;base64,${Buffer.from(contents, "utf8").toString("base64")}`;
}

async function withTempRoot<T>(run: (tempRoot: string, fixtureDir: string) => Promise<T>) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "autodesign-acceptance-preflight-"));
  const fixtureDir = await mkdtemp(path.join(os.tmpdir(), "autodesign-acceptance-preflight-fixture-"));
  try {
    return await run(tempRoot, fixtureDir);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
    await rm(fixtureDir, { recursive: true, force: true });
  }
}

test("create_acceptance_preflight writes snapshot, summary and preview artifacts for the selected session", async () => {
  await withTempRoot(async (tempRoot, fixtureDir) => {
    await writeFile(
      path.join(fixtureDir, "get__api__plugin-bridge.json"),
      JSON.stringify(
        {
          sessions: [
            {
              id: "session_1",
              label: "AutoDesign",
              pluginVersion: "0.2.0",
              editorType: "figma",
              fileName: "Demo File",
              pageName: "Page A",
              status: "online",
              lastSeenAt: "2026-03-23T12:00:00.000Z",
              lastHandshakeAt: "2026-03-23T12:00:00.000Z",
              runtimeFeatures: { supportsExplicitNodeTargeting: true },
              capabilities: [{ id: "selection.refresh" }, { id: "nodes.inspect-subtree" }],
              selection: [
                {
                  id: "1:2",
                  name: "Hero Card",
                  type: "FRAME",
                  fillable: true,
                  fills: [],
                  fillStyleId: null,
                  previewDataUrl: pngDataUrl("preview-1"),
                },
                {
                  id: "1:3",
                  name: "No Preview",
                  type: "GROUP",
                  fillable: false,
                  fills: [],
                  fillStyleId: null,
                },
              ],
            },
          ],
          commands: [],
        },
        null,
        2,
      ),
      "utf8",
    );

    const timestamp = "20260323-231500";
    const { stdout } = await execFileAsync(process.execPath, [scriptPath, "--timestamp", timestamp], {
      cwd: repoRoot,
      env: {
        ...process.env,
        AUTODESIGN_REPORT_ROOT: tempRoot,
        AUTODESIGN_API_FIXTURE_DIR: fixtureDir,
      },
    });

    const artifactRoot = path.join(tempRoot, "reports", "acceptance", "artifacts", timestamp);
    const snapshot = JSON.parse(await readFile(path.join(artifactRoot, "plugin-bridge-snapshot.json"), "utf8"));
    const summary = await readFile(path.join(artifactRoot, "preflight-summary.txt"), "utf8");
    const preview = await readFile(path.join(artifactRoot, "0-hero-card.png"));

    assert.equal(snapshot.sessions[0]?.id, "session_1");
    assert.match(summary, /scenario: live-figma-bridge/);
    assert.match(summary, /supportsExplicitNodeTargeting: yes/);
    assert.match(summary, /selectionCount: 2/);
    assert.equal(preview.toString("utf8"), "preview-1");
    assert.match(stdout, /acceptance preflight created: reports\/acceptance\/artifacts\/20260323-231500\/plugin-bridge-snapshot\.json/);
  });
});

test("create_acceptance_preflight rejects when no plugin session is available", async () => {
  await withTempRoot(async (tempRoot, fixtureDir) => {
    await writeFile(
      path.join(fixtureDir, "get__api__plugin-bridge.json"),
      JSON.stringify({ sessions: [], commands: [] }, null, 2),
      "utf8",
    );

    await assert.rejects(
      () =>
        execFileAsync(process.execPath, [scriptPath], {
          cwd: repoRoot,
          env: {
            ...process.env,
            AUTODESIGN_REPORT_ROOT: tempRoot,
            AUTODESIGN_API_FIXTURE_DIR: fixtureDir,
          },
        }),
      (error: Error & { stderr?: string }) => {
        assert.match(String(error.stderr || ""), /当前没有在线插件会话/);
        return true;
      },
    );
  });
});

test("create_acceptance_preflight captures runtime read artifacts for the runtime-read-live scenario", async () => {
  await withTempRoot(async (tempRoot, fixtureDir) => {
    await writeFile(
      path.join(fixtureDir, "get__api__plugin-bridge.json"),
      JSON.stringify(
        {
          sessions: [
            {
              id: "session_runtime",
              label: "AutoDesign",
              pluginVersion: "0.2.0",
              editorType: "figma",
              fileName: "Runtime Read File",
              pageName: "Runtime",
              status: "online",
              lastSeenAt: "2026-03-23T12:30:00.000Z",
              lastHandshakeAt: "2026-03-23T12:30:00.000Z",
              runtimeFeatures: { supportsExplicitNodeTargeting: true },
              capabilities: [{ id: "selection.refresh" }, { id: "nodes.inspect-subtree" }],
              selection: [
                {
                  id: "2:1",
                  name: "Runtime Hero",
                  type: "FRAME",
                  fillable: true,
                  fills: [],
                  fillStyleId: null,
                  previewDataUrl: pngDataUrl("runtime-preview"),
                },
              ],
            },
          ],
          commands: [],
        },
        null,
        2,
      ),
      "utf8",
    );
    await writeFile(
      path.join(fixtureDir, "get__api__runtime__bridge-overview.json"),
      JSON.stringify({
        sessionCount: 1,
        onlineSessionCount: 1,
        staleSessionCount: 0,
        commandCounts: { queued: 0, claimed: 0, succeeded: 0, failed: 0 },
        sessions: [],
        commands: [],
      }, null, 2),
      "utf8",
    );
    await writeFile(
      path.join(fixtureDir, "post__api__runtime__design-context.json"),
      JSON.stringify({
        selectionIds: [],
        primarySelectionId: null,
        metadata: [],
        contextPack: { selectionIds: [], graphKind: "codegraph", action: "codegraph/summarize" },
        designContext: { sources: [], screens: [], componentMappings: [], reviewItems: [] },
        variableDefs: { available: true, source: "plugin-session-variable-snapshot", note: "ok", collections: [], colors: [], spacing: [], variables: [] },
        pluginSelection: {
          targetSessionId: "session_runtime",
          primarySelectionNodeId: "2:1",
          available: true,
          source: "plugin-selection-summary",
          note: "ok",
          selectionNodeIds: ["2:1"],
          selection: [],
          dependencies: { resolvedStyles: [], resolvedVariables: [], unresolvedStyleIds: [], unresolvedVariableIds: [] },
        },
      }, null, 2),
      "utf8",
    );
    await writeFile(
      path.join(fixtureDir, "post__api__runtime__variable-defs.json"),
      JSON.stringify({
        selectionIds: [],
        primarySelectionId: null,
        variableDefs: { available: true, source: "plugin-session-variable-snapshot", note: "ok", collections: [], colors: ["Colors/primary = #0F172A"], spacing: [], variables: [] },
      }, null, 2),
      "utf8",
    );
    await writeFile(
      path.join(fixtureDir, "post__api__runtime__node-metadata.json"),
      JSON.stringify({
        targetSessionId: "session_runtime",
        nodeId: "2:1",
        available: true,
        source: "session-selection-summary",
        note: "using cached selection summary",
        node: { id: "2:1", name: "Runtime Hero" },
        subtree: [{ id: "2:1", name: "Runtime Hero" }],
        resolvedStyleBindings: [],
        resolvedVariables: [],
        unresolvedVariableIds: [],
        subtreeResolvedStyles: [],
        subtreeResolvedVariables: [],
        subtreeUnresolvedStyleIds: [],
        subtreeUnresolvedVariableIds: [],
      }, null, 2),
      "utf8",
    );
    await writeFile(
      path.join(fixtureDir, "post__api__runtime__screenshot.json"),
      JSON.stringify({
        targetSessionId: "session_runtime",
        nodeId: "2:1",
        available: true,
        source: "session-selection-preview",
        note: null,
        screenshot: {
          mimeType: "image/png",
          width: 1,
          height: 1,
          dataUrl: pngDataUrl("runtime-screenshot"),
        },
        artifactPath: path.join(tempRoot, "reports", "acceptance", "artifacts", "20260323-232000", "runtime-screenshot-runtime-hero.png"),
      }, null, 2),
      "utf8",
    );

    const timestamp = "20260323-232000";
    const { stdout } = await execFileAsync(
      process.execPath,
      [scriptPath, "--timestamp", timestamp, "--scenario", "runtime-read-live"],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          AUTODESIGN_REPORT_ROOT: tempRoot,
          AUTODESIGN_API_FIXTURE_DIR: fixtureDir,
        },
      },
    );

    const artifactRoot = path.join(tempRoot, "reports", "acceptance", "artifacts", timestamp);
    const summary = await readFile(path.join(artifactRoot, "preflight-summary.txt"), "utf8");
    const designContext = JSON.parse(await readFile(path.join(artifactRoot, "runtime-design-context.json"), "utf8"));
    const variableDefs = JSON.parse(await readFile(path.join(artifactRoot, "runtime-variable-defs.json"), "utf8"));
    const nodeMetadata = JSON.parse(await readFile(path.join(artifactRoot, "runtime-node-metadata-runtime-hero.json"), "utf8"));
    const screenshotJson = JSON.parse(await readFile(path.join(artifactRoot, "runtime-screenshot-runtime-hero.json"), "utf8"));
    const screenshotPng = await readFile(path.join(artifactRoot, "runtime-screenshot-runtime-hero.png"));

    assert.equal(designContext.pluginSelection.targetSessionId, "session_runtime");
    assert.deepEqual(variableDefs.variableDefs.colors, ["Colors/primary = #0F172A"]);
    assert.equal(nodeMetadata.node.id, "2:1");
    assert.equal(screenshotJson.nodeId, "2:1");
    assert.equal(screenshotPng.toString("utf8"), "runtime-screenshot");
    assert.match(summary, /scenario: runtime-read-live/);
    assert.match(summary, /runtimeReadArtifacts:/);
    assert.match(summary, /runtime-design-context\.json/);
    assert.match(stdout, /acceptance preflight created: reports\/acceptance\/artifacts\/20260323-232000\/runtime-design-context\.json/);
  });
});
