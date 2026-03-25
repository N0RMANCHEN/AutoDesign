import type {
  PluginBridgeSession,
  PluginNodeInspection,
  PluginNodeSummary,
  PluginNodeStyleBindings,
  PluginStyleDefinition,
  PluginVariableDefinition,
} from "./plugin-bridge.js";
import {
  resolveRuntimePluginTarget,
  type RuntimePluginTargetResolution,
} from "./runtime-plugin-target.js";

export type RuntimeNodeMetadataSnapshot = {
  targetSessionId: string;
  nodeId: string | null;
  available: boolean;
  source: "session-selection-summary" | "plugin-inspect-subtree" | null;
  note: string | null;
  node: PluginNodeInspection | null;
  subtree: PluginNodeInspection[];
  resolvedStyleBindings: RuntimeResolvedStyleBinding[];
  resolvedVariables: PluginVariableDefinition[];
  unresolvedVariableIds: string[];
  subtreeResolvedStyles: PluginStyleDefinition[];
  subtreeResolvedVariables: PluginVariableDefinition[];
  subtreeUnresolvedStyleIds: string[];
  subtreeUnresolvedVariableIds: string[];
};

export type RuntimeResolvedStyleBinding = {
  bindingKey: keyof PluginNodeStyleBindings;
  styleId: string;
  available: boolean;
  styleType: PluginStyleDefinition["styleType"] | null;
  name: string | null;
  description: string | null;
};

export type RuntimeNodeDependencyPack = {
  resolvedStyles: PluginStyleDefinition[];
  resolvedVariables: PluginVariableDefinition[];
  unresolvedStyleIds: string[];
  unresolvedVariableIds: string[];
};

function normalizeSummaryNode(node: PluginNodeSummary): PluginNodeInspection {
  const styleBindings = node.styleBindings ?? {
    fillStyleId: node.fillStyleId ?? null,
    strokeStyleId: null,
    textStyleId: null,
    effectStyleId: null,
    gridStyleId: null,
  };
  return {
    ...node,
    styleBindings,
    boundVariableIds: Array.isArray(node.boundVariableIds) ? node.boundVariableIds : [],
    variableBindings: node.variableBindings ?? {},
    depth: 0,
    childCount: 0,
    indexWithinParent: 0,
    analysisRefId: null,
    visible: null,
    locked: null,
    opacity: null,
    rotation: null,
    strokes: [],
    strokeStyleId: styleBindings.strokeStyleId,
    cornerRadius: null,
    clipsContent: null,
    isMask: null,
    maskType: null,
    constraintsHorizontal: null,
    constraintsVertical: null,
    layoutGrow: null,
    layoutAlign: null,
    layoutSizingHorizontal: null,
    layoutSizingVertical: null,
    primaryAxisSizingMode: null,
    counterAxisSizingMode: null,
    primaryAxisAlignItems: null,
    counterAxisAlignItems: null,
    itemSpacing: null,
    paddingLeft: null,
    paddingRight: null,
    paddingTop: null,
    paddingBottom: null,
    textContent: null,
    fontFamily: null,
    fontStyle: null,
    fontSize: null,
    fontWeight: null,
    lineHeight: null,
    letterSpacing: null,
    textAlignment: null,
    mainComponentId: null,
    mainComponentName: null,
    componentPropertyReferences: [],
    componentPropertyDefinitionKeys: [],
    variantProperties: undefined,
    generatedBy: null,
  };
}

const STYLE_BINDING_KEYS: Array<keyof PluginNodeStyleBindings> = [
  "fillStyleId",
  "strokeStyleId",
  "textStyleId",
  "effectStyleId",
  "gridStyleId",
];

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))].sort();
}

function normalizeStyleBindings(node: Pick<PluginNodeSummary, "styleBindings" | "fillStyleId">) {
  return node.styleBindings ?? {
    fillStyleId: node.fillStyleId ?? null,
    strokeStyleId: null,
    textStyleId: null,
    effectStyleId: null,
    gridStyleId: null,
  };
}

function getStylesById(
  pluginSession?: Pick<PluginBridgeSession, "hasStyleSnapshot" | "styles"> | null,
) {
  return new Map(
    Array.isArray(pluginSession?.styles)
      ? pluginSession.styles.map((style) => [style.id, style] as const)
      : [],
  );
}

