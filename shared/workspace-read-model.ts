import type {
  MappingStatus,
  ProjectData,
  ReviewStatus,
  SyncStatus,
} from "./types.js";

export type WorkspaceSelectionOptionKind =
  | "designSource"
  | "screen"
  | "component"
  | "review";

export type WorkspaceSelectionOption = {
  id: string;
  label: string;
  kind: WorkspaceSelectionOptionKind;
  kindLabel: string;
};

export type WorkspaceDesignSourceCard = {
  id: string;
  name: string;
  status: SyncStatus;
  summary: string;
  figmaFileKey: string;
  branch: string;
  lastSyncedAt: string;
  screenCount: number;
  mappingCount: number;
};

export type WorkspaceMappingCard = {
  id: string;
  designName: string;
  reactName: string;
  status: MappingStatus;
  notes: string;
  props: string[];
  states: string[];
  screenNames: string[];
};

export type WorkspaceReviewQueueCard = {
  id: string;
  title: string;
  area: string;
  status: ReviewStatus;
  owner: string;
  detail: string;
  relatedLabels: string[];
};

export type WorkspaceReadModel = {
  workspace: {
    id: string;
    name: string;
    description: string;
    updatedAt: string;
  };
  selection: {
    defaultIds: string[];
    options: WorkspaceSelectionOption[];
  };
  designSources: WorkspaceDesignSourceCard[];
  mappings: WorkspaceMappingCard[];
  reviewQueue: WorkspaceReviewQueueCard[];
};

export type WorkspaceMappingStatusReceipt = {
  mapping: WorkspaceMappingCard;
  workspaceUpdatedAt: string;
};

export type WorkspaceReviewQueueUpdateReceipt = {
  review: WorkspaceReviewQueueCard;
  workspaceUpdatedAt: string;
};

function kindLabel(kind: WorkspaceSelectionOptionKind) {
  switch (kind) {
    case "designSource":
      return "Design Source";
    case "screen":
      return "Screen";
    case "component":
      return "Component";
    case "review":
      return "Review";
  }
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function buildWorkspaceMappingCard(params: {
  project: ProjectData;
  mapping: ProjectData["componentMappings"][number];
}): WorkspaceMappingCard {
  const { mapping, project } = params;
  const screenLookup = new Map(project.designScreens.map((screen) => [screen.id, screen.name]));
  return {
    id: mapping.id,
    designName: mapping.designName,
    reactName: mapping.reactName,
    status: mapping.status,
    notes: mapping.notes,
    props: mapping.props,
    states: mapping.states,
    screenNames: uniqueStrings(mapping.screenIds.map((screenId) => screenLookup.get(screenId) ?? screenId)),
  };
}

function buildWorkspaceReviewQueueCard(params: {
  project: ProjectData;
  review: ProjectData["reviewItems"][number];
}): WorkspaceReviewQueueCard {
  const { project, review } = params;
  const relatedLookup = new Map<string, string>();

  project.designSources.forEach((item) => relatedLookup.set(item.id, item.name));
  project.designScreens.forEach((item) => relatedLookup.set(item.id, item.name));
  project.componentMappings.forEach((item) => relatedLookup.set(item.id, item.designName));
  project.reviewItems.forEach((item) => relatedLookup.set(item.id, item.title));

  return {
    id: review.id,
    title: review.title,
    area: review.area,
    status: review.status,
    owner: review.owner,
    detail: review.detail,
    relatedLabels: uniqueStrings(
      review.relatedIds.map((relatedId) => relatedLookup.get(relatedId) ?? relatedId),
    ),
  };
}

export function buildWorkspaceReadModel(project: ProjectData): WorkspaceReadModel {
  const sourceScreenCounts = new Map<string, number>();
  const sourceMappingCounts = new Map<string, number>();

  project.designSources.forEach((source) => {
    const screenIds = project.designScreens
      .filter((screen) => screen.sourceId === source.id)
      .map((screen) => screen.id);
    sourceScreenCounts.set(source.id, screenIds.length);
    sourceMappingCounts.set(
      source.id,
      project.componentMappings.filter((mapping) =>
        mapping.screenIds.some((screenId) => screenIds.includes(screenId)),
      ).length,
    );
  });

  return {
    workspace: {
      id: project.meta.id,
      name: project.meta.name,
      description: project.meta.description,
      updatedAt: project.meta.updatedAt,
    },
    selection: {
      defaultIds: project.runtimeSessions[0]?.selectionIds ?? [],
      options: [
        ...project.designSources.map((item) => ({
          id: item.id,
          label: item.name,
          kind: "designSource" as const,
          kindLabel: kindLabel("designSource"),
        })),
        ...project.designScreens.map((item) => ({
          id: item.id,
          label: item.name,
          kind: "screen" as const,
          kindLabel: kindLabel("screen"),
        })),
        ...project.componentMappings.map((item) => ({
          id: item.id,
          label: item.designName,
          kind: "component" as const,
          kindLabel: kindLabel("component"),
        })),
        ...project.reviewItems.map((item) => ({
          id: item.id,
          label: item.title,
          kind: "review" as const,
          kindLabel: kindLabel("review"),
        })),
      ],
    },
    designSources: project.designSources.map((source) => ({
      id: source.id,
      name: source.name,
      status: source.status,
      summary: source.summary,
      figmaFileKey: source.figmaFileKey,
      branch: source.branch,
      lastSyncedAt: source.lastSyncedAt,
      screenCount: sourceScreenCounts.get(source.id) ?? 0,
      mappingCount: sourceMappingCounts.get(source.id) ?? 0,
    })),
    mappings: project.componentMappings.map((mapping) =>
      buildWorkspaceMappingCard({ project, mapping }),
    ),
    reviewQueue: project.reviewItems.map((review) =>
      buildWorkspaceReviewQueueCard({ project, review }),
    ),
  };
}

export function buildWorkspaceMappingStatusReceipt(params: {
  project: ProjectData;
  mapping: ProjectData["componentMappings"][number];
}): WorkspaceMappingStatusReceipt {
  const { mapping, project } = params;
  return {
    mapping: buildWorkspaceMappingCard({ project, mapping }),
    workspaceUpdatedAt: project.meta.updatedAt,
  };
}

export function buildWorkspaceReviewQueueUpdateReceipt(params: {
  project: ProjectData;
  review: ProjectData["reviewItems"][number];
}): WorkspaceReviewQueueUpdateReceipt {
  const { project, review } = params;
  return {
    review: buildWorkspaceReviewQueueCard({ project, review }),
    workspaceUpdatedAt: project.meta.updatedAt,
  };
}
