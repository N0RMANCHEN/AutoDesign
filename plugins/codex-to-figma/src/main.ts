import type { PluginSessionRegistrationPayload } from "../../../shared/plugin-bridge.js";
import type { FigmaPluginCommandBatch } from "../../../shared/plugin-contract.js";
import { runPluginCommandBatch, getRuntimeCapabilities } from "./runtime/capability-runner.js";
import { currentSelectionUiPayload } from "./runtime/selection-context.js";

const PLUGIN_LABEL = "Codex to Figma";
const PLUGIN_VERSION = "0.2.0";
const BRIDGE_URL = "http://localhost:3001/api/plugin-bridge";
const UI_WIDTH = 252;
const UI_HEIGHT = 116;

let pluginSessionId: string | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let selectionSummaryRequestId = 0;

figma.showUI(__html__, {
  width: UI_WIDTH,
  height: UI_HEIGHT,
  title: PLUGIN_LABEL,
  themeColors: true,
});

async function postSelectionSummary(message: string) {
  const requestId = ++selectionSummaryRequestId;
  const selection = await currentSelectionUiPayload();
  if (requestId !== selectionSummaryRequestId) {
    return;
  }

  figma.ui.postMessage({
    type: "selection-summary",
    message,
    selection,
  });
}

function postBridgeStatus(message: string, session: unknown) {
  figma.ui.postMessage({
    type: "bridge-status",
    message,
    session: session || null,
  });
}

function postExecutionError(message: string) {
  figma.ui.postMessage({
    type: "execution-error",
    message,
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
    capabilities: getRuntimeCapabilities(),
    selection: await currentSelectionUiPayload(),
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
  const session = await bridgeFetch("/sessions/register", {
    method: "POST",
    body: JSON.stringify(await sessionPayload()),
  });

  pluginSessionId = session.id;
  postBridgeStatus(`Bridge connected: ${session.id}`, session);
  return session;
}

async function heartbeatBridgeSession() {
  if (!pluginSessionId) {
    await registerBridgeSession();
    return;
  }

  try {
    const session = await bridgeFetch(`/sessions/${pluginSessionId}/heartbeat`, {
      method: "POST",
      body: JSON.stringify(await sessionPayload()),
    });
    postBridgeStatus(`Bridge online: ${session.id}`, session);
  } catch {
    await registerBridgeSession();
  }
}

async function reportCommandResult(
  commandId: string,
  resultMessage: string,
  ok: boolean,
  results: Awaited<ReturnType<typeof runPluginCommandBatch>>["results"],
) {
  await bridgeFetch(`/commands/${commandId}/result`, {
    method: "POST",
    body: JSON.stringify({
      resultMessage,
      ok,
      results,
    }),
  });
}

async function runCommands(batch: FigmaPluginCommandBatch) {
  const result = await runPluginCommandBatch(batch);
  await postSelectionSummary(result.message);
  figma.notify(result.message, {
    timeout: 1800,
    error: !result.ok,
  });
  await heartbeatBridgeSession();
  return result;
}

async function pollBridgeCommands() {
  if (!pluginSessionId) {
    return;
  }

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
      await reportCommandResult(command.id, result.message, result.ok, result.results);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "未知错误";
      await reportCommandResult(command.id, detail, false, []);
      throw error;
    }
  } catch (error) {
    postBridgeStatus(
      error instanceof Error ? error.message : "Bridge polling failed",
      null,
    );
  }
}

async function startBridgeLoop() {
  try {
    await registerBridgeSession();
  } catch (error) {
    postBridgeStatus(
      error instanceof Error ? error.message : "Bridge connect failed",
      null,
    );
    return;
  }

  if (pollTimer !== null) {
    clearInterval(pollTimer);
  }
  if (heartbeatTimer !== null) {
    clearInterval(heartbeatTimer);
  }

  pollTimer = setInterval(() => {
    void pollBridgeCommands();
  }, 1500);

  heartbeatTimer = setInterval(() => {
    void heartbeatBridgeSession();
  }, 5000);
}

figma.on("selectionchange", () => {
  void postSelectionSummary("");
  void heartbeatBridgeSession();
});

void (async () => {
  try {
    await postSelectionSummary("插件已连接到当前页面。");
    await startBridgeLoop();
  } catch (error) {
    const detail = error instanceof Error ? error.message : "插件初始化失败";
    postExecutionError(detail);
    figma.notify(detail, { error: true, timeout: 3000 });
  }
})();
