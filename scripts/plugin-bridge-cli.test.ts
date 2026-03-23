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
