import type { PluginNodeInspection, PluginNodeSummary } from "./plugin-bridge.js";
import type { FigmaCapabilityCommand } from "./plugin-contract.js";

export const RECONSTRUCTION_STAGE_IDS = [
  "validate-input",
  "extract-reference",
  "analyze-layout",
  "match-fonts",
  "plan-rebuild",
  "apply-rebuild",
  "render-preview",
  "measure-diff",
  "refine",
  "done",
] as const;

export type ReconstructionStageId = (typeof RECONSTRUCTION_STAGE_IDS)[number];
export type ReconstructionStageStatus = "pending" | "completed" | "failed";
export type ReconstructionJobStatus = "ready" | "failed" | "completed";
export type ReconstructionGoal = "pixel-match";
export type ReconstructionApplyStatus = "not_applied" | "applied";
export type ReconstructionLoopStatus = "idle" | "running" | "stopped";
export type ReconstructionStrategy =
  | "vector-reconstruction"
  | "hybrid-reconstruction"
  | "raster-exact"
  | "structural-preview";
export type ReconstructionAnalysisProvider =
  | "codex-assisted"
  | "heuristic-local"
  | "openai-responses";
export type ReconstructionLoopStopReason =
  | "target_reached"
  | "max_iterations"
  | "stalled"
  | "no_actionable_suggestions"
  | "error";

export const RECONSTRUCTION_TARGET_SIMILARITY = 0.9;
export const RECONSTRUCTION_MIN_IMPROVEMENT = 0.01;
export const RECONSTRUCTION_STAGNATION_LIMIT = 2;
export const RECONSTRUCTION_ACTIONABLE_CONFIDENCE = 0.6;

export type ReconstructionJobStage = {
  stageId: ReconstructionStageId;
  status: ReconstructionStageStatus;
  message: string;
  updatedAt: string | null;
};

export type ReconstructionInput = {
  targetSessionId: string;
  targetNodeId: string;
  referenceNodeId: string;
  goal: ReconstructionGoal;
  strategy: ReconstructionStrategy;
  maxIterations: number;
  allowOutpainting: boolean;
};

export type ReconstructionRasterAsset = {
  nodeId: string;
  mimeType: string;
  width: number;
  height: number;
  dataUrl: string;
  source: "image-fill-original" | "node-export";
};

export type ReconstructionBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ReconstructionPoint = {
  x: number;
  y: number;
};

export type ReconstructionCanonicalFrame = {
  width: number;
  height: number;
  fixedTargetFrame: boolean;
  deprojected: boolean;
  mappingMode: "extend" | "reflow" | "center";
  sourceQuad?: ReconstructionPoint[];
};

export type ReconstructionRegion = {
  id: string;
  kind: "surface" | "text-band" | "emphasis" | "unknown";
  confidence: number;
  bounds: ReconstructionBounds;
  fillHex: string | null;
};

export type ReconstructionTextCandidate = {
  id: string;
  confidence: number;
  bounds: ReconstructionBounds;
  estimatedRole: "headline" | "body" | "metric" | "label" | "unknown";
};

export type ReconstructionOcrBlock = {
  id: string;
  text: string | null;
  confidence: number;
  bounds: ReconstructionBounds;
  lineCount: number;
  language: string | null;
  source: "heuristic" | "ocr";
};

export type ReconstructionTextStyleHint = {
  textCandidateId: string;
  role: ReconstructionTextCandidate["estimatedRole"];
  fontCategory: "display" | "text" | "mono" | "unknown";
  fontWeightGuess: number | null;
  fontSizeEstimate: number | null;
  colorHex: string | null;
  alignmentGuess: "left" | "center" | "right" | "justified" | "unknown";
  lineHeightEstimate: number | null;
  letterSpacingEstimate: number | null;
  confidence: number;
};

export type ReconstructionAssetCandidate = {
  id: string;
  kind: "photo" | "illustration" | "icon-like" | "texture" | "background-slice";
  bounds: ReconstructionBounds;
  confidence: number;
  extractMode: "crop" | "trace" | "outpaint" | "ignore";
  needsOutpainting: boolean;
};

export type ReconstructionStyleHints = {
  theme: "light" | "dark";
  cornerRadiusHint: number;
  shadowHint: "none" | "soft";
  primaryColorHex: string | null;
  accentColorHex: string | null;
};

