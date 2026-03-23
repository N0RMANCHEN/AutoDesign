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
const scriptPath = path.join(repoRoot, "scripts", "plugin-bridge-cli.ts");

async function writeFixture(fixtureDir: string, fileName: string, payload: unknown) {
  await writeFile(path.join(fixtureDir, fileName), JSON.stringify(payload, null, 2), "utf8");
}

function pngDataUrl(contents: string) {
  return `data:image/png;base64,${Buffer.from(contents, "utf8").toString("base64")}`;
}

function createReconstructionJobFixture(
  strategy: "vector-reconstruction" | "hybrid-reconstruction" | "raster-exact" | "structural-preview",
  overrides?: Record<string, unknown>,
) {
  return {
    id: `job-${strategy}`,
    analysisVersion: "test",
    analysisProvider: "heuristic-local",
    input: {
      targetSessionId: "session_1",
      targetNodeId: "target-1",
      referenceNodeId: "reference-1",
      goal: "pixel-match",
      strategy,
      maxIterations: 4,
      allowOutpainting: strategy === "hybrid-reconstruction",
    },
    status: "ready",
    applyStatus: "not_applied",
    loopStatus: "idle",
    stopReason: null,
    approvalState: "not-reviewed",
    currentStageId: "extract-reference",
    createdAt: "2026-03-23T00:00:00.000Z",
    updatedAt: "2026-03-23T00:00:00.000Z",
    completedAt: null,
    lastAppliedAt: null,
    diffScore: null,
    bestDiffScore: null,
    lastImprovement: null,
    stagnationCount: 0,
    warnings: ["existing warning"],
    targetNode: {
      id: "target-1",
      name: "Target Frame",
      type: "FRAME",
      fillable: true,
      fills: [],
      fillStyleId: null,
      width: 160,
      height: 100,
    },
    referenceNode: {
      id: "reference-1",
      name: "Reference Frame",
      type: "FRAME",
      fillable: true,
      fills: [],
      fillStyleId: null,
      width: 160,
      height: 100,
    },
    referenceRaster: null,
    analysis: null,
    fontMatches: [],
    rebuildPlan: null,
    reviewFlags: [],
    approvedFontChoices: [],
    approvedAssetChoices: [],
    renderedPreview: null,
    diffMetrics: null,
    structureReport: null,
    refineSuggestions: [],
    iterationCount: 0,
    appliedNodeIds: [],
    stages: [],
    ...overrides,
  };
}

async function withFixtureDir<T>(run: (fixtureDir: string) => Promise<T>) {
  const fixtureDir = await mkdtemp(path.join(os.tmpdir(), "autodesign-plugin-cli-test-"));
  try {
    return await run(fixtureDir);
  } finally {
    await rm(fixtureDir, { recursive: true, force: true });
  }
}

async function runCli(args: string[], fixtureDir?: string) {
  return execFileAsync(process.execPath, ["--import", "tsx", scriptPath, ...args], {
    cwd: repoRoot,
    env: fixtureDir
      ? {
          ...process.env,
          AUTODESIGN_API_FIXTURE_DIR: fixtureDir,
        }
      : process.env,
  });
}

test("plugin_bridge_cli status prints a friendly message when no plugin session is online", async () => {
  await withFixtureDir(async (fixtureDir) => {
    await writeFixture(fixtureDir, "get__api__plugin-bridge.json", {
      sessions: [],
      commands: [],
    });
    const { stdout } = await runCli(["status"], fixtureDir);
    assert.match(stdout, /当前没有在线插件会话。/);
  });
});

test("plugin_bridge_cli status prints session metadata, capabilities and selection summaries", async () => {
  await withFixtureDir(async (fixtureDir) => {
    await writeFixture(fixtureDir, "get__api__plugin-bridge.json", {
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
          capabilities: [{ id: "selection.refresh" }, { id: "fills.set-fill" }],
          selection: [
            {
              id: "1:2",
              name: "Card",
              type: "FRAME",
              fills: ["#FFFFFF"],
              fillStyleId: null,
              width: 320,
              height: 180,
              x: 12,
              y: 24,
              absoluteX: 120,
              absoluteY: 240,
              parentNodeType: "PAGE",
              parentNodeId: "0:1",
              parentLayoutMode: "NONE",
              layoutMode: "VERTICAL",
              layoutPositioning: "AUTO",
            },
          ],
        },
      ],
      commands: [],
    });
    const { stdout } = await runCli(["status"], fixtureDir);
    assert.match(stdout, /session_1 \| AutoDesign 0\.2\.0 \| online \| Demo File \/ Page A/);
    assert.match(stdout, /capabilities: selection\.refresh, fills\.set-fill/);
    assert.match(stdout, /runtimeFeatures: explicitNodeTargeting=yes/);
    assert.match(stdout, /- \[0\] Card \[FRAME\] id=1:2/);
  });
});

