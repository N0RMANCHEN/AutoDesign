export type BatchExecutionContext = {
  analysisRefs: Map<string, string>;
};

const ANALYSIS_REF_PREFIX = "analysis:";
const ANALYSIS_REF_SHARED_NAMESPACE = "autodesign";
const ANALYSIS_REF_SHARED_KEY = "analysisRef";

export function createBatchExecutionContext(): BatchExecutionContext {
  return {
    analysisRefs: new Map(),
  };
}

export function normalizeAnalysisRefId(value: string) {
  return value.trim().replace(/^analysis:/, "");
}

export function resolveBatchNodeId(context: BatchExecutionContext | null, nodeId: string) {
  const trimmed = nodeId.trim();
  if (!trimmed.startsWith(ANALYSIS_REF_PREFIX)) {
    return trimmed;
  }

  const analysisRefId = normalizeAnalysisRefId(trimmed);
  const resolved = context?.analysisRefs.get(analysisRefId) || null;
  if (!resolved) {
    throw new Error(`analysis ref "${analysisRefId}" 未在当前 batch 中注册。`);
  }
  return resolved;
}

export function registerAnalysisRefId(
  context: BatchExecutionContext | null,
  analysisRefId: string | undefined,
  nodeId: string,
) {
  if (!analysisRefId || !context) {
    return;
  }

  context.analysisRefs.set(normalizeAnalysisRefId(analysisRefId), nodeId);
}

export function persistAnalysisRefId(node: any, analysisRefId: string | undefined) {
  if (!analysisRefId || !node || typeof node.setSharedPluginData !== "function") {
    return;
  }

  node.setSharedPluginData(
    ANALYSIS_REF_SHARED_NAMESPACE,
    ANALYSIS_REF_SHARED_KEY,
    normalizeAnalysisRefId(analysisRefId),
  );
}
