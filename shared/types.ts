export type SyncStatus = "connected" | "draft" | "stale";
export type MappingStatus = "planned" | "prototype" | "verified";
export type ReviewStatus = "todo" | "doing" | "done";
export const mappingEvidenceKinds = ["story", "spec", "test", "screenshot"] as const;
export type MappingEvidenceKind = (typeof mappingEvidenceKinds)[number];
export const libraryAssetKinds = ["component", "icon", "illustration"] as const;
export type LibraryAssetKind = (typeof libraryAssetKinds)[number];
export type GraphKind = "codegraph" | "knowledge";
export type RuntimeAction =
  | "codegraph/summarize"
  | "codegraph/branch"
  | "codegraph/reorganize_to_frame"
  | "knowledge/summarize"
  | "knowledge/branch"
  | "knowledge/learning_path";

export type ProjectMeta = {
  id: string;
  name: string;
  description: string;
  updatedAt: string;
};

export type DesignSource = {
  id: string;
  name: string;
  figmaFileKey: string;
  branch: string;
  status: SyncStatus;
  lastSyncedAt: string;
  summary: string;
};

export type DesignScreen = {
  id: string;
  sourceId: string;
  name: string;
  purpose: string;
  stateNotes: string[];
  summary: string;
};

export type ComponentMapping = {
  id: string;
  designName: string;
  reactName: string;
  status: MappingStatus;
  props: string[];
  states: string[];
  notes: string;
  screenIds: string[];
  implementationTarget: {
    packageName: string | null;
    path: string;
    exportName: string;
  } | null;
  evidence: Array<{
    kind: MappingEvidenceKind;
    label: string;
    href: string;
  }>;
};

export type ReviewItem = {
  id: string;
  title: string;
  area: string;
  status: ReviewStatus;
  owner: string;
  detail: string;
  relatedIds: string[];
};

export type LibraryAsset = {
  id: string;
  sourceId: string;
  name: string;
  kind: LibraryAssetKind;
  summary: string;
  keywords: string[];
  screenIds: string[];
  mappingIds: string[];
};

export type RuntimeSession = {
  id: string;
  graphKind: GraphKind;
  action: RuntimeAction;
  selectionIds: string[];
  updatedAt: string;
  lastResultSummary: string;
};

export type ProjectData = {
  meta: ProjectMeta;
  designSources: DesignSource[];
  designScreens: DesignScreen[];
  componentMappings: ComponentMapping[];
  reviewItems: ReviewItem[];
  libraryAssets: LibraryAsset[];
  runtimeSessions: RuntimeSession[];
};

export type ContextPackNode = {
  id: string;
  kind: "designSource" | "screen" | "component" | "review";
  title: string;
  summary: string;
  position: {
    x: number;
    y: number;
  };
};

export type ContextPack = {
  graphKind: GraphKind;
  action: RuntimeAction;
  primaryId: string | null;
  selectionIds: string[];
  nodes: ContextPackNode[];
  constraints: {
    maxNewNodes: number;
    allowDelete: boolean;
    allowEdges: boolean;
  };
};

export type RuntimeEnvelope = {
  explanation: string;
  patch: {
    ops: Array<Record<string, unknown>>;
  };
  risks: string[];
  questions: string[];
};

export type FigmaSyncPayload = {
  source: {
    name: string;
    figmaFileKey: string;
    branch: string;
    summary: string;
  };
  screens: Array<{
    name: string;
    purpose: string;
    stateNotes: string[];
    summary: string;
  }>;
  components: Array<{
    designName: string;
    reactName: string;
    props: string[];
    states: string[];
    notes: string;
  }>;
  assets?: Array<{
    name: string;
    kind: LibraryAssetKind;
    summary: string;
    keywords: string[];
    screenNames: string[];
    mappingDesignNames: string[];
  }>;
};