test("plugin_bridge_cli send normalizes a legacy mutating command and queues it with explicit nodeIds", async () => {
  await withFixtureDir(async (fixtureDir) => {
    await writeFixture(fixtureDir, "get__api__plugin-bridge.json", {
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
          capabilities: [{ id: "fills.set-fill" }],
          selection: [
            {
              id: "1:2",
              name: "Card",
              type: "FRAME",
              fills: ["#FFFFFF"],
              fillStyleId: null,
            },
          ],
        },
      ],
      commands: [],
    });
    await writeFixture(fixtureDir, "post__api__plugin-bridge__commands.json", {
      id: "cmd_123",
    });

    const batch = JSON.stringify({
      source: "user",
      commands: [
        {
          type: "set-selection-fill",
          hex: "#00FF88",
        },
      ],
    });
    const { stdout } = await runCli(["send", "--json", batch, "--node-ids", "1:2"], fixtureDir);

    assert.match(stdout, /queued: cmd_123/);
    assert.match(stdout, /session: session_1/);
    assert.match(stdout, /target: Demo File \/ Page A/);
    assert.match(stdout, /"capabilityId": "fills\.set-fill"/);
    assert.match(stdout, /"nodeIds": \[\s*"1:2"\s*\]/);
    assert.match(stdout, /"hex": "#00FF88"/);
  });
});

test("plugin_bridge_cli send allows read-only commands without explicit nodeIds", async () => {
  await withFixtureDir(async (fixtureDir) => {
    await writeFixture(fixtureDir, "get__api__plugin-bridge.json", {
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
          capabilities: [{ id: "selection.refresh" }],
          selection: [],
        },
      ],
      commands: [],
    });
    await writeFixture(fixtureDir, "post__api__plugin-bridge__commands.json", {
      id: "cmd_read_only",
    });

    const batch = JSON.stringify({
      source: "user",
      commands: [
        {
          type: "refresh-selection",
        },
      ],
    });
    const { stdout } = await runCli(["send", "--json", batch], fixtureDir);

    assert.match(stdout, /queued: cmd_read_only/);
    assert.match(stdout, /"capabilityId": "selection\.refresh"/);
    assert.doesNotMatch(stdout, /"nodeIds": \[/);
  });
});

test("plugin_bridge_cli send rejects capabilities that the target session does not expose", async () => {
  await withFixtureDir(async (fixtureDir) => {
    await writeFixture(fixtureDir, "get__api__plugin-bridge.json", {
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
          capabilities: [{ id: "selection.refresh" }],
          selection: [],
        },
      ],
      commands: [],
    });

    const batch = JSON.stringify({
      source: "user",
      commands: [
        {
          type: "capability",
          capabilityId: "fills.set-fill",
          payload: { hex: "#111111" },
        },
      ],
    });

    await assert.rejects(
      () => runCli(["send", "--json", batch, "--node-ids", "1:2"], fixtureDir),
      (error: Error & { stderr?: string }) => {
        assert.match(String(error.stderr || ""), /目标插件当前不支持这些能力：fills\.set-fill/);
        return true;
      },
    );
  });
});

test("plugin_bridge_cli preview exports selection previews into the requested output directory", async () => {
  await withFixtureDir(async (fixtureDir) => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "autodesign-plugin-preview-out-"));
    try {
      await writeFixture(fixtureDir, "get__api__plugin-bridge.json", {
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
            capabilities: [],
            selection: [
              {
                id: "1:2",
                name: "Card Preview",
                type: "RECTANGLE",
                fills: [],
                fillStyleId: null,
                previewDataUrl: pngDataUrl("preview-node-1"),
              },
              {
                id: "1:3",
                name: "No Preview",
                type: "FRAME",
                fills: [],
                fillStyleId: null,
              },
            ],
          },
        ],
        commands: [],
      });

      const { stdout } = await runCli(["preview", "--out", outputDir], fixtureDir);
      const expectedFile = path.join(outputDir, "session_1-0-card-preview.png");
      const bytes = await readFile(expectedFile);

      assert.match(stdout, new RegExp(expectedFile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.equal(bytes.toString("utf8"), "preview-node-1");
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });
});

test("plugin_bridge_cli preview rejects selections that do not contain exportable previews", async () => {
  await withFixtureDir(async (fixtureDir) => {
    await writeFixture(fixtureDir, "get__api__plugin-bridge.json", {
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
          capabilities: [],
          selection: [
            {
              id: "1:2",
              name: "Plain Frame",
              type: "FRAME",
              fills: [],
              fillStyleId: null,
            },
          ],
        },
      ],
      commands: [],
    });

    await assert.rejects(
      () => runCli(["preview"], fixtureDir),
      (error: Error & { stderr?: string }) => {
        assert.match(String(error.stderr || ""), /当前 selection 没有可导出的预览/);
        return true;
      },
    );
  });
});

