import type { PluginCapabilityDescriptor, PluginCapabilityId } from "./plugin-capabilities.js";
import type { FigmaPluginCommandBatch } from "./plugin-contract.js";

export type PluginNodeSummary = {
  id: string;
  name: string;
  type: string;
  fillable: boolean;
  fills: string[];
  fillStyleId: string | null;
  previewDataUrl?: string | null;
};

export type PluginBridgeSession = {
  id: string;
  label: string;
  pluginVersion: string;
  editorType: "figma" | "figjam" | "dev" | "slides" | "buzz";
  fileName: string;
  pageName: string;
  status: "online" | "stale";
  lastSeenAt: string;
  lastHandshakeAt: string;
  capabilities: PluginCapabilityDescriptor[];
  selection: PluginNodeSummary[];
};

export type PluginBridgeCommandStatus =
  | "queued"
  | "claimed"
  | "succeeded"
  | "failed";

export type PluginBridgeCommandRecord = {
  id: string;
  targetSessionId: string;
  source: "workspace" | "codex";
  payload: FigmaPluginCommandBatch;
  status: PluginBridgeCommandStatus;
  createdAt: string;
  claimedAt: string | null;
  completedAt: string | null;
  resultMessage: string;
  results: PluginCommandExecutionResult[];
};

export type PluginBridgeSnapshot = {
  sessions: PluginBridgeSession[];
  commands: PluginBridgeCommandRecord[];
};

export type PluginSessionRegistrationPayload = {
  sessionId?: string;
  label: string;
  pluginVersion: string;
  editorType: "figma" | "figjam" | "dev" | "slides" | "buzz";
  fileName: string;
  pageName: string;
  capabilities: PluginCapabilityDescriptor[];
  selection: PluginNodeSummary[];
};

export type QueuePluginCommandPayload = {
  targetSessionId: string;
  source: "workspace" | "codex";
  payload: FigmaPluginCommandBatch;
};

export type PluginCommandExecutionResult = {
  capabilityId: PluginCapabilityId;
  ok: boolean;
  changedNodeIds: string[];
  createdStyleIds: string[];
  createdVariableIds: string[];
  warnings: string[];
  errorCode: string | null;
  message: string;
};

export type PluginCommandResultPayload = {
  resultMessage: string;
  ok: boolean;
  results?: PluginCommandExecutionResult[];
};
