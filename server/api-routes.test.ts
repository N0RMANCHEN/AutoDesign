import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverPath = path.join(repoRoot, "server", "index.ts");

type ServerModule = typeof import("./index.js");
type RequestResult<T> = {
  response: {
    status: number;
    headers: Record<string, string | string[]>;
  };
  body: T;
};

function pngDataUrl(contents: string) {
  return `data:image/png;base64,${Buffer.from(contents, "utf8").toString("base64")}`;
}

function createMockRequest(pathname: string, init?: RequestInit): IncomingMessage {
  const rawBody = typeof init?.body === "string" ? init.body : "";
  const chunks = rawBody ? [Buffer.from(rawBody, "utf8")] : [];
  const request = {
    url: pathname,
    method: init?.method ?? "GET",
    headers: {
      host: "localhost",
      ...(init?.headers && typeof init.headers === "object" ? Object.fromEntries(new Headers(init.headers).entries()) : {}),
    },
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        yield chunk;
      }
    },
  };
  return request as IncomingMessage;
}

function createMockResponse() {
  let status = 200;
  let headers: Record<string, string | string[]> = {};
  const chunks: Buffer[] = [];

  const response = {
    writeHead(
      nextStatus: number,
      nextHeaders?: Record<string, string | number | readonly string[]>,
    ) {
      status = nextStatus;
      headers = Object.fromEntries(
        Object.entries(nextHeaders ?? {}).map(([key, value]) => [
          key,
          Array.isArray(value) ? value.map(String) : String(value),
        ]),
      );
      return this;
    },
    end(chunk?: string | Buffer) {
      if (chunk !== undefined) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8"));
      }
      return this;
    },
  } as Partial<ServerResponse>;

  return {
    response: response as ServerResponse,
    readResult() {
      const raw = Buffer.concat(chunks).toString("utf8");
      return {
        status,
        headers,
        body: raw ? JSON.parse(raw) : null,
      };
    },
  };
}

async function requestJson<T>(server: ServerModule, pathname: string, init?: RequestInit): Promise<RequestResult<T>> {
  const request = createMockRequest(pathname, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers && typeof init.headers === "object" ? Object.fromEntries(new Headers(init.headers).entries()) : {}),
    },
  });
  const collector = createMockResponse();
  await server.handleAutoDesignRequest(request, collector.response);
  const result = collector.readResult();
  return {
    response: {
      status: result.status,
      headers: result.headers,
    },
    body: result.body as T,
  };
}