test("plugin_bridge_cli inspect exports subtree preview artifacts for a frame inspection request", async () => {
  await withFixtureDir(async (fixtureDir) => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "autodesign-plugin-inspect-out-"));
    try {
      await writeFixture(fixtureDir, "get__api__plugin-bridge.json", {
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
            capabilities: [{ id: "nodes.inspect-subtree" }],
            selection: [],
          },
        ],
        commands: [],
      });
      await writeFixture(fixtureDir, "post__api__plugin-bridge__inspect-frame.json", {
        nodes: [
          {
            id: "9:9",
            name: "Root Frame",
            type: "FRAME",
            depth: 0,
            childCount: 1,
            indexWithinParent: 0,
            generatedBy: null,
            visible: true,
            locked: false,
            x: 0,
            y: 0,
            width: 320,
            height: 180,
            fills: ["#FFFFFF"],
            strokes: [],
            opacity: 1,
            cornerRadius: 24,
            layoutMode: "VERTICAL",
            layoutPositioning: "AUTO",
            layoutAlign: null,
            layoutGrow: 0,
            primaryAxisSizingMode: "AUTO",
            counterAxisSizingMode: "AUTO",
            itemSpacing: 16,
            paddingTop: 24,
            paddingRight: 24,
            paddingBottom: 24,
            paddingLeft: 24,
            constraintsHorizontal: "MIN",
            constraintsVertical: "MIN",
            clipsContent: false,
            isMask: false,
            mainComponentId: null,
            mainComponentName: null,
            componentPropertyDefinitionKeys: [],
            componentPropertyReferences: [],
            variantProperties: {},
            textContent: null,
            fontFamily: null,
            fontStyle: null,
            fontSize: null,
            fontWeight: null,
            textAlignment: null,
          },
        ],
        preview: {
          dataUrl: pngDataUrl("frame-preview"),
          mimeType: "image/png",
          width: 320,
          height: 180,
        },
      });

      const { stdout } = await runCli(
        ["inspect", "--frame-node-id", "9:9", "--max-depth", "2", "--out", outputDir],
        fixtureDir,
      );
      const expectedFile = path.join(outputDir, "session_1-frame-9-9-root-frame.png");
      const bytes = await readFile(expectedFile);

      assert.match(stdout, /session_1 \| AutoDesign 0\.2\.0 \| online \| Demo File \/ Page A/);
      assert.match(stdout, /frameNodes:/);
      assert.match(stdout, /- Root Frame \| id=9:9 type=FRAME/);
      assert.match(stdout, new RegExp(`preview: ${expectedFile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
      assert.equal(bytes.toString("utf8"), "frame-preview");
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });
});

test("plugin_bridge_cli inspect rejects frame inspection when the runtime lacks inspect-subtree capability", async () => {
  await withFixtureDir(async (fixtureDir) => {
    await writeFixture(fixtureDir, "get__api__plugin-bridge.json", {
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
          capabilities: [],
          selection: [],
        },
      ],
      commands: [],
    });

    await assert.rejects(
      () => runCli(["inspect", "--frame-node-id", "9:9"], fixtureDir),
      (error: Error & { stderr?: string }) => {
        assert.match(String(error.stderr || ""), /还不支持 nodes\.inspect-subtree/);
        return true;
      },
    );
  });
});

test("plugin_bridge_cli reconstruct --list prints a friendly empty state when no jobs exist", async () => {
  await withFixtureDir(async (fixtureDir) => {
    await writeFixture(fixtureDir, "get__api__reconstruction__jobs.json", {
      jobs: [],
    });

    const { stdout } = await runCli(["reconstruct", "--list"], fixtureDir);
    assert.match(stdout, /当前没有 reconstruction job。/);
  });
});

test("plugin_bridge_cli reconstruct --list prints summary lines for existing jobs", async () => {
  await withFixtureDir(async (fixtureDir) => {
    await writeFixture(fixtureDir, "get__api__reconstruction__jobs.json", {
      jobs: [
        {
          id: "job_1",
          status: "analysis_ready",
          currentStageId: "analyze",
          targetNode: { name: "Target Frame" },
          referenceNode: { name: "Reference Screen" },
        },
        {
          id: "job_2",
          status: "refine_pending",
          currentStageId: "measure",
          targetNode: { name: "Detail Card" },
          referenceNode: { name: "Reference Card" },
        },
      ],
    });

    const { stdout } = await runCli(["reconstruct", "--list"], fixtureDir);
    assert.match(stdout, /job_1 \| analysis_ready \| Target Frame <= Reference Screen \| analyze/);
    assert.match(stdout, /job_2 \| refine_pending \| Detail Card <= Reference Card \| measure/);
  });
});

test("plugin_bridge_cli reconstruct creates a hybrid job and prints the expected next-step workflow", async () => {
  await withFixtureDir(async (fixtureDir) => {
    await writeFixture(fixtureDir, "get__api__plugin-bridge.json", {
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
          capabilities: [],
          selection: [],
        },
        {
          id: "session_2",
          label: "AutoDesign",
          pluginVersion: "0.2.0",
          editorType: "figma",
          fileName: "Demo File",
          pageName: "Page B",
          status: "online",
          lastSeenAt: "2026-03-23T12:01:00.000Z",
          lastHandshakeAt: "2026-03-23T12:01:00.000Z",
          runtimeFeatures: { supportsExplicitNodeTargeting: true },
          capabilities: [],
          selection: [],
        },
      ],
      commands: [],
    });
    await writeFixture(
      fixtureDir,
      "post__api__reconstruction__jobs.json",
      createReconstructionJobFixture("hybrid-reconstruction", {
        input: {
          targetSessionId: "session_2",
          targetNodeId: "9:9",
          referenceNodeId: "8:8",
          goal: "pixel-match",
          strategy: "hybrid-reconstruction",
          maxIterations: 7,
          allowOutpainting: true,
        },
      }),
    );

    const { stdout } = await runCli(
      [
        "reconstruct",
        "--session",
        "session_2",
        "--target",
        "9:9",
        "--reference",
        "8:8",
        "--strategy",
        "hybrid-reconstruction",
        "--max-iterations",
        "7",
        "--allow-outpainting",
      ],
      fixtureDir,
    );

    assert.match(stdout, /job: job-hybrid-reconstruction/);
    assert.match(stdout, /session: session_2/);
    assert.match(stdout, /strategy: hybrid-reconstruction/);
    assert.match(stdout, /allowOutpainting: true/);
    assert.match(
      stdout,
      /next: --analyze -> --context-pack -> --submit-analysis -> --preview-plan -> --approve-plan -> --apply -> --render -> --measure/,
    );
  });
});

test("plugin_bridge_cli reconstruct supports the --raster-exact alias and prints the raster workflow hint", async () => {
  await withFixtureDir(async (fixtureDir) => {
    await writeFixture(fixtureDir, "get__api__plugin-bridge.json", {
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
          capabilities: [],
          selection: [],
        },
      ],
      commands: [],
    });
    await writeFixture(
      fixtureDir,
      "post__api__reconstruction__jobs.json",
      createReconstructionJobFixture("raster-exact", {
        analysisVersion: "raster-exact-v1",
        approvalState: "approved",
        input: {
          targetSessionId: "session_1",
          targetNodeId: "target-1",
          referenceNodeId: "reference-1",
          goal: "pixel-match",
          strategy: "raster-exact",
          maxIterations: 4,
          allowOutpainting: false,
        },
      }),
    );

    const { stdout } = await runCli(["reconstruct", "--raster-exact"], fixtureDir);
    assert.match(stdout, /job: job-raster-exact/);
    assert.match(stdout, /strategy: raster-exact/);
    assert.match(stdout, /approvalState: approved/);
    assert.match(stdout, /next: --apply -> --render -> --measure/);
  });
});

test("plugin_bridge_cli reconstruct --context-pack writes pack and preview artifacts to disk", async () => {
  await withFixtureDir(async (fixtureDir) => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "autodesign-reconstruction-context-pack-"));
    try {
      await writeFixture(
        fixtureDir,
        "post__api__reconstruction__jobs__job-hybrid__context-pack.json",
        {
          jobId: "job-hybrid",
          mode: "codex-assisted",
          analysisProvider: "codex-assisted",
          analysisVersionTarget: "codex-v1",
          generatedAt: "2026-03-23T12:00:00.000Z",
          strategy: "hybrid-reconstruction",
          targetNode: {
            id: "target-1",
            name: "Target Frame",
            type: "FRAME",
            fillable: true,
            fills: [],
            fillStyleId: null,
            width: 160,
            height: 100,
          },
          referenceNode: {
            id: "reference-1",
            name: "Reference Frame",
            type: "FRAME",
            fillable: true,
            fills: [],
            fillStyleId: null,
            width: 160,
            height: 100,
          },
          referencePreviewDataUrl: pngDataUrl("reference-preview"),
          referenceRectifiedPreviewDataUrl: pngDataUrl("reference-rectified"),
          targetPreviewDataUrl: pngDataUrl("target-preview"),
          currentAnalysis: null,
          currentFontMatches: [],
          currentReviewFlags: [],
          currentWarnings: ["warning a"],
          workflow: ["step 1", "step 2"],
          scoringRubric: ["rubric 1"],
          guidance: ["guide 1", "guide 2"],
        },
      );

      const { stdout } = await runCli(
        ["reconstruct", "--job", "job-hybrid", "--context-pack", "--out", outputDir],
        fixtureDir,
      );

      const contextPath = path.join(outputDir, "job-hybrid-context-pack.json");
      const referencePath = path.join(outputDir, "job-hybrid-reference.png");
      const rectifiedPath = path.join(outputDir, "job-hybrid-reference-rectified.png");
      const targetPath = path.join(outputDir, "job-hybrid-target.png");

      assert.equal(JSON.parse(await readFile(contextPath, "utf8")).jobId, "job-hybrid");
      assert.equal((await readFile(referencePath)).toString("utf8"), "reference-preview");
      assert.equal((await readFile(rectifiedPath)).toString("utf8"), "reference-rectified");
      assert.equal((await readFile(targetPath)).toString("utf8"), "target-preview");
      assert.match(stdout, /job: job-hybrid/);
      assert.match(stdout, /mode: codex-assisted/);
      assert.match(stdout, new RegExp(`contextPack: ${contextPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
      assert.match(stdout, /guidance:\n- guide 1\n- guide 2/);
      assert.match(stdout, /workflow:\n- step 1\n- step 2/);
      assert.match(stdout, /scoringRubric:\n- rubric 1/);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });
});

