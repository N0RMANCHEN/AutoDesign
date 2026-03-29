import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runCodeToDesignPlanCli } from "./code-to-design-plan.js";

async function withSnapshotFixture<T>(run: (snapshotPath: string, tempDir: string) => Promise<T>) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "autodesign-code-plan-"));
  try {
    const snapshotPath = path.join(tempDir, "snapshot.json");
    await writeFile(
      snapshotPath,
      JSON.stringify({
        kind: "code_to_design_runtime_snapshot",
        version: "v1",
        lane: "code_to_design",
        projectRoot: "/tmp/aitest",
        projectName: "aitest",
        route: "/",
        entryPaths: ["src/App.tsx"],
        viewport: { width: 1440, height: 2200, deviceScaleFactor: 1 },
        page: {
          title: "AItest",
          urlPath: "/",
          scrollWidth: 1440,
          scrollHeight: 2200,
          backgroundColor: "rgb(245, 242, 236)",
          backgroundImage: "none",
        },
        summary: { nodeCount: 1, textNodeCount: 1, imageNodeCount: 0, shapeNodeCount: 0 },
        nodes: [
          {
            id: "text-1",
            parentId: "root-1",
            domPath: "h1",
            tagName: "H1",
            role: "text",
            name: "Headline",
            visible: true,
            rect: { x: 60, y: 80, width: 520, height: 180 },
            textContent: "SHADOW OF ELEGANCE",
            styles: {
              display: "block",
              position: "static",
              color: "rgb(15, 15, 15)",
              opacity: 1,
              backgroundColor: "rgba(0, 0, 0, 0)",
              backgroundImage: "none",
              borderTopWidth: "0px",
              borderRightWidth: "0px",
              borderBottomWidth: "0px",
              borderLeftWidth: "0px",
              borderTopColor: "rgba(0, 0, 0, 0)",
              borderRightColor: "rgba(0, 0, 0, 0)",
              borderBottomColor: "rgba(0, 0, 0, 0)",
              borderLeftColor: "rgba(0, 0, 0, 0)",
              borderTopLeftRadius: "0px",
              borderTopRightRadius: "0px",
              borderBottomRightRadius: "0px",
              borderBottomLeftRadius: "0px",
              fontFamily: "Didot",
              fontSize: "80px",
              fontWeight: "600",
              lineHeight: "84px",
              letterSpacing: "-4px",
              textAlign: "left",
              textTransform: "uppercase",
              objectFit: "fill",
              gridTemplateColumns: "none",
              gridTemplateRows: "none",
              gap: "normal",
              rowGap: "normal",
              columnGap: "normal",
            },
            image: null,
          },
        ],
        warnings: [],
        assumptions: [],
      }, null, 2),
      "utf8",
    );
    return await run(snapshotPath, tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

test("runCodeToDesignPlanCli writes a batch file for a captured snapshot", async () => {
  await withSnapshotFixture(async (snapshotPath, tempDir) => {
    const outputPath = path.join(tempDir, "batch.json");
    const qualityPath = path.join(tempDir, "quality.json");
    const layoutPath = path.join(tempDir, "layout.json");
    const result = await runCodeToDesignPlanCli([
      "node",
      "scripts/code-to-design-plan.ts",
      "--snapshot",
      snapshotPath,
      "--parent-node-id",
      "1:2",
      "--out",
      outputPath,
      "--quality-out",
      qualityPath,
      "--layout-out",
      layoutPath,
      "--format",
      "json",
    ]);

    assert.equal(result.exitCode, 0);
    const persisted = JSON.parse(await readFile(outputPath, "utf8"));
    const quality = JSON.parse(await readFile(qualityPath, "utf8"));
    const layout = JSON.parse(await readFile(layoutPath, "utf8"));
    assert.equal(persisted.commands[0].capabilityId, "nodes.create-frame");
    assert.equal(persisted.commands[2].capabilityId, "nodes.create-text");
    assert.equal(quality.kind, "code_to_design_quality_report");
    assert.equal(layout.name, "AItest");
  });
});
