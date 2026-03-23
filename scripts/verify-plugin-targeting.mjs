import {
  collectMutatingCapabilityIds,
  prepareBatchForExternalDispatch,
} from "../shared/plugin-targeting.ts";

function ensure(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const mutatingPromptBatch = {
  source: "user",
  commands: [
    {
      type: "capability",
      capabilityId: "fills.set-fill",
      payload: { hex: "#111111" },
    },
  ],
};

const readOnlyPromptBatch = {
  source: "user",
  commands: [
    {
      type: "capability",
      capabilityId: "selection.refresh",
      payload: {},
    },
  ],
};

const externalMutatingBatch = prepareBatchForExternalDispatch(mutatingPromptBatch, ["1:2"]);
ensure(externalMutatingBatch.source === "codex", "External batch source must be codex.");
ensure(
  externalMutatingBatch.commands[0].type === "capability" &&
    Array.isArray(externalMutatingBatch.commands[0].nodeIds) &&
    externalMutatingBatch.commands[0].nodeIds.length === 1 &&
    externalMutatingBatch.commands[0].nodeIds[0] === "1:2",
  "Mutating external commands must carry nodeIds.",
);

const readOnlyExternalBatch = prepareBatchForExternalDispatch(readOnlyPromptBatch);
ensure(readOnlyExternalBatch.source === "codex", "Read-only external batch source must be codex.");
ensure(
  readOnlyExternalBatch.commands[0].type === "capability" &&
    !("nodeIds" in readOnlyExternalBatch.commands[0]),
  "Read-only external commands should not require nodeIds by default.",
);

const legacyMutatingBatch = prepareBatchForExternalDispatch(
  {
    source: "user",
    commands: [
      {
        type: "set-selection-fill",
        hex: "#222222",
      },
    ],
  },
  ["1:2"],
);
ensure(
  legacyMutatingBatch.commands[0].type === "capability" &&
    legacyMutatingBatch.commands[0].capabilityId === "fills.set-fill",
  "Legacy mutating commands must be normalized to capability commands for external dispatch.",
);
ensure(
  collectMutatingCapabilityIds(mutatingPromptBatch).includes("fills.set-fill"),
  "Mutating capability detection must include fills.set-fill.",
);
ensure(
  collectMutatingCapabilityIds(readOnlyPromptBatch).length === 0,
  "selection.refresh must stay outside the mutating capability set.",
);

const externalCreateRectangleBatch = prepareBatchForExternalDispatch(
  {
    source: "user",
    commands: [
      {
        type: "capability",
        capabilityId: "nodes.create-rectangle",
        payload: {
          width: 80,
          height: 80,
          placement: "below",
          gap: 16,
        },
      },
    ],
  },
  ["1:3"],
);
ensure(
  externalCreateRectangleBatch.commands[0].type === "capability" &&
    externalCreateRectangleBatch.commands[0].nodeIds?.[0] === "1:3",
  "Relative rectangle creation must carry the anchor nodeId for external dispatch.",
);

const externalBatchWithPerCommandTargets = prepareBatchForExternalDispatch(
  {
    source: "user",
    commands: [
      {
        type: "capability",
        capabilityId: "fills.set-fill",
        payload: { hex: "#333333" },
        nodeIds: ["9:9"],
      },
    ],
  },
  ["1:2"],
);
ensure(
  externalBatchWithPerCommandTargets.commands[0].type === "capability" &&
    externalBatchWithPerCommandTargets.commands[0].nodeIds?.[0] === "9:9",
  "Per-command nodeIds must be preserved during external dispatch preparation.",
);

console.log("plugin targeting verified");
