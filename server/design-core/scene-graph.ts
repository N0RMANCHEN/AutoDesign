import type {
  DesignBounds,
  DesignElement,
  DesignElementRole,
  DesignScene,
  DesignTaskMode,
} from "../../shared/design-task.js";
import type {
  ReconstructionAnalysis,
  ReconstructionElement,
} from "../../shared/reconstruction.js";
import { collectReconstructionElements } from "./reconstruction-element-model.js";
import { buildDesignConstraintsFromReconstructionConstraints } from "./constraints.js";

export function designRoleForReconstructionElementKind(kind: string): DesignElementRole {
  if (kind === "surface") {
    return "surface";
  }
  if (kind === "text") {
    return "text";
  }
  if (kind === "icon") {
    return "icon";
  }
  if (kind === "primitive") {
    return "primitive";
  }
  return "group";
}

export function buildDesignRootBoundsFromAnalysis(analysis: ReconstructionAnalysis): DesignBounds {
  return {
    x: 0,
    y: 0,
    width: analysis.canonicalFrame?.width || analysis.width,
    height: analysis.canonicalFrame?.height || analysis.height,
  };
}

export function buildDesignElementFromReconstructionElement(
  element: ReconstructionElement,
): DesignElement {
  return {
    id: element.id,
    name: element.name,
    role: designRoleForReconstructionElementKind(element.kind),
    parentId: element.parentId,
    editable: element.editableKind !== "group" || element.kind === "surface",
    visible: true,
    inferred: element.inferred,
    content: element.content,
    bounds: element.targetBounds || element.referenceBounds,
    sourceRefId: element.analysisRefId,
    style: { ...element.style },
  };
}

export function buildDesignSceneFromReconstructionAnalysis(options: {
  jobId: string;
  mode: DesignTaskMode;
  analysis: ReconstructionAnalysis;
}): DesignScene {
  const { elements, constraints } = collectReconstructionElements(options.analysis);
  return {
    id: `scene/${options.jobId}`,
    mode: options.mode,
    rootBounds: buildDesignRootBoundsFromAnalysis(options.analysis),
    source: {
      kind: "reconstruction-job-compat",
      sourceId: options.jobId,
    },
    elements: elements.map(buildDesignElementFromReconstructionElement),
    constraints: buildDesignConstraintsFromReconstructionConstraints(constraints),
  };
}