test("plugin_bridge_cli reconstruct --submit-analysis rejects missing analysis input", async () => {
  await withFixtureDir(async (fixtureDir) => {
    await assert.rejects(
      () => runCli(["reconstruct", "--job", "job-hybrid", "--submit-analysis"], fixtureDir),
      (error: Error & { stderr?: string }) => {
        assert.match(String(error.stderr || ""), /--submit-analysis 需要 --analysis-file 或 --analysis-json/);
        return true;
      },
    );
  });
});

test("plugin_bridge_cli reconstruct --submit-analysis rejects mixed file and inline analysis input", async () => {
  await withFixtureDir(async (fixtureDir) => {
    const analysisPath = path.join(fixtureDir, "analysis.json");
    await writeFile(analysisPath, JSON.stringify({ analysis: { surfaces: [] } }, null, 2), "utf8");

    await assert.rejects(
      () =>
        runCli(
          [
            "reconstruct",
            "--job",
            "job-hybrid",
            "--submit-analysis",
            "--analysis-file",
            analysisPath,
            "--analysis-json",
            "{\"analysis\":{\"surfaces\":[]}}",
          ],
          fixtureDir,
        ),
      (error: Error & { stderr?: string }) => {
        assert.match(String(error.stderr || ""), /只能使用一种输入方式：--analysis-file 或 --analysis-json/);
        return true;
      },
    );
  });
});

