import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

import { seededProject } from "../shared/seed.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const storageModulePath = path.join(repoRoot, "server", "storage.ts");

async function withTempProjectStore<T>(
  run: (store: typeof import("./storage.js")) => Promise<T>,
  options?: {
    legacyProject?: unknown;
  },
) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "autodesign-project-store-"));
  const previousCwd = process.cwd();
  process.chdir(tempDir);
  try {
    if (options?.legacyProject !== undefined) {
      const dataDir = path.join(tempDir, "data");
      await mkdir(dataDir, { recursive: true });
      await writeFile(
        path.join(dataDir, "figmatest-project.json"),
        JSON.stringify(options.legacyProject, null, 2),
        "utf8",
      );
    }

    const moduleUrl = `${pathToFileURL(storageModulePath).href}?test=${Date.now()}-${Math.random()}`;
    const store = (await import(moduleUrl)) as typeof import("./storage.js");
    return await run(store);
  } finally {
    process.chdir(previousCwd);
    await rm(tempDir, { recursive: true, force: true });
  }
}

test("readProject seeds the workspace when no project file exists", async () => {
  await withTempProjectStore(async (store) => {
    const project = await store.readProject();

    assert.deepEqual(project, seededProject);
  });
});

test("readProject migrates the legacy project file when the new one is absent", async () => {
  await withTempProjectStore(
    async (store) => {
      const project = await store.readProject();

      assert.equal(project.meta.id, "legacy-project");
      assert.equal(project.designSources.length, 1);
      assert.equal(project.designSources[0]?.id, "legacy-source");
    },
    {
      legacyProject: {
        ...seededProject,
        meta: {
          ...seededProject.meta,
          id: "legacy-project",
          updatedAt: "2024-01-01T00:00:00.000Z",
        },
        designSources: [
          {
            ...seededProject.designSources[0],
            id: "legacy-source",
          },
        ],
      },
    },
  );
});

test("writeProject updates updatedAt and resetProject restores the seeded workspace", async () => {
  await withTempProjectStore(async (store) => {
    const updated = await store.writeProject({
      ...seededProject,
      meta: {
        ...seededProject.meta,
        name: "Changed Workspace",
        updatedAt: "2020-01-01T00:00:00.000Z",
      },
    });

    assert.equal(updated.meta.name, "Changed Workspace");
    assert.notEqual(updated.meta.updatedAt, "2020-01-01T00:00:00.000Z");
    assert.match(updated.meta.updatedAt, /^\d{4}-\d{2}-\d{2}T/);

    const readBack = await store.readProject();
    assert.equal(readBack.meta.name, "Changed Workspace");
    assert.equal(readBack.meta.updatedAt, updated.meta.updatedAt);

    const reset = await store.resetProject();
    assert.deepEqual(reset, seededProject);

    const afterReset = await store.readProject();
    assert.deepEqual(afterReset, seededProject);
  });
});