function getVariablesById(
  pluginSession?: Pick<PluginBridgeSession, "hasVariableSnapshot" | "variables"> | null,
) {
  return new Map(
    Array.isArray(pluginSession?.variables)
      ? pluginSession.variables.map((variable) => [variable.id, variable] as const)
      : [],
  );
}

function collectStyleIds(
  node: Pick<PluginNodeSummary, "styleBindings" | "fillStyleId">,
) {
  const styleBindings = normalizeStyleBindings(node);
  return uniqueStrings(
    STYLE_BINDING_KEYS.map((bindingKey) => styleBindings[bindingKey]).filter(
      (styleId): styleId is string => Boolean(styleId),
    ),
  );
}

function collectVariableIds(
  node: Pick<PluginNodeSummary, "boundVariableIds" | "variableBindings">,
) {
  const variableBindingIds = Object.values(node.variableBindings ?? {}).flatMap((ids) =>
    Array.isArray(ids) ? ids : [],
  );
  return uniqueStrings([...(node.boundVariableIds ?? []), ...variableBindingIds]);
}

function buildResolvedStyleBindings(params: {
  node: Pick<PluginNodeSummary, "styleBindings" | "fillStyleId">;
  pluginSession?: Pick<PluginBridgeSession, "hasStyleSnapshot" | "styles"> | null;
}): RuntimeResolvedStyleBinding[] {
  const styleBindings = normalizeStyleBindings(params.node);
  const stylesById = getStylesById(params.pluginSession);

  return STYLE_BINDING_KEYS
    .map((bindingKey) => {
      const styleId = styleBindings[bindingKey];
      if (!styleId) {
        return null;
      }
      const style = stylesById.get(styleId) ?? null;
      return {
        bindingKey,
        styleId,
        available: Boolean(style),
        styleType: style?.styleType ?? null,
        name: style?.name ?? null,
        description: style?.description ?? null,
      } satisfies RuntimeResolvedStyleBinding;
    })
    .filter((item): item is RuntimeResolvedStyleBinding => Boolean(item));
}

function buildResolvedVariables(params: {
  node: Pick<PluginNodeSummary, "boundVariableIds" | "variableBindings">;
  pluginSession?: Pick<PluginBridgeSession, "hasVariableSnapshot" | "variables"> | null;
}) {
  const boundVariableIds = collectVariableIds(params.node);
  const variablesById = getVariablesById(params.pluginSession);
  const resolvedVariables: PluginVariableDefinition[] = [];
  const unresolvedVariableIds: string[] = [];

  for (const variableId of boundVariableIds) {
    const variable = variablesById.get(variableId) ?? null;
    if (variable) {
      resolvedVariables.push(variable);
    } else {
      unresolvedVariableIds.push(variableId);
    }
  }

  return {
    resolvedVariables,
    unresolvedVariableIds,
  };
}

export function buildRuntimeNodeDependencyPack(params: {
  subtree: Array<
    Pick<
      PluginNodeSummary,
      "styleBindings" | "fillStyleId" | "boundVariableIds" | "variableBindings"
    >
  >;
  pluginSession?: Pick<
    PluginBridgeSession,
    "hasStyleSnapshot" | "styles" | "hasVariableSnapshot" | "variables"
  > | null;
}) {
  const subtreeStyleIds = uniqueStrings(params.subtree.flatMap((node) => collectStyleIds(node)));
  const subtreeVariableIds = uniqueStrings(
    params.subtree.flatMap((node) => collectVariableIds(node)),
  );
  const stylesById = getStylesById(params.pluginSession);
  const variablesById = getVariablesById(params.pluginSession);
  const subtreeStyleIdSet = new Set(subtreeStyleIds);
  const subtreeVariableIdSet = new Set(subtreeVariableIds);

  return {
    resolvedStyles: Array.isArray(params.pluginSession?.styles)
      ? params.pluginSession.styles.filter((style) => subtreeStyleIdSet.has(style.id))
      : [],
    resolvedVariables: Array.isArray(params.pluginSession?.variables)
      ? params.pluginSession.variables.filter((variable) => subtreeVariableIdSet.has(variable.id))
      : [],
    unresolvedStyleIds: subtreeStyleIds.filter((styleId) => !stylesById.has(styleId)),
    unresolvedVariableIds: subtreeVariableIds.filter(
      (variableId) => !variablesById.has(variableId),
    ),
  };
}

export type RuntimeNodeMetadataResolution = RuntimePluginTargetResolution;

