import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = path.join(repoRoot, "scripts", "verify-docs.mjs");

async function withTempRepo<T>(run: (tempDir: string) => Promise<T>) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "autodesign-verify-docs-test-"));
  try {
    await mkdir(path.join(tempDir, "doc", "plans", "archive"), { recursive: true });
    await mkdir(path.join(tempDir, "doc", "ai", "runtime", "actions", "knowledge"), { recursive: true });
    await mkdir(path.join(tempDir, "doc", "ai", "runtime", "contracts"), { recursive: true });
    await mkdir(path.join(tempDir, "reports", "acceptance"), { recursive: true });
    await mkdir(path.join(tempDir, "reports", "quality"), { recursive: true });
    return await run(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function writeKeyDocs(tempDir: string) {
  await writeFile(path.join(tempDir, "README.md"), "See [Project Map](doc/Project-Map.md).\n", "utf8");
  await writeFile(path.join(tempDir, "AGENT.md"), "# Agent\n", "utf8");
  await writeFile(path.join(tempDir, "contributing_ai.md"), "# Contributing\n", "utf8");
  await writeFile(path.join(tempDir, "doc", "Project-Map.md"), "# Project Map\n", "utf8");
  await writeFile(path.join(tempDir, "doc", "Architecture-Folder-Governance.md"), "# Governance\n", "utf8");
  await writeFile(path.join(tempDir, "doc", "Product-Standards.md"), "# Product\n", "utf8");
  await writeFile(path.join(tempDir, "doc", "Test-Standards.md"), "# Test\n", "utf8");
  await writeFile(path.join(tempDir, "doc", "Roadmap.md"), "# Roadmap\n", "utf8");
  await writeFile(path.join(tempDir, "doc", "plans", "archive", "README.md"), "# Archive\n", "utf8");
  await writeFile(path.join(tempDir, "doc", "ai", "README.md"), "# AI\n", "utf8");
  await writeFile(path.join(tempDir, "doc", "ai", "runtime", "README.md"), "# Runtime\n", "utf8");
  await writeFile(path.join(tempDir, "reports", "README.md"), "# Reports\n", "utf8");
}

async function writeRuntimeActionFixture(tempDir: string, content?: string) {
  await writeFile(
    path.join(tempDir, "doc", "ai", "runtime", "contracts", "graphpatch.knowledge.schema.json"),
    "{\n  \"type\": \"object\"\n}\n",
    "utf8",
  );
  await writeFile(
    path.join(tempDir, "doc", "ai", "runtime", "actions", "knowledge", "learning_path.md"),
    content ?? "# learning_path\n\nSchema: `graphpatch.knowledge.schema.json`\n\n当前接入状态：local simulator\n",
    "utf8",
  );
}

test("verify_docs passes for valid markdown links, plans/reports content and runtime action contracts", async () => {
  await withTempRepo(async (tempDir) => {
    await writeKeyDocs(tempDir);
    await writeRuntimeActionFixture(tempDir);
    await writeFile(
      path.join(tempDir, "doc", "plans", "active-plan.md"),
      [
        "# Active Plan",
        "",
        "## Summary",
        "",
        "Plan links to [archive](archive/README.md).",
        "",
        "## Scope",
        "",
        "- scope item",
        "",
        "## Dependencies",
        "",
        "- dependency item",
        "",
        "## Entry Conditions",
        "",
        "- entry item",
        "",
        "## Workstreams",
        "",
        "- workstream a",
        "- workstream b",
        "",
        "## Closure Tasks",
        "",
        "- closure a",
        "- closure b",
        "- closure c",
        "",
        "## Exit Conditions",
        "",
        "- exit item",
        "",
        "## Risks",
        "",
        "- risk item",
        "",
        "## Rollback",
        "",
        "- rollback item",
        "",
        "## Verification",
        "",
        "- verify item",
        "",
      ].join("\n"),
      "utf8",
    );
    await writeFile(path.join(tempDir, "reports", "acceptance", "case.md"), "Acceptance references [reports root](../README.md).\n", "utf8");

    const { stdout } = await execFileAsync(process.execPath, [scriptPath], { cwd: tempDir });
    assert.match(stdout, /verify:docs passed/);
  });
});

test("verify_docs fails when markdown contains machine-specific absolute paths and broken internal links", async () => {
  await withTempRepo(async (tempDir) => {
    await writeKeyDocs(tempDir);
    await writeRuntimeActionFixture(tempDir);
    await writeFile(
      path.join(tempDir, "doc", "plans", "active-plan.md"),
      "Broken [link](missing.md) and machine path /Users/tester/project.\n",
      "utf8",
    );

    await assert.rejects(
      execFileAsync(process.execPath, [scriptPath], { cwd: tempDir }),
      (error: any) => {
        const stderr = String(error.stderr || "");
        assert.match(stderr, /verify:docs failed/);
        assert.match(stderr, /doc\/plans\/active-plan\.md: contains machine-specific absolute path/);
        assert.match(stderr, /doc\/plans\/active-plan\.md: broken markdown link: missing\.md/);
        return true;
      },
    );
  });
});

test("verify_docs fails when plans use roadmap-style status fields or runtime action docs drift", async () => {
  await withTempRepo(async (tempDir) => {
    await writeKeyDocs(tempDir);
    await writeRuntimeActionFixture(tempDir, "# learning_path\n\nSchema: `graphpatch.knowledge.schema.json`\n");
    await writeFile(path.join(tempDir, "doc", "plans", "active-plan.md"), "- 状态：`in_progress`\n", "utf8");

    await assert.rejects(
      execFileAsync(process.execPath, [scriptPath], { cwd: tempDir }),
      (error: any) => {
        const stderr = String(error.stderr || "");
        assert.match(stderr, /verify:docs failed/);
        assert.match(stderr, /doc\/plans\/active-plan\.md: contains roadmap-style status field matching/);
        assert.match(stderr, /doc\/ai\/runtime\/actions\/knowledge\/learning_path\.md: missing 当前接入状态 declaration/);
        return true;
      },
    );
  });
});

test("verify_docs fails when active plans omit required subtask structure", async () => {
  await withTempRepo(async (tempDir) => {
    await writeKeyDocs(tempDir);
    await writeRuntimeActionFixture(tempDir);
    await writeFile(
      path.join(tempDir, "doc", "plans", "active-plan.md"),
      [
        "# Active Plan",
        "",
        "## Summary",
        "",
        "Summary only.",
        "",
        "## Scope",
        "",
        "- scope item",
        "",
        "## Dependencies",
        "",
        "- dependency item",
        "",
        "## Entry Conditions",
        "",
        "- entry item",
        "",
        "## Workstreams",
        "",
        "- workstream only",
        "",
        "## Closure Tasks",
        "",
        "- closure a",
        "",
        "## Exit Conditions",
        "",
        "- exit item",
        "",
        "## Risks",
        "",
        "- risk item",
        "",
        "## Rollback",
        "",
        "- rollback item",
        "",
      ].join("\n"),
      "utf8",
    );

    await assert.rejects(
      execFileAsync(process.execPath, [scriptPath], { cwd: tempDir }),
      (error: any) => {
        const stderr = String(error.stderr || "");
        assert.match(stderr, /verify:docs failed/);
        assert.match(stderr, /doc\/plans\/active-plan\.md: missing required section: ## Verification/);
        assert.match(stderr, /doc\/plans\/active-plan\.md: Workstreams must contain at least 2 list items/);
        assert.match(stderr, /doc\/plans\/active-plan\.md: Closure Tasks must contain at least 3 list items/);
        return true;
      },
    );
  });
});
