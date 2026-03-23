import type { PluginCapabilityId } from "./plugin-capabilities.js";
import type {
  FigmaCapabilityCommand,
  FigmaPluginCommand,
  FigmaPluginCommandBatch,
} from "./plugin-contract.js";

export const READ_ONLY_EXTERNAL_CAPABILITY_IDS = new Set<PluginCapabilityId>([
  "selection.refresh",
  "assets.export-node-image",
  "nodes.inspect-subtree",
]);

export function requiresExplicitNodeIdsForExternalCapability(
  capabilityId: PluginCapabilityId,
) {
  return !READ_ONLY_EXTERNAL_CAPABILITY_IDS.has(capabilityId);
}

export function normalizeLegacyCommandForExternalDispatch(
  command: FigmaPluginCommand,
  nodeIds?: string[],
): FigmaCapabilityCommand {
  if (command.type === "capability") {
    const effectiveNodeIds =
      Array.isArray(command.nodeIds) && command.nodeIds.length > 0 ? command.nodeIds : nodeIds;
    if (!nodeIds || nodeIds.length === 0) {
      return effectiveNodeIds ? { ...command, nodeIds: effectiveNodeIds } : command;
    }
    return {
      ...command,
      nodeIds: effectiveNodeIds,
    };
  }

  switch (command.type) {
    case "refresh-selection":
      return {
        type: "capability",
        capabilityId: "selection.refresh",
        payload: {},
        ...(nodeIds && nodeIds.length ? { nodeIds } : {}),
      };
    case "set-selection-fill":
      return {
        type: "capability",
        capabilityId: "fills.set-fill",
        payload: { hex: command.hex },
        ...(nodeIds && nodeIds.length ? { nodeIds } : {}),
      };
    case "set-selection-stroke":
      return {
        type: "capability",
        capabilityId: "strokes.set-stroke",
        payload: { hex: command.hex },
        ...(nodeIds && nodeIds.length ? { nodeIds } : {}),
      };
    case "set-selection-radius":
      return {
        type: "capability",
        capabilityId: "geometry.set-radius",
        payload: { value: command.value },
        ...(nodeIds && nodeIds.length ? { nodeIds } : {}),
      };
    case "set-selection-opacity":
      return {
        type: "capability",
        capabilityId: "nodes.set-opacity",
        payload: { value: command.value },
        ...(nodeIds && nodeIds.length ? { nodeIds } : {}),
      };
    case "create-or-update-paint-style":
      return {
        type: "capability",
        capabilityId: "styles.upsert-paint-style",
        payload: {
          name: command.name,
          hex: command.hex,
          applyToSelection: command.applyToSelection,
        },
        ...(nodeIds && nodeIds.length ? { nodeIds } : {}),
      };
    case "create-or-update-color-variable":
      return {
        type: "capability",
        capabilityId: "variables.upsert-color-variable",
        payload: {
          collectionName: command.collectionName,
          variableName: command.variableName,
          hex: command.hex,
          bindToSelection: command.bindToSelection,
        },
        ...(nodeIds && nodeIds.length ? { nodeIds } : {}),
      };
    default:
      return command satisfies never;
  }
}

export function collectCapabilityIds(batch: FigmaPluginCommandBatch) {
  const ids = new Set<PluginCapabilityId>();

  for (const command of batch.commands) {
    ids.add(normalizeLegacyCommandForExternalDispatch(command).capabilityId);
  }

  return [...ids];
}

export function collectMutatingCapabilityIds(batch: FigmaPluginCommandBatch) {
  return collectCapabilityIds(batch).filter((capabilityId) =>
    requiresExplicitNodeIdsForExternalCapability(capabilityId),
  );
}

export function prepareBatchForExternalDispatch(
  batch: FigmaPluginCommandBatch,
  nodeIds?: string[],
): FigmaPluginCommandBatch {
  return {
    ...batch,
    source: "codex",
    commands: batch.commands.map((command) =>
      normalizeLegacyCommandForExternalDispatch(command, nodeIds),
    ),
  };
}