export function resolveRuntimeNodeMetadataTarget(params: {
  session: PluginBridgeSession;
  nodeId?: string | null;
}): RuntimeNodeMetadataResolution {
  return resolveRuntimePluginTarget(params);
}

export function buildRuntimeNodeMetadataFromSelectionSummary(params: {
  targetSessionId: string;
  node: PluginNodeSummary;
  pluginSession?: Pick<
    PluginBridgeSession,
    "hasStyleSnapshot" | "styles" | "hasVariableSnapshot" | "variables"
  > | null;
}): RuntimeNodeMetadataSnapshot {
  const normalized = normalizeSummaryNode(params.node);
  const resolvedStyleBindings = buildResolvedStyleBindings({
    node: normalized,
    pluginSession: params.pluginSession,
  });
  const { resolvedVariables, unresolvedVariableIds } = buildResolvedVariables({
    node: normalized,
    pluginSession: params.pluginSession,
  });
  const {
    resolvedStyles,
    resolvedVariables: subtreeResolvedVariables,
    unresolvedStyleIds,
    unresolvedVariableIds: subtreeUnresolvedVariableIds,
  } = buildRuntimeNodeDependencyPack({
    subtree: [normalized],
    pluginSession: params.pluginSession,
  });
  return {
    targetSessionId: params.targetSessionId,
    nodeId: params.node.id,
    available: true,
    source: "session-selection-summary",
    note: "using cached selection summary",
    node: normalized,
    subtree: [normalized],
    resolvedStyleBindings,
    resolvedVariables,
    unresolvedVariableIds,
    subtreeResolvedStyles: resolvedStyles,
    subtreeResolvedVariables,
    subtreeUnresolvedStyleIds: unresolvedStyleIds,
    subtreeUnresolvedVariableIds,
  };
}

export function buildRuntimeNodeMetadataFromInspection(params: {
  targetSessionId: string;
  nodeId: string;
  subtree: PluginNodeInspection[];
  pluginSession?: Pick<
    PluginBridgeSession,
    "hasStyleSnapshot" | "styles" | "hasVariableSnapshot" | "variables"
  > | null;
}): RuntimeNodeMetadataSnapshot {
  const primaryNode =
    params.subtree.find((item) => item.id === params.nodeId) ??
    params.subtree[0] ??
    null;
  const resolvedStyleBindings = primaryNode
    ? buildResolvedStyleBindings({
        node: primaryNode,
        pluginSession: params.pluginSession,
      })
    : [];
  const { resolvedVariables, unresolvedVariableIds } = primaryNode
    ? buildResolvedVariables({
        node: primaryNode,
        pluginSession: params.pluginSession,
      })
    : { resolvedVariables: [], unresolvedVariableIds: [] };
  const {
    resolvedStyles,
    resolvedVariables: subtreeResolvedVariables,
    unresolvedStyleIds,
    unresolvedVariableIds: subtreeUnresolvedVariableIds,
  } = buildRuntimeNodeDependencyPack({
    subtree: params.subtree,
    pluginSession: params.pluginSession,
  });
  return {
    targetSessionId: params.targetSessionId,
    nodeId: params.nodeId,
    available: Boolean(primaryNode),
    source: primaryNode ? "plugin-inspect-subtree" : null,
    note: primaryNode ? null : "inspect-subtree completed without returning the target node",
    node: primaryNode,
    subtree: params.subtree,
    resolvedStyleBindings,
    resolvedVariables,
    unresolvedVariableIds,
    subtreeResolvedStyles: resolvedStyles,
    subtreeResolvedVariables,
    subtreeUnresolvedStyleIds: unresolvedStyleIds,
    subtreeUnresolvedVariableIds,
  };
}

export function buildUnavailableRuntimeNodeMetadata(params: {
  targetSessionId: string;
  nodeId: string | null;
  note: string;
}): RuntimeNodeMetadataSnapshot {
  return {
    targetSessionId: params.targetSessionId,
    nodeId: params.nodeId,
    available: false,
    source: null,
    note: params.note,
    node: null,
    subtree: [],
    resolvedStyleBindings: [],
    resolvedVariables: [],
    unresolvedVariableIds: [],
    subtreeResolvedStyles: [],
    subtreeResolvedVariables: [],
    subtreeUnresolvedStyleIds: [],
    subtreeUnresolvedVariableIds: [],
  };
}
