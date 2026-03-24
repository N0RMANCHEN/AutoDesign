import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryModulePath = path.join(repoRoot, "server", "adapters", "reconstruction-job-repository.ts");

async function withTempWorkspace<T>(
  run: (repository: typeof import("./adapters/reconstruction-job-repository.js")) => Promise<T>,
) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "autodesign-reconstruction-repository-"));
  const previousCwd = process.cwd();
  process.chdir(tempDir);
  try {
    const moduleUrl = `${pathToFileURL(repositoryModulePath).href}?test=${Date.now()}-${Math.random()}`;
    const repository = (await import(moduleUrl)) as typeof import("./adapters/reconstruction-job-repository.js");
    return await run(repository);
  } finally {
    process.chdir(previousCwd);
    await rm(tempDir, { recursive: true, force: true });
  }
}

test("reconstruction job repository initializes and persists the snapshot file", async () => {
  await withTempWorkspace(async (repository) => {
    const initial = await repository.readReconstructionJobSnapshot();
    assert.deepEqual(initial, { jobs: [] });

    await repository.writeReconstructionJobSnapshot({
      jobs: [
        {
          id: "job-1",
          createdAt: "2026-03-24T00:00:00.000Z",
        },
      ],
    } as any);

    const loaded = await repository.readReconstructionJobSnapshot();
    assert.equal(loaded.jobs.length, 1);
    assert.equal(loaded.jobs[0]?.id, "job-1");
  });
});
