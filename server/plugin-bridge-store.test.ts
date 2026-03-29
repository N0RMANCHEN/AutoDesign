import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

import type {
  PluginBridgeSnapshot,
  PluginNodeSummary,
  PluginSessionRegistrationPayload,
} from "../shared/plugin-bridge.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const storeModulePath = path.join(repoRoot, "server", "plugin-bridge-store.ts");

function createSelectionNode(id: string): PluginNodeSummary {
  return {
    id,
    name: id,
    type: "FRAME",
    fillable: true,
    fills: [],
    fillStyleId: null,
    width: 120,
    height: 80,
  };
}

function createSessionPayload(overrides?: Partial<PluginSessionRegistrationPayload>): PluginSessionRegistrationPayload {
  return {
    label: "AutoDesign",
    pluginVersion: "0.2.0",
    editorType: "figma",
    fileName: "Demo File",
    pageName: "Page 1",
    runtimeFeatures: {
      supportsExplicitNodeTargeting: true,
    },
    capabilities: [],
    selection: [createSelectionNode("1:2")],
    ...overrides,
  };
}

async function withTempBridgeStore<T>(
  run: (store: typeof import("./plugin-bridge-store.js")) => Promise<T>,
  options?: {
    seedLegacySnapshot?: PluginBridgeSnapshot;
  },
) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "autodesign-plugin-bridge-store-"));
  const previousCwd = process.cwd();
  process.chdir(tempDir);
  try {
    if (options?.seedLegacySnapshot) {
      const dataDir = path.join(tempDir, "data");
      await mkdir(dataDir, { recursive: true });
      await writeFile(
        path.join(dataDir, "figmatest-plugin-bridge.json"),
        JSON.stringify(options.seedLegacySnapshot, null, 2),
        "utf8",
      );
    }

    const moduleUrl = `${pathToFileURL(storeModulePath).href}?test=${Date.now()}-${Math.random()}`;
    const store = (await import(moduleUrl)) as typeof import("./plugin-bridge-store.js");
    return await run(store);
  } finally {
    process.chdir(previousCwd);
    await rm(tempDir, { recursive: true, force: true });
  }
}

test("registerPluginSession and heartbeatPluginSession preserve selection when heartbeat omits it", async () => {
  await withTempBridgeStore(async (store) => {
    const registered = await store.registerPluginSession(createSessionPayload());

    assert.equal(registered.status, "online");
    assert.equal(registered.runtimeFeatures.supportsExplicitNodeTargeting, true);
    assert.equal(registered.selection.length, 1);
    assert.equal(registered.selection[0]?.id, "1:2");

    const heartbeated = await store.heartbeatPluginSession(
      registered.id,
      createSessionPayload({
        selection: [],
        pageName: "Page 2",
      }),
    );

    assert.equal(heartbeated?.pageName, "Page 2");
    assert.equal(heartbeated?.selection.length, 1);
    assert.equal(heartbeated?.selection[0]?.id, "1:2");

    const snapshot = await store.getPluginBridgeSnapshot();
    assert.equal(snapshot.sessions.length, 1);
    assert.equal(snapshot.sessions[0]?.id, registered.id);
    assert.equal(snapshot.sessions[0]?.status, "online");
  });
});

test("registerPluginSession and heartbeatPluginSession preserve or clear variable snapshots based on explicit payload fields", async () => {
  await withTempBridgeStore(async (store) => {
    const registered = await store.registerPluginSession(
      createSessionPayload({
        hasStyleSnapshot: true,
        styles: [
          {
            id: "S:paint-primary",
            styleType: "paint",
            name: "Brand/Primary",
            description: "main brand fill",
          },
        ],
        hasVariableSnapshot: true,
        variableCollections: [
          {
            id: "collection-colors",
            name: "Colors",
            defaultModeId: "mode-light",
            hiddenFromPublishing: false,
            modes: [{ modeId: "mode-light", name: "Light" }],
          },
        ],
        variables: [
          {
            id: "var-color-primary",
            name: "primary",
            collectionId: "collection-colors",
            collectionName: "Colors",
            resolvedType: "COLOR",
            hiddenFromPublishing: false,
            scopes: ["ALL_FILLS"],
            valuesByMode: [
              { modeId: "mode-light", modeName: "Light", kind: "color", value: "#0F172A" },
            ],
          },
        ],
      }),
    );

    assert.equal(registered.hasStyleSnapshot, true);
    assert.equal(registered.styles?.length, 1);
    assert.equal(registered.hasVariableSnapshot, true);
    assert.equal(registered.variables?.length, 1);

    const preserved = await store.heartbeatPluginSession(
      registered.id,
      createSessionPayload({
        selection: [],
      }),
    );

    assert.equal(preserved?.hasStyleSnapshot, true);
    assert.equal(preserved?.styles?.length, 1);
    assert.equal(preserved?.hasVariableSnapshot, true);
    assert.equal(preserved?.variables?.length, 1);

    const cleared = await store.heartbeatPluginSession(
      registered.id,
      createSessionPayload({
        selection: [],
        hasStyleSnapshot: true,
        styles: [],
        hasVariableSnapshot: true,
        variableCollections: [],
        variables: [],
      }),
    );

    assert.equal(cleared?.hasStyleSnapshot, true);
    assert.deepEqual(cleared?.styles, []);
    assert.equal(cleared?.hasVariableSnapshot, true);
    assert.deepEqual(cleared?.variableCollections, []);
    assert.deepEqual(cleared?.variables, []);
  });
});

