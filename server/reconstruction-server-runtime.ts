import type { ReconstructionExecutionServiceDeps } from "./reconstruction-execution-service.js";
import {
  assertSuccessfulCommandRecord,
  collectChangedNodeIds,
  exportSingleNodeImage,
  inspectFrameSubtree,
  isReconstructionGeneratedInspectionNode,
  queueAndWaitForPluginBatch,
  requireLoopCompatibleSession,
  uniqueStrings,
} from "./plugin-runtime-bridge.js";
import {
  isHybridReconstructionJob,
  isRasterExactJob,
  isVectorReconstructionJob,
} from "./reconstruction-mode.js";
import {
  buildAutoRefineCommands,
  resolveLoopStopReason,
} from "./reconstruction-runtime-refine.js";
import {
  ensureHybridReference,
  ensureRasterReference,
  ensureVectorReference,
  resolveReferencePreviewForMeasurement,
} from "./reconstruction-runtime-references.js";
import { normalizeRebuildCommands } from "./reconstruction-runtime-rebuild.js";
import { buildStructureReport } from "./reconstruction-structure-report.js";
import {
  createReconstructionJobFromSelection,
  resolveReconstructionNodes,
} from "./reconstruction-selection.js";

export function createDefaultReconstructionExecutionDeps(): ReconstructionExecutionServiceDeps {
  return {
    isRasterExactJob,
    isVectorReconstructionJob,
    isHybridReconstructionJob,
    ensureRasterReference,
    ensureVectorReference,
    ensureHybridReference,
    queueAndWaitForPluginBatch,
    normalizeRebuildCommands,
    assertSuccessfulCommandRecord,
    collectChangedNodeIds,
    uniqueStrings,
    inspectFrameSubtree,
    isReconstructionGeneratedInspectionNode,
    exportSingleNodeImage,
    resolveReferencePreviewForMeasurement,
    buildStructureReport,
    requireLoopCompatibleSession,
    resolveLoopStopReason,
    buildAutoRefineCommands,
  };
}
export {
  assertSuccessfulCommandRecord,
  buildAutoRefineCommands,
  buildStructureReport,
  createReconstructionJobFromSelection,
  ensureHybridReference,
  ensureRasterReference,
  ensureVectorReference,
  exportSingleNodeImage,
  isHybridReconstructionJob,
  isRasterExactJob,
  isVectorReconstructionJob,
  normalizeRebuildCommands,
  queueAndWaitForPluginBatch,
  resolveLoopStopReason,
  resolveReconstructionNodes,
  resolveReferencePreviewForMeasurement,
  uniqueStrings,
};
