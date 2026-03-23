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
const scriptPath = path.join(repoRoot, "scripts", "check_product_boundary_truth.mjs");

async function withTempRepo<T>(run: (tempDir: string) => Promise<T>) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "autodesign-product-boundary-test-"));
  try {
    await mkdir(path.join(tempDir, "config", "governance"), { recursive: true });
    await mkdir(path.join(tempDir, "doc"), { recursive: true });
    return await run(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function writeTruth(tempDir: string, overrides: Record<string, unknown> = {}) {
  const truth = {
    supportBoundary: {
      formalSupport: [{ id: "plugin-send", label: "Plugin send" }],
      experimental: [{ id: "plugin-reconstruct", label: "Plugin reconstruct" }],
      futureTarget: [{ id: "saas", label: "SaaS" }],
    },
    docAssertions: [
      {
        doc: "doc/README.md",
        snippets: ["Plugin send", "experimental"],
      },
    ],
    ...overrides,
  };
  await writeFile(
    path.join(tempDir, "config", "governance", "product_boundary_truth.json"),
    JSON.stringify(truth, null, 2),
    "utf8",
  );
}

test("check_product_boundary_truth passes when support boundary categories and doc assertions are valid", async () => {
  await withTempRepo(async (tempDir) => {
    await writeTruth(tempDir);
    await writeFile(path.join(tempDir, "doc", "README.md"), "Plugin send is formal support; plugin-reconstruct is experimental.", "utf8");

    const { stdout } = await execFileAsync(process.execPath, [scriptPath], { cwd: tempDir });
    assert.match(stdout, /check:product-boundary passed/);
  });
});

test("check_product_boundary_truth fails when a support boundary category is empty", async () => {
  await withTempRepo(async (tempDir) => {
    await writeTruth(tempDir, {
      supportBoundary: {
        formalSupport: [{ id: "plugin-send", label: "Plugin send" }],
        experimental: [],
        futureTarget: [{ id: "saas", label: "SaaS" }],
      },
    });
    await writeFile(path.join(tempDir, "doc", "README.md"), "Plugin send is formal support; plugin-reconstruct is experimental.", "utf8");

    await assert.rejects(
      execFileAsync(process.execPath, [scriptPath], { cwd: tempDir }),
      (error: any) => {
        const stderr = String(error.stderr || "");
        assert.match(stderr, /check:product-boundary failed/);
        assert.match(stderr, /supportBoundary\.experimental must contain at least one entry/);
        return true;
      },
    );
  });
});

test("check_product_boundary_truth fails when a declared documentation snippet drifts", async () => {
  await withTempRepo(async (tempDir) => {
    await writeTruth(tempDir);
    await writeFile(path.join(tempDir, "doc", "README.md"), "Plugin send is formal support only.", "utf8");

    await assert.rejects(
      execFileAsync(process.execPath, [scriptPath], { cwd: tempDir }),
      (error: any) => {
        const stderr = String(error.stderr || "");
        assert.match(stderr, /check:product-boundary failed/);
        assert.match(stderr, /product boundary drift: doc\/README\.md missing "experimental"/);
        return true;
      },
    );
  });
});
