import { buildContextPack } from "./context-pack.js";
import type { PluginBridgeSession, PluginNodeSummary } from "./plugin-bridge.js";
import {
  buildRuntimeNodeDependencyPack,
  type RuntimeNodeDependencyPack,
} from "./runtime-node-metadata.js";
import { buildRuntimeVariableDefsSnapshot } from "./runtime-variable-defs.js";
import type { RuntimeVariableDefsSnapshot } from "./runtime-variable-defs.js";
export type { RuntimeVariableDefsSnapshot } from "./runtime-variable-defs.js";
import type {
  ComponentMapping,
  ContextPack,
  DesignScreen,
  DesignSource,
  GraphKind,
  ProjectData,
  ReviewItem,
  RuntimeAction,
} from "./types.js";

export type RuntimeDesignContextMetadataItem = {
  id: string;
  kind: "designSource" | "screen" | "component" | "review";
  title: string;
  summary: string;
  relatedIds: string[];
};

export type RuntimeMetadataSnapshot = {
  selectionIds: string[];
  primarySelectionId: string | null;
  metadata: RuntimeDesignContextMetadataItem[];
};

export type RuntimeVariableDefsContext = {
  selectionIds: string[];
  primarySelectionId: string | null;
  variableDefs: RuntimeVariableDefsSnapshot;
};

export type RuntimePluginSelectionSnapshot = {
  targetSessionId: string | null;
  primarySelectionNodeId: string | null;
  available: boolean;
  source: "plugin-selection-summary" | null;
  note: string | null;
  selectionNodeIds: string[];
  selection: PluginNodeSummary[];
  dependencies: RuntimeNodeDependencyPack;
};

export type RuntimeDesignContext = {
  selectionIds: string[];
  primarySelectionId: string | null;
  metadata: RuntimeDesignContextMetadataItem[];
  contextPack: ContextPack;
  designContext: {
    sources: DesignSource[];
    screens: DesignScreen[];
    componentMappings: ComponentMapping[];
    reviewItems: ReviewItem[];
  };
  variableDefs: RuntimeVariableDefsSnapshot;
  pluginSelection: RuntimePluginSelectionSnapshot;
};

type RuntimeVariableDefsPluginSession = Pick<
  PluginBridgeSession,
  | "hasVariableSnapshot"
  | "variableCollections"
  | "variables"
>;

type RuntimePluginSelectionSession = Pick<
  PluginBridgeSession,
  | "id"
  | "selection"
  | "hasStyleSnapshot"
  | "styles"
  | "hasVariableSnapshot"
  | "variableCollections"
  | "variables"
>;

type RuntimeDesignContextPluginSession =
  RuntimeVariableDefsPluginSession & RuntimePluginSelectionSession;

function emptyRuntimeNodeDependencyPack(): RuntimeNodeDependencyPack {
  return {
    resolvedStyles: [],
    resolvedVariables: [],
    unresolvedStyleIds: [],
    unresolvedVariableIds: [],
  };
}

function uniqueById<T extends { id: string }>(items: T[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) {
      return false;
    }
    seen.add(item.id);
    return true;
  });
}

function includesAny(values: string[], expected: string[]) {
  return expected.some((value) => values.includes(value));
}

function toSourceMetadata(source: DesignSource): RuntimeDesignContextMetadataItem {
  return {
    id: source.id,
    kind: "designSource",
    title: source.name,
    summary: `${source.summary} | branch=${source.branch} | status=${source.status}`,
    relatedIds: [],
  };
}

function toScreenMetadata(screen: DesignScreen): RuntimeDesignContextMetadataItem {
  return {
    id: screen.id,
    kind: "screen",
    title: screen.name,
    summary: `${screen.summary} | purpose=${screen.purpose}`,
    relatedIds: [screen.sourceId],
  };
}

function toMappingMetadata(mapping: ComponentMapping): RuntimeDesignContextMetadataItem {
  const target = mapping.implementationTarget
    ? `${mapping.implementationTarget.path}#${mapping.implementationTarget.exportName}`
    : "unlinked";
  return {
    id: mapping.id,
    kind: "component",
    title: `${mapping.designName} -> ${mapping.reactName}`,
    summary: `${mapping.notes} | status=${mapping.status} | target=${target} | evidence=${mapping.evidence.length}`,
    relatedIds: mapping.screenIds,
  };
}

function toReviewMetadata(review: ReviewItem): RuntimeDesignContextMetadataItem {
  return {
    id: review.id,
    kind: "review",
    title: review.title,
    summary: `${review.detail} | owner=${review.owner} | status=${review.status}`,
    relatedIds: review.relatedIds,
  };
}

function getPrimarySelectionId(selectionIds: string[]) {
  return selectionIds[0] ?? null;
}

