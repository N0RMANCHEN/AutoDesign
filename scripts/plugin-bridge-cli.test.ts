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
const VALID_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0uoAAAAASUVORK5CYII=";

async function writeFixture(fixtureDir: string, fileName: string, payload: unknown) {
  await writeFile(path.join(fixtureDir, fileName), JSON.stringify(payload, null, 2), "utf8");
}

async function writeBinaryFixture(fixtureDir: string, fileName: string, contents: Buffer) {
  await writeFile(path.join(fixtureDir, fileName), contents);
}

function pngDataUrl(contents: string) {
  void contents;
  return VALID_PNG_DATA_URL;
}

function pngBuffer() {
  return Buffer.from(VALID_PNG_DATA_URL.split(",")[1], "base64");
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

function createVectorElementAnalysisFixture() {
  return {
    width: 160,
    height: 100,
    previewDataUrl: VALID_PNG_DATA_URL,
    mimeType: "image/png",
    dominantColors: ["#111111", "#F5F7FF"],
    canonicalFrame: {
      width: 160,
      height: 100,
      fixedTargetFrame: true,
      deprojected: true,
      mappingMode: "reflow",
    },
    screenPlane: {
      extracted: true,
      excludesNonUiShell: true,
      confidence: 0.92,
      sourceQuad: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ],
      rectifiedPreviewDataUrl: VALID_PNG_DATA_URL,
    },
    layoutRegions: [],
    designSurfaces: [
      {
        id: "surface-top-card",
        name: "Top Card",
        bounds: { x: 0.08, y: 0.08, width: 0.72, height: 0.46 },
        fillHex: "#6D6FD0",
        cornerRadius: 24,
        opacity: 1,
        shadow: "soft",
        inferred: false,
      },
    ],
    vectorPrimitives: [],
    semanticNodes: [],
    designTokens: null,
    completionPlan: [],
    textCandidates: [],
    textBlocks: [
      {
        id: "text-score",
        bounds: { x: 0.16, y: 0.18, width: 0.22, height: 0.12 },
        role: "metric",
        content: "37.5%",
        inferred: false,
        fontFamily: "SF Pro Display",
        fontStyle: "Bold",
        fontWeight: 700,
        fontSize: 24,
        lineHeight: 26,
        letterSpacing: 0,
        alignment: "left",
        colorHex: "#111111",
      },
    ],
    ocrBlocks: [],
    textStyleHints: [],
    assetCandidates: [],
    completionZones: [],
    deprojectionNotes: [],
    styleHints: {
      theme: "dark",
      cornerRadiusHint: 24,
      shadowHint: "soft",
      primaryColorHex: "#6D6FD0",
      accentColorHex: "#111111",
    },
    uncertainties: [],
  };
}

function createGuideManifestFixture() {
  return {
    jobId: "job-vector",
    targetFrame: {
      id: "target-1",
      width: 160,
      height: 100,
    },
    images: {
      referencePreviewDataUrl: VALID_PNG_DATA_URL,
      rectifiedPreviewDataUrl: VALID_PNG_DATA_URL,
      renderedPreviewDataUrl: VALID_PNG_DATA_URL,
    },
    elements: [
      {
        id: "element/surface-top-card",
        kind: "surface",
        editableKind: "frame",
        name: "Top Card",
        parentId: null,
        referenceBounds: { x: 0.08, y: 0.08, width: 0.72, height: 0.46 },
        targetBounds: { x: 0.08, y: 0.08, width: 0.72, height: 0.46 },
        analysisRefId: "surface-top-card",
        content: null,
        surfaceRefId: "surface-top-card",
        textRefId: null,
        primitiveRefId: null,
        status: "todo",
        inferred: false,
        style: {
          fillHex: "#6D6FD0",
          strokeHex: null,
          strokeWeight: null,
          opacity: 1,
          cornerRadius: 24,
          fontFamily: null,
          fontStyle: null,
          fontWeight: null,
          fontSize: null,
          lineHeight: null,
          letterSpacing: null,
          alignment: null,
          layoutMode: null,
        },
      },
      {
        id: "element/text-score",
        kind: "text",
        editableKind: "text",
        name: "37.5%",
        parentId: "element/surface-top-card",
        referenceBounds: { x: 0.16, y: 0.18, width: 0.22, height: 0.12 },
        targetBounds: { x: 0.16, y: 0.18, width: 0.22, height: 0.12 },
        analysisRefId: "text-score",
        content: "37.5%",
        surfaceRefId: null,
        textRefId: "text-score",
        primitiveRefId: null,
        status: "todo",
        inferred: false,
        style: {
          fillHex: "#111111",
          strokeHex: null,
          strokeWeight: null,
          opacity: 1,
          cornerRadius: null,
          fontFamily: "SF Pro Display",
          fontStyle: "Bold",
          fontWeight: 700,
          fontSize: 24,
          lineHeight: 26,
          letterSpacing: 0,
          alignment: "left",
          layoutMode: null,
        },
      },
    ],
    constraints: [
      {
        id: "same-parent/element/surface-top-card+element/text-score",
        kind: "same-parent",
        elementIds: ["element/surface-top-card", "element/text-score"],
        axis: null,
        targetValue: null,
        tolerance: null,
        hard: true,
        inferred: true,
        description: "37.5% should remain grouped under Top Card.",
      },
    ],
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
          AUTODESIGN_RECONSTRUCT_FIXTURE_DIR: fixtureDir,
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

test("plugin_bridge_cli send composes prompt-driven rename commands without falling through to fill warnings", async () => {
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
          capabilities: [{ id: "nodes.rename" }],
          selection: [
            {
              id: "1:2",
              name: "Old Card",
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
      id: "cmd_rename",
    });

    const { stdout } = await runCli(
      ["send", "--prompt", "把名字改成 HeroCard", "--node-ids", "1:2"],
      fixtureDir,
    );

    assert.match(stdout, /queued: cmd_rename/);
    assert.match(stdout, /notes:\n- 已生成重命名命令：HeroCard。/);
    assert.match(stdout, /"capabilityId": "nodes\.rename"/);
    assert.match(stdout, /"name": "HeroCard"/);
    assert.doesNotMatch(stdout, /无法从这句里识别填充颜色/);
  });
});