test("plugin_bridge_cli reconstruct --submit-analysis accepts inline JSON and prints the updated job", async () => {
  await withFixtureDir(async (fixtureDir) => {
    await writeFixture(
      fixtureDir,
      "post__api__reconstruction__jobs__job-hybrid__submit-analysis.json",
      createReconstructionJobFixture("hybrid-reconstruction", {
        analysisVersion: "codex-v1",
        analysisProvider: "codex-assisted",
        approvalState: "pending-review",
        currentStageId: "plan-rebuild",
        input: {
          targetSessionId: "session_1",
          targetNodeId: "target-1",
          referenceNodeId: "reference-1",
          goal: "pixel-match",
          strategy: "hybrid-reconstruction",
          maxIterations: 4,
          allowOutpainting: true,
        },
        warnings: ["analysis submitted"],
        rebuildPlan: {
          previewOnly: true,
          summary: ["Use vector rebuild"],
          ops: [],
        },
      }),
    );

    const { stdout } = await runCli(
      [
        "reconstruct",
        "--job",
        "job-hybrid",
        "--submit-analysis",
        "--analysis-json",
        JSON.stringify({
          analysisVersion: "codex-v1",
          analysisProvider: "codex-assisted",
          analysis: {
            semanticNodes: [],
          },
          warnings: ["analysis submitted"],
        }),
      ],
      fixtureDir,
    );

    assert.match(stdout, /job: job-hybrid-reconstruction/);
    assert.match(stdout, /approvalState: pending-review/);
    assert.match(stdout, /analysisVersion: codex-v1/);
    assert.match(stdout, /analysisProvider: codex-assisted/);
    assert.match(stdout, /current stage: plan-rebuild/);
    assert.match(stdout, /warnings:\n- analysis submitted/);
    assert.match(stdout, /rebuildPlan:\n- Use vector rebuild/);
  });
});

test("plugin_bridge_cli reconstruct --review-font rejects missing font review arguments", async () => {
  await withFixtureDir(async (fixtureDir) => {
    await assert.rejects(
      () => runCli(["reconstruct", "--job", "job-hybrid", "--review-font"], fixtureDir),
      (error: Error & { stderr?: string }) => {
        assert.match(String(error.stderr || ""), /--review-font 需要 --text-candidate 和 --font/);
        return true;
      },
    );
  });
});

