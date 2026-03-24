import type { PluginBridgeSession } from "../shared/plugin-bridge.js";
import type { CreateReconstructionJobPayload } from "../shared/reconstruction.js";

import { createReconstructionJob } from "./reconstruction-store.js";

export function resolveReconstructionNodes(
  session: PluginBridgeSession,
  payload: CreateReconstructionJobPayload,
) {
  const selection = Array.isArray(session.selection) ? session.selection : [];
  const targetNode = payload.targetNodeId
    ? selection.find((node) => node.id === payload.targetNodeId) || null
    : null;
  const referenceNode = payload.referenceNodeId
    ? selection.find((node) => node.id === payload.referenceNodeId) || null
    : null;

  const frameCandidates = selection.filter((node) => node.type === "FRAME");
  const imageCandidates = selection.filter((node) => node.fills.includes("image"));

  const resolvedTarget = targetNode || (frameCandidates.length === 1 ? frameCandidates[0] : null);
  const resolvedReference =
    referenceNode || (imageCandidates.length === 1 ? imageCandidates[0] : null);

  if (!resolvedTarget) {
    throw new Error("没有找到唯一可用的目标 Frame。请显式提供 targetNodeId，或确保 selection 中只有一个 Frame。");
  }

  if (!resolvedReference) {
    throw new Error(
      "没有找到唯一可用的参考图片节点。请显式提供 referenceNodeId，或确保 selection 中只有一个图片节点。",
    );
  }

  if (resolvedTarget.id === resolvedReference.id) {
    throw new Error("目标节点和参考节点不能是同一个节点。");
  }

  if (resolvedTarget.type !== "FRAME") {
    throw new Error(`目标节点必须是 FRAME，当前为 ${resolvedTarget.type}。`);
  }

  if (
    !resolvedReference.fills.includes("image") &&
    !(typeof resolvedReference.previewDataUrl === "string" && resolvedReference.previewDataUrl)
  ) {
    throw new Error("参考节点必须是可预览的图片节点。");
  }

  return {
    targetNode: resolvedTarget,
    referenceNode: resolvedReference,
  };
}

export async function createReconstructionJobFromSelection(
  session: PluginBridgeSession,
  payload: CreateReconstructionJobPayload,
) {
  const { targetNode, referenceNode } = resolveReconstructionNodes(session, payload);
  const warnings: string[] = [];

  if (payload.allowOutpainting) {
    warnings.push("allowOutpainting 已记录，但当前 tranche 仅建立任务，不会实际生成补图。");
  }

  return createReconstructionJob(payload, targetNode, referenceNode, warnings);
}
