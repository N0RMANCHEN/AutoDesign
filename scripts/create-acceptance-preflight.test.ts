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
