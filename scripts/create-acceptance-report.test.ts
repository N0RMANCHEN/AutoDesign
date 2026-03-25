import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = path.join(repoRoot, "scripts", "create-acceptance-report.mjs");

async function withTempRoot<T>(run: (tempRoot: string) => Promise<T>) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "autodesign-acceptance-report-"));
  try {
    return await run(tempRoot);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

test("create_acceptance_report scaffolds markdown and json files for the live figma bridge scenario", async () => {
  await withTempRoot(async (tempRoot) => {
    const timestamp = "20260323-230000";
    const { stdout } = await execFileAsync(process.execPath, [scriptPath, "--timestamp", timestamp], {
      cwd: repoRoot,
      env: {
        ...process.env,
        AUTODESIGN_REPORT_ROOT: tempRoot,
      },
    });

    const markdownPath = path.join(tempRoot, "reports", "acceptance", `acceptance-${timestamp}.md`);
    const jsonPath = path.join(tempRoot, "reports", "acceptance", `acceptance-${timestamp}.json`);
    const markdown = await readFile(markdownPath, "utf8");
    const payload = JSON.parse(await readFile(jsonPath, "utf8"));

    assert.match(stdout, /acceptance report created: reports\/acceptance\/acceptance-20260323-230000\.md/);
    assert.equal(payload.kind, "acceptance_report");
    assert.equal(payload.timestamp, timestamp);
    assert.equal(payload.status, "PENDING");
    assert.equal(payload.scope, "Live Figma / bridge acceptance");
    assert.equal(payload.commands.length, 3);
    assert.match(markdown, /## Steps/);
    assert.match(markdown, /Status: `PENDING`/);
    assert.match(markdown, /Open Figma Desktop and launch the AutoDesign plugin/);
  });
});

test("create_acceptance_report supports reconstruction live presets and rejects duplicate timestamps", async () => {
  await withTempRoot(async (tempRoot) => {
    const timestamp = "20260323-230500";
    await execFileAsync(
      process.execPath,
      [scriptPath, "--timestamp", timestamp, "--scenario", "reconstruction-live", "--owner", "hirohi"],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          AUTODESIGN_REPORT_ROOT: tempRoot,
        },
      },
    );

    const jsonPath = path.join(tempRoot, "reports", "acceptance", `acceptance-${timestamp}.json`);
    const payload = JSON.parse(await readFile(jsonPath, "utf8"));
    assert.equal(payload.owner, "hirohi");
    assert.equal(payload.scope, "Reconstruction live acceptance");
    assert.match(payload.commands[0], /plugin:reconstruct/);

    await assert.rejects(
      () =>
        execFileAsync(process.execPath, [scriptPath, "--timestamp", timestamp], {
          cwd: repoRoot,
          env: {
            ...process.env,
            AUTODESIGN_REPORT_ROOT: tempRoot,
          },
        }),
      (error: Error & { stderr?: string }) => {
        assert.match(String(error.stderr || ""), /Acceptance report already exists/);
        return true;
      },
    );
  });
});