function resolveRuntimeDesignRelations(params: {
  project: ProjectData;
  selectionIds: string[];
}) {
  const { project, selectionIds } = params;

  const directSources = project.designSources.filter((item) => selectionIds.includes(item.id));
  const directScreens = project.designScreens.filter((item) => selectionIds.includes(item.id));
  const directMappings = project.componentMappings.filter((item) => selectionIds.includes(item.id));
  const directReviews = project.reviewItems.filter((item) => selectionIds.includes(item.id));

  const relatedScreenIds = uniqueById([
    ...directScreens,
    ...project.designScreens.filter((item) => directMappings.some((mapping) => mapping.screenIds.includes(item.id))),
    ...project.designScreens.filter((item) => includesAny(directReviews.flatMap((review) => review.relatedIds), [item.id])),
  ]).map((item) => item.id);

  const screens = uniqueById([
    ...directScreens,
    ...project.designScreens.filter((item) => relatedScreenIds.includes(item.id)),
  ]);

  const sourceIds = uniqueById([
    ...directSources,
    ...project.designSources.filter((item) => screens.some((screen) => screen.sourceId === item.id)),
    ...project.designSources.filter((item) => directReviews.some((review) => review.relatedIds.includes(item.id))),
  ]).map((item) => item.id);

  const sources = uniqueById(project.designSources.filter((item) => sourceIds.includes(item.id)));

  const screenIds = screens.map((item) => item.id);
  const mappingIds = uniqueById([
    ...directMappings,
    ...project.componentMappings.filter((item) => includesAny(item.screenIds, screenIds)),
    ...project.componentMappings.filter((item) => directReviews.some((review) => review.relatedIds.includes(item.id))),
  ]).map((item) => item.id);

  const componentMappings = uniqueById(project.componentMappings.filter((item) => mappingIds.includes(item.id)));

  const relatedIds = uniqueById([
    ...sources,
    ...screens,
    ...componentMappings,
    ...directReviews,
  ]).map((item) => item.id);

  const reviewItems = uniqueById([
    ...directReviews,
    ...project.reviewItems.filter((item) => includesAny(item.relatedIds, relatedIds)),
  ]);

  return {
    sources,
    screens,
    componentMappings,
    reviewItems,
  };
}

function buildRuntimeMetadataItems(params: {
  project: ProjectData;
  selectionIds: string[];
}) {
  const { componentMappings, reviewItems, screens, sources } = resolveRuntimeDesignRelations(params);
  return [
    ...sources.map(toSourceMetadata),
    ...screens.map(toScreenMetadata),
    ...componentMappings.map(toMappingMetadata),
    ...reviewItems.map(toReviewMetadata),
  ];
}

export function buildRuntimeMetadataSnapshot(params: {
  project: ProjectData;
  selectionIds: string[];
}): RuntimeMetadataSnapshot {
  const { selectionIds } = params;
  return {
    selectionIds,
    primarySelectionId: getPrimarySelectionId(selectionIds),
    metadata: buildRuntimeMetadataItems(params),
  };
}

export function buildRuntimeVariableDefsContext(params: {
  project: ProjectData;
  selectionIds: string[];
  pluginSession?: RuntimeVariableDefsPluginSession | null;
}): RuntimeVariableDefsContext {
  const { pluginSession, selectionIds } = params;
  void params.project;
  return {
    selectionIds,
    primarySelectionId: getPrimarySelectionId(selectionIds),
    variableDefs: buildRuntimeVariableDefsSnapshot({ pluginSession }),
  };
}

export function buildRuntimePluginSelectionSnapshot(params: {
  pluginSession?: RuntimePluginSelectionSession | null;
}): RuntimePluginSelectionSnapshot {
  const pluginSession = params.pluginSession;
  if (!pluginSession) {
    return {
      targetSessionId: null,
      primarySelectionNodeId: null,
      available: false,
      source: null,
      note: "当前 design-context 没有绑定 plugin session；如需 selection dependency truth，请传 targetSessionId。",
      selectionNodeIds: [],
      selection: [],
      dependencies: emptyRuntimeNodeDependencyPack(),
    };
  }

  const selection = Array.isArray(pluginSession.selection) ? pluginSession.selection : [];
  if (selection.length === 0) {
    return {
      targetSessionId: pluginSession.id,
      primarySelectionNodeId: null,
      available: false,
      source: null,
      note: "plugin live session 当前没有 selection cached summary。",
      selectionNodeIds: [],
      selection: [],
      dependencies: emptyRuntimeNodeDependencyPack(),
    };
  }

  return {
    targetSessionId: pluginSession.id,
    primarySelectionNodeId: selection[0]?.id ?? null,
    available: true,
    source: "plugin-selection-summary",
    note: "using cached plugin selection summary",
    selectionNodeIds: selection.map((node) => node.id),
    selection,
    dependencies: buildRuntimeNodeDependencyPack({
      subtree: selection,
      pluginSession,
    }),
  };
}

export function buildRuntimeDesignContext(params: {
  project: ProjectData;
  selectionIds: string[];
  graphKind: GraphKind;
  action: RuntimeAction;
  pluginSession?: RuntimeDesignContextPluginSession | null;
}): RuntimeDesignContext {
  const { action, graphKind, pluginSession, project, selectionIds } = params;
  const designContext = resolveRuntimeDesignRelations({ project, selectionIds });
  const metadataSnapshot = buildRuntimeMetadataSnapshot({ project, selectionIds });
  const variableDefsContext = buildRuntimeVariableDefsContext({
    project,
    selectionIds,
    pluginSession,
  });
  const pluginSelection = buildRuntimePluginSelectionSnapshot({
    pluginSession,
  });

  return {
    selectionIds,
    primarySelectionId: metadataSnapshot.primarySelectionId,
    metadata: metadataSnapshot.metadata,
    contextPack: buildContextPack({
      project,
      selectionIds,
      graphKind,
      action,
    }),
    designContext,
    variableDefs: variableDefsContext.variableDefs,
    pluginSelection,
  };
}
