export type DesignTaskMode = "restoration" | "completion" | "generation";
export type DesignOutputTarget = "figma-native";
export type DesignQualityPriority = "pixel-fidelity" | "style-consistency" | "design-quality";
export type DesignAutomationMode = "automatic-iterative";
export type DesignHumanLoopMode = "auto";
export type DesignReferencePolicy = "required" | "preferred" | "optional" | "none";
export type DesignIterationOutcome = "accepted" | "rejected";
export type DesignElementRole =
  | "frame"
  | "surface"
  | "group"
  | "text"
  | "icon"
  | "primitive"
  | "region";
export type DesignConstraintKind =
  | "align-top"
  | "align-bottom"
  | "align-left"
  | "align-right"
  | "share-baseline"
  | "share-typography"
  | "same-parent"
  | "padding-lock";
export type DesignScoreGrade = "A" | "B" | "C" | "D" | "F";
export type DesignIterationStopReason =
  | "target_reached"
  | "max_iterations"
  | "stalled"
  | "no_actionable_suggestions"
  | "mode_drift"
  | "editability_failed"
  | "no_improvement"
  | "error";

export type DesignBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DesignIntent = {
  mode: DesignTaskMode;
  outputTarget: DesignOutputTarget;
  qualityPriority: DesignQualityPriority;
  automationMode: DesignAutomationMode;
  humanLoopMode: DesignHumanLoopMode;
  referencePolicy: DesignReferencePolicy;
  editabilityRequired: boolean;
  notes: string[];
};

export type DesignModePolicy = {
  mode: DesignTaskMode;
  outputTarget: DesignOutputTarget;
  qualityPriority: DesignQualityPriority;
  automationMode: DesignAutomationMode;
  humanLoopMode: DesignHumanLoopMode;
  referencePolicy: DesignReferencePolicy;
  editabilityRequired: boolean;
};

export type DesignElement = {
  id: string;
  name: string;
  role: DesignElementRole;
  parentId: string | null;
  editable: boolean;
  visible: boolean;
  inferred: boolean;
  content: string | null;
  bounds: DesignBounds;
  sourceRefId: string | null;
  style: {
    fillHex: string | null;
    strokeHex: string | null;
    strokeWeight: number | null;
    opacity: number | null;
    cornerRadius: number | null;
    fontFamily: string | null;
    fontStyle: string | null;
    fontWeight: number | null;
    fontSize: number | null;
    lineHeight: number | null;
    letterSpacing: number | null;
    alignment: "left" | "center" | "right" | "justified" | null;
    layoutMode: "NONE" | "HORIZONTAL" | "VERTICAL" | null;
  };
};

export type DesignConstraint = {
  id: string;
  kind: DesignConstraintKind;
  elementIds: string[];
  axis: "x" | "y" | "both" | null;
  targetValue: number | null;
  tolerance: number | null;
  hard: boolean;
  description: string;
};

export type DesignScene = {
  id: string;
  mode: DesignTaskMode;
  rootBounds: DesignBounds;
  source: {
    kind: "reconstruction-job-compat";
    sourceId: string;
  };
  elements: DesignElement[];
  constraints: DesignConstraint[];
};

export type DesignIterationPolicy = {
  regionScoped: boolean;
  maxChangedClustersPerPass: number;
  acceptOnlyOnImprovement: boolean;
  stopOnModeDrift: boolean;
  editabilityRequired: boolean;
};

export type DesignRegionCluster = {
  id: string;
  name: string;
  bounds: DesignBounds;
  elementIds: string[];
};

export type DesignRegionPassResult = {
  mode: DesignTaskMode;
  regionClusterId: string | null;
  changedElementIds: string[];
  outcome: DesignIterationOutcome;
  stopReason: DesignIterationStopReason | null;
  beforeScore: number | null;
  afterScore: number;
  scoreDelta: number | null;
  editabilitySatisfied: boolean;
  hardFailures: string[];
  warnings: string[];
};

export type DesignCaseRecord = {
  id: string;
  mode: DesignTaskMode;
  taskId: string;
  regionClusterId: string | null;
  heuristicId: string | null;
  outcome: DesignIterationOutcome;
  stopReason: DesignIterationStopReason | null;
  beforeScore: number | null;
  afterScore: number;
  scoreDelta: number | null;
  createdAt: string;
  notes: string[];
};

export type DesignElementScorecard = {
  elementId: string;
  elementName: string;
  role: DesignElementRole;
  compositeScore: number;
  geometryScore: number;
  styleScore: number;
  typographyScore: number;
  alignmentScore: number;
  editabilityScore: number;
  hardFailures: string[];
  notes: string[];
};

export type DesignScorecard = {
  mode: DesignTaskMode;
  compositeScore: number;
  grade: DesignScoreGrade;
  elementCount: number;
  hardFailures: string[];
  notes: string[];
  iterationPolicy: DesignIterationPolicy;
  elements: DesignElementScorecard[];
};

export type DesignTaskSnapshot = {
  taskId: string;
  sourceTask: {
    kind: "reconstruction-job";
    sourceId: string;
    strategy: string;
  };
  mode: DesignTaskMode;
  intent: DesignIntent;
  scene: DesignScene;
  scorecard: DesignScorecard | null;
};
