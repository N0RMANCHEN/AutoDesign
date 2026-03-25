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
const scriptPath = path.join(repoRoot, "scripts", "prepare-live-acceptance.mjs");

function pngDataUrl(contents: string) {
  return `data:image/png;base64,${Buffer.from(contents, "utf8").toString("base64")}`;
}

async function withTempRoot<T>(run: (tempRoot: string, fixtureDir: string) => Promise<T>) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "autodesign-acceptance-prepare-"));
  const fixtureDir = await mkdtemp(path.join(os.tmpdir(), "autodesign-acceptance-prepare-fixture-"));
  try {
    return await run(tempRoot, fixtureDir);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
    await rm(fixtureDir, { recursive: true, force: true });
  }
}

test("prepare_live_acceptance scaffolds report and preflight artifacts with the same timestamp", async () => {
  await withTempRoot(async (tempRoot, fixtureDir) => {
    await writeFile(
      path.join(fixtureDir, "get__api__plugin-bridge.json"),
      JSON.stringify(
        {
          sessions: [
            {
              id: "session_preflight",
              label: "AutoDesign",
              pluginVersion: "0.2.0",
              editorType: "figma",
              fileName: "Demo File",
              pageName: "Acceptance",
              status: "online",
              lastSeenAt: "2026-03-23T13:00:00.000Z",
              lastHandshakeAt: "2026-03-23T13:00:00.000Z",
              runtimeFeatures: { supportsExplicitNodeTargeting: true },
              capabilities: [{ id: "selection.refresh" }],
              selection: [
                {
                  id: "5:1",
                  name: "Target Frame",
                  type: "FRAME",
                  fillable: true,
                  fills: [],
                  fillStyleId: null,
                  previewDataUrl: pngDataUrl("acceptance-preview"),
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

    const timestamp = "20260323-233000";
    const { stdout } = await execFileAsync(
      process.execPath,
      [scriptPath, "--timestamp", timestamp, "--owner", "hirohi"],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          AUTODESIGN_REPORT_ROOT: tempRoot,
          AUTODESIGN_API_FIXTURE_DIR: fixtureDir,
        },
      },
    );

    const reportJson = JSON.parse(
      await readFile(path.join(tempRoot, "reports", "acceptance", `acceptance-${timestamp}.json`), "utf8"),
    );
    const reportMarkdown = await readFile(
      path.join(tempRoot, "reports", "acceptance", `acceptance-${timestamp}.md`),
      "utf8",
    );
    const preflightSummary = await readFile(
      path.join(tempRoot, "reports", "acceptance", "artifacts", timestamp, "preflight-summary.txt"),
      "utf8",
    );

    assert.equal(reportJson.owner, "hirohi");
    assert.equal(reportJson.status, "PENDING");
    assert.deepEqual(reportJson.artifacts, [
      `reports/acceptance/artifacts/${timestamp}/preflight-summary.txt`,
      `reports/acceptance/artifacts/${timestamp}/plugin-bridge-snapshot.json`,
      `reports/acceptance/artifacts/${timestamp}/0-target-frame.png`,
    ]);
    assert.match(reportMarkdown, /Status: `PENDING`/);
    assert.match(reportMarkdown, /reports\/acceptance\/artifacts\/20260323-233000\/preflight-summary\.txt/);
    assert.match(preflightSummary, /session: session_preflight/);
    assert.match(stdout, /\[acceptance:prep] ready/);
    assert.match(stdout, /\[acceptance:prep] status: PENDING/);
    assert.match(stdout, /reports\/acceptance\/acceptance-20260323-233000\.md/);
  });
});

test("prepare_live_acceptance leaves a pending report behind when preflight fails", async () => {
  await withTempRoot(async (tempRoot, fixtureDir) => {
    await writeFile(
      path.join(fixtureDir, "get__api__plugin-bridge.json"),
      JSON.stringify({ sessions: [], commands: [] }, null, 2),
      "utf8",
    );

    const timestamp = "20260323-233500";
    await assert.rejects(
      () =>
        execFileAsync(process.execPath, [scriptPath, "--timestamp", timestamp, "--owner", "hirohi"], {
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

    const reportJson = JSON.parse(
      await readFile(path.join(tempRoot, "reports", "acceptance", `acceptance-${timestamp}.json`), "utf8"),
    );
    assert.equal(reportJson.status, "PENDING");
    assert.deepEqual(reportJson.artifacts, []);
  });
});
