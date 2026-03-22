import type { PluginNodeSummary } from "./plugin-bridge.js";
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

export type ReconstructionAnalysis = {
  previewDataUrl: string;
  mimeType: string;
  width: number;
  height: number;
  dominantColors: string[];
  canonicalFrame: ReconstructionCanonicalFrame | null;
  layoutRegions: ReconstructionRegion[];
  designSurfaces: ReconstructionDesignSurface[];
  vectorPrimitives: ReconstructionVectorPrimitive[];
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
  previewOnly: true;
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

export type ReconstructionDiffMetrics = {
  globalSimilarity: number;
  colorDelta: number;
  edgeSimilarity: number;
  layoutSimilarity: number;
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
  targetPreviewDataUrl: string | null;
  currentAnalysis: ReconstructionAnalysis | null;
  currentFontMatches: ReconstructionFontMatch[];
  currentReviewFlags: ReconstructionReviewFlag[];
  currentWarnings: string[];
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
