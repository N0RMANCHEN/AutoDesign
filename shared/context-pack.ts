import type {
  ComponentMapping,
  ContextPack,
  ContextPackNode,
  DesignScreen,
  DesignSource,
  GraphKind,
  ProjectData,
  ReviewItem,
  RuntimeAction,
} from "./types.js";

function fromSource(source: DesignSource, index: number): ContextPackNode {
  return {
    id: source.id,
    kind: "designSource",
    title: source.name,
    summary: `${source.summary} | branch=${source.branch} | status=${source.status}`,
    position: { x: 120, y: 120 + index * 160 },
  };
}

function fromScreen(screen: DesignScreen, index: number): ContextPackNode {
  return {
    id: screen.id,
    kind: "screen",
    title: screen.name,
    summary: `${screen.summary} | purpose=${screen.purpose} | states=${screen.stateNotes.join(", ")}`,
    position: { x: 420, y: 120 + index * 160 },
  };
}

function fromMapping(mapping: ComponentMapping, index: number): ContextPackNode {
  return {
    id: mapping.id,
    kind: "component",
    title: `${mapping.designName} -> ${mapping.reactName}`,
    summary: `${mapping.notes} | props=${mapping.props.join(", ")} | states=${mapping.states.join(", ")}`,
    position: { x: 740, y: 120 + index * 160 },
  };
}

function fromReview(review: ReviewItem, index: number): ContextPackNode {
  return {
    id: review.id,
    kind: "review",
    title: review.title,
    summary: `${review.detail} | owner=${review.owner} | status=${review.status}`,
    position: { x: 1060, y: 120 + index * 160 },
  };
}

export function buildContextPack(params: {
  project: ProjectData;
  selectionIds: string[];
  graphKind: GraphKind;
  action: RuntimeAction;
}): ContextPack {
  const { action, graphKind, project, selectionIds } = params;
  const nodes: ContextPackNode[] = [];

  for (const source of project.designSources) {
    if (selectionIds.includes(source.id)) {
      nodes.push(fromSource(source, nodes.length));
    }
  }

  for (const screen of project.designScreens) {
    if (selectionIds.includes(screen.id)) {
      nodes.push(fromScreen(screen, nodes.length));
    }
  }

  for (const mapping of project.componentMappings) {
    if (selectionIds.includes(mapping.id)) {
      nodes.push(fromMapping(mapping, nodes.length));
    }
  }

  for (const review of project.reviewItems) {
    if (selectionIds.includes(review.id)) {
      nodes.push(fromReview(review, nodes.length));
    }
  }

  return {
    graphKind,
    action,
    primaryId: nodes[0]?.id ?? null,
    selectionIds,
    nodes,
    constraints: {
      maxNewNodes: graphKind === "knowledge" ? 6 : 4,
      allowDelete: false,
      allowEdges: true,
    },
  };
}
