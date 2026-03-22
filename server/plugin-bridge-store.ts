import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  PluginBridgeCommandRecord,
  PluginBridgeSession,
  PluginBridgeSnapshot,
  PluginCommandResultPayload,
  PluginSessionRegistrationPayload,
  QueuePluginCommandPayload,
} from "../shared/plugin-bridge.js";
import { nowIso } from "../shared/utils.js";

const dataDirectory = path.join(process.cwd(), "data");
const bridgeFile = path.join(dataDirectory, "autodesign-plugin-bridge.json");
const legacyBridgeFile = path.join(dataDirectory, "figmatest-plugin-bridge.json");
const sessionFreshnessMs = 45_000;

const emptySnapshot: PluginBridgeSnapshot = {
  sessions: [],
  commands: [],
};

async function ensureBridgeFile() {
  await mkdir(dataDirectory, { recursive: true });

  try {
    await readFile(bridgeFile, "utf8");
  } catch {
    try {
      const legacy = await readFile(legacyBridgeFile, "utf8");
      await writeFile(bridgeFile, legacy, "utf8");
    } catch {
      await writeFile(bridgeFile, JSON.stringify(emptySnapshot, null, 2), "utf8");
    }
  }
}

async function readSnapshot(): Promise<PluginBridgeSnapshot> {
  await ensureBridgeFile();
  const raw = await readFile(bridgeFile, "utf8");
  return JSON.parse(raw) as PluginBridgeSnapshot;
}

async function writeSnapshot(snapshot: PluginBridgeSnapshot): Promise<PluginBridgeSnapshot> {
  await ensureBridgeFile();
  await writeFile(bridgeFile, JSON.stringify(snapshot, null, 2), "utf8");
  return snapshot;
}

function generateId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function withSessionStatus(session: PluginBridgeSession): PluginBridgeSession {
  const lastSeen = new Date(session.lastSeenAt).getTime();
  const isFresh = Date.now() - lastSeen <= sessionFreshnessMs;

  return {
    ...session,
    pluginVersion: session.pluginVersion || "0.0.0",
    editorType: session.editorType || "figma",
    capabilities: Array.isArray(session.capabilities) ? session.capabilities : [],
    status: isFresh ? "online" : "stale",
  };
}

function sortSessions(sessions: PluginBridgeSession[]) {
  return sessions
    .map(withSessionStatus)
    .sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt));
}

function sortCommands(commands: PluginBridgeCommandRecord[]) {
  return [...commands]
    .map((command) => ({
      ...command,
      results: Array.isArray(command.results) ? command.results : [],
    }))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function getPluginBridgeSnapshot(): Promise<PluginBridgeSnapshot> {
  const snapshot = await readSnapshot();
  return {
    sessions: sortSessions(snapshot.sessions),
    commands: sortCommands(snapshot.commands).slice(0, 60),
  };
}

export async function registerPluginSession(
  payload: PluginSessionRegistrationPayload,
): Promise<PluginBridgeSession> {
  const snapshot = await readSnapshot();
  const timestamp = nowIso();
  const sessionId = payload.sessionId || generateId("plugin_session");

  const nextSession: PluginBridgeSession = withSessionStatus({
    id: sessionId,
    label: payload.label,
    pluginVersion: payload.pluginVersion,
    editorType: payload.editorType,
    fileName: payload.fileName,
    pageName: payload.pageName,
    status: "online",
    lastSeenAt: timestamp,
    lastHandshakeAt: timestamp,
    capabilities: payload.capabilities,
    selection: payload.selection,
  });

  const existingIndex = snapshot.sessions.findIndex((item) => item.id === sessionId);
  if (existingIndex >= 0) {
    snapshot.sessions[existingIndex] = nextSession;
  } else {
    snapshot.sessions.unshift(nextSession);
  }

  await writeSnapshot({
    ...snapshot,
    sessions: sortSessions(snapshot.sessions),
  });

  return nextSession;
}

export async function heartbeatPluginSession(
  sessionId: string,
  payload: PluginSessionRegistrationPayload,
): Promise<PluginBridgeSession | null> {
  const snapshot = await readSnapshot();
  const existingIndex = snapshot.sessions.findIndex((item) => item.id === sessionId);
  if (existingIndex < 0) {
    return null;
  }

  const updated = withSessionStatus({
    ...snapshot.sessions[existingIndex],
    label: payload.label,
    pluginVersion: payload.pluginVersion,
    editorType: payload.editorType,
    fileName: payload.fileName,
    pageName: payload.pageName,
    capabilities: payload.capabilities,
    selection: payload.selection,
    lastSeenAt: nowIso(),
  });

  snapshot.sessions[existingIndex] = updated;
  await writeSnapshot({
    ...snapshot,
    sessions: sortSessions(snapshot.sessions),
  });

  return updated;
}

export async function queuePluginCommand(
  payload: QueuePluginCommandPayload,
): Promise<PluginBridgeCommandRecord> {
  const snapshot = await readSnapshot();
  const command: PluginBridgeCommandRecord = {
    id: generateId("plugin_cmd"),
    targetSessionId: payload.targetSessionId,
    source: payload.source,
    payload: payload.payload,
    status: "queued",
    createdAt: nowIso(),
    claimedAt: null,
    completedAt: null,
    resultMessage: "",
    results: [],
  };

  snapshot.commands.unshift(command);
  await writeSnapshot(snapshot);
  return command;
}

export async function claimNextPluginCommand(
  sessionId: string,
): Promise<PluginBridgeCommandRecord | null> {
  const snapshot = await readSnapshot();
  const nextIndex = snapshot.commands.findIndex(
    (item) => item.targetSessionId === sessionId && item.status === "queued",
  );

  if (nextIndex < 0) {
    return null;
  }

  const nextCommand = {
    ...snapshot.commands[nextIndex],
    status: "claimed" as const,
    claimedAt: nowIso(),
  };
  snapshot.commands[nextIndex] = nextCommand;
  await writeSnapshot(snapshot);
  return nextCommand;
}

export async function completePluginCommand(
  commandId: string,
  payload: PluginCommandResultPayload,
): Promise<PluginBridgeCommandRecord | null> {
  const snapshot = await readSnapshot();
  const commandIndex = snapshot.commands.findIndex((item) => item.id === commandId);
  if (commandIndex < 0) {
    return null;
  }

  const nextCommand: PluginBridgeCommandRecord = {
    ...snapshot.commands[commandIndex],
    status: payload.ok ? "succeeded" : "failed",
    completedAt: nowIso(),
    resultMessage: payload.resultMessage,
    results: payload.results || [],
  };

  snapshot.commands[commandIndex] = nextCommand;
  await writeSnapshot(snapshot);
  return nextCommand;
}
