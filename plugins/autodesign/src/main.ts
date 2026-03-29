import type {
  PluginBridgeCommandRecord,
  PluginBridgeSession,
  PluginBridgeSyncResponse,
  PluginCommandExecutionResult,
  PluginSessionRegistrationPayload,
} from "../../../shared/plugin-bridge.js";
import type { FigmaPluginCommandBatch } from "../../../shared/plugin-contract.js";
import {
  runPluginCommandBatch,
  getRuntimeCapabilities,
  getRuntimeFeatures,
} from "./runtime/capability-runner.js";
import { currentSelectionUiPayload } from "./runtime/selection-context.js";
import { readLocalStyleSnapshot } from "./runtime/style-snapshot.js";
import { readLocalVariableSnapshot } from "./runtime/variable-snapshot.js";

const PLUGIN_LABEL = "AutoDesign";
const PLUGIN_VERSION = "0.2.9";
const BRIDGE_URL = "http://localhost:3001/api/plugin-bridge";
const UI_WIDTH = 244;
const UI_HEIGHT = 116;
const COMMAND_SYNC_INTERVAL_MS = 1500;
const HEARTBEAT_INTERVAL_MS = 10000;

type BridgeUiState = "connecting" | "online" | "offline" | "error";

let pluginSessionId: string | null = null;
let commandSyncTimer: ReturnType<typeof setInterval> | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let selectionSummaryRequestId = 0;
let isRegistering = false;
let isHeartbeating = false;
let isExecutingBridgeCommand = false;
let lastBridgeStatusKey = "";

figma.showUI(__html__, {
  width: UI_WIDTH,
  height: UI_HEIGHT,
  title: PLUGIN_LABEL,
  themeColors: true,
});

function describeError(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}

async function readSelectionSummary() {
  try {
    return await currentSelectionUiPayload();
  } catch (error) {
    postExecutionError(describeError(error, "Selection snapshot failed."));
    return [];
  }
}

async function postSelectionSummary(message: string) {
  const requestId = ++selectionSummaryRequestId;
  const selection = await readSelectionSummary();
  if (requestId !== selectionSummaryRequestId) {
    return;
  }

  figma.ui.postMessage({
    type: "selection-summary",
    message,
    selection,
  });
}

function postBridgeStatus(state: BridgeUiState, message: string, session: unknown) {
  const sessionId =
    session &&
    typeof session === "object" &&
    "id" in session &&
    typeof session.id === "string"
      ? session.id
      : null;
  const nextKey = `${state}|${message}|${sessionId || ""}`;
  if (nextKey === lastBridgeStatusKey) {
    return;
  }

  lastBridgeStatusKey = nextKey;
  figma.ui.postMessage({
    type: "bridge-status",
    state,
    message,
    sessionId,
    session: session || null,
  });
}

function postExecutionError(message: string) {
  figma.ui.postMessage({
    type: "execution-error",
    message,
  });
}

function postCommandResult(
  message: string,
  ok: boolean,
  results: PluginCommandExecutionResult[],
) {
  figma.ui.postMessage({
    type: "command-result",
    message,
    ok,
    results,
  });
}

async function sessionPayload(options?: {
  claimCommand?: boolean;
  includeContextSnapshots?: boolean;
}): Promise<PluginSessionRegistrationPayload> {
  const claimCommand = options?.claimCommand === true;
  const includeContextSnapshots = options?.includeContextSnapshots !== false;
  const payload: PluginSessionRegistrationPayload = {
    sessionId: pluginSessionId || undefined,
    label: PLUGIN_LABEL,
    pluginVersion: PLUGIN_VERSION,
    editorType: figma.editorType,
    fileName: figma.root.name || "Untitled",
    pageName: figma.currentPage.name || "Page",
    runtimeFeatures: getRuntimeFeatures(),
    capabilities: getRuntimeCapabilities(),
    selection: await readSelectionSummary(),
    ...(claimCommand ? { claimCommand: true } : {}),
  };

  if (!includeContextSnapshots) {
    return payload;
  }

  const [styleSnapshot, variableSnapshot] = await Promise.all([
    readLocalStyleSnapshot().catch((error) => {
      postExecutionError(describeError(error, "Style snapshot failed."));
      return {
        hasStyleSnapshot: false,
        styles: [],
      };
    }),
    readLocalVariableSnapshot().catch((error) => {
      postExecutionError(describeError(error, "Variable snapshot failed."));
      return {
        hasVariableSnapshot: false,
        variableCollections: [],
        variables: [],
      };
    }),
  ]);

  return {
    ...payload,
    ...styleSnapshot,
    ...variableSnapshot,
  };
}

async function bridgeFetch<T>(pathname: string, init?: RequestInit): Promise<T> {
  const requestInit = Object.assign({}, init || {});
  requestInit.headers = Object.assign(
    {
      "Content-Type": "application/json",
    },
    init && init.headers ? init.headers : {},
  );

  const response = await fetch(`${BRIDGE_URL}${pathname}`, requestInit);
  if (!response.ok) {
    throw new Error(`Bridge request failed: ${response.status}`);
  }

  return (await response.json()) as T;
}

