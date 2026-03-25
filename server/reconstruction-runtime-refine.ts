import type { FigmaCapabilityCommand } from "../shared/plugin-contract.js";
import type {
  ReconstructionBounds,
  ReconstructionFontMatch,
  ReconstructionJob,
  ReconstructionLoopStopReason,
  ReconstructionRegion,
  ReconstructionTextCandidate,
} from "../shared/reconstruction.js";
import { RECONSTRUCTION_ACTIONABLE_CONFIDENCE } from "../shared/reconstruction.js";
import { blendBounds, overlapScore, projectBounds } from "./reconstruction-runtime-geometry.js";

type AppliedRebuildNode = {
  nodeId: string;
  kind: "surface" | "text";
  normalizedBounds: ReconstructionBounds;
  absoluteBounds: ReconstructionBounds;
  fillHex: string | null;
  textCandidate: ReconstructionTextCandidate | null;
  region: ReconstructionRegion | null;
  fontMatch: ReconstructionFontMatch | null;
};

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}

function buildAppliedRebuildNodes(job: ReconstructionJob): AppliedRebuildNode[] {
  if (!job.analysis || !job.rebuildPlan) {
    return [];
  }

  const analysis = job.analysis;
  const targetWidth = job.targetNode.width || analysis.width;
  const targetHeight = job.targetNode.height || analysis.height;
  const appliedNodes: AppliedRebuildNode[] = [];
  let surfaceIndex = 0;
  let textIndex = 0;

  job.rebuildPlan.ops.forEach((command, index) => {
    const nodeId = job.appliedNodeIds[index];
    if (!nodeId || command.type !== "capability") {
      return;
    }

    if (command.capabilityId === "nodes.create-frame") {
      const region = analysis.layoutRegions[surfaceIndex] || null;
      surfaceIndex += 1;
      if (!region) {
        return;
      }

      const payload = command.payload as FigmaCapabilityCommand<"nodes.create-frame">["payload"];
      const projected = projectBounds(region.bounds, targetWidth, targetHeight);
      appliedNodes.push({
        nodeId,
        kind: "surface",
        normalizedBounds: region.bounds,
        absoluteBounds: {
          x: Number.isFinite(payload.x) ? Number(payload.x) : projected.x,
          y: Number.isFinite(payload.y) ? Number(payload.y) : projected.y,
          width: Number.isFinite(payload.width) ? Number(payload.width) : projected.width,
          height: Number.isFinite(payload.height) ? Number(payload.height) : projected.height,
        },
        fillHex: payload.fillHex || region.fillHex || analysis.styleHints.accentColorHex || null,
        textCandidate: null,
        region,
        fontMatch: null,
      });
      return;
    }

    if (command.capabilityId === "nodes.create-text") {
      const textCandidate = analysis.textCandidates[textIndex] || null;
      const fontMatch =
        textCandidate && job.fontMatches.find((item) => item.textCandidateId === textCandidate.id)
          ? job.fontMatches.find((item) => item.textCandidateId === textCandidate.id) || null
          : null;
      textIndex += 1;
      if (!textCandidate) {
        return;
      }

      const payload = command.payload as FigmaCapabilityCommand<"nodes.create-text">["payload"];
      const projected = projectBounds(textCandidate.bounds, targetWidth, targetHeight);
      appliedNodes.push({
        nodeId,
        kind: "text",
        normalizedBounds: textCandidate.bounds,
        absoluteBounds: {
          x: Number.isFinite(payload.x) ? Number(payload.x) : projected.x,
          y: Number.isFinite(payload.y) ? Number(payload.y) : projected.y,
          width: projected.width,
          height: projected.height,
        },
        fillHex: payload.colorHex || null,
        textCandidate,
        region: null,
        fontMatch,
      });
    }
  });

  return appliedNodes;
}

function findBestAppliedNode(
  nodes: AppliedRebuildNode[],
  kind: AppliedRebuildNode["kind"],
  normalizedBounds: ReconstructionBounds | null,
) {
  const candidates = nodes.filter((node) => node.kind === kind);
  if (!candidates.length) {
    return null;
  }
  if (!normalizedBounds) {
    return candidates[0];
  }

  return [...candidates].sort(
    (left, right) =>
      overlapScore(right.normalizedBounds, normalizedBounds) -
      overlapScore(left.normalizedBounds, normalizedBounds),
  )[0];
}

function uniqueHexPalette(job: ReconstructionJob) {
  return uniqueStrings([
    job.analysis?.styleHints.primaryColorHex || "",
    job.analysis?.styleHints.accentColorHex || "",
    ...(job.analysis?.dominantColors || []),
  ]);
}

function isActionableSuggestion(job: ReconstructionJob, suggestion: ReconstructionJob["refineSuggestions"][number]) {
  return (
    suggestion.kind !== "manual-review" &&
    suggestion.confidence >= RECONSTRUCTION_ACTIONABLE_CONFIDENCE &&
    job.applyStatus === "applied"
  );
}