test("plugin_bridge_cli reconstruct --review-font accepts a reviewer choice and prints approved fonts", async () => {
  await withFixtureDir(async (fixtureDir) => {
    await writeFixture(
      fixtureDir,
      "post__api__reconstruction__jobs__job-hybrid__review__font.json",
      createReconstructionJobFixture("hybrid-reconstruction", {
        approvalState: "pending-review",
        currentStageId: "match-fonts",
        approvedFontChoices: [
          {
            textCandidateId: "text-1",
            fontFamily: "Inter",
          },
        ],
      }),
    );

    const { stdout } = await runCli(
      [
        "reconstruct",
        "--job",
        "job-hybrid",
        "--review-font",
        "--text-candidate",
        "text-1",
        "--font",
        "Inter",
      ],
      fixtureDir,
    );

    assert.match(stdout, /job: job-hybrid-reconstruction/);
    assert.match(stdout, /current stage: match-fonts/);
    assert.match(stdout, /approvedFontChoices:\n- text-1: Inter/);
  });
});

test("plugin_bridge_cli reconstruct --approve-plan accepts approval notes and prints the approved state", async () => {
  await withFixtureDir(async (fixtureDir) => {
    await writeFixture(
      fixtureDir,
      "post__api__reconstruction__jobs__job-hybrid__review__approve-plan.json",
      createReconstructionJobFixture("hybrid-reconstruction", {
        approvalState: "approved",
        currentStageId: "apply-rebuild",
        rebuildPlan: {
          previewOnly: false,
          summary: ["Plan approved"],
          ops: [],
        },
      }),
    );

    const { stdout } = await runCli(
      [
        "reconstruct",
        "--job",
        "job-hybrid",
        "--approve-plan",
        "--note",
        "Looks good",
      ],
      fixtureDir,
    );

    assert.match(stdout, /job: job-hybrid-reconstruction/);
    assert.match(stdout, /approvalState: approved/);
    assert.match(stdout, /current stage: apply-rebuild/);
    assert.match(stdout, /rebuildPlan:\n- Plan approved/);
  });
});

test("plugin_bridge_cli reconstruct --review-asset rejects missing or invalid asset review arguments", async () => {
  await withFixtureDir(async (fixtureDir) => {
    await assert.rejects(
      () => runCli(["reconstruct", "--job", "job-hybrid", "--review-asset"], fixtureDir),
      (error: Error & { stderr?: string }) => {
        assert.match(String(error.stderr || ""), /--review-asset 需要 --asset 和 --decision approved\|rejected/);
        return true;
      },
    );
  });
});

test("plugin_bridge_cli reconstruct --review-asset accepts reviewer decisions and prints approved assets", async () => {
  await withFixtureDir(async (fixtureDir) => {
    await writeFixture(
      fixtureDir,
      "post__api__reconstruction__jobs__job-hybrid__review__asset.json",
      createReconstructionJobFixture("hybrid-reconstruction", {
        approvalState: "pending-review",
        currentStageId: "plan-rebuild",
        approvedAssetChoices: [
          {
            assetId: "asset-1",
            decision: "approved",
            note: "Use cropped source",
          },
        ],
      }),
    );

    const { stdout } = await runCli(
      [
        "reconstruct",
        "--job",
        "job-hybrid",
        "--review-asset",
        "--asset",
        "asset-1",
        "--decision",
        "approved",
        "--note",
        "Use cropped source",
      ],
      fixtureDir,
    );

    assert.match(stdout, /job: job-hybrid-reconstruction/);
    assert.match(stdout, /current stage: plan-rebuild/);
    assert.match(stdout, /approvedAssetChoices:\n- asset-1: approved \| Use cropped source/);
  });
});

test("plugin_bridge_cli reconstruct --request-changes keeps the plan in review with the supplied note", async () => {
  await withFixtureDir(async (fixtureDir) => {
    await writeFixture(
      fixtureDir,
      "post__api__reconstruction__jobs__job-hybrid__review__approve-plan.json",
      createReconstructionJobFixture("hybrid-reconstruction", {
        approvalState: "pending-review",
        currentStageId: "plan-rebuild",
        rebuildPlan: {
          previewOnly: true,
          summary: ["Need asset adjustment"],
          ops: [],
        },
        reviewFlags: [
          {
            id: "flag-1",
            severity: "warning",
            kind: "asset",
            message: "Adjust hero illustration crop",
          },
        ],
      }),
    );

    const { stdout } = await runCli(
      [
        "reconstruct",
        "--job",
        "job-hybrid",
        "--request-changes",
        "--note",
        "Adjust hero illustration crop",
      ],
      fixtureDir,
    );

    assert.match(stdout, /approvalState: pending-review/);
    assert.match(stdout, /current stage: plan-rebuild/);
    assert.match(stdout, /reviewFlags:\n- \[warning\] asset: Adjust hero illustration crop/);
    assert.match(stdout, /rebuildPlan:\n- Need asset adjustment/);
  });
});

