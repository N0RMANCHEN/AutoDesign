import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = path.join(repoRoot, "scripts", "check_capability_catalog_consistency.mjs");
const tsxLoader = require.resolve("tsx");

async function withTempRepo<T>(run: (tempDir: string) => Promise<T>) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "autodesign-capability-catalog-test-"));
  try {
    await mkdir(path.join(tempDir, "doc"), { recursive: true });
    await mkdir(path.join(tempDir, "shared"), { recursive: true });
    return await run(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function writeRegistry(tempDir: string, ids: string[]) {
  const rows = ids
    .map(
      (id) => `  { id: ${JSON.stringify(id)}, domain: "nodes", label: ${JSON.stringify(id)}, description: "desc", supportedEditorTypes: ["figma"], requiresSelection: false, requiresEditAccess: false, requiresPaidFeature: false }`,
    )
    .join(",\n");
  await writeFile(
    path.join(tempDir, "shared", "plugin-capabilities.ts"),
    `export const IMPLEMENTED_PLUGIN_CAPABILITIES = [\n${rows}\n];\n`,
    "utf8",
  );
}

async function writeCatalog(tempDir: string, implementedIds: string[]) {
  const rows = implementedIds
    .map((id) => `| \`${id}\` | \`nodes\` | implemented | \`{}\` | test |`)
    .join("\n");
  await writeFile(
    path.join(tempDir, "doc", "Capability-Catalog.md"),
    `# Capability Catalog\n\n| capabilityId | domain | status | payload | 作用 |\n| --- | --- | --- | --- | --- |\n${rows}\n`,
    "utf8",
  );
}

test("check_capability_catalog_consistency passes when implemented registry and catalog match", async () => {
  await withTempRepo(async (tempDir) => {
    const ids = ["selection.refresh", "nodes.inspect-subtree"];
    await writeRegistry(tempDir, ids);
    await writeCatalog(tempDir, ids);

    const { stdout } = await execFileAsync(process.execPath, ["--import", tsxLoader, scriptPath], { cwd: tempDir });
    assert.match(stdout, /check:capability-catalog passed/);
  });
});

test("check_capability_catalog_consistency fails when an implemented capability is missing from the catalog", async () => {
  await withTempRepo(async (tempDir) => {
    await writeRegistry(tempDir, ["selection.refresh", "nodes.inspect-subtree"]);
    await writeCatalog(tempDir, ["selection.refresh"]);

    await assert.rejects(
      execFileAsync(process.execPath, ["--import", tsxLoader, scriptPath], { cwd: tempDir }),
      (error: any) => {
        const stderr = String(error.stderr || "");
        assert.match(stderr, /check:capability-catalog failed/);
        assert.match(stderr, /implemented capability missing from catalog: nodes.inspect-subtree/);
        return true;
      },
    );
  });
});

test("check_capability_catalog_consistency fails when the catalog claims implemented capability ids that are not in the registry", async () => {
  await withTempRepo(async (tempDir) => {
    await writeRegistry(tempDir, ["selection.refresh"]);
    await writeCatalog(tempDir, ["selection.refresh", "nodes.inspect-subtree"]);

    await assert.rejects(
      execFileAsync(process.execPath, ["--import", tsxLoader, scriptPath], { cwd: tempDir }),
      (error: any) => {
        const stderr = String(error.stderr || "");
        assert.match(stderr, /catalog marks capability as implemented but registry does not: nodes.inspect-subtree/);
        return true;
      },
    );
  });
});