function parseBridgeSyncResponse(
  payload: PluginBridgeSession | PluginBridgeSyncResponse,
) {
  if ("session" in payload) {
    return payload;
  }
  return {
    session: payload,
    command: null,
  } satisfies PluginBridgeSyncResponse;
}

async function executeBridgeCommand(command: PluginBridgeCommandRecord | null) {
  if (!command) {
    return;
  }

  isExecutingBridgeCommand = true;
  try {
    const result = await runCommands(command.payload);
    try {
      await reportCommandResult(command.id, result.message, result.ok, result.results);
    } catch (error) {
      pluginSessionId = null;
      postBridgeStatus("offline", describeError(error, "Bridge result reporting failed"), null);
    }
  } catch (error) {
    const detail = describeError(error, "未知错误");
    postExecutionError(detail);
    postCommandResult(detail, false, []);
    try {
      await reportCommandResult(command.id, detail, false, []);
    } catch (reportError) {
      pluginSessionId = null;
      postBridgeStatus(
        "offline",
        describeError(reportError, "Bridge result reporting failed"),
        null,
      );
    }
  } finally {
    isExecutingBridgeCommand = false;
  }
}

async function handleBridgeSyncResponse(
  payload: PluginBridgeSession | PluginBridgeSyncResponse,
) {
  const response = parseBridgeSyncResponse(payload);
  pluginSessionId = response.session.id;
  postBridgeStatus("online", `Bridge online: ${response.session.id}`, response.session);
  await executeBridgeCommand(response.command);
  return response.session;
}

async function registerBridgeSession() {
  if (isRegistering) {
    return null;
  }

  isRegistering = true;
  postBridgeStatus("connecting", "正在连接本地 bridge…", null);

  try {
    const response = await bridgeFetch<PluginBridgeSession | PluginBridgeSyncResponse>("/sessions/register", {
      method: "POST",
      body: JSON.stringify(
        await sessionPayload({
          claimCommand: true,
          includeContextSnapshots: true,
        }),
      ),
    });
    return await handleBridgeSyncResponse(response);
  } catch (error) {
    pluginSessionId = null;
    postBridgeStatus("offline", describeError(error, "Bridge connect failed"), null);
    return null;
  } finally {
    isRegistering = false;
  }
}

async function heartbeatBridgeSession(options?: {
  claimCommand?: boolean;
  includeContextSnapshots?: boolean;
}) {
  if (!pluginSessionId) {
    return registerBridgeSession();
  }

  if (isHeartbeating) {
    return null;
  }

  isHeartbeating = true;

  try {
    const response = await bridgeFetch<PluginBridgeSession | PluginBridgeSyncResponse>(
      `/sessions/${pluginSessionId}/heartbeat`,
      {
      method: "POST",
        body: JSON.stringify(await sessionPayload(options)),
      },
    );
    return await handleBridgeSyncResponse(response);
  } catch (error) {
    pluginSessionId = null;
    postBridgeStatus("offline", describeError(error, "Bridge heartbeat failed"), null);
    return null;
  } finally {
    isHeartbeating = false;
  }
}

async function reportCommandResult(
  commandId: string,
  resultMessage: string,
  ok: boolean,
  results: Awaited<ReturnType<typeof runPluginCommandBatch>>["results"],
) {
  if (!pluginSessionId) {
    throw new Error("Bridge session is offline.");
  }

  await bridgeFetch(`/commands/${commandId}/result`, {
    method: "POST",
    body: JSON.stringify({
      resultMessage,
      ok,
      results,
    }),
  });
}

async function syncBridgeSession() {
  if (pluginSessionId) {
    return heartbeatBridgeSession({
      claimCommand: !isExecutingBridgeCommand,
      includeContextSnapshots: false,
    });
  }

  return registerBridgeSession();
}

async function runCommands(batch: FigmaPluginCommandBatch) {
  const result = await runPluginCommandBatch(batch);
  await postSelectionSummary(result.message);
  postCommandResult(result.message, result.ok, result.results);
  await syncBridgeSession().catch(() => null);
  return result;
}

function startBridgeLoop() {
  if (commandSyncTimer !== null) {
    clearInterval(commandSyncTimer);
  }
  if (heartbeatTimer !== null) {
    clearInterval(heartbeatTimer);
  }

  void syncBridgeSession();

  commandSyncTimer = setInterval(() => {
    void syncBridgeSession();
  }, COMMAND_SYNC_INTERVAL_MS);

  heartbeatTimer = setInterval(() => {
    void heartbeatBridgeSession({
      claimCommand: !isExecutingBridgeCommand,
      includeContextSnapshots: true,
    });
  }, HEARTBEAT_INTERVAL_MS);
}

figma.on("selectionchange", () => {
  void postSelectionSummary("已同步当前 selection。");
  if (pluginSessionId) {
    void heartbeatBridgeSession({
      claimCommand: false,
      includeContextSnapshots: false,
    });
  }
});

void (async () => {
  try {
    await postSelectionSummary("插件已连接到当前页面。");
    postBridgeStatus("connecting", "正在连接本地 bridge…", null);
    startBridgeLoop();
  } catch (error) {
    const detail = describeError(error, "插件初始化失败");
    postExecutionError(detail);
    postBridgeStatus("error", detail, null);
    figma.notify(detail, { error: true, timeout: 3000 });
  }
})();