async function withInMemoryServer<T>(run: (server: ServerModule) => Promise<T>) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "autodesign-api-routes-"));
  const previousDataDir = process.env.AUTODESIGN_DATA_DIR;
  process.env.AUTODESIGN_DATA_DIR = path.join(tempDir, "data");
  try {
    const moduleUrl = `${pathToFileURL(serverPath).href}?test=${Date.now()}-${Math.random()}`;
    const server = (await import(moduleUrl)) as ServerModule;
    return await run(server);
  } finally {
    if (previousDataDir === undefined) {
      delete process.env.AUTODESIGN_DATA_DIR;
    } else {
      process.env.AUTODESIGN_DATA_DIR = previousDataDir;
    }
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function registerSampleSession(server: ServerModule) {
  const payload = {
    sessionId: "session_test",
    label: "AutoDesign",
    pluginVersion: "0.2.0",
    editorType: "figma",
    fileName: "Demo File",
    pageName: "Page A",
    runtimeFeatures: {
      supportsExplicitNodeTargeting: true,
    },
    capabilities: [],
    hasStyleSnapshot: true,
    styles: [
      {
        id: "S:fill-card",
        styleType: "paint",
        name: "Fill/Card",
        description: "card background",
      },
      {
        id: "S:stroke-card",
        styleType: "paint",
        name: "Stroke/Card",
        description: null,
      },
      {
        id: "S:effect-card",
        styleType: "effect",
        name: "Shadow/Card",
        description: "soft card shadow",
      },
      {
        id: "S:grid-card",
        styleType: "grid",
        name: "Grid/Card",
        description: null,
      },
    ],
    hasVariableSnapshot: true,
    variableCollections: [
      {
        id: "collection-colors",
        name: "Colors",
        defaultModeId: "mode-light",
        hiddenFromPublishing: false,
        modes: [
          { modeId: "mode-light", name: "Light" },
          { modeId: "mode-dark", name: "Dark" },
        ],
      },
      {
        id: "collection-layout",
        name: "Layout",
        defaultModeId: "mode-base",
        hiddenFromPublishing: false,
        modes: [{ modeId: "mode-base", name: "Base" }],
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
          { modeId: "mode-dark", modeName: "Dark", kind: "color", value: "#E2E8F0" },
        ],
      },
      {
        id: "var-spacing-md",
        name: "spacing/md",
        collectionId: "collection-layout",
        collectionName: "Layout",
        resolvedType: "FLOAT",
        hiddenFromPublishing: false,
        scopes: ["GAP"],
        valuesByMode: [
          { modeId: "mode-base", modeName: "Base", kind: "number", value: 16 },
        ],
      },
    ],
    selection: [
      {
        id: "target-1",
        name: "Target Frame",
        type: "FRAME",
        fillable: true,
        fills: [],
        fillStyleId: "S:fill-card",
        styleBindings: {
          fillStyleId: "S:fill-card",
          strokeStyleId: "S:stroke-card",
          textStyleId: null,
          effectStyleId: "S:effect-card",
          gridStyleId: "S:grid-card",
        },
        boundVariableIds: ["var-color-primary", "var-spacing-md"],
        variableBindings: {
          fills: ["var-color-primary"],
          itemSpacing: ["var-spacing-md"],
        },
        width: 160,
        height: 100,
      },
      {
        id: "reference-1",
        name: "Reference Image",
        type: "RECTANGLE",
        fillable: true,
        fills: ["image"],
        fillStyleId: null,
        width: 160,
        height: 100,
        previewDataUrl: pngDataUrl("reference-preview"),
      },
    ],
  };

  const { response, body } = await requestJson<any>(
    server,
    "/api/plugin-bridge/sessions/register",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
  assert.equal(response.status, 200);
  assert.equal(body.id, "session_test");
}

function createStructuredAnalysisPayload() {
  return {
    width: 160,
    height: 100,
    previewDataUrl: pngDataUrl("analysis-preview"),
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
      rectifiedPreviewDataUrl: pngDataUrl("reference-rectified"),
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

test("api_routes register plugin session and expose it through the bridge snapshot", async () => {
  await withInMemoryServer(async (server) => {
    await registerSampleSession(server);

    const { response, body } = await requestJson<any>(server, "/api/plugin-bridge");
    assert.equal(response.status, 200);
    assert.equal(body.sessions.length, 1);
    assert.equal(body.sessions[0]?.id, "session_test");
    assert.equal(body.sessions[0]?.status, "online");
    assert.equal(body.sessions[0]?.selection[1]?.id, "reference-1");
  });
});

test("api_routes expose runtime bridge overview without leaking raw selection payloads", async () => {
  await withInMemoryServer(async (server) => {
    await registerSampleSession(server);

    const queued = await requestJson<any>(server, "/api/runtime/bridge-dispatch", {
      method: "POST",
      body: JSON.stringify({
        targetSessionId: "session_test",
        source: "workspace",
        payload: {
          source: "workspace",
          commands: [],
        },
      }),
    });
    assert.equal(queued.response.status, 200);

    const overview = await requestJson<any>(server, "/api/runtime/bridge-overview");
    assert.equal(overview.response.status, 200);
    assert.equal(overview.body.sessionCount, 1);
    assert.equal(overview.body.onlineSessionCount, 1);
    assert.equal(overview.body.commandCounts.queued, 1);
    assert.equal(overview.body.sessions[0]?.id, "session_test");
    assert.equal(overview.body.sessions[0]?.selectionCount, 2);
    assert.equal(overview.body.sessions[0]?.capabilityCount, 0);
    assert.equal(overview.body.sessions[0]?.selection, undefined);
    assert.equal(overview.body.commands[0]?.targetSessionId, "session_test");
    assert.equal(overview.body.commands[0]?.status, "queued");
    assert.equal(overview.body.commands[0]?.warningCount, 0);
    assert.equal(overview.body.commands[0]?.changedNodeCount, 0);
  });
});

test("api_routes expose runtime bridge dispatch receipt without leaking raw command payloads", async () => {
  await withInMemoryServer(async (server) => {
    await registerSampleSession(server);

    const receipt = await requestJson<any>(server, "/api/runtime/bridge-dispatch", {
      method: "POST",
      body: JSON.stringify({
        targetSessionId: "session_test",
        source: "workspace",
        payload: {
          source: "workspace",
          commands: [
            {
              type: "set-selection-fill",
              hex: "#FF6FAE",
            },
            {
              type: "set-selection-stroke",
              hex: "#2563EB",
            },
          ],
        },
      }),
    });

    assert.equal(receipt.response.status, 200);
    assert.equal(receipt.body.payloadCommandCount, 2);
    assert.equal(receipt.body.command.targetSessionId, "session_test");
    assert.equal(receipt.body.command.status, "queued");
    assert.equal(receipt.body.command.warningCount, 0);
    assert.equal(receipt.body.command.changedNodeCount, 0);
    assert.equal(receipt.body.command.payload, undefined);
    assert.equal(receipt.body.command.results, undefined);
  });
});

test("api_routes expose seeded project data and support figma sync updates", async () => {
  await withInMemoryServer(async (server) => {
    const initialProject = await requestJson<any>(server, "/api/project");
    assert.equal(initialProject.response.status, 200);
    assert.equal(initialProject.body.meta.id, "autodesign-main");
    assert.ok(Array.isArray(initialProject.body.designSources) && initialProject.body.designSources.length > 0);

    const synced = await requestJson<any>(server, "/api/figma/sync", {
      method: "POST",
      body: JSON.stringify({
        source: {
          name: "Billing Flow",
          figmaFileKey: "FigmaKey-Billing",
          branch: "main",
          summary: "Checkout and billing review flows.",
        },
        screens: [
          {
            name: "Billing / Review",
            purpose: "确认账单摘要和提交 CTA。",
            stateNotes: ["default", "error"],
            summary: "提交前确认账单信息与价格明细。",
          },
        ],
        components: [
          {
            designName: "Billing Summary Card",
            reactName: "BillingSummaryCard",
            props: ["total", "items"],
            states: ["default", "loading"],
            notes: "对齐支付前账单摘要结构。",
          },
        ],
      }),
    });
    assert.equal(synced.response.status, 200);
    assert.equal(synced.body.designSources[0]?.id, "source-billing-flow");
    assert.ok(synced.body.designScreens.some((screen: { id: string }) => screen.id === "screen-billing-review"));
    assert.ok(
      synced.body.componentMappings.some(
        (mapping: { id: string }) => mapping.id === "mapping-billing-summary-card",
      ),
    );
  });
});

test("api_routes expose a narrowed workspace read model and mapping-status write receipt", async () => {
  await withInMemoryServer(async (server) => {
    const workspace = await requestJson<any>(server, "/api/workspace/read-model");

    assert.equal(workspace.response.status, 200);
    assert.equal(workspace.body.workspace.id, "autodesign-main");
    assert.deepEqual(workspace.body.selection.defaultIds, [
      "screen-dashboard",
      "mapping-account-tile",
    ]);
    assert.equal(workspace.body.designSources[0]?.screenCount, 2);
    assert.equal(workspace.body.designSources[0]?.mappingCount, 3);
    assert.equal(workspace.body.screens[0]?.id, "screen-onboarding");
    assert.equal(workspace.body.screens[0]?.sourceName, "Mobile Banking App");
    assert.deepEqual(workspace.body.screens[0]?.mappingNames, [
      "Welcome Hero Card",
      "Button / Primary",
    ]);
    assert.deepEqual(workspace.body.mappings[2]?.screenNames, [
      "Buttons / States",
      "Onboarding / Welcome",
    ]);
    assert.deepEqual(workspace.body.reviewQueue[0]?.relatedLabels, [
      "Onboarding / Welcome",
      "Welcome Hero Card",
    ]);
    assert.equal(workspace.body.runtimeSessions, undefined);
    assert.equal(workspace.body.designScreens, undefined);
    assert.equal(workspace.body.componentMappings, undefined);
    assert.equal(workspace.body.reviewItems, undefined);

    const receipt = await requestJson<any>(server, "/api/workspace/mapping-status", {
      method: "POST",
      body: JSON.stringify({
        mappingId: "mapping-account-tile",
        status: "verified",
      }),
    });

    assert.equal(receipt.response.status, 200);
    assert.equal(receipt.body.mapping.id, "mapping-account-tile");
    assert.equal(receipt.body.mapping.status, "verified");
    assert.deepEqual(receipt.body.mapping.screenNames, ["Dashboard / Account Overview"]);
    assert.match(String(receipt.body.workspaceUpdatedAt), /^\d{4}-\d{2}-\d{2}T/);

    const updatedWorkspace = await requestJson<any>(server, "/api/workspace/read-model");
    assert.equal(
      updatedWorkspace.body.mappings.find((item: any) => item.id === "mapping-account-tile")?.status,
      "verified",
    );
  });
});

test("api_routes expose workspace-scoped figma sync and reset surfaces", async () => {
  await withInMemoryServer(async (server) => {
    const synced = await requestJson<any>(server, "/api/workspace/figma-sync", {
      method: "POST",
      body: JSON.stringify({
        source: {
          name: "Billing Flow",
          figmaFileKey: "FigmaKey-Billing",
          branch: "main",
          summary: "Checkout and billing review flows.",
        },
        screens: [
          {
            name: "Billing / Review",
            purpose: "确认账单摘要和提交 CTA。",
            stateNotes: ["default", "error"],
            summary: "提交前确认账单信息与价格明细。",
          },
        ],
        components: [
          {
            designName: "Billing Summary Card",
            reactName: "BillingSummaryCard",
            props: ["total", "items"],
            states: ["default", "loading"],
            notes: "对齐支付前账单摘要结构。",
          },
        ],
      }),
    });

    assert.equal(synced.response.status, 200);
    assert.equal(synced.body.workspace.id, "autodesign-main");
    assert.equal(synced.body.designSources[0]?.id, "source-billing-flow");
    assert.ok(
      synced.body.mappings.some((mapping: { id: string }) => mapping.id === "mapping-billing-summary-card"),
    );
    assert.ok(
      synced.body.selection.options.some((item: { id: string }) => item.id === "screen-billing-review"),
    );

    const reset = await requestJson<any>(server, "/api/workspace/reset", {
      method: "POST",
    });

    assert.equal(reset.response.status, 200);
    assert.equal(reset.body.designSources[0]?.id, "source-mobile-banking");
    assert.equal(
      reset.body.mappings.some((mapping: { id: string }) => mapping.id === "mapping-billing-summary-card"),
      false,
    );
  });
});

test("api_routes expose review-queue write receipts and reject invalid review updates", async () => {
  await withInMemoryServer(async (server) => {
    const receipt = await requestJson<any>(server, "/api/workspace/review-queue-item", {
      method: "POST",
      body: JSON.stringify({
        reviewId: "review-balance-mask",
        status: "doing",
        owner: "Design Ops",
      }),
    });

    assert.equal(receipt.response.status, 200);
    assert.equal(receipt.body.review.id, "review-balance-mask");
    assert.equal(receipt.body.review.status, "doing");
    assert.equal(receipt.body.review.owner, "Design Ops");
    assert.deepEqual(receipt.body.review.relatedLabels, [
      "Dashboard / Account Overview",
      "Account Overview Tile",
    ]);
    assert.equal(receipt.body.review.relatedIds, undefined);
    assert.match(String(receipt.body.workspaceUpdatedAt), /^\d{4}-\d{2}-\d{2}T/);

    const workspace = await requestJson<any>(server, "/api/workspace/read-model");
    const updatedReview = workspace.body.reviewQueue.find((item: any) => item.id === "review-balance-mask");
    assert.equal(updatedReview?.status, "doing");
    assert.equal(updatedReview?.owner, "Design Ops");

    const blankOwner = await requestJson<any>(server, "/api/workspace/review-queue-item", {
      method: "POST",
      body: JSON.stringify({
        reviewId: "review-balance-mask",
        owner: "   ",
      }),
    });
    assert.equal(blankOwner.response.status, 400);
    assert.match(String(blankOwner.body.error), /owner must not be empty/);

    const invalidStatus = await requestJson<any>(server, "/api/workspace/review-queue-item", {
      method: "POST",
      body: JSON.stringify({
        reviewId: "review-balance-mask",
        status: "blocked",
      }),
    });
    assert.equal(invalidStatus.response.status, 400);
    assert.match(String(invalidStatus.body.error), /status must be todo, doing or done/);
  });
});

test("api_routes build a local design-context bundle with metadata, related mappings and live variable defs when a session is targeted", async () => {
  await withInMemoryServer(async (server) => {
    await registerSampleSession(server);

    const designContext = await requestJson<any>(server, "/api/runtime/design-context", {
      method: "POST",
      body: JSON.stringify({
        selectionIds: ["mapping-button-primary"],
        graphKind: "codegraph",
        action: "codegraph/summarize",
        targetSessionId: "session_test",
      }),
    });

    assert.equal(designContext.response.status, 200);
    assert.equal(designContext.body.selectionIds[0], "mapping-button-primary");
    assert.equal(designContext.body.primarySelectionId, "mapping-button-primary");
    assert.deepEqual(
      designContext.body.designContext.sources.map((item: any) => item.id),
      ["source-mobile-banking", "source-design-system"],
    );
    assert.deepEqual(
      designContext.body.designContext.screens.map((item: any) => item.id),
      ["screen-onboarding", "screen-button-system"],
    );
    assert.ok(
      designContext.body.designContext.componentMappings.some(
        (item: any) => item.id === "mapping-button-primary",
      ),
    );
    assert.ok(
      designContext.body.designContext.reviewItems.some((item: any) => item.id === "review-runtime-context"),
    );
    assert.equal(designContext.body.variableDefs.available, true);
    assert.equal(designContext.body.variableDefs.source, "plugin-session-variable-snapshot");
    assert.match(String(designContext.body.variableDefs.note), /plugin live session/);
    assert.deepEqual(designContext.body.variableDefs.colors, ["Colors/primary = #0F172A"]);
    assert.equal(designContext.body.pluginSelection.available, true);
    assert.equal(designContext.body.pluginSelection.source, "plugin-selection-summary");
    assert.equal(designContext.body.pluginSelection.primarySelectionNodeId, "target-1");
    assert.deepEqual(designContext.body.pluginSelection.selectionNodeIds, ["target-1", "reference-1"]);
    assert.deepEqual(
      designContext.body.pluginSelection.dependencies.resolvedStyles.map((item: any) => item.id),
      ["S:fill-card", "S:stroke-card", "S:effect-card", "S:grid-card"],
    );
    assert.deepEqual(
      designContext.body.pluginSelection.dependencies.resolvedVariables.map((item: any) => item.id),
      ["var-color-primary", "var-spacing-md"],
    );
    assert.deepEqual(
      designContext.body.pluginSelection.dependencies.unresolvedStyleIds,
      [],
    );
    assert.deepEqual(
      designContext.body.pluginSelection.dependencies.unresolvedVariableIds,
      [],
    );
    const metadataKinds = designContext.body.metadata.map((item: any) => item.kind);
    assert.equal(metadataKinds.filter((item: string) => item === "designSource").length, 2);
    assert.equal(metadataKinds.filter((item: string) => item === "screen").length, 2);
    assert.ok(metadataKinds.filter((item: string) => item === "component").length >= 1);
    assert.ok(metadataKinds.filter((item: string) => item === "review").length >= 1);
    assert.ok(
      designContext.body.metadata.some((item: any) => item.id === "mapping-button-primary"),
    );
    assert.ok(
      designContext.body.metadata.some((item: any) => item.id === "review-runtime-context"),
    );
  });
});

test("api_routes expose standalone metadata and variable-def snapshots for local read contracts", async () => {
  await withInMemoryServer(async (server) => {
    await registerSampleSession(server);

    const metadata = await requestJson<any>(server, "/api/runtime/metadata", {
      method: "POST",
      body: JSON.stringify({
        selectionIds: ["mapping-button-primary"],
      }),
    });

    assert.equal(metadata.response.status, 200);
    assert.equal(metadata.body.primarySelectionId, "mapping-button-primary");
    assert.ok(
      metadata.body.metadata.some((item: any) => item.id === "mapping-button-primary" && item.kind === "component"),
    );
    assert.ok(
      metadata.body.metadata.some((item: any) => item.id === "review-runtime-context" && item.kind === "review"),
    );

    const unavailableVariableDefs = await requestJson<any>(server, "/api/runtime/variable-defs", {
      method: "POST",
      body: JSON.stringify({
        selectionIds: ["mapping-button-primary"],
      }),
    });

    assert.equal(unavailableVariableDefs.response.status, 200);
    assert.equal(unavailableVariableDefs.body.variableDefs.available, false);
    assert.equal(unavailableVariableDefs.body.variableDefs.source, null);
    assert.match(String(unavailableVariableDefs.body.variableDefs.note), /variables\/styles truth/);

    const variableDefs = await requestJson<any>(server, "/api/runtime/variable-defs", {
      method: "POST",
      body: JSON.stringify({
        selectionIds: ["mapping-button-primary"],
        targetSessionId: "session_test",
      }),
    });

    assert.equal(variableDefs.response.status, 200);
    assert.equal(variableDefs.body.primarySelectionId, "mapping-button-primary");
    assert.equal(variableDefs.body.variableDefs.available, true);
    assert.equal(variableDefs.body.variableDefs.source, "plugin-session-variable-snapshot");
    assert.match(String(variableDefs.body.variableDefs.note), /plugin live session/);
    assert.deepEqual(variableDefs.body.variableDefs.colors, ["Colors/primary = #0F172A"]);
    assert.deepEqual(variableDefs.body.variableDefs.spacing, ["Layout/spacing/md = 16"]);
    assert.equal(variableDefs.body.variableDefs.variables.length, 2);
  });
});

test("api_routes expose cached screenshots and explicit unavailable notes for screenshot gaps", async () => {
  await withInMemoryServer(async (server) => {
    await registerSampleSession(server);

    const cached = await requestJson<any>(server, "/api/runtime/screenshot", {
      method: "POST",
      body: JSON.stringify({
        targetSessionId: "session_test",
        nodeId: "reference-1",
      }),
    });

    assert.equal(cached.response.status, 200);
    assert.equal(cached.body.available, true);
    assert.equal(cached.body.source, "session-selection-preview");
    assert.equal(cached.body.nodeId, "reference-1");
    assert.equal(cached.body.screenshot?.mimeType, "image/png");
    assert.equal(cached.body.screenshot?.dataUrl, pngDataUrl("reference-preview"));

    const unavailable = await requestJson<any>(server, "/api/runtime/screenshot", {
      method: "POST",
      body: JSON.stringify({
        targetSessionId: "session_test",
        nodeId: "target-1",
        allowLiveExport: false,
      }),
    });

    assert.equal(unavailable.response.status, 200);
    assert.equal(unavailable.body.available, false);
    assert.equal(unavailable.body.nodeId, "target-1");
    assert.equal(unavailable.body.screenshot, null);
    assert.match(String(unavailable.body.note), /allowLiveExport=true/);
  });
});

test("api_routes expose cached node metadata summaries and explicit live-inspect gaps", async () => {
  await withInMemoryServer(async (server) => {
    await registerSampleSession(server);

    const summary = await requestJson<any>(server, "/api/runtime/node-metadata", {
      method: "POST",
      body: JSON.stringify({
        targetSessionId: "session_test",
        nodeId: "target-1",
      }),
    });

    assert.equal(summary.response.status, 200);
    assert.equal(summary.body.available, true);
    assert.equal(summary.body.source, "session-selection-summary");
    assert.equal(summary.body.node?.id, "target-1");
    assert.equal(summary.body.node?.styleBindings?.fillStyleId, "S:fill-card");
    assert.equal(summary.body.node?.styleBindings?.effectStyleId, "S:effect-card");
    assert.deepEqual(summary.body.node?.boundVariableIds, ["var-color-primary", "var-spacing-md"]);
    assert.deepEqual(summary.body.node?.variableBindings?.fills, ["var-color-primary"]);
    assert.equal(summary.body.resolvedStyleBindings.length, 4);
    assert.equal(summary.body.resolvedStyleBindings[0]?.styleId, "S:fill-card");
    assert.equal(summary.body.resolvedStyleBindings[0]?.name, "Fill/Card");
    assert.equal(summary.body.resolvedStyleBindings[3]?.styleType, "grid");
    assert.equal(summary.body.resolvedVariables.length, 2);
    assert.deepEqual(summary.body.unresolvedVariableIds, []);
    assert.deepEqual(
      summary.body.subtreeResolvedStyles.map((item: any) => item.id),
      ["S:fill-card", "S:stroke-card", "S:effect-card", "S:grid-card"],
    );
    assert.deepEqual(
      summary.body.subtreeResolvedVariables.map((item: any) => item.id),
      ["var-color-primary", "var-spacing-md"],
    );
    assert.deepEqual(summary.body.subtreeUnresolvedStyleIds, []);
    assert.deepEqual(summary.body.subtreeUnresolvedVariableIds, []);
    assert.equal(summary.body.subtree.length, 1);

    const unavailable = await requestJson<any>(server, "/api/runtime/node-metadata", {
      method: "POST",
      body: JSON.stringify({
        targetSessionId: "session_test",
        nodeId: "outside-1",
        allowLiveInspect: false,
      }),
    });

    assert.equal(unavailable.response.status, 200);
    assert.equal(unavailable.body.available, false);
    assert.equal(unavailable.body.node, null);
    assert.match(String(unavailable.body.note), /allowLiveInspect=true/);
  });
});

test("api_routes create, list and inspect a reconstruction job via HTTP", async () => {
  await withInMemoryServer(async (server) => {
    await registerSampleSession(server);

    const created = await requestJson<any>(server, "/api/reconstruction/jobs", {
      method: "POST",
      body: JSON.stringify({
        targetSessionId: "session_test",
        strategy: "hybrid-reconstruction",
        targetNodeId: "target-1",
        referenceNodeId: "reference-1",
        allowOutpainting: true,
      }),
    });

    assert.equal(created.response.status, 200);
    assert.equal(created.body.input.targetSessionId, "session_test");
    assert.equal(created.body.input.strategy, "hybrid-reconstruction");
    assert.equal(created.body.targetNode.id, "target-1");
    assert.equal(created.body.referenceNode.id, "reference-1");
    assert.match(created.body.warnings[0] || "", /allowOutpainting 已记录/);

    const listed = await requestJson<any>(server, "/api/reconstruction/jobs");
    assert.equal(listed.response.status, 200);
    assert.equal(listed.body.jobs.length, 1);
    assert.equal(listed.body.jobs[0]?.id, created.body.id);

    const fetched = await requestJson<any>(server, `/api/reconstruction/jobs/${created.body.id}`);
    assert.equal(fetched.response.status, 200);
    assert.equal(fetched.body.id, created.body.id);
    assert.equal(fetched.body.status, "ready");
  });
});

test("api_routes build a reconstruction context pack from a created job", async () => {
  await withInMemoryServer(async (server) => {
    await registerSampleSession(server);
    const created = await requestJson<any>(server, "/api/reconstruction/jobs", {
      method: "POST",
      body: JSON.stringify({
        targetSessionId: "session_test",
        strategy: "hybrid-reconstruction",
        targetNodeId: "target-1",
        referenceNodeId: "reference-1",
      }),
    });

    const contextPack = await requestJson<any>(
      server,
      `/api/reconstruction/jobs/${created.body.id}/context-pack`,
      {
        method: "POST",
      },
    );

    assert.equal(contextPack.response.status, 200);
    assert.equal(contextPack.body.jobId, created.body.id);
    assert.equal(contextPack.body.strategy, "hybrid-reconstruction");
    assert.equal(contextPack.body.referenceNode.id, "reference-1");
    assert.equal(contextPack.body.referencePreviewDataUrl, pngDataUrl("reference-preview"));
    assert.ok(Array.isArray(contextPack.body.guidance) && contextPack.body.guidance.length > 0);
  });
});

test("api_routes reject malformed reconstruction analysis submission and unknown routes", async () => {
  await withInMemoryServer(async (server) => {
    await registerSampleSession(server);
    const created = await requestJson<any>(server, "/api/reconstruction/jobs", {
      method: "POST",
      body: JSON.stringify({
        targetSessionId: "session_test",
        strategy: "hybrid-reconstruction",
        targetNodeId: "target-1",
        referenceNodeId: "reference-1",
      }),
    });

    const invalidSubmit = await requestJson<any>(
      server,
      `/api/reconstruction/jobs/${created.body.id}/submit-analysis`,
      {
        method: "POST",
        body: JSON.stringify({}),
      },
    );
    assert.equal(invalidSubmit.response.status, 400);
    assert.match(invalidSubmit.body.error || "", /analysis is required/);

    const missingRoute = await requestJson<any>(server, "/api/reconstruction/unknown", {
      method: "POST",
      body: JSON.stringify({}),
    });
    assert.equal(missingRoute.response.status, 404);
    assert.equal(missingRoute.body.ok, false);
    assert.match(missingRoute.body.error || "", /Route not found/);
  });
});

test("api_routes expose reconstruction guide manifests, element scoring and design-task compatibility snapshots", async () => {
  await withInMemoryServer(async (server) => {
    await registerSampleSession(server);
    const created = await requestJson<any>(server, "/api/reconstruction/jobs", {
      method: "POST",
      body: JSON.stringify({
        targetSessionId: "session_test",
        strategy: "vector-reconstruction",
        targetNodeId: "target-1",
        referenceNodeId: "reference-1",
      }),
    });

    const submitted = await requestJson<any>(
      server,
      `/api/reconstruction/jobs/${created.body.id}/submit-analysis`,
      {
        method: "POST",
        body: JSON.stringify({
          analysisVersion: "codex-v1",
          analysisProvider: "codex-assisted",
          analysis: createStructuredAnalysisPayload(),
        }),
      },
    );
    assert.equal(submitted.response.status, 200);

    const guideManifest = await requestJson<any>(
      server,
      `/api/reconstruction/jobs/${created.body.id}/guide-manifest`,
    );
    assert.equal(guideManifest.response.status, 200);
    assert.equal(guideManifest.body.jobId, created.body.id);
    assert.equal(guideManifest.body.images.referencePreviewDataUrl, pngDataUrl("reference-preview"));
    assert.equal(guideManifest.body.images.rectifiedPreviewDataUrl, pngDataUrl("reference-rectified"));
    assert.ok(Array.isArray(guideManifest.body.elements) && guideManifest.body.elements.length >= 2);

    const elementScores = await requestJson<any>(
      server,
      `/api/reconstruction/jobs/${created.body.id}/element-scores`,
      {
        method: "POST",
        body: JSON.stringify({
          inspectedNodes: [
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
        }),
      },
    );
    assert.equal(elementScores.response.status, 200);
    assert.equal(elementScores.body.referencePreviewKind, "rectified");
    assert.equal(elementScores.body.liveNodeCount, 3);
    assert.ok(Array.isArray(elementScores.body.scores) && elementScores.body.scores.length >= 2);

    const designTask = await requestJson<any>(
      server,
      `/api/design-tasks/reconstruction-jobs/${created.body.id}`,
    );
    assert.equal(designTask.response.status, 200);
    assert.equal(designTask.body.mode, "restoration");
    assert.equal(designTask.body.intent.outputTarget, "figma-native");
    assert.ok(Array.isArray(designTask.body.scene.elements) && designTask.body.scene.elements.length >= 2);
    assert.equal(designTask.body.scorecard, null);
  });
});
