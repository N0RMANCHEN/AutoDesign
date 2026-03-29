import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { buildRuntimeReadRequest } from "./runtime-read-cli.js";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = path.join(repoRoot, "scripts", "runtime-read-cli.ts");
const VALID_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0uoAAAAASUVORK5CYII=";

async function runCli(args: string[], fixtureDir?: string) {
  return execFileAsync(
    process.execPath,
    ["--import", "tsx", scriptPath, ...args],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        ...(fixtureDir ? { AUTODESIGN_API_FIXTURE_DIR: fixtureDir } : {}),
      },
    },
  );
}

async function withFixtureDir<T>(run: (fixtureDir: string) => Promise<T>) {
  const fixtureDir = await mkdtemp(path.join(os.tmpdir(), "autodesign-runtime-read-cli-"));
  try {
    return await run(fixtureDir);
  } finally {
    await rm(fixtureDir, { recursive: true, force: true });
  }
}

async function writeFixture(fixtureDir: string, fileName: string, payload: unknown) {
  await writeFile(path.join(fixtureDir, fileName), JSON.stringify(payload, null, 2), "utf8");
}

function readRequestBody(request: ReturnType<typeof buildRuntimeReadRequest>) {
  return JSON.parse(String(request.init?.body || "{}"));
}

test("runtime_read_cli bridge_overview prints the narrowed runtime overview fixture", async () => {
  await withFixtureDir(async (fixtureDir) => {
    await writeFixture(fixtureDir, "get__api__runtime__bridge-overview.json", {
      sessionCount: 1,
      onlineSessionCount: 1,
      staleSessionCount: 0,
      commandCounts: {
        queued: 0,
        claimed: 0,
        succeeded: 1,
        failed: 0,
      },
      sessions: [
        {
          id: "session_test",
          label: "AutoDesign",
          editorType: "figma",
          fileName: "Demo File",
          pageName: "Page A",
          status: "online",
          lastSeenAt: "2026-03-29T00:00:00.000Z",
          lastHandshakeAt: "2026-03-29T00:00:00.000Z",
          selectionCount: 2,
          capabilityCount: 3,
          supportsExplicitNodeTargeting: true,
          hasStyleSnapshot: true,
          hasVariableSnapshot: true,
        },
      ],
      commands: [],
    });

    const { stdout } = await runCli(["bridge_overview"], fixtureDir);
    const payload = JSON.parse(stdout);
    assert.equal(payload.sessionCount, 1);
    assert.equal(payload.sessions[0]?.id, "session_test");
    assert.equal(payload.commandCounts.succeeded, 1);
  });
});

test("runtime_read_cli get_design_context prints the local design-context fixture", async () => {
  await withFixtureDir(async (fixtureDir) => {
    await writeFixture(fixtureDir, "post__api__runtime__design-context.json", {
      selectionIds: ["mapping-button-primary"],
      primarySelectionId: "mapping-button-primary",
      metadata: [
        {
          id: "mapping-button-primary",
          kind: "component",
          title: "Button/Primary -> ButtonPrimary",
          summary: "linked",
          relatedIds: ["screen-button-system"],
        },
      ],
      contextPack: {
        selectionIds: ["mapping-button-primary"],
        graphKind: "knowledge",
        action: "knowledge/learning_path",
      },
      designContext: {
        sources: [],
        screens: [],
        componentMappings: [
          {
            id: "mapping-button-primary",
            designName: "Button/Primary",
            reactName: "ButtonPrimary",
          },
        ],
        reviewItems: [],
      },
      variableDefs: {
        available: true,
        source: "plugin-session-variable-snapshot",
        note: "using plugin live session variable snapshot",
        collections: [],
        colors: ["Colors/primary = #0F172A"],
        spacing: [],
        variables: [],
      },
      pluginSelection: {
        targetSessionId: "session_test",
        primarySelectionNodeId: "target-1",
        available: true,
        source: "plugin-selection-summary",
        note: "using cached plugin selection summary",
        selectionNodeIds: ["target-1"],
        selection: [],
        dependencies: {
          resolvedStyles: [],
          resolvedVariables: [],
          unresolvedStyleIds: [],
          unresolvedVariableIds: [],
        },
      },
    });

    const { stdout } = await runCli(
      [
        "get_design_context",
        "--selection-ids",
        "mapping-button-primary",
        "--session",
        "session_test",
        "--action",
        "knowledge/learning_path",
      ],
      fixtureDir,
    );

    const payload = JSON.parse(stdout);
    assert.equal(payload.primarySelectionId, "mapping-button-primary");
    assert.equal(payload.contextPack.graphKind, "knowledge");
    assert.equal(payload.contextPack.action, "knowledge/learning_path");
    assert.equal(payload.variableDefs.source, "plugin-session-variable-snapshot");
  });
});