test("queuePluginCommand, claimNextPluginCommand and completePluginCommand persist the command lifecycle", async () => {
  await withTempBridgeStore(async (store) => {
    const session = await store.registerPluginSession(createSessionPayload());
    const queued = await store.queuePluginCommand({
      targetSessionId: session.id,
      source: "codex",
      payload: {
        source: "codex",
        commands: [
          {
            type: "capability",
            capabilityId: "fills.set-fill",
            payload: { hex: "#111111" },
            nodeIds: ["1:2"],
          },
        ],
      },
    });

    assert.equal(queued.status, "queued");
    assert.equal(queued.claimedAt, null);

    const claimed = await store.claimNextPluginCommand(session.id);
    assert.equal(claimed?.id, queued.id);
    assert.equal(claimed?.status, "claimed");
    assert.ok(claimed?.claimedAt);

    const completed = await store.completePluginCommand(queued.id, {
      ok: true,
      resultMessage: "Applied successfully",
      results: [
        {
          capabilityId: "fills.set-fill",
          ok: true,
          changedNodeIds: ["1:2"],
          createdStyleIds: [],
          createdVariableIds: [],
          exportedImages: [],
          inspectedNodes: [],
          warnings: [],
          errorCode: null,
          message: "Fill changed",
        },
      ],
    });

    assert.equal(completed?.status, "succeeded");
    assert.ok(completed?.completedAt);
    assert.equal(completed?.results[0]?.message, "Fill changed");

    const loaded = await store.getPluginCommandRecord(queued.id);
    assert.equal(loaded?.status, "succeeded");
    assert.equal(loaded?.results[0]?.capabilityId, "fills.set-fill");

    const snapshot = await store.getPluginBridgeSnapshot();
    assert.equal(snapshot.commands.length, 1);
    assert.equal(snapshot.commands[0]?.id, queued.id);
  });
});

test("getPluginBridgeSnapshot migrates from the legacy bridge file when the new snapshot file is absent", async () => {
  await withTempBridgeStore(
    async (store) => {
      const snapshot = await store.getPluginBridgeSnapshot();

      assert.equal(snapshot.sessions.length, 1);
      assert.equal(snapshot.sessions[0]?.id, "legacy-session");
      assert.equal(snapshot.sessions[0]?.status, "stale");
      assert.equal(snapshot.commands.length, 1);
      assert.equal(snapshot.commands[0]?.id, "legacy-command");
    },
    {
      seedLegacySnapshot: {
        sessions: [
          {
            id: "legacy-session",
            label: "Legacy Plugin",
            pluginVersion: "0.1.0",
            editorType: "figma",
            fileName: "Legacy File",
            pageName: "Legacy Page",
            status: "online",
            lastSeenAt: "2024-01-01T00:00:00.000Z",
            lastHandshakeAt: "2024-01-01T00:00:00.000Z",
            runtimeFeatures: {
              supportsExplicitNodeTargeting: false,
            },
            capabilities: [],
            selection: [],
          },
        ],
        commands: [
          {
            id: "legacy-command",
            targetSessionId: "legacy-session",
            source: "workspace",
            payload: {
              source: "user",
              commands: [
                {
                  type: "refresh-selection",
                },
              ],
            },
            status: "queued",
            createdAt: "2024-01-01T00:00:00.000Z",
            claimedAt: null,
            completedAt: null,
            resultMessage: "",
            results: [],
          },
        ],
      },
    },
  );
});

test("getPluginBridgeSnapshot marks recent persisted sessions online across fresh imports", async () => {
  const now = new Date().toISOString();
  await withTempBridgeStore(
    async (store) => {
      const snapshot = await store.getPluginBridgeSnapshot();

      assert.equal(snapshot.sessions.length, 1);
      assert.equal(snapshot.sessions[0]?.id, "recent-session");
      assert.equal(snapshot.sessions[0]?.status, "online");
    },
    {
      seedLegacySnapshot: {
        sessions: [
          {
            id: "recent-session",
            label: "Recent Plugin",
            pluginVersion: "0.2.3",
            editorType: "figma",
            fileName: "Live File",
            pageName: "Page 1",
            status: "online",
            lastSeenAt: now,
            lastHandshakeAt: now,
            runtimeFeatures: {
              supportsExplicitNodeTargeting: true,
            },
            capabilities: [],
            selection: [],
          },
        ],
        commands: [],
      },
    },
  );
});