test("plugin_bridge_cli reconstruct --apply prints deduplicated applied nodes and apply stage progress", async () => {
  await withFixtureDir(async (fixtureDir) => {
    await writeFixture(
      fixtureDir,
      "post__api__reconstruction__jobs__job-hybrid__apply.json",
      createReconstructionJobFixture("hybrid-reconstruction", {
        applyStatus: "applied",
        currentStageId: "apply-rebuild",
        appliedNodeIds: ["node-a", "node-b"],
        stages: [
          {
            stageId: "apply-rebuild",
            status: "completed",
            message: "Rebuild applied",
            updatedAt: "2026-03-23T12:10:00.000Z",
          },
        ],
      }),
    );

    const { stdout } = await runCli(["reconstruct", "--job", "job-hybrid", "--apply"], fixtureDir);
    assert.match(stdout, /job: job-hybrid-reconstruction/);
    assert.match(stdout, /applyStatus: applied/);
    assert.match(stdout, /current stage: apply-rebuild/);
    assert.match(stdout, /appliedNodeIds: 2/);
    assert.match(stdout, /stages:\n- apply-rebuild: completed \| Rebuild applied/);
  });
});

test("plugin_bridge_cli reconstruct --render prints preview and structure report details", async () => {
  await withFixtureDir(async (fixtureDir) => {
    await writeFixture(
      fixtureDir,
      "post__api__reconstruction__jobs__job-hybrid__render.json",
      createReconstructionJobFixture("hybrid-reconstruction", {
        currentStageId: "render-preview",
        renderedPreview: {
          previewDataUrl: pngDataUrl("rendered-preview"),
          mimeType: "image/png",
          width: 160,
          height: 100,
          capturedAt: "2026-03-23T12:20:00.000Z",
        },
        structureReport: {
          targetFramePreserved: true,
          imageFillNodeCount: 1,
          textNodeCount: 4,
          vectorNodeCount: 6,
          inferredTextCount: 1,
          passed: true,
          issues: [],
        },
      }),
    );

    const { stdout } = await runCli(["reconstruct", "--job", "job-hybrid", "--render"], fixtureDir);
    assert.match(stdout, /current stage: render-preview/);
    assert.match(stdout, /renderedPreview: 160x100 \| image\/png/);
    assert.match(
      stdout,
      /structureReport: passed=yes \| framePreserved=yes \| imageFillNodes=1 \| vectorNodes=6 \| textNodes=4 \| inferredText=1/,
    );
  });
});

test("plugin_bridge_cli reconstruct --measure prints diff metrics and acceptance gates", async () => {
  await withFixtureDir(async (fixtureDir) => {
    await writeFixture(
      fixtureDir,
      "post__api__reconstruction__jobs__job-hybrid__measure.json",
      createReconstructionJobFixture("hybrid-reconstruction", {
        currentStageId: "measure-diff",
        diffScore: 0.91,
        bestDiffScore: 0.91,
        diffMetrics: {
          globalSimilarity: 0.92,
          colorDelta: 0.08,
          edgeSimilarity: 0.9,
          layoutSimilarity: 0.93,
          structureSimilarity: 0.91,
          hotspotAverage: 0.12,
          hotspotPeak: 0.18,
          hotspotCoverage: 0.2,
          compositeScore: 0.91,
          grade: "A",
          acceptanceGates: [
            {
              id: "layout-gate",
              label: "layoutSimilarity",
              metric: "layoutSimilarity",
              comparator: "gte",
              threshold: 0.9,
              actual: 0.93,
              passed: true,
              hard: true,
            },
            {
              id: "color-gate",
              label: "colorDelta",
              metric: "colorDelta",
              comparator: "lte",
              threshold: 0.15,
              actual: 0.08,
              passed: true,
              hard: false,
            },
          ],
          hotspots: [],
        },
      }),
    );

    const { stdout } = await runCli(["reconstruct", "--job", "job-hybrid", "--measure"], fixtureDir);
    assert.match(stdout, /current stage: measure-diff/);
    assert.match(
      stdout,
      /diffMetrics: composite=0\.9100 grade=A global=0\.9200 layout=0\.9300 structure=0\.9100 edge=0\.9000 colorDelta=0\.0800 hotspotAvg=0\.1200 hotspotPeak=0\.1800 hotspotCoverage=0\.2000/,
    );
    assert.match(stdout, /acceptanceGates:/);
    assert.match(stdout, /- \[pass\] layoutSimilarity: layoutSimilarity gte 0\.900 \(actual=0\.930 \| hard\)/);
    assert.match(stdout, /- \[pass\] colorDelta: colorDelta lte 0\.150 \(actual=0\.080\)/);
  });
});