test("plugin_bridge_cli send composes compound text prompts into multiple capability commands", async () => {
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
          capabilities: [{ id: "text.set-content" }, { id: "text.set-font-family" }],
          selection: [
            {
              id: "1:2",
              name: "Body Copy",
              type: "TEXT",
              fills: ["#111111"],
              fillStyleId: null,
            },
          ],
        },
      ],
      commands: [],
    });
    await writeFixture(fixtureDir, "post__api__plugin-bridge__commands.json", {
      id: "cmd_text_compound",
    });

    const { stdout } = await runCli(
      ["send", "--prompt", "把文本改成 Hello 字体 SF Pro", "--node-ids", "1:2"],
      fixtureDir,
    );

    assert.match(stdout, /queued: cmd_text_compound/);
    assert.match(stdout, /notes:\n- 已生成文本内容命令：Hello。\n- 已生成字体命令：SF Pro。/);
    assert.match(stdout, /"capabilityId": "text\.set-content"/);
    assert.match(stdout, /"value": "Hello"/);
    assert.match(stdout, /"capabilityId": "text\.set-font-family"/);
    assert.match(stdout, /"family": "SF Pro"/);
  });
});

test("plugin_bridge_cli send composes compound stroke prompts into multiple capability commands", async () => {
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
          capabilities: [{ id: "strokes.set-weight" }, { id: "strokes.set-stroke" }],
          selection: [
            {
              id: "1:2",
              name: "Card Border",
              type: "RECTANGLE",
              fills: ["#FFFFFF"],
              fillStyleId: null,
            },
          ],
        },
      ],
      commands: [],
    });
    await writeFixture(fixtureDir, "post__api__plugin-bridge__commands.json", {
      id: "cmd_stroke_compound",
    });

    const { stdout } = await runCli(
      ["send", "--prompt", "描边 #222222 粗细 3", "--node-ids", "1:2"],
      fixtureDir,
    );

    assert.match(stdout, /queued: cmd_stroke_compound/);
    assert.match(stdout, /notes:\n- 已生成描边粗细命令：3px。\n- 已生成描边颜色命令：#222222。/);
    assert.match(stdout, /"capabilityId": "strokes\.set-weight"/);
    assert.match(stdout, /"value": 3/);
    assert.match(stdout, /"capabilityId": "strokes\.set-stroke"/);
    assert.match(stdout, /"hex": "#222222"/);
  });
});

test("plugin_bridge_cli send preserves distinct fill and stroke colors in one prompt", async () => {
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
          capabilities: [{ id: "fills.set-fill" }, { id: "strokes.set-weight" }, { id: "strokes.set-stroke" }],
          selection: [
            {
              id: "1:2",
              name: "Surface Card",
              type: "RECTANGLE",
              fills: ["#FFFFFF"],
              fillStyleId: null,
            },
          ],
        },
      ],
      commands: [],
    });
    await writeFixture(fixtureDir, "post__api__plugin-bridge__commands.json", {
      id: "cmd_fill_stroke_compound",
    });

    const { stdout } = await runCli(
      ["send", "--prompt", "填充 #111111 描边 #222222 粗细 2", "--node-ids", "1:2"],
      fixtureDir,
    );

    assert.match(stdout, /queued: cmd_fill_stroke_compound/);
    assert.match(
      stdout,
      /notes:\n- 已生成填充颜色命令：#111111。\n- 已生成描边粗细命令：2px。\n- 已生成描边颜色命令：#222222。/,
    );
    assert.match(stdout, /"capabilityId": "fills\.set-fill"/);
    assert.match(stdout, /"hex": "#111111"/);
    assert.match(stdout, /"capabilityId": "strokes\.set-weight"/);
    assert.match(stdout, /"value": 2/);
    assert.match(stdout, /"capabilityId": "strokes\.set-stroke"/);
    assert.match(stdout, /"hex": "#222222"/);
  });
});

