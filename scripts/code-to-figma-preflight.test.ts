import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { runCodeToFigmaPreflightCli } from "./code-to-figma-preflight.js";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = path.join(repoRoot, "scripts", "code-to-figma-preflight.ts");

async function withFixtureProject<T>(run: (projectRoot: string) => Promise<T>) {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "autodesign-code-to-figma-"));
  try {
    await writeFile(
      path.join(projectRoot, "package.json"),
      JSON.stringify({ name: "fixture-project", private: true }, null, 2),
      "utf8",
    );
    await mkdir(path.join(projectRoot, "src"), { recursive: true });
    return await run(projectRoot);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
}

test("runCodeToFigmaPreflightCli returns a report and writes JSON output when blocked projects are allowed", async () => {
  await withFixtureProject(async (projectRoot) => {
    await writeFile(
      path.join(projectRoot, "src", "App.tsx"),
      `
        import { useState } from "react";

        export default function App() {
          const [open] = useState(false);
          return <button onClick={() => null}>{open ? <span>Open</span> : <span>Closed</span>}</button>;
        }
      `,
      "utf8",
    );
    await writeFile(
      path.join(projectRoot, "src", "index.css"),
      `
        .page {
          display: grid;
          width: min(1200px, calc(100% - 32px));
        }
      `,
      "utf8",
    );

    const outputPath = path.join(projectRoot, "report.json");
    const result = await runCodeToFigmaPreflightCli([
      "node",
      scriptPath,
      "--project",
      projectRoot,
      "--entry",
      "src/App.tsx",
      "--allow-blocked",
      "--format",
      "json",
      "--out",
      outputPath,
    ]);

    assert.equal(result.exitCode, 0);
    assert.equal(result.report?.projectName, "fixture-project");
    assert.equal(result.report?.supported, false);
    assert.equal(result.report?.entryPaths[0], "src/App.tsx");

    const persisted = JSON.parse(await readFile(outputPath, "utf8"));
    assert.equal(persisted.kind, "code_to_figma_preflight");
    assert.equal(persisted.projectName, "fixture-project");
  });
});

test("code-to-figma-preflight exits non-zero for blocked projects without --allow-blocked", async () => {
  await withFixtureProject(async (projectRoot) => {
    await writeFile(
      path.join(projectRoot, "src", "App.tsx"),
      `
        import { useState } from "react";

        export default function App() {
          const [open, setOpen] = useState(false);
          return <section className="page" onClick={() => setOpen(!open)}>{open ? "Open" : "Closed"}</section>;
        }
      `,
      "utf8",
    );
    await writeFile(
      path.join(projectRoot, "src", "index.css"),
      `
        .page {
          display: grid;
        }
      `,
      "utf8",
    );

    await assert.rejects(
      execFileAsync(process.execPath, ["--import", "tsx", scriptPath, "--project", projectRoot], {
        cwd: repoRoot,
      }),
      (error: unknown) => {
        const typed = error as { code?: number; stdout?: string };
        assert.equal(typed.code, 1);
        assert.match(String(typed.stdout || ""), /verdict: BLOCKED/);
        return true;
      },
    );
  });
});