export type ReconstructionDesignSurface = {
  id: string;
  name: string | null;
  bounds: ReconstructionBounds;
  fillHex: string | null;
  cornerRadius: number | null;
  opacity: number | null;
  shadow: "none" | "soft" | null;
  inferred: boolean;
};

export type ReconstructionVectorPrimitive = {
  id: string;
  kind: "rectangle" | "ellipse" | "line" | "svg";
  name: string | null;
  bounds: ReconstructionBounds | null;
  points: ReconstructionPoint[];
  fillHex: string | null;
  strokeHex: string | null;
  strokeWeight: number | null;
  opacity: number | null;
  cornerRadius: number | null;
  svgMarkup: string | null;
  inferred: boolean;
};

export type ReconstructionTextBlock = {
  id: string;
  bounds: ReconstructionBounds;
  role: "headline" | "body" | "metric" | "label" | "unknown";
  content: string;
  inferred: boolean;
  fontFamily: string;
  fontStyle: string | null;
  fontWeight: number | null;
  fontSize: number;
  lineHeight: number | null;
  letterSpacing: number | null;
  alignment: "left" | "center" | "right" | "justified";
  colorHex: string | null;
};

export type ReconstructionCompletionZone = {
  id: string;
  bounds: ReconstructionBounds;
  reason: "extend-background" | "extend-layout" | "inferred-panel" | "unknown";
};

export type ReconstructionDeprojectionNote = {
  id: string;
  message: string;
  targetId: string | null;
};

export type ReconstructionScreenPlane = {
  extracted: boolean;
  excludesNonUiShell: boolean;
  confidence: number;
  sourceQuad: ReconstructionPoint[];
  rectifiedPreviewDataUrl: string | null;
};

export type ReconstructionSemanticNode = {
  id: string;
  name: string;
  kind:
    | "screen-root"
    | "header"
    | "section"
    | "card"
    | "pill"
    | "group"
    | "text"
    | "primitive";
  parentId: string | null;
  bounds: ReconstructionBounds;
  inferred: boolean;
  surfaceRefId: string | null;
  textRefId: string | null;
  primitiveRefId: string | null;
  layoutMode: "NONE" | "HORIZONTAL" | "VERTICAL";
  itemSpacing: number | null;
  paddingTop: number | null;
  paddingRight: number | null;
  paddingBottom: number | null;
  paddingLeft: number | null;
  fillHex: string | null;
  cornerRadius: number | null;
  componentName: string | null;
};

export type ReconstructionElementKind =
  | "surface"
  | "text"
  | "icon"
  | "primitive"
  | "group";

export type ReconstructionElementEditableKind =
  | "frame"
  | "text"
  | "shape"
  | "vector"
  | "group";

export type ReconstructionElementStatus = "todo" | "drawing" | "review" | "locked";

export type ReconstructionElementConstraintKind =
  | "align-top"
  | "align-bottom"
  | "align-left"
  | "align-right"
  | "share-baseline"
  | "share-typography"
  | "same-parent"
  | "padding-lock";

