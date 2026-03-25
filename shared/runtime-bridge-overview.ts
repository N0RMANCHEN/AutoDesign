import type {
  PluginBridgeCommandRecord,
  PluginBridgeSnapshot,
  PluginBridgeCommandStatus,
  PluginBridgeSession,
} from "./plugin-bridge.js";

export type RuntimeBridgeOverviewSession = {
  id: string;
  label: string;
  editorType: PluginBridgeSession["editorType"];
  fileName: string;
  pageName: string;
  status: PluginBridgeSession["status"];
  lastSeenAt: string;
  lastHandshakeAt: string;
  selectionCount: number;
  capabilityCount: number;
  supportsExplicitNodeTargeting: boolean;
  hasStyleSnapshot: boolean;
  hasVariableSnapshot: boolean;
};

export type RuntimeBridgeOverviewCommand = {
  id: string;
  targetSessionId: string;
  source: PluginBridgeCommandRecord["source"];
  status: PluginBridgeCommandStatus;
  createdAt: string;
  completedAt: string | null;
  resultMessage: string;
  warningCount: number;
  errorCount: number;
  changedNodeCount: number;
};

export type RuntimeBridgeOverview = {
  sessionCount: number;
  onlineSessionCount: number;
  staleSessionCount: number;
  commandCounts: Record<PluginBridgeCommandStatus, number>;
  sessions: RuntimeBridgeOverviewSession[];
  commands: RuntimeBridgeOverviewCommand[];
};

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function toRuntimeBridgeOverviewSession(
  session: PluginBridgeSession,
): RuntimeBridgeOverviewSession {
  return {
    id: session.id,
    label: session.label,
    editorType: session.editorType,
    fileName: session.fileName,
    pageName: session.pageName,
    status: session.status,
    lastSeenAt: session.lastSeenAt,
    lastHandshakeAt: session.lastHandshakeAt,
    selectionCount: Array.isArray(session.selection) ? session.selection.length : 0,
    capabilityCount: Array.isArray(session.capabilities) ? session.capabilities.length : 0,
    supportsExplicitNodeTargeting: Boolean(
      session.runtimeFeatures?.supportsExplicitNodeTargeting,
    ),
    hasStyleSnapshot: session.hasStyleSnapshot === true,
    hasVariableSnapshot: session.hasVariableSnapshot === true,
  };
}

export function buildRuntimeBridgeOverviewCommand(
  command: PluginBridgeCommandRecord,
): RuntimeBridgeOverviewCommand {
  const results = Array.isArray(command.results) ? command.results : [];
  return {
    id: command.id,
    targetSessionId: command.targetSessionId,
    source: command.source,
    status: command.status,
    createdAt: command.createdAt,
    completedAt: command.completedAt,
    resultMessage: command.resultMessage,
    warningCount: results.reduce((total, result) => total + (result.warnings?.length ?? 0), 0),
    errorCount: results.filter((result) => result.ok === false).length,
    changedNodeCount: uniqueStrings(
      results.flatMap((result) => result.changedNodeIds || []),
    ).length,
  };
}

export function buildRuntimeBridgeOverview(
  snapshot: Pick<PluginBridgeSnapshot, "sessions" | "commands">,
): RuntimeBridgeOverview {
  const sessions = Array.isArray(snapshot.sessions)
    ? snapshot.sessions.map(toRuntimeBridgeOverviewSession)
    : [];
  const commands = Array.isArray(snapshot.commands)
    ? snapshot.commands.map(buildRuntimeBridgeOverviewCommand)
    : [];

  return {
    sessionCount: sessions.length,
    onlineSessionCount: sessions.filter((session) => session.status === "online").length,
    staleSessionCount: sessions.filter((session) => session.status === "stale").length,
    commandCounts: {
      queued: commands.filter((command) => command.status === "queued").length,
      claimed: commands.filter((command) => command.status === "claimed").length,
      succeeded: commands.filter((command) => command.status === "succeeded").length,
      failed: commands.filter((command) => command.status === "failed").length,
    },
    sessions,
    commands,
  };
}
