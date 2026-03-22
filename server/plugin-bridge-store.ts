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
const serverStartedAtMs = Date.now();

const emptySnapshot: PluginBridgeSnapshot = {
  sessions: [],
  commands: [],
};

// Simple async mutex to prevent concurrent read-modify-write corruption.
let lockQueue: Promise<void> = Promise.resolve();

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = lockQueue.then(fn, fn);
  // Keep the chain going regardless of success/failure.
  lockQueue = next.then(() => {}, () => {});
  return next;
}

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
  const seenByCurrentServer = Number.isFinite(lastSeen) && lastSeen >= serverStartedAtMs;
  const isFresh = seenByCurrentServer && Date.now() - lastSeen <= sessionFreshnessMs;

  return {
    ...session,
    pluginVersion: session.pluginVersion || "0.0.0",
    editorType: session.editorType || "figma",
    runtimeFeatures: {
      supportsExplicitNodeTargeting: Boolean(
        session.runtimeFeatures?.supportsExplicitNodeTargeting,
      ),
    },
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
      results: Array.isArray(command.results)
        ? command.results.map((result) => ({
            ...result,
            exportedImages: Array.isArray(result.exportedImages) ? result.exportedImages : [],
          }))
        : [],
    }))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function getPluginBridgeSnapshot(): Promise<PluginBridgeSnapshot> {
  return withLock(async () => {
    const snapshot = await readSnapshot();
    return {
      sessions: sortSessions(snapshot.sessions),
      commands: sortCommands(snapshot.commands).slice(0, 60),
    };
  });
}

export function getPluginCommandRecord(
  commandId: string,
): Promise<PluginBridgeCommandRecord | null> {
  return withLock(async () => {
    const snapshot = await readSnapshot();
    const command = snapshot.commands.find((item) => item.id === commandId) || null;
    return command
      ? {
          ...command,
          results: Array.isArray(command.results)
            ? command.results.map((result) => ({
                ...result,
                exportedImages: Array.isArray(result.exportedImages) ? result.exportedImages : [],
              }))
            : [],
        }
      : null;
  });
}

export function registerPluginSession(
  payload: PluginSessionRegistrationPayload,
): Promise<PluginBridgeSession> {
  return withLock(async () => {
  const snapshot = await readSnapshot();
  const timestamp = nowIso();
  const sessionId = payload.sessionId || generateId("plugin_session");

  const existingIndex = snapshot.sessions.findIndex((item) => item.id === sessionId);
  const previous = existingIndex >= 0 ? snapshot.sessions[existingIndex] : null;
  const incomingSelection = Array.isArray(payload.selection) ? payload.selection : [];
  const nextSelection =
    incomingSelection.length > 0
      ? incomingSelection
      : previous
        ? previous.selection
        : [];

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
    runtimeFeatures: payload.runtimeFeatures,
    capabilities: payload.capabilities,
    selection: nextSelection,
  });
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
  });
}

export function heartbeatPluginSession(
  sessionId: string,
  payload: PluginSessionRegistrationPayload,
): Promise<PluginBridgeSession | null> {
  return withLock(async () => {
  const snapshot = await readSnapshot();
  const existingIndex = snapshot.sessions.findIndex((item) => item.id === sessionId);
  if (existingIndex < 0) {
    return null;
  }

  const previous = snapshot.sessions[existingIndex];
  const incomingSelection = Array.isArray(payload.selection) ? payload.selection : [];
  const nextSelection =
    incomingSelection.length > 0 ? incomingSelection : previous.selection;

  const updated = withSessionStatus({
    ...previous,
    label: payload.label,
    pluginVersion: payload.pluginVersion,
    editorType: payload.editorType,
    fileName: payload.fileName,
    pageName: payload.pageName,
    runtimeFeatures: payload.runtimeFeatures,
    capabilities: payload.capabilities,
    selection: nextSelection,
    lastSeenAt: nowIso(),
  });

  snapshot.sessions[existingIndex] = updated;
  await writeSnapshot({
    ...snapshot,
    sessions: sortSessions(snapshot.sessions),
  });

  return updated;
  });
}

export function queuePluginCommand(
  payload: QueuePluginCommandPayload,
): Promise<PluginBridgeCommandRecord> {
  return withLock(async () => {
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
  });
}

export function claimNextPluginCommand(
  sessionId: string,
): Promise<PluginBridgeCommandRecord | null> {
  return withLock(async () => {
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
  });
}

export function completePluginCommand(
  commandId: string,
  payload: PluginCommandResultPayload,
): Promise<PluginBridgeCommandRecord | null> {
  return withLock(async () => {
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
  });
}