test("runtime_read_cli get_screenshot writes the screenshot artifact from fixture output", async () => {
  await withFixtureDir(async (fixtureDir) => {
    const outputPath = path.join(fixtureDir, "artifacts", "reference.png");

    await writeFixture(fixtureDir, "post__api__runtime__screenshot.json", {
      targetSessionId: "session_test",
      nodeId: "reference-1",
      available: true,
      source: "plugin-export",
      note: null,
      screenshot: {
        mimeType: "image/png",
        width: 1,
        height: 1,
        dataUrl: VALID_PNG_DATA_URL,
      },
    });

    const { stdout } = await runCli(
      [
        "get_screenshot",
        "--session",
        "session_test",
        "--node-id",
        "reference-1",
        "--allow-live-export",
        "--prefer-original-bytes",
        "--constraint-type",
        "WIDTH",
        "--constraint-value",
        "320",
        "--out",
        outputPath,
      ],
      fixtureDir,
    );

    const payload = JSON.parse(stdout);
    assert.equal(payload.available, true);
    assert.equal(payload.artifactPath, outputPath);
    const contents = await readFile(outputPath);
    assert.deepEqual(contents, Buffer.from(VALID_PNG_DATA_URL.split(",")[1], "base64"));
  });
});

test("runtime_read_cli buildRuntimeReadRequest narrows get_metadata and get_variable_defs payloads", () => {
  const metadataRequest = buildRuntimeReadRequest([
    "node",
    scriptPath,
    "get_metadata",
    "--selection-ids",
    "mapping-button-primary, screen-button-system ,",
  ]);
  assert.equal(metadataRequest.mode, "get_metadata");
  assert.equal(metadataRequest.pathname, "/api/runtime/metadata");
  assert.deepEqual(readRequestBody(metadataRequest), {
    selectionIds: ["mapping-button-primary", "screen-button-system"],
  });

  const variableDefsRequest = buildRuntimeReadRequest([
    "node",
    scriptPath,
    "get_variable_defs",
    "--selection-ids",
    "mapping-button-primary",
    "--session",
    "session_test",
  ]);
  assert.equal(variableDefsRequest.mode, "get_variable_defs");
  assert.equal(variableDefsRequest.pathname, "/api/runtime/variable-defs");
  assert.deepEqual(readRequestBody(variableDefsRequest), {
    selectionIds: ["mapping-button-primary"],
    targetSessionId: "session_test",
  });
});

test("runtime_read_cli buildRuntimeReadRequest narrows get_node_metadata payloads", () => {
  const request = buildRuntimeReadRequest([
    "node",
    scriptPath,
    "get_node_metadata",
    "--session",
    "session_test",
    "--node-id",
    "1:2",
    "--allow-live-inspect",
    "--max-depth",
    "4",
  ]);

  assert.equal(request.mode, "get_node_metadata");
  assert.equal(request.pathname, "/api/runtime/node-metadata");
  assert.deepEqual(readRequestBody(request), {
    targetSessionId: "session_test",
    nodeId: "1:2",
    allowLiveInspect: true,
    maxDepth: 4,
  });
});

test("runtime_read_cli buildRuntimeReadRequest narrows get_screenshot payloads", () => {
  const request = buildRuntimeReadRequest([
    "node",
    scriptPath,
    "get_screenshot",
    "--session",
    "session_test",
    "--node-id",
    "1:2",
    "--allow-live-export",
    "--prefer-original-bytes",
    "--constraint-type",
    "scale",
    "--constraint-value",
    "2",
  ]);

  assert.equal(request.mode, "get_screenshot");
  assert.equal(request.pathname, "/api/runtime/screenshot");
  assert.deepEqual(readRequestBody(request), {
    targetSessionId: "session_test",
    nodeId: "1:2",
    allowLiveExport: true,
    preferOriginalBytes: true,
    constraint: {
      type: "SCALE",
      value: 2,
    },
  });
});

test("runtime_read_cli rejects invalid graph-kind values before any request is sent", async () => {
  let failure: any = null;
  try {
    await runCli(["get_design_context", "--graph-kind", "invalid"]);
  } catch (error) {
    failure = error;
  }

  assert.ok(failure, "runtime-read-cli should reject invalid graph-kind");
  assert.match(String(failure.stderr || ""), /--graph-kind must be codegraph or knowledge/);
});

test("runtime_read_cli buildRuntimeReadRequest rejects invalid numeric flags", () => {
  assert.throws(
    () =>
      buildRuntimeReadRequest([
        "node",
        scriptPath,
        "get_node_metadata",
        "--session",
        "session_test",
        "--max-depth",
        "bad",
      ]),
    /--max-depth must be an integer/,
  );

  assert.throws(
    () =>
      buildRuntimeReadRequest([
        "node",
        scriptPath,
        "get_screenshot",
        "--session",
        "session_test",
        "--constraint-type",
        "WIDTH",
      ]),
    /--constraint-type and --constraint-value must be provided together/,
  );
});

test("runtime_read_cli requires --session for session-bound modes", async () => {
  let failure: any = null;
  try {
    await runCli(["get_screenshot", "--node-id", "reference-1"]);
  } catch (error) {
    failure = error;
  }

  assert.ok(failure, "runtime-read-cli should reject missing session");
  assert.match(String(failure.stderr || ""), /--session is required/);
});