test("plugin_bridge_cli send composes rename and fill prompts without swallowing the fill clause into the new name", async () => {
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
          capabilities: [{ id: "nodes.rename" }, { id: "fills.set-fill" }],
          selection: [
            {
              id: "1:2",
              name: "Old Hero",
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
      id: "cmd_rename_fill_compound",
    });

    const { stdout } = await runCli(
      ["send", "--prompt", "重命名为 Hero 填充 #111111", "--node-ids", "1:2"],
      fixtureDir,
    );

    assert.match(stdout, /queued: cmd_rename_fill_compound/);
    assert.match(stdout, /notes:\n- 已生成重命名命令：Hero。\n- 已生成填充颜色命令：#111111。/);
    assert.match(stdout, /"capabilityId": "nodes\.rename"/);
    assert.match(stdout, /"name": "Hero"/);
    assert.match(stdout, /"capabilityId": "fills\.set-fill"/);
    assert.match(stdout, /"hex": "#111111"/);
    assert.doesNotMatch(stdout, /"name": "Hero 填充 #111111"/);
  });
});

test("plugin_bridge_cli send composes text-color and opacity prompts into multiple capability commands", async () => {
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
          capabilities: [{ id: "text.set-text-color" }, { id: "nodes.set-opacity" }],
          selection: [
            {
              id: "1:2",
              name: "Body Copy",
              type: "TEXT",
              fills: ["#333333"],
              fillStyleId: null,
            },
          ],
        },
      ],
      commands: [],
    });
    await writeFixture(fixtureDir, "post__api__plugin-bridge__commands.json", {
      id: "cmd_text_opacity_compound",
    });

    const { stdout } = await runCli(
      ["send", "--prompt", "文字颜色 #111111 透明度 80", "--node-ids", "1:2"],
      fixtureDir,
    );

    assert.match(stdout, /queued: cmd_text_opacity_compound/);
    assert.match(stdout, /notes:\n- 已生成文字颜色命令：#111111。\n- 已生成透明度命令：80%。/);
    assert.match(stdout, /"capabilityId": "text\.set-text-color"/);
    assert.match(stdout, /"hex": "#111111"/);
    assert.match(stdout, /"capabilityId": "nodes\.set-opacity"/);
    assert.match(stdout, /"value": 80/);
  });
});

test("plugin_bridge_cli send composes style-apply and opacity prompts into multiple capability commands", async () => {
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
          capabilities: [{ id: "styles.apply-style" }, { id: "nodes.set-opacity" }],
          selection: [
            {
              id: "1:2",
              name: "Styled Card",
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
      id: "cmd_style_opacity_compound",
    });

    const { stdout } = await runCli(
      ["send", "--prompt", "应用样式 Primary Card 透明度 80", "--node-ids", "1:2"],
      fixtureDir,
    );

    assert.match(stdout, /queued: cmd_style_opacity_compound/);
    assert.match(stdout, /notes:\n- 已生成样式应用命令：Primary Card。\n- 已生成透明度命令：80%。/);
    assert.match(stdout, /"capabilityId": "styles\.apply-style"/);
    assert.match(stdout, /"styleName": "Primary Card"/);
    assert.match(stdout, /"capabilityId": "nodes\.set-opacity"/);
    assert.match(stdout, /"value": 80/);
  });
});

test("plugin_bridge_cli send treats style definitions with color and apply as paint-style upserts", async () => {
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
          capabilities: [{ id: "styles.upsert-paint-style" }],
          selection: [
            {
              id: "1:2",
              name: "Styled Card",
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
      id: "cmd_style_upsert_apply",
    });

    const { stdout } = await runCli(
      ["send", "--prompt", "样式 Primary Card #111111 应用", "--node-ids", "1:2"],
      fixtureDir,
    );

    assert.match(stdout, /queued: cmd_style_upsert_apply/);
    assert.match(stdout, /notes:\n- 已生成样式命令：Primary Card。/);
    assert.match(stdout, /"capabilityId": "styles\.upsert-paint-style"/);
    assert.match(stdout, /"name": "Primary Card"/);
    assert.match(stdout, /"hex": "#111111"/);
    assert.match(stdout, /"applyToSelection": true/);
    assert.doesNotMatch(stdout, /"capabilityId": "styles\.apply-style"/);
  });
});