export function resolveLoopStopReason(job: ReconstructionJob): ReconstructionLoopStopReason | null {
  if (job.stopReason) {
    return job.stopReason;
  }
  if (job.status === "completed") {
    const compositeScore = job.diffMetrics?.compositeScore || job.diffScore || 0;
    const hardGateFailed = Boolean(job.diffMetrics?.acceptanceGates.some((gate) => gate.hard && !gate.passed));
    if (compositeScore >= 0.9 && !hardGateFailed) {
      return "target_reached";
    }
    if (job.iterationCount >= job.input.maxIterations) {
      return "max_iterations";
    }
    if (job.stagnationCount >= 2) {
      return "stalled";
    }
    return "no_actionable_suggestions";
  }
  return null;
}

export function buildAutoRefineCommands(job: ReconstructionJob) {
  if (!job.analysis || !job.rebuildPlan || !job.appliedNodeIds.length) {
    return {
      commands: [] as FigmaCapabilityCommand[],
      warnings: ["Reconstruction job 缺少分析结果或已应用节点，无法生成自动 refine 命令。"],
    };
  }

  const appliedNodes = buildAppliedRebuildNodes(job);
  const targetWidth = job.targetNode.width || job.analysis.width;
  const targetHeight = job.targetNode.height || job.analysis.height;
  const palette = uniqueHexPalette(job);
  const issued = new Set<string>();
  const commands: FigmaCapabilityCommand[] = [];
  const warnings: string[] = [];

  const pushCommand = (command: FigmaCapabilityCommand) => {
    const key = JSON.stringify({
      capabilityId: command.capabilityId,
      nodeIds: command.nodeIds || [],
      payload: command.payload,
    });
    if (issued.has(key)) {
      return;
    }
    issued.add(key);
    commands.push(command);
  };

  for (const suggestion of job.refineSuggestions) {
    if (!isActionableSuggestion(job, suggestion)) {
      continue;
    }

    if (suggestion.kind === "nudge-fill") {
      const node = findBestAppliedNode(appliedNodes, "surface", suggestion.bounds);
      if (!node) {
        warnings.push("没有找到可执行 fill refine 的 surface 节点。");
        continue;
      }

      const preferredHex =
        node.region?.fillHex ||
        (node.region?.kind === "emphasis"
          ? job.analysis.styleHints.accentColorHex
          : job.analysis.styleHints.primaryColorHex) ||
        palette[0] ||
        node.fillHex;
      const fillHex =
        job.stagnationCount > 0
          ? palette.find((hex) => hex !== preferredHex && hex !== node.fillHex) || preferredHex
          : preferredHex;
      if (!fillHex) {
        warnings.push(`节点 ${node.nodeId} 缺少可用 fill 颜色。`);
        continue;
      }

      pushCommand({
        type: "capability",
        capabilityId: "fills.set-fill",
        nodeIds: [node.nodeId],
        payload: { hex: fillHex },
      });
      continue;
    }

    if (suggestion.kind === "nudge-layout") {
      const node = findBestAppliedNode(appliedNodes, "surface", suggestion.bounds);
      if (!node) {
        warnings.push("没有找到可执行 layout refine 的 surface 节点。");
        continue;
      }

      const hotspotBounds = suggestion.bounds
        ? projectBounds(suggestion.bounds, targetWidth, targetHeight)
        : node.absoluteBounds;
      const targetBounds = blendBounds(node.absoluteBounds, hotspotBounds, 0.35);

      pushCommand({
        type: "capability",
        capabilityId: "geometry.set-position",
        nodeIds: [node.nodeId],
        payload: { x: targetBounds.x, y: targetBounds.y },
      });
      pushCommand({
        type: "capability",
        capabilityId: "geometry.set-size",
        nodeIds: [node.nodeId],
        payload: { width: targetBounds.width, height: targetBounds.height },
      });
      continue;
    }

    if (suggestion.kind === "nudge-text") {
      const node = findBestAppliedNode(appliedNodes, "text", suggestion.bounds);
      if (!node || !node.textCandidate) {
        warnings.push("没有找到可执行 text refine 的文本节点。");
        continue;
      }

      const hotspotBounds = suggestion.bounds
        ? projectBounds(suggestion.bounds, targetWidth, targetHeight)
        : node.absoluteBounds;
      const projectedBounds = projectBounds(node.textCandidate.bounds, targetWidth, targetHeight);
      const targetBounds = blendBounds(projectedBounds, hotspotBounds, 0.25);
      const fontCandidates = node.fontMatch?.candidates || [];
      const fontFamily =
        job.stagnationCount > 0 ? fontCandidates[1] || node.fontMatch?.recommended : node.fontMatch?.recommended;
      const fontSize = Math.max(12, Math.round(projectedBounds.height * 0.82));
      const textColorHex =
        job.analysis.styleHints.theme === "dark"
          ? "#F5F7FF"
          : "#111111";

      pushCommand({
        type: "capability",
        capabilityId: "geometry.set-position",
        nodeIds: [node.nodeId],
        payload: { x: targetBounds.x, y: targetBounds.y },
      });
      pushCommand({
        type: "capability",
        capabilityId: "text.set-font-size",
        nodeIds: [node.nodeId],
        payload: { value: fontSize },
      });
      if (fontFamily) {
        pushCommand({
          type: "capability",
          capabilityId: "text.set-font-family",
          nodeIds: [node.nodeId],
          payload: { family: fontFamily },
        });
      }
      pushCommand({
        type: "capability",
        capabilityId: "text.set-text-color",
        nodeIds: [node.nodeId],
        payload: { hex: textColorHex },
      });
    }
  }

  return {
    commands: commands.slice(0, 8),
    warnings,
  };
}