test("plugin_bridge_cli reconstruct --refine prints terminal status and actionable suggestions", async () => {
  await withFixtureDir(async (fixtureDir) => {
    await writeFixture(
      fixtureDir,
      "post__api__reconstruction__jobs__job-hybrid__refine.json",
      createReconstructionJobFixture("hybrid-reconstruction", {
        status: "completed",
        loopStatus: "stopped",
        stopReason: "target_reached",
        currentStageId: "done",
        refineSuggestions: [
          {
            id: "manual-review-1",
            kind: "manual-review",
            confidence: 0.92,
            message: "当前结果已通过硬门槛。",
            bounds: null,
          },
        ],
        stages: [
          {
            stageId: "done",
            status: "completed",
            message: "Refine complete",
            updatedAt: "2026-03-23T12:30:00.000Z",
          },
        ],
      }),
    );

    const { stdout } = await runCli(["reconstruct", "--job", "job-hybrid", "--refine"], fixtureDir);
    assert.match(stdout, /status: completed/);
    assert.match(stdout, /loopStatus: stopped/);
    assert.match(stdout, /stopReason: target_reached/);
    assert.match(stdout, /current stage: done/);
    assert.match(stdout, /refineSuggestions:\n- \[manual-review\] 当前结果已通过硬门槛。/);
    assert.match(stdout, /stages:\n- done: completed \| Refine complete/);
  });
});

test("plugin_bridge_cli reconstruct --clear resets applied nodes and returns to the apply stage", async () => {
  await withFixtureDir(async (fixtureDir) => {
    await writeFixture(
      fixtureDir,
      "post__api__reconstruction__jobs__job-hybrid__clear.json",
      createReconstructionJobFixture("hybrid-reconstruction", {
        applyStatus: "not_applied",
        currentStageId: "apply-rebuild",
        appliedNodeIds: [],
        stages: [
          {
            stageId: "apply-rebuild",
            status: "completed",
            message: "Cleared applied nodes",
            updatedAt: "2026-03-23T12:40:00.000Z",
          },
        ],
      }),
    );

    const { stdout } = await runCli(["reconstruct", "--job", "job-hybrid", "--clear"], fixtureDir);
    assert.match(stdout, /applyStatus: not_applied/);
    assert.match(stdout, /appliedNodeIds: 0/);
    assert.match(stdout, /stages:\n- apply-rebuild: completed \| Cleared applied nodes/);
  });
});

test("plugin_bridge_cli reconstruct --iterate prints updated iteration metrics and pending refine suggestions", async () => {
  await withFixtureDir(async (fixtureDir) => {
    await writeFixture(
      fixtureDir,
      "post__api__reconstruction__jobs__job-hybrid__iterate.json",
      createReconstructionJobFixture("hybrid-reconstruction", {
        loopStatus: "running",
        currentStageId: "measure-diff",
        iterationCount: 2,
        bestDiffScore: 0.89,
        lastImprovement: 0.03,
        stagnationCount: 0,
        refineSuggestions: [
          {
            id: "layout-1",
            kind: "layout",
            confidence: 0.77,
            message: "Tighten spacing in the top card cluster.",
            bounds: {
              x: 12,
              y: 20,
              width: 100,
              height: 60,
            },
          },
        ],
      }),
    );

    const { stdout } = await runCli(["reconstruct", "--job", "job-hybrid", "--iterate"], fixtureDir);
    assert.match(stdout, /loopStatus: running/);
    assert.match(stdout, /iterationCount: 2/);
    assert.match(stdout, /bestCompositeScore: 0\.8900/);
    assert.match(stdout, /lastImprovement: 0\.0300/);
    assert.match(stdout, /stagnationCount: 0/);
    assert.match(stdout, /refineSuggestions:\n- \[layout\] Tighten spacing in the top card cluster\./);
  });
});

test("plugin_bridge_cli reconstruct --loop prints terminal loop state when the target is reached", async () => {
  await withFixtureDir(async (fixtureDir) => {
    await writeFixture(
      fixtureDir,
      "post__api__reconstruction__jobs__job-hybrid__loop.json",
      createReconstructionJobFixture("hybrid-reconstruction", {
        status: "completed",
        loopStatus: "stopped",
        stopReason: "target_reached",
        currentStageId: "done",
        iterationCount: 3,
        bestDiffScore: 0.94,
        lastImprovement: 0.01,
        stages: [
          {
            stageId: "done",
            status: "completed",
            message: "Loop converged",
            updatedAt: "2026-03-23T12:50:00.000Z",
          },
        ],
      }),
    );

    const { stdout } = await runCli(["reconstruct", "--job", "job-hybrid", "--loop"], fixtureDir);
    assert.match(stdout, /status: completed/);
    assert.match(stdout, /loopStatus: stopped/);
    assert.match(stdout, /stopReason: target_reached/);
    assert.match(stdout, /iterationCount: 3/);
    assert.match(stdout, /bestCompositeScore: 0\.9400/);
    assert.match(stdout, /stages:\n- done: completed \| Loop converged/);
  });
});

test("plugin_bridge_cli rejects unsupported modes with a usage message", async () => {
  let failure: any = null;
  try {
    await runCli(["bad-mode"]);
  } catch (error) {
    failure = error;
  }

  assert.ok(failure, "plugin-bridge-cli should fail on unsupported modes");
  assert.match(String(failure.stderr || ""), /Usage: npm run plugin:status/);
});