test("plugin_bridge_cli send keeps apply-style prompts from drifting into paint-style upsert when a fill clause follows", async () => {
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
          capabilities: [{ id: "styles.apply-style" }, { id: "fills.set-fill" }],
          selection: [
            {
              id: "1:2",
              name: "Styled Card",
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
      id: "cmd_apply_style_fill_compound",
    });

    const { stdout } = await runCli(
      ["send", "--prompt", "应用样式 Primary Card 填充 #111111", "--node-ids", "1:2"],
      fixtureDir,
    );

    assert.match(stdout, /queued: cmd_apply_style_fill_compound/);
    assert.match(stdout, /notes:\n- 已生成样式应用命令：Primary Card。\n- 已生成填充颜色命令：#111111。/);
    assert.match(stdout, /"capabilityId": "styles\.apply-style"/);
    assert.match(stdout, /"styleName": "Primary Card"/);
    assert.match(stdout, /"capabilityId": "fills\.set-fill"/);
    assert.match(stdout, /"hex": "#111111"/);
    assert.doesNotMatch(stdout, /"capabilityId": "styles\.upsert-paint-style"/);
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
      assert.equal(bytes[0], 0x89);
      assert.equal(bytes[1], 0x50);
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
      assert.equal(bytes[0], 0x89);
      assert.equal(bytes[1], 0x50);
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
      assert.equal((await readFile(referencePath))[0], 0x89);
      assert.equal((await readFile(rectifiedPath))[0], 0x89);
      assert.equal((await readFile(targetPath))[0], 0x89);
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

test("plugin_bridge_cli reconstruct --export-guides writes a guide manifest with synthesized elements", async () => {
  await withFixtureDir(async (fixtureDir) => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "autodesign-reconstruction-guides-"));
    try {
      await writeFixture(
        fixtureDir,
        "get__api__reconstruction__jobs__job-vector.json",
        createReconstructionJobFixture("vector-reconstruction", {
          id: "job-vector",
          analysis: createVectorElementAnalysisFixture(),
        }),
      );
      await writeFixture(
        fixtureDir,
        "get__api__reconstruction__jobs__job-vector__guide-manifest.json",
        createGuideManifestFixture(),
      );

      const { stdout } = await runCli(
        ["reconstruct", "--job", "job-vector", "--export-guides", "--out", outputDir],
        fixtureDir,
      );

      const manifestPath = path.join(outputDir, "job-vector-guide-manifest.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      assert.match(stdout, /guideManifest: .*job-vector-guide-manifest\.json/);
      assert.equal(manifest.jobId, "job-vector");
      assert.ok(Array.isArray(manifest.elements));
      assert.ok(manifest.elements.length >= 2);
      assert.ok(Array.isArray(manifest.constraints));
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });
});

test("plugin_bridge_cli reconstruct --export-guides rejects missing structured analysis", async () => {
  await withFixtureDir(async (fixtureDir) => {
    await writeFixture(
      fixtureDir,
      "get__api__reconstruction__jobs__job-vector.json",
      createReconstructionJobFixture("vector-reconstruction", {
        id: "job-vector",
      }),
    );

    await assert.rejects(
      () => runCli(["reconstruct", "--job", "job-vector", "--export-guides"], fixtureDir),
      (error: Error & { stderr?: string }) => {
        assert.match(String(error.stderr || ""), /Reconstruction job has no structured analysis yet\./);
        return true;
      },
    );
  });
});

test("plugin_bridge_cli reconstruct --estimate-quad --draft-analysis writes vector draft artifacts from offline fixtures", async () => {
  await withFixtureDir(async (fixtureDir) => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "autodesign-reconstruction-vector-draft-"));
    try {
      await writeFixture(
        fixtureDir,
        "get__api__reconstruction__jobs__job-vector.json",
        createReconstructionJobFixture("vector-reconstruction", {
          id: "job-vector",
          referenceNode: {
            id: "reference-1",
            name: "Reference Frame",
            type: "FRAME",
            fillable: true,
            fills: [],
            fillStyleId: null,
            width: 200,
            height: 100,
          },
          referenceRaster: {
            nodeId: "reference-1",
            mimeType: "image/png",
            width: 200,
            height: 100,
            dataUrl: VALID_PNG_DATA_URL,
            source: "node-export",
          },
        }),
      );
      await writeFixture(fixtureDir, "estimate-screen-quad__job-vector.json", {
        rotationDegrees: 11.5,
        rotatedBox: {
          x: 20,
          y: 10,
          width: 160,
          height: 80,
          density: 0.84,
        },
        sourceQuadPixels: [
          { x: 20, y: 10 },
          { x: 180, y: 10 },
          { x: 180, y: 90 },
          { x: 20, y: 90 },
        ],
        debug: {
          originalOverlayPath: "/tmp/job-vector-original-overlay.png",
          rotatedOverlayPath: "/tmp/job-vector-rotated-overlay.png",
        },
      });
      await writeBinaryFixture(fixtureDir, "reconstruct-remap-preview__job-vector.png", pngBuffer());
      await writeFixture(fixtureDir, "preview-heuristic__job-vector-remap-preview.json", {
        width: 160,
        height: 100,
        dominantColors: ["#111111", "#6D6FD0"],
        layoutRegions: [
          {
            id: "surface-top-card",
            kind: "surface",
            confidence: 0.96,
            bounds: { x: 0.08, y: 0.08, width: 0.72, height: 0.46 },
            fillHex: "#6D6FD0",
          },
        ],
        textCandidates: [
          {
            id: "metric-1",
            confidence: 0.98,
            bounds: { x: 0.16, y: 0.18, width: 0.22, height: 0.12 },
            estimatedRole: "metric",
          },
        ],
        textStyleHints: [
          {
            textCandidateId: "metric-1",
            role: "metric",
            fontCategory: "display",
            fontWeightGuess: 700,
            fontSizeEstimate: 24,
            colorHex: "#111111",
            alignmentGuess: "left",
            lineHeightEstimate: 26,
            letterSpacingEstimate: 0,
            confidence: 0.92,
          },
        ],
        assetCandidates: [],
        styleHints: {
          theme: "dark",
          cornerRadiusHint: 24,
          shadowHint: "soft",
          primaryColorHex: "#111111",
          accentColorHex: "#6D6FD0",
        },
        uncertainties: [],
      });
      await writeFixture(fixtureDir, "vision-ocr__job-vector-remap-preview.json", [
        {
          text: "37.5%",
          confidence: 0.99,
          bounds: { x: 0.16, y: 0.18, width: 0.22, height: 0.12 },
        },
      ]);

      const { stdout } = await runCli(
        ["reconstruct", "--job", "job-vector", "--estimate-quad", "--draft-analysis", "--out", outputDir],
        fixtureDir,
      );

      const remapPath = path.join(outputDir, "job-vector-remap-preview.png");
      const draftPath = path.join(outputDir, "job-vector-vector-analysis-draft.json");
      const draft = JSON.parse(await readFile(draftPath, "utf8"));

      assert.match(stdout, /job: job-vector/);
      assert.match(stdout, /estimatedRotation: 11\.5deg/);
      assert.match(stdout, /sourceQuadPx: 20,10 \| 180,10 \| 180,90 \| 20,90/);
      assert.match(stdout, new RegExp(`remapPreview: ${remapPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
      assert.match(stdout, new RegExp(`analysisDraft: ${draftPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
      assert.equal((await readFile(remapPath))[0], 0x89);
      assert.equal(draft.analysisProvider, "codex-assisted");
      assert.deepEqual(draft.analysis.canonicalFrame.sourceQuad[0], { x: 0.1, y: 0.1 });
      assert.equal(draft.analysis.textBlocks[0].content, "37.5%");
      assert.ok(draft.analysis.designSurfaces.length >= 1);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });
});

test("plugin_bridge_cli reconstruct --draft-analysis writes a hybrid draft from an explicit source quad", async () => {
  await withFixtureDir(async (fixtureDir) => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "autodesign-reconstruction-hybrid-draft-"));
    try {
      await writeFixture(
        fixtureDir,
        "get__api__reconstruction__jobs__job-hybrid.json",
        createReconstructionJobFixture("hybrid-reconstruction", {
          id: "job-hybrid",
          referenceRaster: {
            nodeId: "reference-1",
            mimeType: "image/png",
            width: 160,
            height: 100,
            dataUrl: VALID_PNG_DATA_URL,
            source: "node-export",
          },
        }),
      );
      await writeBinaryFixture(fixtureDir, "reconstruct-remap-preview__job-hybrid.png", pngBuffer());

      const { stdout } = await runCli(
        [
          "reconstruct",
          "--job",
          "job-hybrid",
          "--draft-analysis",
          "--source-quad-px",
          "16,10;144,10;144,90;16,90",
          "--out",
          outputDir,
        ],
        fixtureDir,
      );

      const remapPath = path.join(outputDir, "job-hybrid-remap-preview.png");
      const draftPath = path.join(outputDir, "job-hybrid-hybrid-analysis-draft.json");
      const draft = JSON.parse(await readFile(draftPath, "utf8"));

      assert.match(stdout, /job: job-hybrid/);
      assert.match(stdout, /sourceQuadPx: 16,10 \| 144,10 \| 144,90 \| 16,90/);
      assert.match(stdout, new RegExp(`remapPreview: ${remapPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
      assert.match(stdout, new RegExp(`analysisDraft: ${draftPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
      assert.equal((await readFile(remapPath))[0], 0x89);
      assert.equal(draft.analysisProvider, "codex-assisted");
      assert.deepEqual(draft.analysis.canonicalFrame.sourceQuad[0], { x: 0.1, y: 0.1 });
      assert.equal(draft.analysis.deprojectionNotes[0].id, "source-quad-draft");
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });
});

test("plugin_bridge_cli reconstruct --preview-remap requires an explicit or estimated source quad", async () => {
  await withFixtureDir(async (fixtureDir) => {
    await writeFixture(
      fixtureDir,
      "get__api__reconstruction__jobs__job-hybrid.json",
      createReconstructionJobFixture("hybrid-reconstruction", {
        id: "job-hybrid",
        referenceRaster: {
          nodeId: "reference-1",
          mimeType: "image/png",
          width: 160,
          height: 100,
          dataUrl: VALID_PNG_DATA_URL,
          source: "node-export",
        },
      }),
    );

    await assert.rejects(
      () => runCli(["reconstruct", "--job", "job-hybrid", "--preview-remap"], fixtureDir),
      (error: Error & { stderr?: string }) => {
        assert.match(String(error.stderr || ""), /无法获得 sourceQuad。请提供 --source-quad-px，或使用 --estimate-quad。/);
        return true;
      },
    );
  });
});

test("plugin_bridge_cli reconstruct --score-elements prints per-element scores using live frame inspection", async () => {
  await withFixtureDir(async (fixtureDir) => {
    await writeFixture(
      fixtureDir,
      "get__api__reconstruction__jobs__job-vector.json",
      createReconstructionJobFixture("vector-reconstruction", {
        id: "job-vector",
        analysis: createVectorElementAnalysisFixture(),
        referenceRaster: {
          nodeId: "reference-1",
          mimeType: "image/png",
          width: 160,
          height: 100,
          dataUrl: VALID_PNG_DATA_URL,
          source: "node-export",
        },
        renderedPreview: {
          previewDataUrl: VALID_PNG_DATA_URL,
          mimeType: "image/png",
          width: 160,
          height: 100,
          capturedAt: "2026-03-23T12:20:00.000Z",
        },
      }),
    );
    await writeFixture(
      fixtureDir,
      "get__api__reconstruction__jobs__job-vector__guide-manifest.json",
      createGuideManifestFixture(),
    );
    await writeFixture(fixtureDir, "post__api__plugin-bridge__inspect-frame.json", {
      sessionId: "session_1",
      frameNodeId: "target-1",
      preview: {
        kind: "node-image",
        nodeId: "target-1",
        mimeType: "image/png",
        width: 160,
        height: 100,
        dataUrl: VALID_PNG_DATA_URL,
        source: "node-export",
      },
      nodes: [
        {
          id: "target-1",
          name: "Target Frame",
          type: "FRAME",
          fillable: true,
          fills: [],
          fillStyleId: null,
          x: 0,
          y: 0,
          absoluteX: 0,
          absoluteY: 0,
          width: 160,
          height: 100,
          depth: 0,
          childCount: 2,
          indexWithinParent: 0,
        },
        {
          id: "node-top-card",
          name: "Top Card",
          type: "FRAME",
          fillable: true,
          fills: ["#6D6FD0"],
          fillStyleId: null,
          x: 12.8,
          y: 8,
          absoluteX: 12.8,
          absoluteY: 8,
          width: 115.2,
          height: 46,
          parentNodeId: "target-1",
          parentNodeType: "FRAME",
          depth: 1,
          childCount: 1,
          indexWithinParent: 0,
          cornerRadius: 24,
          opacity: 1,
          analysisRefId: "surface-top-card",
          generatedBy: "reconstruction",
        },
        {
          id: "node-score",
          name: "37.5%",
          type: "TEXT",
          fillable: true,
          fills: ["#111111"],
          fillStyleId: null,
          x: 25.6,
          y: 18,
          absoluteX: 25.6,
          absoluteY: 18,
          width: 35.2,
          height: 12,
          parentNodeId: "node-top-card",
          parentNodeType: "FRAME",
          depth: 2,
          childCount: 0,
          indexWithinParent: 0,
          textContent: "37.5%",
          fontFamily: "SF Pro Display",
          fontStyle: "Bold",
          fontSize: 24,
          fontWeight: 700,
          textAlignment: "LEFT",
          analysisRefId: "text-score",
          generatedBy: "reconstruction",
        },
      ],
    });
    await writeFixture(
      fixtureDir,
      "post__api__reconstruction__jobs__job-vector__element-scores.json",
      {
        jobId: "job-vector",
        referencePreviewKind: "rectified",
        liveNodeCount: 3,
        scores: [
          {
            elementId: "element/surface-top-card",
            elementName: "Top Card",
            kind: "surface",
            inspectedNodeId: "node-top-card",
            matchStrategy: "analysis-ref",
            referenceBounds: { x: 0.08, y: 0.08, width: 0.72, height: 0.46 },
            targetBounds: { x: 0.08, y: 0.08, width: 0.72, height: 0.46 },
            pixelScore: 0.98,
            geometryScore: 0.99,
            styleScore: 0.97,
            typographyScore: 1,
            alignmentScore: 0.95,
            editabilityScore: 1,
            compositeScore: 0.98,
            grade: "A",
            hardFailures: [],
            notes: [],
          },
          {
            elementId: "element/text-score",
            elementName: "37.5%",
            kind: "text",
            inspectedNodeId: "node-score",
            matchStrategy: "analysis-ref",
            referenceBounds: { x: 0.16, y: 0.18, width: 0.22, height: 0.12 },
            targetBounds: { x: 0.16, y: 0.18, width: 0.22, height: 0.12 },
            pixelScore: 0.97,
            geometryScore: 0.98,
            styleScore: 0.95,
            typographyScore: 0.99,
            alignmentScore: 0.96,
            editabilityScore: 1,
            compositeScore: 0.98,
            grade: "A",
            hardFailures: [],
            notes: [],
          },
        ],
      },
    );

    const { stdout } = await runCli(["reconstruct", "--job", "job-vector", "--score-elements"], fixtureDir);
    assert.match(stdout, /elementScores:/);
    assert.match(stdout, /Top Card \[surface\]/);
    assert.match(stdout, /37\.5% \[text\]/);
    assert.match(stdout, /match=analysis-ref/);
  });
});

test("plugin_bridge_cli reconstruct --score-elements rejects missing structured analysis", async () => {
  await withFixtureDir(async (fixtureDir) => {
    await writeFixture(
      fixtureDir,
      "get__api__reconstruction__jobs__job-vector.json",
      createReconstructionJobFixture("vector-reconstruction", {
        id: "job-vector",
      }),
    );

    await assert.rejects(
      () => runCli(["reconstruct", "--job", "job-vector", "--score-elements"], fixtureDir),
      (error: Error & { stderr?: string }) => {
        assert.match(String(error.stderr || ""), /Reconstruction job has no structured analysis yet/);
        return true;
      },
    );
  });
});

test("plugin_bridge_cli reconstruct --render-element exports reference and rendered crops", async () => {
  await withFixtureDir(async (fixtureDir) => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "autodesign-reconstruction-element-render-"));
    try {
      await writeFixture(
        fixtureDir,
        "get__api__reconstruction__jobs__job-vector.json",
        createReconstructionJobFixture("vector-reconstruction", {
          id: "job-vector",
          analysis: createVectorElementAnalysisFixture(),
          referenceRaster: {
            nodeId: "reference-1",
            mimeType: "image/png",
            width: 160,
            height: 100,
            dataUrl: VALID_PNG_DATA_URL,
            source: "node-export",
          },
          renderedPreview: {
            previewDataUrl: VALID_PNG_DATA_URL,
            mimeType: "image/png",
            width: 160,
            height: 100,
            capturedAt: "2026-03-23T12:20:00.000Z",
          },
        }),
      );
      await writeFixture(
        fixtureDir,
        "get__api__reconstruction__jobs__job-vector__guide-manifest.json",
        createGuideManifestFixture(),
      );
      await writeFixture(fixtureDir, "post__api__plugin-bridge__inspect-frame.json", {
        sessionId: "session_1",
        frameNodeId: "target-1",
        preview: {
          kind: "node-image",
          nodeId: "target-1",
          mimeType: "image/png",
          width: 160,
          height: 100,
          dataUrl: VALID_PNG_DATA_URL,
          source: "node-export",
        },
        nodes: [
          {
            id: "target-1",
            name: "Target Frame",
            type: "FRAME",
            fillable: true,
            fills: [],
            fillStyleId: null,
            x: 0,
            y: 0,
            absoluteX: 0,
            absoluteY: 0,
            width: 160,
            height: 100,
            depth: 0,
            childCount: 0,
            indexWithinParent: 0,
          },
        ],
      });

      const { stdout } = await runCli(
        ["reconstruct", "--job", "job-vector", "--render-element", "37.5%", "--out", outputDir],
        fixtureDir,
      );
      assert.match(stdout, /element: 37\.5% \[element\/text-score\]/);
      assert.ok((await readFile(path.join(outputDir, "job-vector-37-5-reference.png"))).length > 0);
      assert.ok((await readFile(path.join(outputDir, "job-vector-37-5-rendered.png"))).length > 0);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });
});

test("plugin_bridge_cli reconstruct --render-element rejects missing structured analysis", async () => {
  await withFixtureDir(async (fixtureDir) => {
    await writeFixture(
      fixtureDir,
      "get__api__reconstruction__jobs__job-vector.json",
      createReconstructionJobFixture("vector-reconstruction", {
        id: "job-vector",
      }),
    );

    await assert.rejects(
      () => runCli(["reconstruct", "--job", "job-vector", "--render-element", "37.5%"], fixtureDir),
      (error: Error & { stderr?: string }) => {
        assert.match(String(error.stderr || ""), /Reconstruction job has no structured analysis yet\./);
        return true;
      },
    );
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
      "get__api__reconstruction__jobs__job-hybrid.json",
      createReconstructionJobFixture("hybrid-reconstruction", {
        id: "job-hybrid",
        approvalState: "approved",
        rebuildPlan: {
          previewOnly: false,
          summary: ["Apply vector rebuild"],
          ops: [],
        },
      }),
    );
    await writeFixture(
      fixtureDir,
      "post__api__reconstruction__jobs__job-hybrid__apply.json",
      createReconstructionJobFixture("hybrid-reconstruction", {
        id: "job-hybrid",
        approvalState: "approved",
        rebuildPlan: {
          previewOnly: false,
          summary: ["Apply vector rebuild"],
          ops: [],
        },
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
    assert.match(stdout, /job: job-hybrid/);
    assert.match(stdout, /applyStatus: applied/);
    assert.match(stdout, /current stage: apply-rebuild/);
    assert.match(stdout, /appliedNodeIds: 2/);
    assert.match(stdout, /stages:\n- apply-rebuild: completed \| Rebuild applied/);
  });
});

test("plugin_bridge_cli reconstruct --apply rejects missing rebuild plan before posting", async () => {
  await withFixtureDir(async (fixtureDir) => {
    await writeFixture(
      fixtureDir,
      "get__api__reconstruction__jobs__job-hybrid.json",
      createReconstructionJobFixture("hybrid-reconstruction", {
        id: "job-hybrid",
      }),
    );

    await assert.rejects(
      () => runCli(["reconstruct", "--job", "job-hybrid", "--apply"], fixtureDir),
      (error: Error & { stderr?: string }) => {
        assert.match(String(error.stderr || ""), /Reconstruction job has no rebuild plan yet/);
        return true;
      },
    );
  });
});

test("plugin_bridge_cli reconstruct --apply rejects unapproved rebuilds before posting", async () => {
  await withFixtureDir(async (fixtureDir) => {
    await writeFixture(
      fixtureDir,
      "get__api__reconstruction__jobs__job-hybrid.json",
      createReconstructionJobFixture("hybrid-reconstruction", {
        id: "job-hybrid",
        approvalState: "pending-review",
        rebuildPlan: {
          previewOnly: false,
          summary: ["Need approval before apply"],
          ops: [],
        },
      }),
    );

    await assert.rejects(
      () => runCli(["reconstruct", "--job", "job-hybrid", "--apply"], fixtureDir),
      (error: Error & { stderr?: string }) => {
        assert.match(String(error.stderr || ""), /Reconstruction job must be approved before apply\. current approvalState=pending-review/);
        return true;
      },
    );
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
      "get__api__reconstruction__jobs__job-hybrid.json",
      createReconstructionJobFixture("hybrid-reconstruction", {
        id: "job-hybrid",
        renderedPreview: {
          previewDataUrl: pngDataUrl("rendered-preview"),
          mimeType: "image/png",
          width: 160,
          height: 100,
          capturedAt: "2026-03-23T12:20:00.000Z",
        },
      }),
    );
    await writeFixture(
      fixtureDir,
      "post__api__reconstruction__jobs__job-hybrid__measure.json",
      createReconstructionJobFixture("hybrid-reconstruction", {
        id: "job-hybrid",
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

test("plugin_bridge_cli reconstruct --measure rejects missing rendered preview before posting", async () => {
  await withFixtureDir(async (fixtureDir) => {
    await writeFixture(
      fixtureDir,
      "get__api__reconstruction__jobs__job-hybrid.json",
      createReconstructionJobFixture("hybrid-reconstruction", {
        id: "job-hybrid",
      }),
    );

    await assert.rejects(
      () => runCli(["reconstruct", "--job", "job-hybrid", "--measure"], fixtureDir),
      (error: Error & { stderr?: string }) => {
        assert.match(String(error.stderr || ""), /Reconstruction job has no rendered preview yet\./);
        return true;
      },
    );
  });
});

test("plugin_bridge_cli reconstruct --refine rejects missing diff metrics before posting", async () => {
  await withFixtureDir(async (fixtureDir) => {
    await writeFixture(
      fixtureDir,
      "get__api__reconstruction__jobs__job-preview.json",
      createReconstructionJobFixture("structural-preview", {
        id: "job-preview",
      }),
    );

    await assert.rejects(
      () => runCli(["reconstruct", "--job", "job-preview", "--refine"], fixtureDir),
      (error: Error & { stderr?: string }) => {
        assert.match(String(error.stderr || ""), /Reconstruction job has no diff metrics yet\./);
        return true;
      },
    );
  });
});

test("plugin_bridge_cli reconstruct --refine rejects unsupported hybrid auto-refine before posting", async () => {
  await withFixtureDir(async (fixtureDir) => {
    await writeFixture(
      fixtureDir,
      "get__api__reconstruction__jobs__job-hybrid.json",
      createReconstructionJobFixture("hybrid-reconstruction", {
        id: "job-hybrid",
      }),
    );

    await assert.rejects(
      () => runCli(["reconstruct", "--job", "job-hybrid", "--refine"], fixtureDir),
      (error: Error & { stderr?: string }) => {
        assert.match(String(error.stderr || ""), /hybrid-reconstruction 当前先支持 apply\/render\/measure，暂不支持自动 refine。/);
        return true;
      },
    );
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

test("plugin_bridge_cli reconstruct --iterate rejects unsupported vector iteration before posting", async () => {
  await withFixtureDir(async (fixtureDir) => {
    await writeFixture(
      fixtureDir,
      "get__api__reconstruction__jobs__job-vector.json",
      createReconstructionJobFixture("vector-reconstruction", {
        id: "job-vector",
      }),
    );

    await assert.rejects(
      () => runCli(["reconstruct", "--job", "job-vector", "--iterate"], fixtureDir),
      (error: Error & { stderr?: string }) => {
        assert.match(String(error.stderr || ""), /vector-reconstruction 目前不支持 iterate。请修改 analysis\/rebuild plan 后重新 apply。/);
        return true;
      },
    );
  });
});

test("plugin_bridge_cli reconstruct --iterate rejects missing analysis before posting", async () => {
  await withFixtureDir(async (fixtureDir) => {
    await writeFixture(
      fixtureDir,
      "get__api__reconstruction__jobs__job-preview.json",
      createReconstructionJobFixture("structural-preview", {
        id: "job-preview",
      }),
    );

    await assert.rejects(
      () => runCli(["reconstruct", "--job", "job-preview", "--iterate"], fixtureDir),
      (error: Error & { stderr?: string }) => {
        assert.match(String(error.stderr || ""), /Reconstruction job has no analysis yet/);
        return true;
      },
    );
  });
});

test("plugin_bridge_cli reconstruct --loop rejects unsupported raster refine loop before posting", async () => {
  await withFixtureDir(async (fixtureDir) => {
    await writeFixture(
      fixtureDir,
      "get__api__reconstruction__jobs__job-raster.json",
      createReconstructionJobFixture("raster-exact", {
        id: "job-raster",
      }),
    );

    await assert.rejects(
      () => runCli(["reconstruct", "--job", "job-raster", "--loop"], fixtureDir),
      (error: Error & { stderr?: string }) => {
        assert.match(String(error.stderr || ""), /raster-exact job 不支持自动 refine loop。/);
        return true;
      },
    );
  });
});

test("plugin_bridge_cli reconstruct --loop rejects unapplied jobs before posting", async () => {
  await withFixtureDir(async (fixtureDir) => {
    await writeFixture(
      fixtureDir,
      "get__api__reconstruction__jobs__job-preview.json",
      createReconstructionJobFixture("structural-preview", {
        id: "job-preview",
        analysis: createVectorElementAnalysisFixture(),
        applyStatus: "not_applied",
      }),
    );

    await assert.rejects(
      () => runCli(["reconstruct", "--job", "job-preview", "--loop"], fixtureDir),
      (error: Error & { stderr?: string }) => {
        assert.match(String(error.stderr || ""), /Reconstruction job must be applied before running auto refine loop/);
        return true;
      },
    );
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
