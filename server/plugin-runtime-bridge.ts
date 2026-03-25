import type {
  PluginBridgeCommandRecord,
  PluginBridgeSession,
  PluginImageArtifact,
  PluginNodeInspection,
} from "../shared/plugin-bridge.js";
import type { FigmaCapabilityCommand, FigmaPluginCommandBatch } from "../shared/plugin-contract.js";
import { nowIso } from "../shared/utils.js";
import {
  getPluginBridgeSnapshot,
  getPluginCommandRecord,
  queuePluginCommand,
} from "./plugin-bridge-store.js";

const pluginCommandWaitTimeoutMs = 30_000;
const pluginCommandPollIntervalMs = 300;

export function findSessionById(sessions: PluginBridgeSession[], sessionId: string) {
  return sessions.find((session) => session.id === sessionId) || null;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function collectCommandWarnings(command: PluginBridgeCommandRecord) {
  return uniqueStrings(command.results.flatMap((result) => result.warnings || []));
}

export function collectChangedNodeIds(command: PluginBridgeCommandRecord) {
  return uniqueStrings(command.results.flatMap((result) => result.changedNodeIds || []));
}

function collectExportedImages(command: PluginBridgeCommandRecord) {
  return command.results.flatMap((result) => result.exportedImages || []) as PluginImageArtifact[];
}

function collectInspectedNodes(command: PluginBridgeCommandRecord) {
  return command.results.flatMap((result) => result.inspectedNodes || []) as PluginNodeInspection[];
}

export function isReconstructionGeneratedInspectionNode(node: PluginNodeInspection) {
  return (
    node.generatedBy === "reconstruction" ||
    node.name.startsWith("AD Vector/") ||
    node.name.startsWith("AD Hybrid/") ||
    node.name.startsWith("AD Rebuild/")
  );
}

function isOnlineSession(session: PluginBridgeSession | null) {
  return Boolean(session && session.status === "online");
}

function supportsExplicitNodeTargeting(session: PluginBridgeSession | null) {
  return Boolean(session?.runtimeFeatures?.supportsExplicitNodeTargeting);
}

export async function requireOnlineSession(sessionId: string) {
  const snapshot = await getPluginBridgeSnapshot();
  const session = findSessionById(snapshot.sessions, sessionId);
  if (!session) {
    throw new Error("Plugin session not found");
  }
  if (!isOnlineSession(session)) {
    throw new Error(`Plugin session ${sessionId} is not online.`);
  }
  return session;
}

export async function requireLoopCompatibleSession(sessionId: string) {
  const session = await requireOnlineSession(sessionId);
  if (!supportsExplicitNodeTargeting(session)) {
    throw new Error(
      "当前在线 AutoDesign 插件会话未声明 supportsExplicitNodeTargeting，server 已阻止 auto-refine loop 继续执行。请重新导入并重新运行最新插件。",
    );
  }
  return session;
}

async function waitForPluginCommand(commandId: string) {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= pluginCommandWaitTimeoutMs) {
    const command = await getPluginCommandRecord(commandId);
    if (!command) {
      throw new Error(`Plugin command ${commandId} not found.`);
    }
    if (command.status === "succeeded" || command.status === "failed") {
      return command;
    }
    await sleep(pluginCommandPollIntervalMs);
  }
  throw new Error(`Timed out waiting for plugin command ${commandId}.`);
}

export async function queueAndWaitForPluginBatch(
  targetSessionId: string,
  commands: FigmaCapabilityCommand[],
) {
  if (!commands.length) {
    throw new Error("No reconstruction commands to execute.");
  }

  await requireOnlineSession(targetSessionId);

  const batch: FigmaPluginCommandBatch = {
    source: "codex",
    issuedAt: nowIso(),
    commands: commands.map((command) => ({
      ...command,
      executionMode: "strict",
    })),
  };

  const queued = await queuePluginCommand({
    targetSessionId,
    source: "codex",
    payload: batch,
  });

  return waitForPluginCommand(queued.id);
}

export function assertSuccessfulCommandRecord(
  command: PluginBridgeCommandRecord,
  contextLabel: string,
  options?: { allowMissingWarnings?: boolean },
) {
  if (command.status !== "succeeded") {
    throw new Error(command.resultMessage || `${contextLabel} failed.`);
  }

  const failedResult = command.results.find((result) => !result.ok);
  if (failedResult) {
    throw new Error(failedResult.message || `${contextLabel} failed.`);
  }

  const warnings = collectCommandWarnings(command);
  if (!warnings.length) {
    return warnings;
  }

  if (options?.allowMissingWarnings) {
    const unexpected = warnings.filter((warning) => !warning.includes("未找到"));
    if (!unexpected.length) {
      return warnings;
    }
    throw new Error(`${contextLabel} returned warnings: ${unexpected.join(" | ")}`);
  }

  throw new Error(`${contextLabel} returned warnings: ${warnings.join(" | ")}`);
}

export async function exportSingleNodeImage(
  targetSessionId: string,
  nodeId: string,
  options?: {
    preferOriginalBytes?: boolean;
    constraint?: { type: "WIDTH" | "HEIGHT" | "SCALE"; value: number };
  },
) {
  const command = await queueAndWaitForPluginBatch(targetSessionId, [
    {
      type: "capability",
      capabilityId: "assets.export-node-image",
      nodeIds: [nodeId],
      payload: {
        preferOriginalBytes: options?.preferOriginalBytes,
        ...(options?.constraint ? { constraint: options.constraint } : {}),
      },
      executionMode: "strict",
    },
  ]);

  assertSuccessfulCommandRecord(command, "Node image export");
  const artifact = collectExportedImages(command).find((item) => item.nodeId === nodeId) || null;
  if (!artifact) {
    throw new Error(`Node image export completed without artifact for node ${nodeId}.`);
  }
  return artifact;
}

export async function inspectNodeSubtree(
  targetSessionId: string,
  nodeId: string,
  options?: { maxDepth?: number },
) {
  const command = await queueAndWaitForPluginBatch(targetSessionId, [
    {
      type: "capability",
      capabilityId: "nodes.inspect-subtree",
      payload: {
        nodeId,
        ...(Number.isFinite(options?.maxDepth) ? { maxDepth: options?.maxDepth } : {}),
      },
      executionMode: "strict",
    },
  ]);

  assertSuccessfulCommandRecord(command, "Node inspect");
  return collectInspectedNodes(command);
}

export async function inspectFrameSubtree(
  targetSessionId: string,
  frameNodeId: string,
  options?: { maxDepth?: number },
) {
  return inspectNodeSubtree(targetSessionId, frameNodeId, options);
}
