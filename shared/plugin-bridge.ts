import type { PluginCapabilityDescriptor, PluginCapabilityId } from "./plugin-capabilities.js";
import type { FigmaPluginCommandBatch } from "./plugin-contract.js";

export type PluginNodeSummary = {
  id: string;
  name: string;
  type: string;
  fillable: boolean;
  fills: string[];
  fillStyleId: string | null;
  styleBindings?: PluginNodeStyleBindings;
  boundVariableIds?: string[];
  variableBindings?: PluginNodeVariableBindings;
  x?: number | null;
  y?: number | null;
  absoluteX?: number | null;
  absoluteY?: number | null;
  width?: number | null;
  height?: number | null;
  parentNodeId?: string | null;
  parentNodeType?: string | null;
  parentLayoutMode?: string | null;
  layoutMode?: string | null;
  layoutPositioning?: string | null;
  previewDataUrl?: string | null;
  hasImageFill?: boolean;
};

export type PluginNodeStyleBindings = {
  fillStyleId: string | null;
  strokeStyleId: string | null;
  textStyleId: string | null;
  effectStyleId: string | null;
  gridStyleId: string | null;
};

export type PluginNodeVariableBindings = Record<string, string[]>;

export type PluginNodeInspection = PluginNodeSummary & {
  depth: number;
  childCount: number;
  indexWithinParent: number;
  analysisRefId?: string | null;
  visible?: boolean | null;
  locked?: boolean | null;
  opacity?: number | null;
  rotation?: number | null;
  strokes?: string[];
  strokeStyleId?: string | null;
  cornerRadius?: number | null;
  clipsContent?: boolean | null;
  isMask?: boolean | null;
  maskType?: string | null;
  constraintsHorizontal?: string | null;
  constraintsVertical?: string | null;
  layoutGrow?: number | null;
  layoutAlign?: string | null;
  layoutSizingHorizontal?: string | null;
  layoutSizingVertical?: string | null;
  primaryAxisSizingMode?: string | null;
  counterAxisSizingMode?: string | null;
  primaryAxisAlignItems?: string | null;
  counterAxisAlignItems?: string | null;
  itemSpacing?: number | null;
  paddingLeft?: number | null;
  paddingRight?: number | null;
  paddingTop?: number | null;
  paddingBottom?: number | null;
  textContent?: string | null;
  fontFamily?: string | null;
  fontStyle?: string | null;
  fontSize?: number | null;
  fontWeight?: number | string | null;
  lineHeight?: number | null;
  letterSpacing?: number | null;
  textAlignment?: string | null;
  mainComponentId?: string | null;
  mainComponentName?: string | null;
  componentPropertyReferences?: string[];
  componentPropertyDefinitionKeys?: string[];
  variantProperties?: Record<string, string>;
  generatedBy?: "reconstruction" | null;
};

export type PluginImageArtifact = {
  kind: "node-image";
  nodeId: string;
  mimeType: string;
  width: number;
  height: number;
  dataUrl: string;
  source: "image-fill-original" | "node-export";
};

export type PluginVariableCollectionMode = {
  modeId: string;
  name: string;
};

export type PluginVariableCollectionSummary = {
  id: string;
  name: string;
  defaultModeId: string;
  hiddenFromPublishing: boolean;
  modes: PluginVariableCollectionMode[];
};

export type PluginVariableValueKind =
  | "color"
  | "number"
  | "string"
  | "boolean"
  | "alias"
  | "unknown";

export type PluginVariableModeValue = {
  modeId: string;
  modeName: string | null;
  kind: PluginVariableValueKind;
  value: string | number | boolean | null;
};

export type PluginVariableDefinition = {
  id: string;
  name: string;
  collectionId: string;
  collectionName: string;
  resolvedType: "COLOR" | "FLOAT" | "STRING" | "BOOLEAN";
  hiddenFromPublishing: boolean;
  scopes: string[];
  valuesByMode: PluginVariableModeValue[];
};

export type PluginStyleDefinition = {
  id: string;
  styleType: "paint" | "text" | "effect" | "grid";
  name: string;
  description: string | null;
};

export type PluginRuntimeFeatures = {
  supportsExplicitNodeTargeting: boolean;
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
  runtimeFeatures: PluginRuntimeFeatures;
  capabilities: PluginCapabilityDescriptor[];
  selection: PluginNodeSummary[];
  hasStyleSnapshot?: boolean;
  styles?: PluginStyleDefinition[];
  hasVariableSnapshot?: boolean;
  variableCollections?: PluginVariableCollectionSummary[];
  variables?: PluginVariableDefinition[];
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
  runtimeFeatures: PluginRuntimeFeatures;
  capabilities: PluginCapabilityDescriptor[];
  selection: PluginNodeSummary[];
  hasStyleSnapshot?: boolean;
  styles?: PluginStyleDefinition[];
  hasVariableSnapshot?: boolean;
  variableCollections?: PluginVariableCollectionSummary[];
  variables?: PluginVariableDefinition[];
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
  exportedImages: PluginImageArtifact[];
  inspectedNodes: PluginNodeInspection[];
  warnings: string[];
  errorCode: string | null;
  message: string;
};

export type PluginCommandResultPayload = {
  resultMessage: string;
  ok: boolean;
  results?: PluginCommandExecutionResult[];
};

export type InspectFrameRequestPayload = {
  targetSessionId: string;
  frameNodeId: string;
  maxDepth?: number;
  includePreview?: boolean;
};

export type InspectFrameResponsePayload = {
  sessionId: string;
  frameNodeId: string;
  nodes: PluginNodeInspection[];
  preview: PluginImageArtifact | null;
};
