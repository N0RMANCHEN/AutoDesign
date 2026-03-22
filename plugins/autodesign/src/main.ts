import type {
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

const PLUGIN_LABEL = "AutoDesign";
const PLUGIN_VERSION = "0.2.3";
const BRIDGE_URL = "http://localhost:3001/api/plugin-bridge";
const UI_WIDTH = 252;
const UI_HEIGHT = 116;
const POLL_INTERVAL_MS = 1500;
const HEARTBEAT_INTERVAL_MS = 5000;

type BridgeUiState = "connecting" | "online" | "offline" | "error";

let pluginSessionId: string | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let selectionSummaryRequestId = 0;
let isRegistering = false;
let isHeartbeating = false;
let isPolling = false;
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

async function sessionPayload(): Promise<PluginSessionRegistrationPayload> {
  return {
    sessionId: pluginSessionId || undefined,
    label: PLUGIN_LABEL,
    pluginVersion: PLUGIN_VERSION,
    editorType: figma.editorType,
    fileName: figma.root.name || "Untitled",
    pageName: figma.currentPage.name || "Page",
    runtimeFeatures: getRuntimeFeatures(),
    capabilities: getRuntimeCapabilities(),
    selection: await readSelectionSummary(),
  };
}

async function bridgeFetch(pathname: string, init?: RequestInit) {
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

  return response.json();
}

async function registerBridgeSession() {
  if (isRegistering) {
    return null;
  }

  isRegistering = true;
  postBridgeStatus("connecting", "正在连接本地 bridge…", null);

  try {
    const session = await bridgeFetch("/sessions/register", {
      method: "POST",
      body: JSON.stringify(await sessionPayload()),
    });

    pluginSessionId = session.id;
    postBridgeStatus("online", `Bridge online: ${session.id}`, session);
    return session;
  } catch (error) {
    pluginSessionId = null;
    postBridgeStatus("offline", describeError(error, "Bridge connect failed"), null);
    return null;
  } finally {
    isRegistering = false;
  }
}

async function heartbeatBridgeSession() {
  if (!pluginSessionId) {
    return registerBridgeSession();
  }

  if (isHeartbeating) {
    return null;
  }

  isHeartbeating = true;

  try {
    const session = await bridgeFetch(`/sessions/${pluginSessionId}/heartbeat`, {
      method: "POST",
      body: JSON.stringify(await sessionPayload()),
    });
    pluginSessionId = session.id;
    postBridgeStatus("online", `Bridge online: ${session.id}`, session);
    return session;
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
    return heartbeatBridgeSession();
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

async function pollBridgeCommands() {
  if (!pluginSessionId || isPolling) {
    return;
  }

  isPolling = true;

  try {
    const response = await bridgeFetch(`/sessions/${pluginSessionId}/commands/next`, {
      method: "GET",
    });
    const command = response.command;
    if (!command) {
      return;
    }

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
    }
  } catch (error) {
    pluginSessionId = null;
    postBridgeStatus(
      "offline",
      describeError(error, "Bridge polling failed"),
      null,
    );
  } finally {
    isPolling = false;
  }
}

function startBridgeLoop() {
  if (pollTimer !== null) {
    clearInterval(pollTimer);
  }
  if (heartbeatTimer !== null) {
    clearInterval(heartbeatTimer);
  }

  void syncBridgeSession();

  pollTimer = setInterval(() => {
    void pollBridgeCommands();
  }, POLL_INTERVAL_MS);

  heartbeatTimer = setInterval(() => {
    void syncBridgeSession();
  }, HEARTBEAT_INTERVAL_MS);
}

figma.on("selectionchange", () => {
  void postSelectionSummary("已同步当前 selection。");
  if (pluginSessionId) {
    void heartbeatBridgeSession();
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