export type ReconstructionElement = {
  id: string;
  kind: ReconstructionElementKind;
  editableKind: ReconstructionElementEditableKind;
  name: string;
  parentId: string | null;
  referenceBounds: ReconstructionBounds;
  targetBounds: ReconstructionBounds | null;
  analysisRefId: string | null;
  content: string | null;
  surfaceRefId: string | null;
  textRefId: string | null;
  primitiveRefId: string | null;
  status: ReconstructionElementStatus;
  inferred: boolean;
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

export type ReconstructionElementConstraint = {
  id: string;
  kind: ReconstructionElementConstraintKind;
  elementIds: string[];
  axis: "x" | "y" | "both" | null;
  targetValue: number | null;
  tolerance: number | null;
  hard: boolean;
  inferred: boolean;
  description: string;
};

export type ReconstructionElementScore = {
  elementId: string;
  elementName: string;
  kind: ReconstructionElementKind;
  inspectedNodeId: string | null;
  matchStrategy: "analysis-ref" | "heuristic" | "missing";
  referenceBounds: ReconstructionBounds;
  targetBounds: ReconstructionBounds | null;
  pixelScore: number;
  geometryScore: number;
  styleScore: number;
  typographyScore: number;
  alignmentScore: number;
  editabilityScore: number;
  compositeScore: number;
  grade: ReconstructionDiffGrade;
  hardFailures: string[];
  notes: string[];
};

export type ReconstructionDesignTokens = {
  colors: {
    canvas: string | null;
    accent: string | null;
    foreground: string | null;
    mutedForeground: string | null;
    pillBackground: string | null;
  };
  radiusScale: number[];
  spacingScale: number[];
  typography: {
    displayFamily: string | null;
    textFamily: string | null;
    headlineSize: number | null;
    bodySize: number | null;
    labelSize: number | null;
    metricSize: number | null;
  };
};

export type ReconstructionCompletionSuggestion = {
  id: string;
  name: string;
  bounds: ReconstructionBounds;
  strategy: "conservative-extend" | "continue-module-stack" | "leave-minimal";
  summary: string;
  priority: "low" | "medium" | "high";
  inferred: boolean;
};

export type ReconstructionAnalysis = {
  previewDataUrl: string;
  mimeType: string;
  width: number;
  height: number;
  dominantColors: string[];
  canonicalFrame: ReconstructionCanonicalFrame | null;
  screenPlane: ReconstructionScreenPlane | null;
  layoutRegions: ReconstructionRegion[];
  designSurfaces: ReconstructionDesignSurface[];
  vectorPrimitives: ReconstructionVectorPrimitive[];
  semanticNodes: ReconstructionSemanticNode[];
  elements?: ReconstructionElement[];
  elementConstraints?: ReconstructionElementConstraint[];
  designTokens: ReconstructionDesignTokens | null;
  completionPlan: ReconstructionCompletionSuggestion[];
  textCandidates: ReconstructionTextCandidate[];
  textBlocks: ReconstructionTextBlock[];
  ocrBlocks: ReconstructionOcrBlock[];
  textStyleHints: ReconstructionTextStyleHint[];
  assetCandidates: ReconstructionAssetCandidate[];
  completionZones: ReconstructionCompletionZone[];
  deprojectionNotes: ReconstructionDeprojectionNote[];
  styleHints: ReconstructionStyleHints;
  uncertainties: string[];
};

export type ReconstructionFontMatch = {
  textCandidateId: string;
  recommended: string;
  candidates: string[];
  confidence: number;
};

export type ReconstructionReviewFlag = {
  id: string;
  kind:
    | "ocr-missing"
    | "ocr-low-confidence"
    | "font-review"
    | "asset-review"
    | "outpainting-not-supported"
    | "preview-plan-review";
  severity: "info" | "warning" | "critical";
  message: string;
  targetId: string | null;
};

export type ReconstructionApprovalState =
  | "not-reviewed"
  | "pending-review"
  | "approved"
  | "changes-requested";

export type ReconstructionApprovedFontChoice = {
  textCandidateId: string;
  fontFamily: string;
  approvedAt: string;
};

export type ReconstructionApprovedAssetChoice = {
  assetId: string;
  decision: "approved" | "rejected";
  approvedAt: string;
  note?: string;
};

export type ReconstructionPlan = {
  previewOnly: boolean;
  summary: string[];
  ops: FigmaCapabilityCommand[];
};

export type ReconstructionRenderedPreview = {
  previewDataUrl: string;
  mimeType: string;
  width: number;
  height: number;
  capturedAt: string;
};

export type ReconstructionDiffHotspot = {
  id: string;
  score: number;
  bounds: ReconstructionBounds;
};

export type ReconstructionAcceptanceGate = {
  id: string;
  label: string;
  metric: string;
  comparator: "gte" | "lte";
  threshold: number;
  actual: number;
  passed: boolean;
  hard: boolean;
};

export type ReconstructionDiffGrade = "A" | "B" | "C" | "D" | "F";

export type ReconstructionDiffMetrics = {
  globalSimilarity: number;
  colorDelta: number;
  edgeSimilarity: number;
  layoutSimilarity: number;
  structureSimilarity: number;
  hotspotAverage: number;
  hotspotPeak: number;
  hotspotCoverage: number;
  compositeScore: number;
  grade: ReconstructionDiffGrade;
  acceptanceGates: ReconstructionAcceptanceGate[];
  hotspots: ReconstructionDiffHotspot[];
};

export type ReconstructionStructureReport = {
  targetFramePreserved: boolean | null;
  imageFillNodeCount: number;
  textNodeCount: number;
  vectorNodeCount: number;
  inferredTextCount: number;
  passed: boolean;
  issues: string[];
};

export type ReconstructionRefineSuggestion = {
  id: string;
  kind: "nudge-fill" | "nudge-layout" | "nudge-text" | "manual-review";
  confidence: number;
  message: string;
  bounds: ReconstructionBounds | null;
};

export type ReconstructionJob = {
  id: string;
  analysisVersion: string;
  analysisProvider: ReconstructionAnalysisProvider;
  input: ReconstructionInput;
  status: ReconstructionJobStatus;
  applyStatus: ReconstructionApplyStatus;
  loopStatus: ReconstructionLoopStatus;
  stopReason: ReconstructionLoopStopReason | null;
  approvalState: ReconstructionApprovalState;
  currentStageId: ReconstructionStageId;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  lastAppliedAt: string | null;
  diffScore: number | null;
  bestDiffScore: number | null;
  lastImprovement: number | null;
  stagnationCount: number;
  warnings: string[];
  targetNode: PluginNodeSummary;
  referenceNode: PluginNodeSummary;
  referenceRaster: ReconstructionRasterAsset | null;
  analysis: ReconstructionAnalysis | null;
  fontMatches: ReconstructionFontMatch[];
  rebuildPlan: ReconstructionPlan | null;
  reviewFlags: ReconstructionReviewFlag[];
  approvedFontChoices: ReconstructionApprovedFontChoice[];
  approvedAssetChoices: ReconstructionApprovedAssetChoice[];
  renderedPreview: ReconstructionRenderedPreview | null;
  diffMetrics: ReconstructionDiffMetrics | null;
  structureReport: ReconstructionStructureReport | null;
  refineSuggestions: ReconstructionRefineSuggestion[];
  iterationCount: number;
  appliedNodeIds: string[];
  stages: ReconstructionJobStage[];
};

export type ReconstructionJobSnapshot = {
  jobs: ReconstructionJob[];
};

export type ReconstructionGuideManifest = {
  jobId: string;
  targetFrame: {
    id: string;
    width: number | null;
    height: number | null;
  };
  images: {
    referencePreviewDataUrl: string | null;
    rectifiedPreviewDataUrl: string | null;
    renderedPreviewDataUrl: string | null;
  };
  elements: ReconstructionElement[];
  constraints: ReconstructionElementConstraint[];
};

export type ReconstructionElementScoresPayload = {
  inspectedNodes: PluginNodeInspection[];
  renderedPreviewDataUrl?: string | null;
  elementIds?: string[];
};

export type ReconstructionElementScoresResponse = {
  jobId: string;
  referencePreviewKind: "rectified" | "reference";
  liveNodeCount: number;
  scores: ReconstructionElementScore[];
};

export type CreateReconstructionJobPayload = {
  targetSessionId: string;
  targetNodeId?: string;
  referenceNodeId?: string;
  goal?: ReconstructionGoal;
  strategy?: ReconstructionStrategy;
  maxIterations?: number;
  allowOutpainting?: boolean;
};

export type ReviewReconstructionFontPayload = {
  textCandidateId: string;
  fontFamily: string;
};

export type ReviewReconstructionAssetPayload = {
  assetId: string;
  decision: "approved" | "rejected";
  note?: string;
};

export type ApproveReconstructionPlanPayload = {
  approved: boolean;
  note?: string;
};

export type ReconstructionContextPack = {
  jobId: string;
  mode: "codex-assisted";
  analysisProvider: "codex-assisted";
  analysisVersionTarget: string;
  generatedAt: string;
  strategy: ReconstructionStrategy;
  targetNode: PluginNodeSummary;
  referenceNode: PluginNodeSummary;
  referencePreviewDataUrl: string;
  referenceRectifiedPreviewDataUrl: string | null;
  targetPreviewDataUrl: string | null;
  currentAnalysis: ReconstructionAnalysis | null;
  currentFontMatches: ReconstructionFontMatch[];
  currentReviewFlags: ReconstructionReviewFlag[];
  currentWarnings: string[];
  workflow: string[];
  scoringRubric: string[];
  guidance: string[];
};

export type SubmitReconstructionAnalysisPayload = {
  analysisVersion?: string;
  analysisProvider?: ReconstructionAnalysisProvider;
  analysis: unknown;
  fontMatches?: ReconstructionFontMatch[];
  reviewFlags?: ReconstructionReviewFlag[];
  warnings?: string[];
};
