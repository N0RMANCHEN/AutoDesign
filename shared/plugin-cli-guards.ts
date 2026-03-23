import type { PluginBridgeSession } from "./plugin-bridge.js";
import type { FigmaPluginCommandBatch } from "./plugin-contract.js";
import {
  normalizeLegacyCommandForExternalDispatch,
  requiresExplicitNodeIdsForExternalCapability,
} from "./plugin-targeting.js";
import type { CreateReconstructionJobPayload } from "./reconstruction.js";

export function parseNodeIds(nodeIdsRaw: string | null) {
  if (!nodeIdsRaw) {
    return [];
  }
  return nodeIdsRaw.split(",").map((id) => id.trim()).filter(Boolean);
}

export function parseReconstructionStrategy(
  argv: string[],
  readFlag: (argv: string[], name: string) => string | null,
): CreateReconstructionJobPayload["strategy"] {
  const explicit = readFlag(argv, "--strategy");
  if (
    explicit === "vector-reconstruction" ||
    explicit === "hybrid-reconstruction" ||
    explicit === "raster-exact" ||
    explicit === "structural-preview"
  ) {
    return explicit;
  }
  if (argv.includes("--hybrid")) {
    return "hybrid-reconstruction";
  }
  if (argv.includes("--raster-exact")) {
    return "raster-exact";
  }
  if (argv.includes("--vector-reconstruction")) {
    return "vector-reconstruction";
  }
  if (argv.includes("--structural-preview")) {
    return "structural-preview";
  }
  if (explicit) {
    throw new Error(`不支持的 reconstruction strategy: ${explicit}`);
  }
  return undefined;
}

function formatSelectionForTargeting(session: PluginBridgeSession) {
  if (!session.selection.length) {
    return "当前 selection 为空。";
  }

  return [
    "当前 selection:",
    ...session.selection.map(
      (node) => `- ${node.name} [${node.type}] id=${node.id}`,
    ),
  ].join("\n");
}

export function ensureExplicitTargetingForMutations(
  batch: FigmaPluginCommandBatch,
  session: PluginBridgeSession,
  nodeIds: string[],
) {
  const normalizedCommands = batch.commands.map((command) =>
    normalizeLegacyCommandForExternalDispatch(command),
  );
  const mutatingCapabilityIds = normalizedCommands
    .map((command) => command.capabilityId)
    .filter((capabilityId) => requiresExplicitNodeIdsForExternalCapability(capabilityId));
  if (!mutatingCapabilityIds.length) {
    return;
  }

  if (!session.runtimeFeatures?.supportsExplicitNodeTargeting) {
    throw new Error("目标插件当前不支持显式 nodeIds 定向，已拒绝发送修改类外部命令。");
  }

  const missingExplicitTargets = normalizedCommands.filter(
    (command) =>
      requiresExplicitNodeIdsForExternalCapability(command.capabilityId) &&
      (!Array.isArray(command.nodeIds) || command.nodeIds.length === 0),
  );

  if (!nodeIds.length && missingExplicitTargets.length) {
    throw new Error(
      [
        `修改类外部命令必须提供 --node-ids。涉及能力：${mutatingCapabilityIds.join(", ")}`,
        "如果使用 --json，也可以直接在每条 capability command 上显式提供 nodeIds。",
        '示例：npm run plugin:send -- --prompt "把指定对象改成深灰色" --node-ids 1:2',
        formatSelectionForTargeting(session),
      ].join("\n"),
    );
  }
}

export function ensureSafeMutationBatch(batch: FigmaPluginCommandBatch) {
  const mutatingTargetSets = batch.commands
    .map((command) => normalizeLegacyCommandForExternalDispatch(command))
    .filter((command) => requiresExplicitNodeIdsForExternalCapability(command.capabilityId))
    .map((command) => {
      const targetIds = Array.isArray(command.nodeIds) ? command.nodeIds.filter(Boolean) : [];
      return targetIds.join(",");
    })
    .filter(Boolean);

  if (mutatingTargetSets.length > 1 && new Set(mutatingTargetSets).size > 1) {
    throw new Error("外部修改类命令不能在同一批次里混用多组 nodeIds。请按父级或局部拆成多次 plugin:send。");
  }
}
