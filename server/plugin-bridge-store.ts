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
import { resolveDataDirectory } from "./runtime-paths.js";

const sessionFreshnessMs = 45_000;

const emptySnapshot: PluginBridgeSnapshot = {
  sessions: [],
  commands: [],
};

// Simple async mutex to prevent concurrent read-modify-write corruption.
let lockQueue: Promise<void> = Promise.resolve();

function resolveBridgePaths() {
  const dataDirectory = resolveDataDirectory();
  return {
    dataDirectory,
    bridgeFile: path.join(dataDirectory, "autodesign-plugin-bridge.json"),
    legacyBridgeFile: path.join(dataDirectory, "figmatest-plugin-bridge.json"),
  };
}

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = lockQueue.then(fn, fn);
  // Keep the chain going regardless of success/failure.
  lockQueue = next.then(() => {}, () => {});
  return next;
}

async function ensureBridgeFile() {
  const { dataDirectory, bridgeFile, legacyBridgeFile } = resolveBridgePaths();
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
  const { bridgeFile } = resolveBridgePaths();
  const raw = await readFile(bridgeFile, "utf8");
  return JSON.parse(raw) as PluginBridgeSnapshot;
}

async function writeSnapshot(snapshot: PluginBridgeSnapshot): Promise<PluginBridgeSnapshot> {
  await ensureBridgeFile();
  const { bridgeFile } = resolveBridgePaths();
  await writeFile(bridgeFile, JSON.stringify(snapshot, null, 2), "utf8");
  return snapshot;
}

function generateId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeVariableCollections(
  collections: PluginBridgeSession["variableCollections"],
) {
  return Array.isArray(collections)
    ? collections.map((collection) => ({
        id: String(collection.id || ""),
        name: String(collection.name || "Unnamed Collection"),
        defaultModeId: String(collection.defaultModeId || ""),
        hiddenFromPublishing: Boolean(collection.hiddenFromPublishing),
        modes: Array.isArray(collection.modes)
          ? collection.modes
              .map((mode) =>
                mode && typeof mode.modeId === "string"
                  ? {
                      modeId: mode.modeId,
                      name: typeof mode.name === "string" ? mode.name : mode.modeId,
                    }
                  : null,
              )
              .filter((mode): mode is NonNullable<typeof mode> => Boolean(mode))
          : [],
      }))
    : [];
}

function normalizeStyleDefinitions(styles: PluginBridgeSession["styles"]) {
  return Array.isArray(styles)
    ? styles.map((style) => ({
        id: String(style.id || ""),
        styleType:
          style.styleType === "paint" ||
          style.styleType === "text" ||
          style.styleType === "effect" ||
          style.styleType === "grid"
            ? style.styleType
            : "paint",
        name: String(style.name || "Unnamed Style"),
        description:
          typeof style.description === "string" && style.description.trim()
            ? style.description.trim()
            : null,
      }))
    : [];
}

function normalizeVariables(variables: PluginBridgeSession["variables"]) {
  return Array.isArray(variables)
    ? variables.map((variable) => ({
        id: String(variable.id || ""),
        name: String(variable.name || "Unnamed Variable"),
        collectionId: String(variable.collectionId || ""),
        collectionName: String(variable.collectionName || "Unknown Collection"),
        resolvedType:
          variable.resolvedType === "COLOR" ||
          variable.resolvedType === "FLOAT" ||
          variable.resolvedType === "STRING" ||
          variable.resolvedType === "BOOLEAN"
            ? variable.resolvedType
            : "STRING",
        hiddenFromPublishing: Boolean(variable.hiddenFromPublishing),
        scopes: Array.isArray(variable.scopes) ? variable.scopes.map(String) : [],
        valuesByMode: Array.isArray(variable.valuesByMode)
          ? variable.valuesByMode.map((value) => ({
              modeId: String(value.modeId || ""),
              modeName: typeof value.modeName === "string" ? value.modeName : null,
              kind:
                value.kind === "color" ||
                value.kind === "number" ||
                value.kind === "string" ||
                value.kind === "boolean" ||
                value.kind === "alias" ||
                value.kind === "unknown"
                  ? value.kind
                  : "unknown",
              value:
                typeof value.value === "string" ||
                typeof value.value === "number" ||
                typeof value.value === "boolean" ||
                value.value === null
                  ? value.value
                  : null,
            }))
          : [],
      }))
    : [];
}

function withSessionStatus(session: PluginBridgeSession): PluginBridgeSession {
  const lastSeen = new Date(session.lastSeenAt).getTime();
  const isFresh = Number.isFinite(lastSeen) && Date.now() - lastSeen <= sessionFreshnessMs;

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
    hasStyleSnapshot: session.hasStyleSnapshot === true,
    styles: normalizeStyleDefinitions(session.styles),
    hasVariableSnapshot: session.hasVariableSnapshot === true,
    variableCollections: normalizeVariableCollections(session.variableCollections),
    variables: normalizeVariables(session.variables),
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
    const nextHasStyleSnapshot =
      typeof payload.hasStyleSnapshot === "boolean"
        ? payload.hasStyleSnapshot
        : (previous?.hasStyleSnapshot ?? false);
    const nextStyles =
      payload.styles !== undefined ? payload.styles : (previous?.styles ?? []);
    const nextHasVariableSnapshot =
      typeof payload.hasVariableSnapshot === "boolean"
        ? payload.hasVariableSnapshot
        : (previous?.hasVariableSnapshot ?? false);
    const nextVariableCollections =
      payload.variableCollections !== undefined
        ? payload.variableCollections
        : (previous?.variableCollections ?? []);
    const nextVariables =
      payload.variables !== undefined ? payload.variables : (previous?.variables ?? []);

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
      hasStyleSnapshot: nextHasStyleSnapshot,
      styles: nextStyles,
      hasVariableSnapshot: nextHasVariableSnapshot,
      variableCollections: nextVariableCollections,
      variables: nextVariables,
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
    const nextHasStyleSnapshot =
      typeof payload.hasStyleSnapshot === "boolean"
        ? payload.hasStyleSnapshot
        : (previous.hasStyleSnapshot ?? false);
    const nextStyles =
      payload.styles !== undefined ? payload.styles : (previous.styles ?? []);
    const nextHasVariableSnapshot =
      typeof payload.hasVariableSnapshot === "boolean"
        ? payload.hasVariableSnapshot
        : (previous.hasVariableSnapshot ?? false);
    const nextVariableCollections =
      payload.variableCollections !== undefined
        ? payload.variableCollections
        : (previous.variableCollections ?? []);
    const nextVariables =
      payload.variables !== undefined ? payload.variables : (previous.variables ?? []);

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
      hasStyleSnapshot: nextHasStyleSnapshot,
      styles: nextStyles,
      hasVariableSnapshot: nextHasVariableSnapshot,
      variableCollections: nextVariableCollections,
      variables: nextVariables,
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
